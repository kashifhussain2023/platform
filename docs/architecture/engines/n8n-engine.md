# n8n — Engine Study

Source verified against: local clone `C:\Users\Admin\AppData\Local\Temp\claude\n8n-src` (n8n-io/n8n,
branch as cloned) + official docs at docs.n8n.io (fetched 2026-07-19). All claims below are cited to a
real file path or a fetched doc URL. Anything that could not be verified this way is marked **NOT VERIFIED**.

---

## 1. Executive Summary

n8n is a workflow-automation server written in TypeScript, distributed as a pnpm/turborepo monorepo. A
single Node.js process (`packages/cli`) hosts an Express-based REST API, a webhook receiver, a Vue 3
editor UI (`packages/frontend/editor-ui`), and an execution engine (`packages/core` +
`packages/workflow`) that runs "nodes" — one built-in integration per external system
(`packages/nodes-base`, 307 node folders, 405 credential types on disk). Workflows are directed graphs
of nodes stored as JSON in Postgres/MySQL/SQLite via TypeORM entities. Execution can run in the main
process ("regular mode") or be dispatched via a real Bull (Redis-backed) queue to separate worker
processes ("queue mode") for horizontal scaling.

n8n uses a "fair-code" dual license: the bulk of the code is under n8n's own **Sustainable Use License**
(free for internal business use, not free to resell/host-as-a-service), while any file whose name/dir
contains `.ee.` (~100+ files found) is under the separate **Enterprise License** (`LICENSE_EE.md`) and
requires a paid n8n Enterprise license key to run in production, even though the source is physically
present in this open clone. Feature gating is enforced at runtime through a proprietary
`@n8n_io/license-sdk` package (`packages/cli/src/license.ts`) checking a signed license certificate
against a `LICENSE_FEATURES` map (`packages/@n8n/constants/src/index.ts`) — this is a real code-level
gate, not merely a doc convention.

For Orlixa: n8n is architecturally a **generic workflow engine with a huge integration catalog**, not an
AI-agent framework. Its node-execution engine, node interface (`INodeType`), and 307-integration node
library are the valuable, reusable part. Its own editor UI, its own user/auth/multi-user model, and its
Enterprise-gated governance features (SSO, LDAP, RBAC, git-based environments, log streaming) are not
things Orlixa needs to adopt, and several would require a paid commercial agreement to use in production.

---

## 2. Architecture Diagram

```
                                   ┌────────────────────────────────────────┐
                                   │              n8n "main" process          │
                                   │           (packages/cli entrypoint)      │
                                   │                                          │
  HTTP clients ──────────────────▶│  Express app (abstract-server.ts)        │
  (editor UI, REST/API, webhooks) │   ├─ REST API (internal, used by UI)     │
                                   │   ├─ Public REST API (public-api/v1)     │
                                   │   ├─ Webhook receiver (webhooks/*)       │
                                   │   ├─ Auth (JWT cookie, auth.service.ts)  │
                                   │   └─ WorkflowRunner / ActiveExecutions   │
                                   │        │                                │
                                   │        ▼                                │
                                   │  Regular mode: executes node graph      │
                                   │  in-process (WorkflowExecute)           │
                                   │        OR                               │
                                   │  Queue mode: enqueues job to Bull/Redis │
                                   └───────────┬──────────────────────────────┘
                                               │ Bull queue "jobs" (Redis)
                                               ▼
                                   ┌────────────────────────────────────────┐
                                   │           n8n "worker" process(es)       │
                                   │   ScalingService.setupWorker()          │
                                   │   packages/cli/src/scaling/*            │
                                   │   → pulls job → loads workflow from DB  │
                                   │   → WorkflowExecute (core) runs nodes   │
                                   │   → writes execution result to DB       │
                                   └───────────┬──────────────────────────────┘
                                               │
                                               ▼
                                   ┌────────────────────────────────────────┐
                                   │   Database (Postgres/MySQL/SQLite)      │
                                   │   TypeORM entities: WorkflowEntity,     │
                                   │   ExecutionEntity, CredentialsEntity,   │
                                   │   User, Project, ...                    │
                                   └────────────────────────────────────────┘

  Node execution itself calls out to external services (Slack, Gmail, HTTP
  APIs, DBs, etc.) using per-node HTTP/SDK clients defined in nodes-base.
```

---

## 3. Component Diagram

```
packages/
 ├─ workflow/         core domain types: INodeType, INodeTypeDescription, Workflow class,
 │                    expression engine — used by both cli and core
 ├─ core/             execution engine: WorkflowExecute, node-execute-functions,
 │                    encryption (credentials), binary-data storage, triggers/pollers
 ├─ cli/              the server: Express app, REST + Public API, auth, license,
 │                    webhooks, scaling (Bull queue + workers), community-packages
 ├─ @n8n/db/          TypeORM entities + repositories (Postgres/MySQL/SQLite)
 ├─ @n8n/permissions/ RBAC scopes (many are .ee-gated — Enterprise custom roles)
 ├─ @n8n/constants/   LICENSE_FEATURES / LICENSE_QUOTAS map
 ├─ nodes-base/        307 built-in integration nodes + 405 credential types
 ├─ frontend/editor-ui/ Vue 3 SPA — the workflow canvas/editor (not reused by Orlixa)
 ├─ extensions/        NOT VERIFIED in depth — appears to hold optional add-on packages
 ├─ node-dev/          CLI scaffolding tool for building custom/community nodes
 └─ testing/           test harnesses
```

---

## 4. Request Flow (webhook → node execution → completion)

Traced through real files:

1. External HTTP request hits a registered webhook path. The Express handler is built by
   `createWebhookHandlerFor()` in `packages/cli/src/webhooks/webhook-request-handler.ts`, which wraps
   a `WebhookRequestHandler` class. It validates the HTTP method against `WEBHOOK_METHODS`, handles CORS,
   then calls `this.webhookManager.executeWebhook(req, res, expectedNodeType)`.
2. The active `IWebhookManager` (in `packages/cli/src/webhooks/`, e.g. `live-webhooks.ts`,
   `waiting-webhooks.ts` for `$resumeWebhookUrl` style "wait" nodes) looks up which workflow/node owns
   that path, using the `webhook-entity.ts` TypeORM entity (a `WebhookEntity` row is created when a
   workflow with a Webhook-trigger node is activated).
3. The manager builds an execution context and invokes the triggering node's `webhook()` function — part
   of the `INodeType` interface (`packages/workflow/src/interfaces.ts:2293-2304`,
   `webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>`).
4. From there, execution is handed to the core engine: `WorkflowExecute`
   (`packages/core/src/execution-engine/workflow-execute.ts`), which walks the node graph node-by-node,
   calling each node's `execute()` (or `poll`/`trigger` for other node types), passing data forward
   between connected nodes as `INodeExecutionData[][]`.
   - In **regular mode**, this happens synchronously in the main process.
   - In **queue mode**, the main process instead enqueues a Bull job (`ScalingService.setupQueue()` /
     `queue.add(...)`, `packages/cli/src/scaling/scaling.service.ts`) and a separate worker process
     (`ScalingService.setupWorker()`, same file) picks the job up via `queue.process(JOB_TYPE_NAME,
     concurrency, ...)` and runs `WorkflowExecute` there instead.
5. Execution progress/results are persisted through `ExecutionRepository`
   (`packages/@n8n/db/src/entities/execution-entity.ts`, `execution-data.ts`) and lifecycle hooks in
   `packages/core/src/execution-engine/execution-lifecycle-hooks.ts`.
6. The webhook's HTTP response is produced from either the "Respond to Webhook" node output or the last
   node's output, and sent back via `sendWebhookResponse()` in `webhook-request-handler.ts` (static JSON,
   streaming, or "no response" modes are all supported, per that file, lines 96-135).

---

## 5. Authentication Flow

**n8n's own user login (editor / internal API):**
- Cookie-based JWT session. `packages/cli/src/auth/auth.service.ts` issues a JWT (`AuthJwtPayload`:
  user id, a hash derived from email+bcrypt(password), a browser id to reduce session-hijack risk, an
  `usedMfa` flag, and an `isEmbed` flag for embedded/iframe logins). Stored in an `AUTH_COOKIE_NAME`
  cookie (see `packages/cli/src/constants.ts`).
- MFA is supported (`packages/cli/src/mfa/mfa.service.ts`); MFA **enforcement** specifically is gated
  behind `LICENSE_FEATURES.MFA_ENFORCEMENT` (Enterprise-only — MFA itself is available, org-wide
  enforcement is not, see §18).
- SSO via SAML (`packages/cli/src/modules/sso-saml/*.ee.ts`) and OIDC
  (`packages/cli/src/modules/sso-oidc/*.ee.ts`) — both are `.ee.` files, i.e. Enterprise-licensed.
- **Public REST API** (`packages/cli/src/public-api`) uses a distinct scheme, defined in its OpenAPI spec
  (`packages/cli/src/public-api/v1/openapi.yml`, lines ~193-201): `ApiKeyAuth` (header
  `X-N8N-API-KEY`, type `apiKey`) and a `BearerAuth` (JWT) scheme.

**Per-credential OAuth for external services n8n connects to:**
- `packages/cli/src/oauth/oauth.service.ts`, `oauth-browser-binding.service.ts`,
  `oauth-jwe-service.proxy.ts`, `validate-oauth-url.ts` implement OAuth1/OAuth2 authorization-code flows
  per credential type (e.g. Google, Slack). Each `n8n-nodes-base` credential file
  (`packages/nodes-base/credentials/*.credentials.ts`) declares its own OAuth endpoints/scopes; the
  generic OAuth controller in `cli` drives the redirect/callback dance and stores the resulting
  access/refresh token as an encrypted `CredentialsEntity` row (see §16 for the encryption mechanism).
  This is conceptually identical in shape to Orlixa's own per-employee/per-company connector model.

---

## 6. Database Design

Real TypeORM entities found in `packages/@n8n/db/src/entities/` (verified by directory listing and
partial reads):

| Entity file | Purpose |
|---|---|
| `workflow-entity.ts` | The workflow definition (nodes + connections JSON) |
| `workflow-history.ts`, `workflow-published-version.ts`, `workflow-publish-history.ts`, `workflow-publication-outbox.ts`, `workflow-publication-trigger-status.ts` | Versioning / publish-pipeline for a workflow (workflow history retention is itself license-quota-limited, `DEFAULT_WORKFLOW_HISTORY_PRUNE_LIMIT` in `@n8n/constants`) |
| `execution-entity.ts`, `execution-data.ts`, `execution-metadata.ts` | Execution runs and their I/O data |
| `execution-annotation.ee.ts` | Enterprise-only: manual annotation/labeling of executions (evaluation feature) |
| `credentials-entity.ts`, `shared-credentials.ts`, `credential-dependency-entity.ts` | Encrypted credential storage + per-project credential sharing |
| `user.ts`, `auth-identity.ts`, `auth-provider-sync-history.ts`, `api-key.ts`, `invalid-auth-token.ts` | Users, external-identity linkage (LDAP/SSO), API keys, token-revocation list |
| `project.ts`, `project-relation.ts` | n8n's "Project" = personal or team workspace (see §15 on multi-tenancy) |
| `role.ts`, `scope.ts`, `role-mapping-rule.ts` | RBAC roles/scopes — custom role definitions are Enterprise (`role-mapping-rule.ts` supports SSO-driven auto role assignment, part of `provisioning.ee`) |
| `folder.ts`, `folder-tag-mapping.ts`, `tag-entity.ts`, `workflow-tag-mapping.ts` | Organization: folders and tags for workflows |
| `variables.ts` | Global "Variables" feature — gated behind `LICENSE_FEATURES.VARIABLES` |
| `webhook-entity.ts` | Registered webhook path → workflow/node mapping |
| `settings.ts` | Key-value instance settings, including the stored license certificate (`SETTINGS_LICENSE_CERT_KEY`) |
| `evaluation-collection.ee.ts`, `evaluation-config.ee.ts`, `test-run.ee.ts`, `test-case-execution.ee.ts` | Enterprise "Evaluations" (workflow testing) feature |
| `secrets-provider-connection.ts`, `project-secrets-provider-access.ts` | External Secrets Manager integration (Enterprise) |
| `scheduled-task.ts`, `scheduled-job.ts`, `processed-data.ts`, `binary-data-file.ts`, `deployment-key.ts`, `workflow-statistics.ts`, `ai-builder-temporary-workflow.ts` | Supporting infrastructure (cron scheduling, binary data references, dedup, telemetry) |

No dedicated "tenant" or "organization" entity was found — see §15.

---

## 7. Folder Structure (verified via directory listing)

```
n8n/  (pnpm workspace, turbo.json build orchestration)
├─ packages/
│  ├─ cli/                 the server binary: Express app, REST/Public API, auth, license,
│  │                       webhooks, scaling/queue, community-packages, commands (CLI subcommands)
│  ├─ core/                execution engine (WorkflowExecute), encryption, binary data, node loading
│  ├─ workflow/            shared domain model: INodeType, workflow class, expressions
│  ├─ nodes-base/          307 built-in node folders + 405 credential type files
│  ├─ node-dev/            scaffolding CLI for authoring new/custom nodes
│  ├─ @n8n/db/             TypeORM entities + repositories
│  ├─ @n8n/permissions/    RBAC scope definitions (mixed community + .ee)
│  ├─ @n8n/constants/      LICENSE_FEATURES / LICENSE_QUOTAS enums
│  ├─ frontend/editor-ui/  Vue 3 SPA editor (workflow canvas)
│  ├─ frontend/@n8n/rest-api-client/  typed client the editor-ui uses to call cli's REST API
│  ├─ extensions/          NOT VERIFIED — not read in depth in this pass
│  └─ testing/             shared test utilities
```

Package manager: pnpm workspaces (`pnpm-workspace.yaml`) + Turborepo (`turbo.json`) for build caching —
verified by presence of both files at repo root.

---

## 8. Deployment Architecture

Per official docs (`docs.n8n.io/deploy/host-n8n/install-options/use-a-cloud-provider/use-docker-compose.md`,
fetched):
- The documented baseline Docker Compose stack is just **Traefik** (TLS/reverse proxy) + **n8n**
  (single container), using **SQLite** by default (n8n_data volume stores "its SQLite database file and
  encryption key"). Postgres/Redis are **not** part of that baseline compose example — they are added
  only when queue mode or a production DB is desired (confirmed separately via the queue-mode docs
  below).
- Queue mode docs (`docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/enable-queue-mode.md`, fetched):
  requires `EXECUTIONS_MODE=queue` set on **both** main and worker processes, Redis connection env vars
  (`QUEUE_BULL_REDIS_HOST`, `QUEUE_BULL_REDIS_PORT`), and the **same** `N8N_ENCRYPTION_KEY` shared across
  all instances (main + all workers) because credentials are decrypted wherever a node executes.

---

## 9. Worker Architecture

Per docs + source:
- **Main process**: handles UI, webhooks intake, timers/schedules, and the Public/internal REST API. In
  queue mode it does not execute workflow nodes itself — it enqueues a job and returns.
- **Worker process(es)**: separate Node.js processes running the same n8n codebase started in "worker"
  mode. `ScalingService.setupWorker(concurrency)` (`packages/cli/src/scaling/scaling.service.ts`) calls
  `this.queue.process(JOB_TYPE_NAME, concurrency, async (job) => {...})` — this is literally Bull's
  worker-consumer API, run in-process per worker instance, each capable of running `concurrency` jobs in
  parallel.
- Concurrency is controlled either by `N8N_CONCURRENCY_PRODUCTION_LIMIT` (env var, applies globally per
  docs) or a per-worker `--concurrency` CLI flag, with env var taking precedence when set to something
  other than `-1` (per `docs.n8n.io/deploy/host-n8n/configure-n8n/scaling/control-concurrency.md`,
  fetched).
- Workers are stateless with respect to workflow definitions — they fetch the workflow JSON from the
  shared database per job, execute, and write results back (`ExecutionRepository`,
  `ExecutionPersistence` in `scaling.service.ts` imports).
- `multi-main-setup.ee.ts` (Enterprise) supports running multiple **main** instances (not just workers)
  for HA of the webhook/UI tier, using leader election (`leader-election-client.ts`) — gated behind
  `LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES`.

---

## 10. Queue Architecture

- Verified real dependency: `"bull": "4.16.4"` in `packages/cli/package.json` (Bull, not raw BullMQ,
  though the API shape is similar — Orlixa's own engine uses BullMQ directly, see §21).
- Queue name: `QUEUE_NAME` constant, imported from `packages/cli/src/scaling/constants.ts` (file exists;
  exact string value not re-quoted here but referenced directly in `scaling.service.ts` as
  `new BullQueue(QUEUE_NAME, {...})`).
- Job type: `JOB_TYPE_NAME` (same constants file) — a single job type is used for workflow executions.
  `job.data` carries `executionId`, `workflowId`, etc. (`JobData` type in `scaling.types.ts`).
- Redis client is created via a `RedisClientService` (`packages/cli/src/services/redis-client.service.ts`,
  imported dynamically in `setupQueue()`), with a configurable prefix (`this.globalConfig.queue.bull.prefix`).
- Recovery: `scheduleQueueRecovery()` runs only on the elected leader instance
  (`this.instanceSettings.isLeader`), guarding against duplicate recovery across multiple mains.
- Notably, `setupQueue()` also wires up an MCP (Model Context Protocol) server session store backed by
  the same Redis instance (`@n8n/n8n-nodes-langchain/mcp/core`) — n8n ships an MCP server capability
  tied into its queue/pubsub layer, worth noting given Orlixa's own AI-agent focus, but this is n8n
  exposing *itself* as an MCP tool server, not consuming external MCP tools generically.

---

## 11. API Structure

Public REST API (`packages/cli/src/public-api/v1/`), OpenAPI-documented
(`packages/cli/src/public-api/v1/openapi.yml`), verified handler folders:
`audit, community-packages, credentials, data-tables, discover, evaluations, executions, folders,
insights, log-streaming, n8n-packages, projects, security-policy, source-control, sso-saml, tags, users,
variables, workflows`.

- Auth: `X-N8N-API-KEY` header (apiKey scheme) or Bearer JWT — both declared in `openapi.yml`
  `securitySchemes` (lines ~193-201, read directly).
- Several handler groups correspond 1:1 to Enterprise-only features and their API surface is meaningless
  without a license: `source-control` (git), `sso-saml`, `log-streaming`, `variables` (quota-limited even
  on lower tiers), `insights` (view-scoped feature flags), `security-policy`.
- Core CRUD is present for `workflows`, `executions`, `credentials`, `users`, `tags`, `folders`,
  `projects` — these are the Community-usable parts of the Public API.

---

## 12. Extension Points — the Node Architecture (most important)

Source: `packages/workflow/src/interfaces.ts`, lines 2280-2330+ (read directly).

A node is a class implementing `INodeType`:
```ts
export interface INodeType {
  description: INodeTypeDescription;
  supplyData?(this: ISupplyDataFunctions, itemIndex: number): Promise<SupplyData>;
  execute?(this: IExecuteFunctions, response?: EngineResponse): Promise<NodeOutput>;
  onMessage?(context: IExecuteFunctions, data: INodeExecutionData): Promise<NodeOutput>;
  poll?(this: IPollFunctions): Promise<INodeExecutionData[][] | null>;
  trigger?(this: ITriggerFunctions): Promise<ITriggerResponse | undefined>;
  webhook?(this: IWebhookFunctions): Promise<IWebhookResponseData>;
  methods?: {
    loadOptions?: {...};       // dynamic dropdown population in the UI
    listSearch?: {...};        // searchable resource pickers
    credentialTest?: {...};    // "Test connection" button logic
    resourceMapping?: {...};   // maps external schema fields (e.g. spreadsheet columns)
    actionHandler?: {...};
  };
}
```
Key node "kinds" are just which optional method is implemented:
- **Regular/action node**: implements `execute()`.
- **Trigger node** (cron, manual, generic polling triggers): implements `trigger()` or `poll()`.
- **Webhook node**: implements `webhook()`.
- **Sub-node / AI tool node** (LangChain-style, used by n8n's AI Agent node): implements `supplyData()`
  and is connected via a special (non-data) connection type rather than the main execution flow.
- `NodeOutput` return type includes `EngineRequest`, which supports node execution being paused and
  resumed with an "engine response" — this underlies human-in-the-loop / wait-for-external-event nodes.

`INodeTypeDescription` (declared alongside, referenced but not fully re-quoted here) carries the node's
UI metadata: displayName, icon, group, version, `properties` (parameter schema shown in the editor),
inputs/outputs (including special AI connection types like `ai_tool`, `ai_languageModel` — NOT VERIFIED
exhaustively but referenced by type names in the interfaces file and consistent with n8n's public "AI
Agent" node documentation).

This is the single cleanest, most reusable abstraction in the codebase: a node is a small, self-contained
class with a declarative parameter schema plus 1-6 lifecycle methods, loaded by name at runtime.

---

## 13. Plugin System — Community Nodes

Verified in `packages/cli/src/modules/community-packages/`:
- `community-packages.service.ts` has `checkNpmPackageStatus()`, `installPackage()`, and installs
  packages by name/version (+ checksum) — i.e. it literally runs `npm install` against configured
  package(s) (comment in the file: "Strip dev, optional, and peer dependencies before running `npm
  install`", confirming actual npm invocation, not a simulation).
- Convention (per n8n public docs / package naming, cross-checked against the `n8n-nodes-langchain`
  package name seen imported live in `scaling.service.ts`): community node packages are npm packages
  named `n8n-nodes-*`, which export `INodeType`/credential classes the same way `nodes-base` does.
- `community-node-types.controller.ts` / `.service.ts` expose these to the editor UI once installed;
  `community-packages.config.ts` and `community-packages.lifecycle.service.ts` govern enabling on
  startup.
- A separate `COMMUNITY_NODES_CUSTOM_REGISTRY` license feature exists (`LICENSE_FEATURES` map) — i.e.
  installing community nodes from a **custom/private npm registry** (vs the public npm registry) is
  Enterprise-gated; using public community nodes is not.

---

## 14. Scalability

Per docs (fetched) + source:
- Horizontal scaling is via adding worker processes consuming the same Bull/Redis queue; this scales
  execution throughput without touching the main (webhook/UI) instance.
- Per-instance parallelism is controlled by `N8N_CONCURRENCY_PRODUCTION_LIMIT` or `--concurrency`.
- HA of the main/webhook tier itself (multiple main instances with leader election) is Enterprise-only
  (`multi-main-setup.ee.ts`, `LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES`) — Community Edition effectively
  has a single main instance as the ingress point even though it can have many workers.
- Execution data pruning/retention is configurable (`manage-execution-data` doc referenced by the
  sitemap) to bound DB growth under scale — details of exact env vars NOT VERIFIED in this pass (not
  fetched).

---

## 15. Multi-tenancy

**Verified: n8n Community Edition has no true multi-tenant data-isolation concept.** What it has instead:
- `Project` entity (`project.ts`): `type: 'personal' | 'team'`. This is a **workspace/grouping**
  construct within one shared instance/database — closer to "folders with ACLs" than tenant isolation.
  All projects share one Postgres database, one set of instance-wide settings, and one license.
- There is no `tenant_id`/organization-boundary column found on core entities (`workflow-entity.ts`,
  `execution-entity.ts`, etc.) — isolation, where it exists, is via `SharedWorkflow`/`SharedCredentials`
  join-table ACL rows scoped to `Project`, not a hard schema-level tenant boundary.
- For actual SaaS-style multi-tenant embedding, n8n sells a separate commercial **OEM integration**
  product (`docs.n8n.io/deploy/host-n8n/deploy-as-an-oem-integration.md`, fetched): "requires a separate
  commercial agreement with n8n," lets a vendor embed n8n's own editor UI in their product, supports
  "managing workflows across multiple users or organizations," but **"n8n branding is required as part
  of an OEM integration"** — i.e. even the paid OEM path does not offer a fully white-labeled experience,
  and it specifically only matters "when you want your users to interact with the n8n editor directly."
  For a backend-only usage (Orlixa's intended usage — n8n invisible to end users), the OEM agreement is
  explicitly stated as unnecessary; standard paid plans cover that.
- Conclusion: if Orlixa wanted multiple Orlixa customers to share one n8n instance safely, Orlixa would
  need to build its own tenant boundary on top (e.g. one Project per Orlixa customer, or fully separate
  n8n instances per customer) — n8n does not provide this natively in Community Edition.

---

## 16. Security

- **Credential encryption at rest**: verified two real cipher implementations in
  `packages/core/src/encryption/`:
  - `aes-256-cbc.ts` — legacy cipher: AES-256-CBC with an OpenSSL-EVP-BytesToKey-style MD5 key/IV
    derivation from a per-instance key + random salt (`RANDOM_BYTES` "Salted__" magic header pattern,
    identical in shape to OpenSSL's legacy `enc` format).
  - `aes-256-gcm.ts` — current cipher: AES-256-GCM with HKDF-SHA (`hkdfSync`) key/IV derivation, a
    versioned wire format (`FORMAT_VERSION` byte + salt + auth tag + ciphertext), and authenticated
    encryption (auth tag verified on decrypt, throws on mismatch/short input).
  - Both are keyed off a single **`N8N_ENCRYPTION_KEY`** environment variable (confirmed via the
    queue-mode doc: "The encryption key must be shared across all instances"). This key is not itself
    stored in the DB — losing it makes all stored credentials unrecoverable (standard envelope-key
    architecture, not a novel finding but confirmed from source).
- API keys (`api-key.ts` entity) and session tokens (`invalid-auth-token.ts`, a revocation list) are
  managed server-side; JWT payload embeds a `hash` derived from `email + bcrypt(password)`, so changing a
  password invalidates existing tokens without a separate blacklist lookup for that case.
- MFA is implemented in Community Edition (`mfa/mfa.service.ts`); only **enforcement** (forcing all org
  members to use it) is Enterprise-gated.

---

## 17. Limitations (real gaps found)

- Single main-instance ingress in Community Edition (no HA for webhook/UI tier without Enterprise
  license) — see §14.
- No native multi-tenant data isolation — see §15.
- Bull (not BullMQ) is the queue library actually used (`bull@4.16.4` in `packages/cli/package.json`) —
  older API/maintenance profile than BullMQ, which is what Orlixa's own engine already uses.
- Community node installation runs a real `npm install` at runtime inside the n8n process
  (`community-packages.service.ts`) — a supply-chain/code-execution trust surface if Orlixa let end
  customers install arbitrary community nodes.
- A large fraction of governance/ops features (see §18) are Enterprise-gated, meaning a from-scratch
  Community deployment lacks SSO, LDAP, RBAC-with-custom-roles, git-based environment promotion, and
  log streaming out of the box — all things a serious multi-customer SaaS backend would eventually want.
- `packages/extensions` was not read in depth in this pass — NOT VERIFIED what it contains.

---

## 18. Enterprise-only Features

**Legal framing (per task requirement):** the following are gated by `.ee.` file/dir naming under
`LICENSE.md`'s exclusion clause and are covered instead by `LICENSE_EE.md`, which states the software
"may only be used in production, if you (and any entity that you represent) hold a valid n8n Enterprise
license corresponding to your usage." The code for these features is physically present in this cloned
repository, but **that does not license their use** — per `LICENSE_EE.md`, only "development and testing
purposes" are permitted without a subscription; any production use requires a paid Enterprise license.
Each item below is marked accordingly.

Verified via `.ee.` file paths and/or the `LICENSE_FEATURES` map (`packages/@n8n/constants/src/index.ts`):

- **SSO — SAML** (`packages/cli/src/modules/sso-saml/*.ee.ts`, `LICENSE_FEATURES.SAML`) — ENTERPRISE ONLY, requires a paid license, do not enable without one.
- **SSO — OIDC** (`packages/cli/src/modules/sso-oidc/*.ee.ts`, `LICENSE_FEATURES.OIDC`) — ENTERPRISE ONLY.
- **LDAP** (`packages/cli/src/modules/ldap.ee/*`, `LICENSE_FEATURES.LDAP`) — ENTERPRISE ONLY.
- **MFA enforcement** (org-wide mandatory MFA) (`LICENSE_FEATURES.MFA_ENFORCEMENT`) — ENTERPRISE ONLY (MFA itself, per-user opt-in, is free/Community).
- **Advanced permissions / custom roles** (`packages/@n8n/permissions/src/roles/*.ee.ts`, `LICENSE_FEATURES.ADVANCED_PERMISSIONS`, `CUSTOM_ROLES`, `PROJECT_ROLE_ADMIN/EDITOR/VIEWER`) — ENTERPRISE ONLY.
- **Source control / git-based environments** (`packages/cli/src/modules/source-control.ee/*`, `LICENSE_FEATURES.SOURCE_CONTROL`) — ENTERPRISE ONLY.
- **Log streaming** (`packages/cli/src/modules/log-streaming.ee/*` — Sentry, syslog, webhook destinations, `LICENSE_FEATURES.LOG_STREAMING`) — ENTERPRISE ONLY.
- **External Secrets** (vault-style secret providers) (`packages/cli/src/modules/external-secrets.ee/*`, `LICENSE_FEATURES.EXTERNAL_SECRETS`) — ENTERPRISE ONLY.
- **Variables** (global key-value variables feature) (`packages/@n8n/db/.../variables.ts` + `environments.ee/variables/*.ee.ts`, `LICENSE_FEATURES.VARIABLES`) — ENTERPRISE ONLY (quota-limited even when licensed, `LICENSE_QUOTAS.VARIABLES_LIMIT`).
- **Workflow/credential sharing across users** (`LICENSE_FEATURES.SHARING`, `WorkflowShareModal.ee.vue`, `CredentialSharing.ee.vue`) — ENTERPRISE ONLY.
- **Multiple main instances (HA)** (`scaling/multi-main-setup.ee.ts`, `LICENSE_FEATURES.MULTIPLE_MAIN_INSTANCES`) — ENTERPRISE ONLY.
- **Worker view (observability UI for workers)** (`scaling/worker-status.service.ee.ts`, `LICENSE_FEATURES.WORKER_VIEW`) — ENTERPRISE ONLY.
- **Evaluations** (workflow test-run tooling, annotations) (`*.ee.ts` under `evaluation.ee/`, `db/entities/evaluation-*.ee.ts`, `test-run.ee.ts`) — ENTERPRISE ONLY (`LICENSE_FEATURES` has no single flag confirmed read for this exact one — inferred from `.ee.` naming; treat as ENTERPRISE ONLY pending a feature-flag cross-check, i.e. **partially NOT VERIFIED** on exact flag name).
- **Provisioning / SSO-driven role mapping** (`modules/provisioning.ee/*`) — ENTERPRISE ONLY.
- **Binary data / execution data on S3 or Azure Blob** (`core/src/binary-data/*.ee.ts`, `blob-storage/*.ee.ts`, `LICENSE_FEATURES.BINARY_DATA_S3/AZURE`, `EXECUTION_DATA_S3/AZURE`) — ENTERPRISE ONLY.
- **Insights dashboard / hourly data / summary views** (`LICENSE_FEATURES.INSIGHTS_VIEW_*`) — ENTERPRISE ONLY (varies by exact view; base insights may be more limited on lower tiers — exact free/paid split per view NOT fully re-verified per flag in this pass).
- **API key scopes, workflow diffs, named versions, dynamic credentials, personal space policy, token exchange, data redaction, custom OTEL span attributes, workflow reviews, AI Builder** — all present as distinct `LICENSE_FEATURES` entries (`API_KEY_SCOPES`, `WORKFLOW_DIFFS`, `NAMED_VERSIONS`, `DYNAMIC_CREDENTIALS`, `PERSONAL_SPACE_POLICY`, `TOKEN_EXCHANGE`, `DATA_REDACTION`, `OTEL_CUSTOM_SPAN_ATTRIBUTES`, `WORKFLOW_REVIEWS`, `AI_BUILDER`) confirming these are ALL gated feature flags — ENTERPRISE ONLY (specific behavior of each NOT individually explored in this pass; flagged for completeness only).
- **Community nodes from a custom/private registry** (`LICENSE_FEATURES.COMMUNITY_NODES_CUSTOM_REGISTRY`) — ENTERPRISE ONLY (installing from the *public* npm registry is Community/free).
- **OEM embedding of the n8n editor UI inside a third-party product** — per docs, requires a **separate commercial agreement** (not just an Enterprise license) — ENTERPRISE/COMMERCIAL ONLY, and even then n8n branding must remain visible.

None of the above should be enabled in any Orlixa deployment without Orlixa itself holding the
corresponding paid n8n license — the code being present in the open-source clone is not authorization to
use it.

---

## 19. Community Features (confirmed to ship free, unlicensed)

Verified as NOT `.ee.`-suffixed and not gated by any `LICENSE_FEATURES` flag found:
- Core workflow editor, node-by-node execution engine, all 307 built-in `nodes-base` integrations and
  their 405 credential types.
- Manual/cron/polling/webhook triggers; the full `INodeType` extension surface (§12).
- Queue mode itself (Bull/Redis) and adding worker processes for horizontal scaling — not license-gated
  (only *multiple main instances* is gated, not workers).
- Public REST API core resources: workflows, executions, credentials, users, tags, folders, projects
  (CRUD).
- Installing community nodes from the public npm registry (`n8n-nodes-*` packages).
- Per-user MFA (opt-in), basic user management, personal + team Projects (the non-Enterprise sharing
  model within a project you already belong to).
- AES-256-GCM credential encryption via `N8N_ENCRYPTION_KEY` — the security mechanism itself is fully
  Community, not paywalled.

---

## 20. Which parts should Orlixa reuse

1. **The `INodeType` node abstraction and the 307-node `nodes-base` library**, if Orlixa decides it needs
   broad third-party-integration breadth (e.g. long-tail CRMs, marketing tools, project-management SaaS)
   faster than it can hand-build `TOOL_ACTION` executors for each. Wrapping n8n as a black-box
   "automation sub-engine" invoked by Orlixa's own `TOOL_ACTION` node type is architecturally clean: n8n
   never needs to be shown to a customer, and Orlixa keeps its own TRIGGER/RETRIEVE/AI_STEP/CONDITION/
   WAIT/APPROVAL/NOTIFY semantics as the outer orchestration layer.
2. **The community-node npm-package convention** as a model for how Orlixa could let its own team (not
   necessarily end customers) add new integrations without a full backend release, if Orlixa ever wants
   a similar plugin story.
3. **The credential encryption design** (single instance-wide envelope key via env var, AES-256-GCM with
   HKDF, versioned wire format) is a reasonable reference pattern if Orlixa's own credential-at-rest
   encryption needs hardening — Orlixa need not use n8n's code, but the design is a good comparison
   point.

---

## 21. Which parts should Orlixa replace / not adopt as the core engine

**Orlixa's own internal workflow engine (BullMQ-based, TRIGGER/RETRIEVE/AI_STEP/TOOL_ACTION/WAIT/
CONDITION/NOTIFY/APPROVAL) should NOT be replaced by n8n.** Reasons, grounded in what was verified above:
- n8n's node graph model is a generic automation DSL with no first-class concept of an AI agent step,
  an approval/human-in-the-loop gate as a named primitive (n8n approximates this via wait/webhook-resume
  patterns), or Orlixa's TOOL_ACTION-vs-NOTIFY distinction. Rebuilding Orlixa's semantics on top of n8n's
  graph would mean fighting the grain of a tool designed for its own editor UI and its own execution
  model, not simplifying anything.
- n8n's queue is Bull (v4), not BullMQ — adopting n8n wholesale would mean running two different queue
  libraries/operational models side by side, adding complexity rather than removing it.
- n8n's multi-user/multi-tenant model (Projects, sharing, RBAC) is either weak (Community) or paid
  (Enterprise) and doesn't map to Orlixa's per-company/per-employee tenancy without Orlixa building its
  own isolation layer on top anyway — at which point Orlixa gains nothing over its current design.
- If Orlixa wants n8n's integration breadth, the correct architecture is **n8n as a separate, optional
  execution backend behind a single Orlixa `TOOL_ACTION` (or a new node type) that calls into an
  n8n instance's workflows via its Public REST API / webhook trigger**, not a replacement of Orlixa's
  orchestration engine. This preserves Orlixa's own AI_STEP/APPROVAL/CONDITION semantics as the
  system of record for "what the AI Employee is doing," while delegating only the "talk to this SaaS
  API" leaf work to n8n where useful.

---

## 22. Which parts should Orlixa ignore

- **n8n's editor UI (`frontend/editor-ui`)** — per the task's own framing, Orlixa customers must never
  see this; there is no reuse case since Orlixa's own AI-employee chat interface is the sole UI.
- **n8n's own user/auth/session system** (JWT cookie login, its own `User`/`Project`/RBAC model) — Orlixa
  already has its own tenant/user model; adopting n8n's would create two overlapping identity systems.
- **All Enterprise-gated governance features** (§18: SSO, LDAP, RBAC/custom roles, source control,
  log streaming, external secrets, multi-main HA, insights) — not just because of cost, but because
  Orlixa's own platform is the correct place to build governance for its own customers; buying n8n's
  Enterprise license would only govern n8n's internal admin surface, not Orlixa's product surface.
- **OEM/white-label embedding of n8n's editor** — explicitly not what Orlixa wants (task states customers
  never see n8n), and per docs it still requires n8n branding even under a paid OEM agreement, so it
  would not achieve a clean white-label goal even if pursued.
- **n8n's own Bull-based queue/worker infrastructure as Orlixa's queue** — Orlixa already has a working
  BullMQ-based engine; running n8n's Bull queue in parallel (if n8n is adopted at all) should stay
  internal to an isolated "n8n backend" deployment, not merged into Orlixa's own job infrastructure.

---

## Not Verified / Open Items

- Exact contents of `packages/extensions` — not read in this pass.
- Exact license-feature-flag name backing "Evaluations" (§18) — inferred from `.ee.` naming, not
  individually cross-checked against `LICENSE_FEATURES`.
- Detailed behavior of `INSIGHTS_VIEW_*` free/paid split per view.
- Exact default `--concurrency` value for workers (docs describe the fallback mechanism but not the
  numeric default).
- AI Agent node's `ai_tool`/`ai_languageModel` connection-type mechanics — referenced structurally but
  not read node-by-node in `nodes-base`.
