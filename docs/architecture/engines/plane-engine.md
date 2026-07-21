# Engine Study: Plane (Community Edition) → AI Project Manager Employee

**Source**: real clone of `makeplane/plane` at `C:\Users\Admin\AppData\Local\Temp\claude\plane-src`
(Django backend `apps/api`, Next.js frontend `apps/web`, public-site app `apps/space`, admin console
`apps/admin`, realtime collab server `apps/live`, edge `apps/proxy`), read directly file-by-file, plus
official docs at `docs.plane.so` / `developers.plane.so` (fetched live). Anything not directly
confirmed from one of these two sources is marked **NOT VERIFIED**.

**License**: AGPL-3.0-only (SPDX header on every source file read, e.g.
`apps/api/plane/db/models/issue.py:2`). No `ee/` directory exists anywhere in the Django backend
(`apps/api`); the only `ee/` folder in the whole repo is `packages/editor/src/ee/` (two small files,
`extensions/index.ts` and `types/index.ts` — editor-extension seams, not a licensing wall). All four
`deployments/*` targets (`aio`, `cli`, `kubernetes`, `swarm`) contain only a `community/` subfolder —
no `enterprise/` sibling exists in this clone. The `Instance` model
(`apps/api/plane/license/models/instance.py`) has a single hardcoded edition value,
`InstanceEdition.PLANE_COMMUNITY`. **Conclusion: this clone is genuinely a single-edition, fully-open
Community Edition** — there is no in-repo feature-flag/license-check gate to find. (Plane Cloud/Business/
Enterprise plans are documented as pricing tiers on plane.so, but nothing in this source tree
implements a gate for them — see §18.)

---

## 1. Executive Summary

Plane is a self-hostable project/issue-tracking system (Linear/Jira-class): Workspaces → Projects →
Work Items (Issues), organized further by Cycles (sprints), Modules (epics/feature groups), States,
and Labels. Backend is Django + Django REST Framework (`apps/api`) backed by Postgres, Redis (cache/
sessions/rate-limit), and RabbitMQ (Celery broker); a Next.js web app, a separate Next.js "space"
app (public/deploy boards), a Next.js admin console, and a small realtime "live" server (Hocuspocus,
for collaborative rich-text editing) round out the monorepo. Two REST surfaces exist side by side:
an **internal `app/` API** (session-cookie auth, used by the web app itself, unversioned, subject to
change) and a **stable public `api/` API** (`/api/v1/...`, API-key or OAuth auth, documented at
developers.plane.so, intended for integrations). A real webhook system (HMAC-signed, SSRF-hardened,
Celery-retried) and — critically — an official **MCP server** (`plane-mcp-server`, self-hostable via
stdio, exposing "Plane's full API surface as MCP tools") make Plane a very clean black-box backend
for an AI agent. For Orlixa's "AI Project Manager Employee," the recommended pattern mirrors the
Postiz engine study: **run vanilla self-hosted Plane (Community Edition, which is the whole product
here), never embed or fork it, and call it only through its public `api/v1` REST endpoints (or
its MCP server as a ready-made tool adapter)** — never show a user Plane's own UI.

## 2. Architecture Diagram

```
                    ┌───────────────┐        ┌───────────────┐
   Browser ───────► │  apps/web     │        │  apps/admin   │  Next.js instance console
                    │  (Next.js)    │        └───────┬───────┘
                    └───────┬───────┘                │
   Public/deploy   ┌────────▼───────┐                │
   boards ───────► │  apps/space    │                │
                    │  (Next.js)     │                │
                    └────────┬───────┘                │
                             │ REST (session cookie or X-Api-Key)
   3rd-party/AI ──────────────────────────────────────▼
   agent (public   ┌─────────────────────────────────────────┐
   api/v1, MCP) ──► │            apps/api  (Django)            │
                    │  app/  = internal API (session auth)     │
                    │  api/  = public v1 API (API-key/OAuth)    │
                    │  authentication/ = login, OAuth, magic-link
                    │  license/ = instance config (CE-only here)│
                    └──────┬───────────────┬───────────┬───────┘
                           │               │           │
                   ┌───────▼─────┐  ┌──────▼─────┐ ┌───▼────────┐
                   │  Postgres   │  │   Redis    │ │  RabbitMQ  │
                   │ (all data)  │  │ (cache/    │ │ (Celery    │
                   │             │  │ sessions/  │ │  broker)   │
                   │             │  │ rate-limit)│ │            │
                   └─────────────┘  └────────────┘ └─────┬──────┘
                                                          │
                                              ┌───────────▼────────────┐
                                              │  bgworker (Celery      │
                                              │  worker) + beatworker  │
                                              │  (Celery beat)         │
                                              │  → webhook_send_task,  │
                                              │    email, exports,     │
                                              │    issue_activity...   │
                                              └────────────────────────┘
   apps/live (Hocuspocus realtime collab server, separate container, for rich-text co-editing)
   apps/proxy (nginx-based edge/reverse proxy container, fronts web/api/space/admin)
   S3-compatible storage (MinIO in self-host compose) for file assets
```
(Derived from `docker-compose.yml`, `apps/api/plane/settings/common.py`, and the app directory
listing under `apps/`.)

## 3. Component Diagram

Top-level `apps/`: `api` (Django backend — the only backend), `web` (main Next.js product UI),
`space` (Next.js — public deploy-boards/guest views), `admin` (Next.js — instance/God-mode admin
console), `live` (realtime collaborative-editing server), `proxy` (nginx reverse-proxy container,
`Dockerfile.ce` confirms Community Edition build). `packages/`: `editor` (rich-text editor, has the
one `ee/` sub-seam noted above), `types`, `ui`, `i18n`, `constants`, `hooks`, `utils`, `services`,
`shared-state`, `propel`, `decorators`, `logger`, `codemods`, `tailwind-config`,
`typescript-config`. Inside `apps/api/plane`: `app/` (internal DRF views/serializers/urls),
`api/` (public v1 DRF views/serializers/urls — separately versioned and documented), `authentication/`
(session, OAuth providers: Google/GitHub/GitLab/Gitea, magic-link/email/password), `db/` (all Django
models + migrations), `bgtasks/` (Celery task modules), `license/` (Instance/InstanceAdmin/
InstanceConfiguration models — self-host instance config, not a paid-tier gate), `space/` (backend
views serving the `apps/space` public boards), `web/` (misc web-serving glue), `analytics/`,
`throttles/`, `middleware/`.

## 4. Request Flow — "create a work item via the public API"

Traced directly in `apps/api/plane/api/views/issue.py` (`IssueListCreateAPIEndpoint.post`,
lines ~449-520):

1. Client sends `POST /api/v1/workspaces/{slug}/projects/{project_id}/issues/` with `X-Api-Key`
   header (or `Authorization: Bearer` OAuth token).
2. `APIKeyAuthentication.authenticate` (`plane/api/middleware/api_authentication.py`) looks up
   `APIToken` by token, checks `is_active` + not expired, updates `last_used`, and returns the
   owning `user` — so every write is attributed to a real Django `User` (a "Bot" user_type is
   supported: `APIToken.user_type` choices `(0,"Human"),(1,"Bot")`).
3. View loads `Project` by `project_id` (workspace-scoping enforced by `project.workspace_id`
   flowing into the serializer context — this is how tenant isolation gets enforced per-request,
   see §15).
4. `IssueSerializer(data=request.data, context={project_id, workspace_id, default_assignee_id})`
   validates; `serializer.save()` triggers `Issue.save()` (`db/models/issue.py`), which:
   - takes a **Postgres advisory transaction lock** keyed on the project UUID
     (`pg_advisory_xact_lock`) so concurrent creates in the same project can't race on
     `sequence_id`,
   - computes the next `sequence_id` (the human-facing `PROJ-123` number) from `IssueSequence`,
   - strips HTML for `description_stripped`,
   - assigns a default `State` if none given (`_ensure_default_state`),
   - creates an `IssueSequence` row.
5. Back in the view: dual dispatch to Celery —
   `issue_activity.delay(...)` (writes `IssueActivity` audit-trail rows + drives in-app
   notifications) and `model_activity.delay(...)` (`plane/bgtasks/webhook_task.py`), which diffs
   the payload and calls `webhook_activity.delay(event="issue", verb="created", ...)`.
6. `webhook_activity` (Celery task) filters `Webhook` rows for the workspace where `issue=True` and
   `is_active=True`, and for each one enqueues `webhook_send_task.delay(...)`.
7. `webhook_send_task` (Celery, `autoretry_for=RequestException, max_retries=5, retry_backoff=600,
   retry_jitter=True`) builds the payload, HMAC-signs it with the webhook's `secret_key`
   (`X-Plane-Signature` header), and POSTs it via `pinned_fetch` — a hardened fetch that resolves +
   validates the destination IP and pins the connection to it (closing a DNS-rebinding SSRF gap,
   explicitly documented in the code as fixing `GHSA-mq87-52pf-hm3h`), never follows redirects, and
   logs every attempt to `WebhookLog`. After 5 failed retries the webhook is auto-deactivated and an
   email is sent to its creator (`send_webhook_deactivation_email`).
8. Response: the created `Issue` (serialized) returns synchronously to the API caller; steps 5-7 are
   fully async side effects.

## 5. Authentication Flow

Two independent mechanisms, both verified in source:

- **Interactive/browser login (session-based)**: `apps/api/plane/authentication/urls.py` wires
  `sign-in`, `sign-up`, `magic-generate`/`magic-sign-in` (passwordless email-code flow,
  `authentication/provider/credentials/magic_code.py`), and OAuth initiate/callback endpoints for
  Google, GitHub, GitLab, and Gitea (`authentication/provider/oauth/*.py`). On success Django's
  session framework issues a session cookie; `BaseSessionAuthentication`
  (`authentication/session.py`) is `SessionAuthentication` with CSRF enforcement disabled for the
  REST endpoints (`enforce_csrf` overridden to a no-op) — DRF views instead rely on the session
  cookie for auth. `CSRFTokenEndpoint` exists for the browser SPA to still fetch/attach a CSRF token
  for state-changing calls. `space/` app duplicates equivalent sign-in/sign-up/magic-link endpoints
  under `/spaces/...` for the public-facing app.
- **Programmatic access (API tokens)**: `APIToken` model (`db/models/api.py`) — `label`,
  `token` (default `"plane_api_" + uuid4().hex`), `user` (owner, human or bot), `workspace`
  (scoped or null), `expired_at`, `is_service`, `allowed_rate_limit` (per-token rate limit string,
  default `"60/min"`). Sent as `X-Api-Key` header; validated by `APIKeyAuthentication`
  (`api/middleware/api_authentication.py`), which enforces `is_active`, non-expired, and active user,
  and stamps `last_used`.
- **OAuth app tokens** (Bearer): per official docs (`developers.plane.so/dev-tools/build-plane-app`),
  a separate "Build a Plane app" OAuth framework issues Bot-Token or User-Token OAuth credentials
  for registered third-party apps, sent as `Authorization: Bearer <token>` — this is a superset
  mechanism on top of the simpler API-key path, aimed at multi-tenant integration builders.
  **NOT independently verified in this backend source clone** (the OAuth-app registration/scopes
  code was not located under `apps/api` in the time available) — treat as **NOT VERIFIED** beyond
  the docs' own description.

## 6. Database Design (real models, file-cited)

- **Workspace** (`db/models/workspace.py`) — tenant root: `name`, `slug` (unique, validated against
  `RESTRICTED_WORKSPACE_SLUGS`), `owner`, `timezone`. Soft-delete appends an epoch suffix to `slug`
  on delete so slugs can be reused.
- **WorkspaceMember** (`workspace.py`) — `workspace` FK, `member` FK (User), `role` (`20=Admin,
  15=Member, 5=Guest`), per-user view/filter/display preference JSON blobs.
- **Project** (`db/models/project.py`) — `workspace` FK, `identifier` (short code, e.g. `ENG`),
  `network` (0=Secret/2=Public), `default_assignee`, `project_lead`, `estimate` FK, `default_state`
  FK, feature toggles (`module_view`, `cycle_view`, `intake_view`, `is_time_tracking_enabled`,
  `is_issue_type_enabled`), `archive_in`/`close_in` (auto-archive month counters), `timezone`.
- **ProjectMember** (`project.py`) — per-project role + per-project sort-order/preferences.
- **Issue** (`db/models/issue.py`, "work item") — `project`/`workspace` (via `ProjectBaseModel`),
  `parent` (self-FK for sub-issues), `state` FK, `estimate_point` FK, `priority` (urgent/high/
  medium/low/none), `sequence_id` (per-project incrementing number via `IssueSequence` +
  Postgres advisory lock), `assignees` (M2M through `IssueAssignee`), `labels` (M2M through
  `IssueLabel`), `type` FK (`IssueType` — custom issue types), `is_draft`, `external_source`/
  `external_id` (import/dedup support), `description_binary` (Yjs CRDT binary for the collaborative
  editor). Related: `IssueBlocker`, `IssueRelation` (duplicate/relates_to/blocked_by/start_before/
  finish_before/implemented_by, with auto reverse-mapping), `IssueComment` (own CRDT description
  too), `IssueActivity` (audit trail), `IssueAttachment`, `IssueVote`, `IssueReaction`,
  `IssueSubscriber`, `IssueVersion`/`IssueDescriptionVersion` (point-in-time snapshots).
- **Cycle** (`db/models/cycle.py`) — sprint-like: `start_date`/`end_date`, `owned_by`,
  `progress_snapshot` JSON, `version`. `CycleIssue` is the join table to `Issue`.
- **Module** (`db/models/module.py`) — epic/feature grouping: `status` (backlog/planned/
  in-progress/paused/completed/cancelled), `lead`, `members` M2M through `ModuleMember`.
  `ModuleIssue` join table, `ModuleLink`.
- **State** (`db/models/state.py`) — per-project workflow states; `group` (`StateGroup` enum:
  backlog/unstarted/started/completed/cancelled/**triage**), `is_triage` flag, `default` flag,
  `sequence` (float, used for kanban-column ordering). `DEFAULT_STATES` seeds 6 states per new
  project. Note: the default `Issue` manager (`IssueManager`) **excludes** issues in triage-group
  states and archived/draft issues — triage/archived issues require an explicit query.
- **Label** (`db/models/label.py`) — workspace-scoped (`WorkspaceBaseModel`), optional `parent` for
  nested labels, optionally scoped to a `project` (nullable) or workspace-wide.
- **Webhook** / **WebhookLog** / **ProjectWebhook** (`db/models/webhook.py`) — see §4/§12.
- **APIToken** / **APIActivityLog** (`db/models/api.py`) — see §5, §16.
- **Instance** / **InstanceAdmin** / **InstanceConfiguration** / **ChangeLog**
  (`license/models/instance.py`) — self-host instance metadata (telemetry opt-in, setup-done flag,
  version tracking), not a per-tenant billing/feature gate (see §18).

## 7. Folder Structure (annotated)

```
apps/api/plane/
  app/            internal DRF app: views/serializers/urls consumed by apps/web (session auth)
  api/            public v1 DRF app: views/serializers/urls documented at developers.plane.so
  authentication/ session + OAuth (google/github/gitlab/gitea) + magic-link/password providers
  db/
    models/       one file per domain area (workspace.py, project.py, issue.py, cycle.py, module.py,
                   state.py, label.py, webhook.py, api.py, page.py, view.py, notification.py, ...)
    migrations/   Django migrations (114+ at time of read)
  bgtasks/         Celery task modules — one per concern (see §9)
  license/         Instance/InstanceAdmin/InstanceConfiguration models + bgtasks (telemetry push)
  space/           backend views/serializers for the public "space" deploy-board app
  throttles/, middleware/, analytics/, utils/  cross-cutting

apps/web/app/       Next.js App Router: (all)/[workspaceSlug]/... (workspace-scoped product UI),
                    (all)/accounts, onboarding, settings, create-workspace, invitations
apps/space/app/     Next.js: public issue boards, [workspaceSlug]/... for published/guest views
apps/admin/         Next.js: instance-wide "God mode" console (license/instance config UI)
apps/live/          realtime collaboration server (Hocuspocus/Yjs) for co-editing descriptions
apps/proxy/         nginx edge proxy, Dockerfile.ce confirms Community Edition build image
```

## 8. Deployment Architecture

From `docker-compose.yml` (root) — required services for a full self-host stack: `web`, `admin`,
`space` (three Next.js frontends), `api` (Django, `docker-entrypoint-api.sh`), `worker` (Celery
worker, `docker-entrypoint-worker.sh`), `beat-worker` (Celery beat scheduler,
`docker-entrypoint-beat.sh`), `migrator` (one-shot Django migration runner), `live` (realtime
server), `plane-db` (Postgres 15.7-alpine, `max_connections=1000`), `plane-redis` (Valkey
7.2.11-alpine — Redis-API-compatible fork, used for cache/session/rate-limit), `plane-mq`
(RabbitMQ 3.13.6-management-alpine — Celery broker), `plane-minio` (MinIO — S3-compatible object
storage for file assets), `proxy` (nginx, fronts everything on `LISTEN_HTTP_PORT`/
`LISTEN_HTTPS_PORT`). `deployments/` additionally ships ready-made `aio` (all-in-one single
container), `cli`, `kubernetes`, and `swarm` variants — each with only a `community/` subfolder in
this clone.

## 9. Worker Architecture

Celery workers found under `apps/api/plane/bgtasks/` (real files): `analytic_plot_export.py`,
`cleanup_task.py` (deletes stale API/webhook/notification logs, page/issue-description versions),
`copy_s3_object.py`, `deletion_task.py` (hard-delete sweep), `dummy_data_task.py`,
`email_notification_task.py` (batches notification emails every 5 min), `event_tracking_task.py`,
`export_task.py` / `exporter_expired_task.py`, `file_asset_task.py`, `forgot_password_task.py`,
`issue_activities_task.py` (audit trail + notification fan-out), `issue_automation_task.py`
(daily auto-archive/close of old issues), `issue_description_version_task.py` /
`issue_description_version_sync.py` / `issue_version_sync.py` (CRDT/version snapshotting),
`magic_link_code_task.py`, `notification_task.py`, `page_transaction_task.py` /
`page_version_task.py`, `project_add_user_email_task.py`, `project_invitation_task.py`,
`recent_visited_task.py`, `storage_metadata_task.py`, `user_activation_email_task.py` /
`user_deactivation_email_task.py` / `user_email_update_task.py`, `webhook_task.py` (the webhook
pipeline, §4/§12), `work_item_link_task.py`, `workspace_invitation_task.py` /
`workspace_seed_task.py`. Plus `license/bgtasks/telemetry_metrics.py` (periodic instance telemetry
push). Entrypoints run plain `celery -A plane worker -l info` / `celery -A plane beat -l info` — no
custom concurrency flag is set in the scripts read, so Celery's default (CPU-count prefork pool)
applies unless overridden by environment/deployment config. **NOT VERIFIED**: any documented
recommended concurrency tuning for production (not found in this clone's compose/entrypoint files).

## 10. Queue Architecture

Broker is RabbitMQ (`CELERY_BROKER_URL` built from `RABBITMQ_HOST/PORT/USER/PASSWORD/VHOST` or a
single `AMQP_URL` override, `settings/common.py`). Serialization is JSON both ways
(`CELERY_TASK_SERIALIZER`/`CELERY_RESULT_SERIALIZER = "json"`). Scheduled (beat) jobs are defined
declaratively in `apps/api/plane/celery.py` via `app.conf.beat_schedule`, e.g.: email notifications
every 5 minutes, instance telemetry push every `METRICS_PUSH_INTERVAL_MINUTES` (default 360),
daily hard-delete sweep (00:00 UTC), daily issue auto-archive/close (01:00 UTC), and a staggered
sequence of daily cleanup jobs (exporter links, unattached file assets, API logs, email-notification
logs, page versions, issue-description versions, webhook logs — each offset 15-30 min apart,
01:30-03:45 UTC) to spread DB load. Retry policy is per-task, not global: `webhook_send_task` is the
clearest example (`autoretry_for=(requests.RequestException,), retry_backoff=600, max_retries=5,
retry_jitter=True`) — exponential-ish backoff starting at 600s with jitter, capped at 5 attempts,
then the webhook is auto-deactivated.

## 11. API Structure

Two clearly separate DRF namespaces confirmed by folder + URL inspection:

- **`app/` (internal)**: `apps/api/plane/app/urls/*.py` — `analytic`, `cycle`, `estimate`,
  `exporter`, `intake`, `issue`, `module`, `notification`, `page`, `project`, `search`, `state`,
  `user`, `webhook`, `workspace`, plus `asset`, `external`, `timezone`. Session-cookie auth,
  unversioned, powers `apps/web` directly — treat as an implementation detail, not a stable
  contract.
- **`api/` (public v1)**: `apps/api/plane/api/urls/*.py` — `asset`, `cycle`, `estimate`, `intake`,
  `invite`, `label`, `member`, `module`, `project`, `state`, `sticky`, `user`, `work_item`
  (issues, renamed in the public API), plus `schema.py` (OpenAPI schema generation — confirms a
  formal, documented contract). This is the one documented at developers.plane.so
  (`/api/v1/workspaces/{slug}/...`), authenticated by `X-Api-Key` (`APIKeyAuthentication`) or OAuth
  Bearer tokens, and per-token/per-key rate-limited (`ApiKeyRateThrottle`, §16). This is the correct
  integration surface for Orlixa.
- **Personal Access Tokens**: generated from Profile Settings ("Personal Access Tokens" per docs),
  backed by the `APIToken` model — confirmed real, not aspirational.

## 12. Extension Points

- **Webhooks (real, verified in source)**: `Webhook` model — per-workspace URL, boolean flags for
  which resources to notify on (`project`, `issue`, `module`, `cycle`, `issue_comment`), HMAC-SHA256
  signed (`X-Plane-Signature`), delivered via Celery with retry/backoff, auto-deactivated after 5
  failures, every attempt logged to `WebhookLog`. SSRF-hardened (`pinned_fetch`, DNS-rebinding fix
  cited by CVE-style ID in-code). This is the cleanest "Plane → Orlixa" push channel (e.g. issue
  state changes flowing back into an Orlixa AI Employee's task queue) if polling isn't wanted.
- **MCP Server (verified via official docs, `developers.plane.so/dev-tools/mcp-server`)**: Plane
  ships an official `plane-mcp-server`. Per the docs' own wording: *"It exposes Plane's full API
  surface as MCP tools, so your AI tool can create work items, manage sprints, track time, and
  organise work without you leaving your editor or chat interface."* Concretely it covers: work-item
  lookup/create/update/comment, project listing, cycle (sprint) create/list/issue-transfer, time
  logging, filtered search, module issue-assignment, and state listing/transitions. Four transport
  modes: **HTTP+OAuth** (Plane Cloud, browser flow), **HTTP+PAT** (`x-api-key`/`x-workspace-slug`
  headers — automatable, no browser needed), **stdio** (local/self-hosted, env vars
  `PLANE_API_KEY`/`PLANE_WORKSPACE_SLUG`/`PLANE_BASE_URL`), and legacy SSE. Crucially, **it works
  against self-hosted Plane** by pointing `PLANE_BASE_URL` at the self-hosted instance — this is not
  Cloud-only. This is directly analogous to the Postiz MCP server found in the prior engine study
  and is a strong candidate integration seam for Orlixa's AI Project Manager Employee (§20).
- **"Build a Plane app" framework** (docs only, `developers.plane.so/dev-tools/build-plane-app`,
  **not located in this backend source clone** — treat the mechanism details as **NOT VERIFIED**
  beyond the docs' own text): OAuth app registration in Workspace Settings → Integrations, issuing
  Client ID/Secret; Bot-Token flow (recommended for most integrations) vs. User-Token flow;
  webhook-handler setup with signature verification; official Node.js/Python SDKs with typed API
  clients and OAuth helpers. This looks like the mechanism a marketplace-style third-party app would
  use — heavier than plain API-key auth and likely unnecessary for Orlixa's own backend-to-backend
  integration (Orlixa isn't a third-party app in Plane's marketplace sense, it's an operator of a
  private Plane instance).

## 13. Plugin System

No plugin/extension-loading framework was found in the Django backend beyond the two extension
points above (webhooks, the OAuth "Build a Plane app" framework). There is no in-process plugin
API, no server-side scripting/automation-rule engine, and no marketplace-side-loading mechanism
discovered in `apps/api`. The one `packages/editor/src/ee/` folder is a compile-time extension seam
for the rich-text editor (two files, types + extensions index) — not a runtime plugin system.

## 14. Scalability

`docker-compose.yml` shows `worker` and `beat-worker` as separate scalable containers from `api`
(so API request-handling and background-task throughput scale independently); Postgres is configured
with `max_connections=1000` in the reference compose, suggesting the project expects many
concurrent DB connections (workers + web replicas). **NOT VERIFIED**: no official scaling guide
(read-replica support, recommended worker-concurrency numbers, HPA configs) was found in this clone's
`deployments/kubernetes/community` in the time available — treat detailed scaling guidance as
**NOT VERIFIED** beyond "workers and API are independently horizontally scalable containers."

## 15. Multi-tenancy

**Workspace is the tenant root**, confirmed directly: every domain model chains back to `Workspace`
either directly (`WorkspaceBaseModel`, e.g. `Label`) or via `Project.workspace`
(`ProjectBaseModel`, e.g. `Issue`, `Cycle`, `Module`, `State`). Isolation is enforced at the
application/query layer, not via Postgres row-level security: views scope querysets by
`workspace__slug=slug` (URL path parameter) and by `project_id`; `ProjectBaseModel.save()` and
`WorkspaceBaseModel.save()` even auto-derive `workspace` from the parent `project` on every save, so
a row can't silently drift to the wrong workspace. Membership/roles are per-workspace
(`WorkspaceMember.role`: Admin/Member/Guest) and per-project (`ProjectMember.role`), i.e.
two-level RBAC. There is no visible database-level tenant partitioning (no separate schema-per-
tenant, no RLS policies found) — isolation is entirely enforced by consistent FK-scoping in every
query, which is typical for Django multi-tenant SaaS but means a missed `.filter(workspace=...)`
somewhere would be a real cross-tenant leak risk (not found in the views read, but not exhaustively
audited either).

## 16. Security

- **Auth**: session cookies (CSRF exempted on API paths, relying on cookie auth instead — see §5)
  for the web app; `X-Api-Key` bearer-style tokens (`APIToken`) for programmatic API access; OAuth
  Bearer tokens for the app-framework flow (docs-only, not verified in this backend clone).
- **API rate limiting**: `ApiKeyRateThrottle` (`api/rate_limit.py`) — per-API-key sliding-window
  throttle keyed off `X-Api-Key`, rate pulled from `settings.API_KEY_RATE_LIMIT`, and it also
  attaches `X-RateLimit-Remaining`/`X-RateLimit-Reset` response headers. `APIToken.allowed_rate_limit`
  additionally allows a **per-token** override (default `"60/min"`), so individual integrations can
  be rate-limited independently. A separate `AssetRateThrottle` throttles per-asset-id.
  `apps/api/plane/api/rate_limit.py` throttle is workspace/key-scoped, not global.
  `apps/api/plane/authentication/rate_limit.py` exists too (login-path throttling — file present,
  not read in full).
- **Webhook security**: HMAC-SHA256 request signing (`X-Plane-Signature`), URL scheme validation
  (http/https only), localhost/loopback destination rejection at model-save time
  (`validate_domain`), and a hardened `pinned_fetch` at send-time that resolves+validates+pins the
  destination IP and never follows redirects (explicit anti-SSRF/anti-DNS-rebinding code, citing
  `GHSA-mq87-52pf-hm3h`).
- **Audit logging**: `APIActivityLog` records every API call (path, method, headers, body, response
  code/body, IP, user-agent) keyed by `token_identifier` — a real, queryable API audit trail.
- **Data protection**: soft-deletion is the default (`deleted_at` + unique constraints scoped to
  "not deleted") across nearly every model, with a scheduled hard-delete sweep
  (`bgtasks/deletion_task.py`) run daily — gives a recoverability window before permanent deletion.

## 17. Limitations (real gaps found)

- The internal `app/` API is explicitly not a stable contract (no versioning, no OpenAPI schema
  generation module found for it, unlike `api/`'s `schema.py`) — anything integrating with Plane
  must stick to `api/v1`, narrowing the usable surface versus the full product.
- The OAuth "Build a Plane app" framework's actual implementation (scopes model, token issuance
  code, permission enforcement) could not be located in this backend clone in the time available —
  its real robustness is **NOT VERIFIED** from source, only from docs prose.
- No in-repo evidence of read-replica support, connection pooling middleware (e.g. PgBouncer), or a
  documented horizontal-scaling runbook beyond "workers and API are separate containers."
- No native automation/rules engine (e.g. "when issue moves to Done, do X") was found server-side;
  any such automation must be built externally via webhooks + your own logic, or via the MCP
  server/API driven by an external agent (which is exactly Orlixa's use case).
- Multi-tenancy isolation is convention-enforced (consistent FK-scoping), not database-enforced
  (no RLS found) — a real, if standard-for-Django, architectural risk to be aware of if Orlixa ever
  runs one shared Plane instance across many end customers rather than one Plane workspace/instance
  per customer.

## 18. Enterprise-only Features

**No Enterprise-only code path exists in this clone to gate anything.** Verified checks performed:
(a) no `ee/` directory under `apps/api`; (b) `Instance.edition` is hardcoded to
`InstanceEdition.PLANE_COMMUNITY` with only one enum value defined at all — there is no
`PLANE_ENTERPRISE`/`PLANE_BUSINESS` enum member in this source to even switch on; (c) every
`deployments/*` target ships only a `community/` folder, no `enterprise/` sibling; (d) no
license-key-validation service, feature-flag client, or "requires paid plan" decorator was found
guarding any view, model, or Celery task read during this study. Therefore: **there is nothing in
this codebase to mark "ENTERPRISE ONLY."** Cycles, Modules, custom Issue Types, time tracking,
intake forms, webhooks, and the public API are all present and functional in this Community Edition
clone. (Plane's commercial Cloud/Business/Enterprise plans, as marketed on plane.so, may add
SSO/SAML, advanced analytics, or dedicated support — but those are **not implemented as gated code
in this repository**; they would live in Plane's separately-hosted Cloud infrastructure, which is
out of scope for a self-hosted black-box deployment and was not examined.)

## 19. Community Features (confirmed to ship in this self-hosted edition)

Workspaces, Projects, Work Items/Issues (with sub-issues, relations, blockers, comments, reactions,
votes, attachments, mentions, subscribers, activity history, versioning), Cycles (sprints), Modules
(epics), custom Issue Types, States (with a dedicated Triage state group), Labels (nested, project-
or workspace-scoped), Estimates, Intake (external issue submission), custom Views, Pages
(collaborative rich-text docs via the `live` server), Notifications, Import/Export, Webhooks, the
full public `api/v1` REST API with Personal Access Tokens, OAuth login (Google/GitHub/GitLab/Gitea),
magic-link/passwordless auth, an admin console (`apps/admin`) for instance configuration, and (per
docs, self-hostable) the MCP server. All confirmed present in this Community Edition source tree.

## 20. Which parts should Orlixa reuse

- **The public `api/v1` REST API, called exactly as documented** (`X-Api-Key` header, workspace-
  scoped paths) — this is the single integration surface Orlixa's AI Project Manager Employee should
  talk to for CRUD on work items, cycles, modules, states, labels, members. It's stable, versioned,
  documented, and rate-limited — exactly the "black box behind a REST wall" pattern used for Postiz.
- **The MCP server, self-hosted (stdio + `PLANE_BASE_URL` pointed at Orlixa's own Plane instance)**
  as a ready-made tool-calling adapter: rather than hand-writing every Plane API wrapper function for
  the AI employee's tool-use loop, `plane-mcp-server` already exposes create/update/search/cycle/
  module/time-tracking operations as callable tools. This could shortcut a meaningful chunk of the
  "AI Project Manager Employee" tool layer — with the caveat that Orlixa should still put its own
  auth/authorization layer in front (the MCP server's PAT-header mode is trivially embeddable
  server-side).
- **The webhook system** as the async "Plane state changed → notify Orlixa" channel (e.g. issue
  moved to Done → trigger an Orlixa follow-up action) — it's real, signed, retried, and logged.
- **Self-hosting the whole stack via `docker-compose.yml`** (Postgres/Redis/RabbitMQ/MinIO/worker/
  beat) as one tenant-isolated Plane instance per Orlixa customer (or per Orlixa's own back-office),
  exactly mirroring "run vanilla Postiz, wrap via API" — never fork or embed Plane's own frontend/UI.

## 21. Which parts should Orlixa replace

- **All three Plane frontends** (`apps/web`, `apps/space`, `apps/admin`) — end users must never see
  Plane's UI; Orlixa's own AI-employee chat interface is the only UI surface, per the study's
  explicit constraint. These apps should be deployed (if at all, for a break-glass admin path) fully
  internally, never exposed to Orlixa customers.
- **Plane's own OAuth/session login UX** — Orlixa customers authenticate to Orlixa, not to Plane;
  Orlixa's backend should hold one (or per-tenant) service-level `APIToken`(s)/bot tokens and never
  surface Plane's sign-in screens.
- **The internal `app/` API** — not a stable contract; nothing in Orlixa should depend on it even if
  discovered by inspecting the web app's network calls.

## 22. Which parts should Orlixa ignore

- **The "Build a Plane app" OAuth-app/marketplace framework** — this exists for third-party
  developers publishing apps *into* Plane's own marketplace/UI (a scenario where end users browse
  Plane's App directory), which is irrelevant when Orlixa is the sole operator of a private,
  API-only Plane instance behind its own product.
- **The realtime collaboration server (`apps/live`)** — this exists to support multiple humans
  co-editing a Page/Issue description inside Plane's own rich-text editor UI; since Orlixa users
  never see that editor, this component (and the CRDT `description_binary` fields it depends on)
  is irrelevant infrastructure to run or maintain.
- **Plane's admin console (`apps/admin`) as a customer-facing feature** — it's an instance operator
  tool (telemetry, license/instance config), not something to expose to Orlixa's own customers;
  Orlixa's own admin surfaces should be built natively instead.
- **Any assumption of Enterprise/Business gated code** — confirmed in §18 there is none in this
  repo; do not architect around a Community/Enterprise split that doesn't exist in the source.
