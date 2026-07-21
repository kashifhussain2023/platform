# Novu — Engine Study

Source verified against a local clone of `novuhq/novu` (TypeScript, Nx monorepo, pnpm workspaces) at
`C:\Users\Admin\AppData\Local\Temp\claude\novu-src`, plus official docs at `docs.novu.co`. Docker image
tag observed in the repo's own community compose file: `3.18.0`. Where a claim could not be verified
against source or official docs, it is marked **NOT VERIFIED**.

---

## 1. Executive Summary

Novu is an open-core, multi-channel **notification infrastructure** platform: you define a "Workflow"
(a sequence of steps — email, SMS, push, in-app, chat, plus delay/digest/custom "tool" steps), register
it with Novu (either via its dashboard UI or headlessly via the `@novu/framework` code-first SDK), and
then fire it by calling `POST /v1/events/trigger` with a workflow identifier, a recipient
(`subscriberId`), and a JSON payload. Novu resolves the workflow, evaluates per-subscriber/per-channel
preferences, fans out to the configured provider integrations (SES/SendGrid/Twilio/FCM/Slack/etc. —
credentials stored per Organization+Environment), and records delivery state in MongoDB. Background
processing is Nx-monorepo NestJS services (`apps/api`, `apps/worker`, `apps/ws`) backed by
**BullMQ-on-Redis**, with a newer, partially-rolled-out **SQS** path already wired into the same worker
classes (`WorkflowWorkerService`/`StandardWorkerService` in `libs/application-generic` both drive a
BullMQ worker and an SQS consumer side-by-side — apps/worker/src/app/workflow/services/workflow.worker.ts,
standard.worker.ts). The whole trigger path is 100% API-drivable with zero dashboard/UI involvement —
confirmed both in source (`EventsController` requires only header auth, no session) and in Novu's own
docs, which state explicitly "the dashboard is not required to trigger workflows via API."

Novu ships as **open-core**: the bulk of the product (apps/api, apps/worker, apps/ws, the provider
framework, the DAL) is MIT-licensed. A separate `enterprise/` directory at the repo root (packages for
`ai`, `api`, `auth`, `billing`, `shared-services`, `translation`, plus `workers/scheduler`, `socket`,
`step-resolver`, `thalamus-observer`) is covered by a **different, more restrictive proprietary license**
(`EE-PACKAGES-LICENSE`) than the rest of the enterprise-tier code (`LICENSE-ENTERPRISE`). Both are
non-OSI licenses requiring Novu's prior written approval to use in production — see Section 18 for the
exact terms and what is gated.

---

## 2. Architecture Diagram

```
                            ┌───────────────────────────┐
                            │   External Caller (Orlixa) │
                            │  POST /v1/events/trigger    │
                            │  Authorization: ApiKey ...  │
                            └──────────────┬──────────────┘
                                           │ HTTPS
                                           ▼
                     ┌────────────────────────────────────────┐
                     │              apps/api (NestJS)           │
                     │  EventsController → ParseEventRequest    │
                     │  resolves workflow + subscriber(s),      │
                     │  writes Job doc, enqueues                │
                     └───────┬───────────────────┬─────────────┘
                             │ BullMQ / SQS       │ Mongoose
                             ▼                    ▼
                   ┌───────────────────┐   ┌──────────────┐
                   │      Redis        │   │   MongoDB     │
                   │ (BullMQ queues:    │   │ (Organization,│
                   │ trigger-handler,   │   │ Environment,  │
                   │ standard,          │   │ NotificationTemplate,
                   │ process-subscriber,│   │ Subscriber,   │
                   │ ws_socket_queue,   │   │ Job, Message, │
                   │ inbound-parse-mail)│   │ Integration…) │
                   └─────────┬──────────┘   └──────┬────────┘
                             │                      │
                             ▼                      │
                    ┌──────────────────┐            │
                    │   apps/worker     │◄───────────┘
                    │  WorkflowWorker   │  reads workflow steps,
                    │  StandardWorker   │  evaluates conditions/digest/
                    │ (RunJob usecase)  │  delay, calls provider SDKs
                    └─────────┬─────────┘
                              │
             ┌────────────────┼─────────────────┬───────────────┐
             ▼                ▼                 ▼               ▼
        Email provider   SMS provider      Push provider   Chat/Slack/Teams
        (SES/SendGrid/…) (Twilio/…)        (FCM/APNs/…)    provider
             │                │                 │               │
             └──────────────────────► Recipient inbox / device ◄┘

  apps/ws (Socket.IO, Redis-backed) pushes real-time in-app/inbox updates to
  end-user browser widgets (@novu/js / @novu/react). apps/dashboard is the
  admin/config UI (Clerk-authenticated in EE mode) — not required for triggers.
```

---

## 3. Component Diagram

| Component | Nx path | Role |
|---|---|---|
| `apps/api` | REST API — auth, events/trigger, workflows-v1/v2, subscribers, integrations, tenants, topics | NestJS, request-scoped controllers |
| `apps/worker` | Background job processors | NestJS microservice, no HTTP surface besides health |
| `apps/ws` | WebSocket gateway for real-time in-app/Inbox updates | Socket.IO + Redis adapter |
| `apps/dashboard` | Admin/config web UI (Vite/React) | Clerk auth (EE) — workflow editor, integration setup |
| `apps/inbound-mail` | Inbound email parsing (reply-to-thread) | NestJS |
| `apps/webhook` | Outbound webhook delivery / signature verification helper app | NestJS |
| `libs/dal` | Mongoose schemas + repositories (the only place MongoDB is touched) | shared lib |
| `libs/application-generic` | Cross-cutting: queues (BullMQ/SQS), encryption, feature flags, caching, logging | shared lib |
| `packages/framework` | `@novu/framework` — code-first workflow definition SDK (the "Bridge") | published npm pkg |
| `packages/providers` | Channel provider adapters (email/sms/push/chat/tool) | published npm pkg |
| `packages/novu`, `packages/js`, `packages/react`, `packages/react-native` | Client SDKs (trigger + Inbox widget) | published npm pkgs |
| `enterprise/packages/*`, `enterprise/workers/*` | EE-gated: AI, EE-auth (Clerk), billing, translation, shared-services, scheduler/socket/step-resolver/thalamus-observer workers | **EE-PACKAGES-LICENSE** |

---

## 4. Request Flow

Traced from real source:

1. **`POST /v1/events/trigger`** — handled by `EventsController.trigger()`
   (`apps/api/src/app/events/events.controller.ts:105`). Guarded by `@RequireAuthentication()`,
   `@ExternalApiAccessible()`, `@KeylessAccessible()`, `@OAuthAccessible()` — i.e. API-key auth is a
   first-class, fully external-callable path (no session/dashboard cookie needed).
2. Controller builds a `ParseEventRequestMulticastCommand` (workflow `identifier` = `body.name`,
   `payload`, `to` = recipient(s), optional `tenant`, `actor`, `overrides`, `transactionId`) and calls
   **`ParseEventRequest.execute()`**
   (`apps/api/src/app/events/usecases/parse-event-request/parse-event-request.usecase.ts`, 615 lines).
   This usecase: validates the payload against the workflow's `payloadSchema` (if
   `validatePayload` is set on the `NotificationTemplate`), resolves/creates the `Subscriber` doc(s),
   resolves the `NotificationTemplate` (a.k.a. workflow) by `_environmentId` + `triggers.identifier`,
   and writes a `Job` document per step/subscriber combination.
3. Jobs are enqueued onto the **`trigger-handler`** BullMQ/SQS queue
   (`JobTopicNameEnum.WORKFLOW`, `packages/shared/src/config/job-queue.ts:12`), consumed by
   `WorkflowWorker` (`apps/worker/src/app/workflow/services/workflow.worker.ts`), which invokes the
   `TriggerEvent` usecase — this expands the workflow's step list into a chain of per-step `Job`
   documents and queues them onto the **`standard`** queue.
4. `StandardWorker` (`standard.worker.ts`) consumes each step job via the `RunJob` usecase
   (`apps/worker/src/app/workflow/usecases/run-job`), which evaluates step conditions/filters, handles
   digest/delay aggregation, and for message-producing steps calls into
   `apps/worker/src/app/workflow/usecases/send-message` — this is where a `providerId` is resolved from
   the org's active `Integration` document for that channel, credentials are decrypted
   (`get-decrypted-integrations.usecase.ts`), and the matching adapter in `packages/providers/src/lib/{email,sms,push,chat,tool}`
   is invoked to actually call the third-party provider API.
5. Every send is recorded as a `Message` document (`libs/dal/src/repositories/message/message.schema.ts`)
   with `status`, `deliveredAt`, `errorId`/`errorText`. In-app messages additionally push a real-time
   event over `apps/ws` (`ws_socket_queue`) to any connected Inbox/widget client.
6. `POST /v1/events/trigger/bulk` (`ProcessBulkTrigger`) and `POST /v1/events/trigger/broadcast`
   (`TriggerEventToAll`, all subscribers) are the same pipeline with a different fan-out entry point.
   `DELETE /v1/events/trigger/:transactionId` (`CancelDelayed`) cancels pending delay/digest jobs by
   `transactionId`.

---

## 5. Authentication Flow

Two distinct auth surfaces, confirmed in source:

**A. Dashboard user auth (interactive, human):**
- Community edition: `getCommunityAuthModuleConfig()`
  (`apps/api/src/app/auth/community.auth.module.config.ts`) registers Passport `JwtStrategy` +
  `@nestjs/jwt` signed with `JWT_SECRET`, backed by `CommunityUserRepository`/`CommunityAuthService`.
  Optional GitHub OAuth strategy if `GITHUB_OAUTH_CLIENT_ID` is set.
- Enterprise edition: `getEEModuleConfig()` (`ee.auth.module.config.ts`) `require()`s
  `@novu/ee-auth` at runtime and throws `PlatformException('ee-auth module is not loaded')` if the
  package/license isn't present. The dashboard's `package.json` depends on `@clerk/react`,
  `@clerk/backend`, `@clerk/shared` — confirming **Clerk** is the EE auth provider (SSO/social login,
  organization/member management UI). Test scripts explicitly set `CLERK_ENABLED=true
  NOVU_ENTERPRISE=true` to run the EE auth path.

**B. External API-key auth (machine-to-machine, used for triggering):**
- `ApiKeyStrategy` (`apps/api/src/app/auth/services/passport/apikey.strategy.ts`) is a
  `passport-headerapikey` strategy expecting header `Authorization: ApiKey <key>`. It SHA-256 hashes
  the presented key (`createHash('sha256')`) and looks it up (LRU-cached) via
  `AuthService.getUserByApiKey`. The raw key is generated per-Environment and stored on
  `Environment.apiKeys[]` (`libs/dal/.../environment.schema.ts`: `{ key, hash, _userId }`).
- A kill-switch feature flag (`IS_ORG_KILLSWITCH_FLAG_ENABLED`) is checked on every API-key request,
  letting Novu (cloud) or a self-hosted operator hard-disable an org.
- Separate `JwtSubscriberStrategy` issues short-lived JWTs for the **Inbox/widget** (end-user facing,
  not admin), and there's also a documented **"Keyless"** mode (`@KeylessAccessible()`) for
  zero-config trial usage — **NOT VERIFIED** in depth beyond the decorator's presence.

---

## 6. Database Design

MongoDB via Mongoose. Real schema files (all under `libs/dal/src/repositories/*/*.schema.ts`):

- **`organization.schema.ts`** — root tenant entity: `name`, `apiServiceLevel` (billing tier), `branding`,
  `defaultLocale`/`targetLocales`, `productUseCases`, `partnerConfigurations` (Vercel-style partner
  integration tokens, `select: false`).
- **`environment.schema.ts`** — child of Organization (`_organizationId`); holds `apiKeys[]`
  (`{key, hash, _userId}`), `apiRateLimits` per category, `widget.notificationCenterEncryption`, DNS/
  inbound-parse config, `bridge.url` / `echo.url` (the Framework "Bridge" endpoint URL for code-first
  workflows), `_parentId` (Dev→Prod hierarchy).
- **`notification-template.schema.ts`** — this **is** the "Workflow": `triggers[]` (identifier +
  variables), `steps[]` (each with `type`, `filters`, `_templateId` → `MessageTemplate`, `metadata`
  for digest/delay config, and a `variants[]` array for A/B step variants), `preferenceSettings`,
  `payloadSchema`/`validatePayload`, `critical`, `isTranslationEnabled`.
- **`integration.schema.ts`** — one document per provider connection, scoped to `_environmentId` +
  `_organizationId`; `credentials` is a large flat object covering every supported provider's field
  set (apiKey, secretKey, accountSid, token, region, tenantId, signingSecret, etc.), `active`/`primary`/
  `priority` for provider fan-out ordering, `conditions[]` for routing rules, `kind: 'delivery' | 'agent'`.
- **`subscriber.schema.ts`** — end recipients, scoped per environment; holds channel identity data
  (email, phone, deviceTokens per channel — inferred from repository types, not fully enumerated here).
- **`message.schema.ts`** — one doc per actual send: `channel`, `providerId`, `status`, `seen`/`read`/
  `archived`, `deliveredAt[]`, `errorId`/`errorText`, `transactionId`, `payload`, `channelData[]`
  (endpoint/token for push), `contextKeys[]`.
- **`tenant.schema.ts`** — **separate from Organization**: `identifier`, `name`, `data` (free-form),
  scoped to one `_environmentId`/`_organizationId`. This is Novu's built-in mechanism for a single
  Novu project to serve many *end-customers* of the app built on top of it (see Section 15).
- Other repositories present: `job` (per-step execution state), `notification` (parent of `message`s
  for one trigger), `preferences` (per-subscriber channel opt-in/out), `topic` (pub/sub grouping of
  subscribers), `layout`, `execution-details` (audit trail per job/step), `change` (workflow
  publish/promote history), `translation`/`translation-group`, `localization`/`localization-group`.
- Soft-delete via `mongoose-delete` plugin is applied to `Integration` and `NotificationTemplate` (and
  likely others) — `deletedAt`/`deletedBy` fields, `overrideMethods: 'all'`.

---

## 7. Folder Structure

```
novu/
├── apps/
│   ├── api/            NestJS REST API (trigger, workflows, subscribers, integrations, auth…)
│   │   └── src/app/    ~45 feature modules (events, workflows-v1/v2, integrations, tenant, topics-v1/v2,
│   │                   subscribers-v1/v2, preferences, translations, agents, billing, bridge…)
│   ├── worker/          BullMQ/SQS consumers: WorkflowWorker, StandardWorker, subscriber-process worker
│   ├── ws/               Socket.IO gateway for real-time Inbox/widget updates
│   ├── dashboard/        React/Vite admin UI (Clerk auth in EE)
│   ├── inbound-mail/     Inbound email → reply-to-notification parsing
│   └── webhook/          Outbound webhook delivery service
├── libs/
│   ├── dal/               Mongoose schemas + repository classes (sole DB access layer)
│   ├── application-generic/  Queues (BullMQ+SQS), encryption, caching, feature flags, logging, health
│   ├── automation/, notifications/, agent-evals/, internal-sdk/, maily-*  (mail rendering/editor libs)
│   └── testing/           Shared e2e/test helpers
├── packages/
│   ├── framework/         @novu/framework — code-first "Bridge" workflow definition SDK
│   ├── providers/          Channel provider adapters: lib/{email,sms,push,chat,tool}
│   ├── novu/, js/, react/, react-native/, nextjs/  Client trigger + Inbox widget SDKs
│   ├── shared/             Cross-cutting enums/types/DTOs shared by API, worker, SDKs
│   └── stateless/, add-inbox/, chat-adapter*/, agent-toolkit/
├── enterprise/            EE-PACKAGES-LICENSE — see Section 18
│   ├── packages/{ai,api,auth,billing,shared-services,translation}
│   └── workers/{scheduler,socket,step-resolver,thalamus-observer}
├── docker/
│   ├── community/         Production-style single-org docker-compose.yml (Section 8)
│   └── local/              Dev-only dependency compose files (Mongo/Redis/LocalStack)
├── LICENSE-MIT             Default license for everything outside enterprise/packages
├── LICENSE-ENTERPRISE       Governs the broader "enterprise" tier / cloud-only features
└── EE-PACKAGES-LICENSE      Governs enterprise/packages specifically (see Section 18)
```

---

## 8. Deployment Architecture

Confirmed from the repo's own `docker/community/docker-compose.yml` (image tag `3.18.0`) and
`docker/Readme.md`, plus `docs.novu.co/community/self-hosting-novu/overview`:

- Services: `redis` (redis:alpine), `mongodb` (mongo:8.0.17), `api`, `worker`, `ws`, `dashboard` — each
  a separate container, `api`/`worker`/`ws` all depend on Mongo+Redis health checks; `dashboard`
  depends on `api`+`worker`.
- Required env vars include `MONGO_URL`, `REDIS_HOST/PORT/PASSWORD` (with a distinct
  `REDIS_CACHE_SERVICE_HOST/PORT` for a separate cache Redis instance), `JWT_SECRET`,
  `STORE_ENCRYPTION_KEY` (32 chars — encrypts provider credentials, see Section 16), `NOVU_SECRET_KEY`,
  S3 config (`S3_BUCKET_NAME`/`S3_REGION` or `S3_LOCAL_STACK` for local dev).
- `docker/local/` is explicitly documented as **dev-dependencies only** (Mongo, Redis, LocalStack) — it
  does *not* start API/Worker/WS/Dashboard; those run from source via `pnpm dev:portless` in local dev.
- Official production self-hosting guidance (`docs.novu.co`) recommends a **multi-VM topology**: API,
  Worker, and WS each on their own VM (2 vCPU/4GB), Dashboard on its own VM (2 vCPU/4GB), **two separate
  Redis clusters** (8GB each — one dedicated to the BullMQ queue with AOF persistence enabled to avoid
  job loss on restart), MongoDB Atlas M20-or-higher, and S3-compatible storage (10GB min). A
  single-VM fallback (4 vCPU/8GB) is documented for constrained environments. Kubernetes deployment via
  Helm/Kustomize is referenced (`docker/Readme.md` → `kubernetes/helm/Readme.md`) but not itself present
  in this clone's `docker/` tree — **NOT VERIFIED** beyond the pointer.
- Cloud-exclusive features and social login are explicitly documented as unavailable in self-hosted mode.

---

## 9. Worker Architecture

- `apps/worker` is a standalone NestJS process (no HTTP API besides `/v1/health-check`), holding
  `WorkflowWorker` and `StandardWorker` (`apps/worker/src/app/workflow/services/*.worker.ts`), each
  extending a shared base (`WorkflowWorkerService`/`StandardWorkerService` in
  `libs/application-generic`) that wraps **both** a BullMQ `Worker` and an SQS long-poll consumer —
  i.e. the codebase is mid-migration from pure BullMQ/Redis to a BullMQ/SQS hybrid, selectable per
  queue/job via feature flags (`CF_SCHEDULER_MODE` — Cloudflare Queues scheduler shadow/live/complete
  modes seen in `standard-queue.service.ts`). For a from-scratch integration, **the BullMQ/Redis path is
  the one guaranteed to work identically in self-hosted community edition** — the SQS/Cloudflare paths
  read like Novu-cloud infra experiments layered on top.
- Retry semantics differ intentionally by queue: **Workflow jobs are at-most-once** — any processing
  failure at the trigger-resolution stage is treated as a non-retryable client error (bad
  `transactionId`, missing `subscriberId`, schema-invalid payload) and dropped rather than retried
  (explicit code comment in `workflow.worker.ts`). **Standard (per-step) jobs** retry with a
  configurable backoff strategy (`WebhookFilterBackoffStrategy`) up to `DEFAULT_ATTEMPTS`, tracked via
  `attemptsMade` and, on the SQS path, `RedrivePolicy.maxReceiveCount`.
- A kill-switch check (`IS_ORG_KILLSWITCH_FLAG_ENABLED` feature flag) runs before every job is
  processed, letting an operator hard-stop a single organization's processing without touching the
  queue globally.
- `subscriber-process.worker.ts` handles a separate `process-subscriber` queue for subscriber
  create/update side-effects (e.g. resolving a `to:` addressing spec into concrete Subscriber docs) —
  decoupled from the trigger critical path.

---

## 10. Queue Architecture

Canonical, source-of-truth queue names (`packages/shared/src/config/job-queue.ts` —
the file's own comment: *"DO NOT CHANGE THE VALUES OF THIS ENUM ... changing them will break the
system resulting in stalled jobs"*):

| `JobTopicNameEnum` | Redis/BullMQ name | Purpose |
|---|---|---|
| `WORKFLOW` | `trigger-handler` | Trigger resolution → step-job expansion (`WorkflowWorker`) |
| `STANDARD` | `standard` | Per-step execution / provider send (`StandardWorker`, `RunJob`) |
| `PROCESS_SUBSCRIBER` | `process-subscriber` | Subscriber create/update side-effects |
| `WEB_SOCKETS` | `ws_socket_queue` | Real-time Inbox/widget push events |
| `INBOUND_PARSE_MAIL` | `inbound-parse-mail` | Inbound email → reply-to-notification |
| `ACTIVE_JOBS_METRIC` | `metric-active-jobs` | Queue depth/backlog metrics |

Each queue is wrapped by a `*QueueService extends QueueBaseService`
(`libs/application-generic/src/services/queues/*.ts`), constructed with a `BullMqService` (Redis) and,
increasingly, an `SqsService` side-by-side. `StandardQueueService.add()` shows the delay-handling logic
concretely: delay=0 jobs route through the normal BullMQ/SQS path; delayed jobs go through either
BullMQ's native delay or (feature-flagged) a Cloudflare Scheduler shadow/live/complete rollout. Retry
config lives per-worker (Section 9), not centrally in the queue definitions.

---

## 11. API Structure

Confirmed controller: `apps/api/src/app/events/events.controller.ts` (base path `events`, prefixed
`/v1` at the app level per Novu's own trigger-docs example URL
`https://api.novu.co/v1/events/trigger`):

| Endpoint | Method | Notes |
|---|---|---|
| `/v1/events/trigger` | POST | Single workflow trigger. `@KeylessAccessible @ExternalApiAccessible @OAuthAccessible`, `RequirePermissions(EVENT_WRITE)`. Body: `name` (workflow identifier), `to`, `payload`, `overrides`, `actor`, `tenant`, `context`, `transactionId`, `bridgeUrl`, `controls`. |
| `/v1/events/trigger/bulk` | POST | Up to 100 events per request via `ProcessBulkTrigger`. |
| `/v1/events/trigger/broadcast` | POST | Trigger to **all** subscribers in the environment (`TriggerEventToAll`). |
| `/v1/events/trigger/:transactionId` | DELETE | Cancel a pending delayed/digested trigger. |
| `/v1/events/test/email` | POST | Internal-only (`@ApiExcludeEndpoint`) send-test-email helper. |

Other major API modules present in `apps/api/src/app` (each its own NestJS module):
`workflows-v1`/`workflows-v2` (CRUD for NotificationTemplates), `subscribers`/`subscribers-v2`,
`integrations` (provider CRUD), `tenant`, `topics-v1`/`topics-v2`, `preferences`, `translations`,
`layouts-v1`/`layouts-v2`, `feeds`, `messages`, `notification-groups`, `organization`, `environments-v1`/
`environments-v2`, `bridge` (Framework endpoint sync), `inbox` (Inbox widget backend), `agents`
(the newer AI-agent surface — **NOT VERIFIED** against docs, source-only finding).

---

## 12. Extension Points

Adding a new notification provider (e.g. a new SMS vendor) is a **provider-package** extension, not a
workflow-engine change:
1. Implement an adapter under `packages/providers/src/lib/{channel}/` extending `BaseProvider`
   (`packages/providers/src/base.provider.ts`), which standardizes request/response **casing**
   transforms (`camelCase`/`PascalCase`/`snake_case`/`kebab-case`/`CONSTANT_CASE` — real enum
   `CasingEnum`) between Novu's internal data shape and whatever casing the vendor's API expects, plus a
   `transform()` helper that merges a "passthrough" escape hatch (raw `body`/`headers`/`query`
   overrides) into the final provider payload.
2. Register the provider's credential fields in `Integration.credentials` (the flat schema already
   anticipates ~50 field names spanning every existing provider — a new provider typically reuses
   existing fields like `apiKey`/`secretKey`/`from` rather than needing a schema migration).
3. Wire it into whichever channel's dispatch usecase in `apps/worker/src/app/workflow/usecases/send-message`
   selects a provider by `channel` + active `Integration.providerId`.
No plugin manifest/registry system was found — it is a compile-time, in-repo addition (open-source
contribution model), confirmed by the flat `packages/providers/src/lib/{chat,email,push,sms,tool}`
structure with no dynamic-loader code nearby.

---

## 13. Plugin System

**No general-purpose runtime plugin system exists beyond the provider-adapter pattern above.**
Extensibility for *workflow logic* (as opposed to delivery channels) is via `@novu/framework` — a
code-first SDK where you define workflow steps (including a generic "custom"/`tool` step type) in your
own codebase and expose them over an HTTP "Bridge" endpoint that Novu's API calls back into
(`Environment.bridge.url` / `echo.url` fields in the schema; `apps/api/src/app/bridge` module). This is
closer to a webhook-callback integration model than a plugin/module-loading system — no dynamic
package discovery, sandboxing, or marketplace mechanism was found in source.

---

## 14. Scalability

Per official self-hosting guidance (Section 8): API/Worker/WS are each independently horizontally
scalable stateless NestJS processes behind their own VM/replica count; state lives in MongoDB (Atlas
M20+ recommended) and two logically separate Redis clusters (a queue cluster with AOF persistence, and
a separate cache cluster — reflected in source by the distinct `REDIS_HOST` vs
`REDIS_CACHE_SERVICE_HOST` env vars in the docker-compose file). Worker concurrency itself is configured
via BullMQ `WorkerOptions` (`getWorkflowWorkerOptions()`/`getStandardWorkerOptions()` in
`application-generic`) — exact default concurrency values were **NOT VERIFIED** (not opened in this
pass; would require reading `libs/application-generic/src/services/queues/queue-base.service.ts` in
full). The in-flight migration to SQS + a Cloudflare Queues scheduler shadow-mode (Section 9) signals
Novu-cloud is actively moving off pure Redis-queue scaling limits — self-hosters on the community image
are still on the BullMQ/Redis model.

---

## 15. Multi-tenancy

Two independent axes exist, and conflating them is the most likely integration mistake:

1. **Organization → Environment** is the *administrative/structural* tenant root. An Organization owns
   Environments (typically Development + Production, more on paid plans); each Environment has its own
   API keys, integrations, subscribers, and rate limits (confirmed: `environment.schema.ts` `_organizationId`
   ref; official docs: "Activity feeds, API keys, integrations, subscribers, topics, and webhooks are
   completely separate and unique to each environment"). This layer is meant for **one company's own
   dev/staging/prod split**, not for hosting many end-customers.
2. **Tenant** (`libs/dal/src/repositories/tenant/tenant.schema.ts`) is a separate, lightweight, runtime
   entity scoped under one Environment (`_environmentId`/`_organizationId` + `identifier`/`name`/`data`)
   built specifically for **"applications that serve multiple organizations, workspaces, or customers
   from a single Novu project"** (official docs, verbatim). Triggers accept an optional `tenant` field
   (seen directly in `EventsController.trigger()`'s command construction), which scopes Inbox feed
   grouping, notification preferences, and branding/content per tenant — without needing a new
   Organization or Environment per customer.

**Recommendation for Orlixa (justified):** map **one shared Novu Organization + one Environment**
(Orlixa's own production account) to Orlixa as a whole, and map **one Novu `Tenant` record per Orlixa
company/tenant**, passing `tenant: { identifier: orlixaCompanyId }` on every trigger call. This avoids
provisioning a new Novu org/API-key pair per Orlixa customer (heavyweight, not what the Organization/
Environment model is designed for) while still getting per-customer branding, preference scoping, and
Inbox isolation. Subscribers (`subscriberId`) should be namespaced per Orlixa user (e.g.
`{orlixaCompanyId}:{userId}`) since Subscriber identity is only unique within one Environment, not
further scoped by Tenant automatically at the DB level for uniqueness — this needs to be enforced by
Orlixa's own ID convention, not by Novu.

---

## 16. Security

- **Provider credentials are encrypted at rest.** `Integration.credentials.*` values are encrypted with
  the repo's own AES-256-CBC helper (`libs/application-generic/src/encryption/cipher.ts`:
  `createCipheriv('aes-256-cbc', ...)`, random 16-byte IV per value, stored as `iv:ciphertext` hex),
  keyed by the operator-supplied `STORE_ENCRYPTION_KEY` env var (required, 32 chars, per
  `docker/Readme.md`). A dedicated migration (`apps/api/migrations/encrypt-credentials`,
  `encrypt-api-keys`) exists in the repo, implying this encryption was retrofitted onto previously
  plaintext data at some point in Novu's history — worth noting for anyone auditing an old self-hosted
  instance for un-migrated plaintext rows.
- **API keys are hashed, not stored raw**, for lookup (`ApiKeyStrategy`: `createHash('sha256')`) — the
  `Environment.apiKeys[]` schema stores both `key` (used for display/rotation UX) and `hash`.
- Kill-switch feature flag lets an operator immediately halt processing per organization across API,
  worker, and event-trigger paths (three independent checks found: `EventsController.checkKillSwitch`,
  `ApiKeyStrategy.checkKillSwitch`, `WorkflowWorker/StandardWorker.isKillSwitchEnabled`).
- Rate limiting is a first-class concern: `ApiRateLimitCategoryEnum` (TRIGGER/CONFIGURATION/GLOBAL)
  per-Environment limits stored directly on the `Environment` document, enforced via
  `@ThrottlerCategory`/`@ThrottlerCost` decorators on controllers.
- SSRF protections exist and are tested (`apps/api/src/app/events/e2e/trigger-event-ssrf.e2e.ts`) —
  relevant because triggers can carry a `bridgeUrl`/`directWebhookUrl` that the backend will call back
  into.

---

## 17. Limitations (real gaps found)

- The BullMQ→SQS/Cloudflare-Scheduler migration visible throughout `application-generic` and the worker
  services is clearly **mid-flight** (feature-flagged shadow/live/complete modes) — self-hosters get a
  hybrid, partially-documented queue backend rather than one clean implementation.
- Cloud-exclusive features are explicitly unavailable self-hosted (official docs), and social login
  (GitHub OAuth aside) is likewise cloud-only.
- No public plugin/marketplace system for delivery providers — adding one requires a source-level PR/
  fork, not a runtime extension mechanism (Section 12/13).
- Subscriber uniqueness/tenant-scoping is Environment-wide, not Tenant-scoped at the schema level — an
  integrator must invent their own namespacing convention for multi-tenant `subscriberId`s (Section 15).
- Some newer surfaces (`apps/api/src/app/agents`, `enterprise/packages/ai`) exist in source with no
  corresponding public docs page found in this pass — **NOT VERIFIED** as GA vs. internal/experimental.

---

## 18. Enterprise-only Features

**Legal framing (read first):** the repo has three license regimes, verified verbatim:

1. **`LICENSE-MIT`** (root) — standard MIT, copyright "Noti-fire Apps Ltd." — applies to "content
   outside of the [enterprise/packages] directories" per `LICENSE-ENTERPRISE`'s own preamble.
2. **`LICENSE-ENTERPRISE`** — a **"Novu Proprietary Software License"**. Verbatim key terms: grants "a
   non-exclusive, non-transferable license to use the Software **solely for your internal
   operations**"; explicitly states "**You may not rent, lease, lend, sell, redistribute, sublicense or
   provide commercial hosting services with the Software**"; requires **"Approval Required: You may not
   use the Software without obtaining prior written approval from Novu"**; forbids modification,
   reverse-engineering, or decompilation. This license's own preamble states it covers "the broader
   enterprise tier" content and explicitly carves out `enterprise/packages/*` as separately licensed.
3. **`EE-PACKAGES-LICENSE`** — textually **identical** proprietary-license body to `LICENSE-ENTERPRISE`
   (same "Approval Required" / no-modification / no-redistribution / no-commercial-hosting terms), but
   scoped specifically to `https://github.com/novuhq/novu/tree/next/enterprise/packages` — confirmed by
   cross-referencing against the real directory: `enterprise/packages/{ai,api,auth,billing,
   shared-services,translation}` and `enterprise/workers/{scheduler,socket,step-resolver,
   thalamus-observer}` genuinely exist in this clone.

**Practical implication:** the presence of `enterprise/` source in this clone (and the fact that
`ee.auth.module.config.ts` does a runtime `require('@novu/ee-auth')`, i.e. the *code path exists* in
`apps/api`) does **not** mean it is licensed for anyone's production use. Per the license text quoted
above, using any `enterprise/packages/*` code (or the broader "enterprise" tier) in production **requires
prior written approval from Novu and, in practice, a paid commercial agreement**; it may not be
modified, redistributed, or used to provide hosting services to third parties. This document describes
these mechanisms only for architectural understanding — it is not guidance for bypassing the license.

Concretely gated (**ENTERPRISE ONLY — requires a paid license / Novu approval**), based on the real
`enterprise/` directory contents and the `ee.auth.module.config.ts` runtime dependency:
- **SSO / social-login / Clerk-based auth** — `enterprise/packages/auth`, loaded only via
  `@novu/ee-auth` when `NOVU_ENTERPRISE`/EE build flags are set.
- **Translation/localization management workflow** — `enterprise/packages/translation` (the community
  DAL still has `translation`/`localization` *repositories*, i.e. the data model is community, but the
  management package is EE — **NOT FULLY VERIFIED** which slice of translation UX is community vs EE
  without reading the translation module's guard decorators; flagged here as likely-gated based on
  directory placement alone).
- **Billing** — `enterprise/packages/billing` (expected: this is inherently a cloud/EE concern for a
  hosted SaaS; a self-hoster with no need to bill sub-customers wouldn't need this regardless of
  license).
- **AI package** — `enterprise/packages/ai`.
- **Shared-services** — `enterprise/packages/shared-services` — contents not individually opened in
  this pass; **NOT VERIFIED** beyond its EE-license placement.
- **Scheduler / Socket / Step-resolver / Thalamus-observer workers** — `enterprise/workers/*` — these
  read as Novu-cloud-only infrastructure workers (e.g. `step-resolver` likely correlates with the
  community-side `apps/api/src/app/step-resolvers` module, suggesting a cloud-hosted variant of the same
  concern) — **NOT VERIFIED** in depth.

No evidence of gated audit-log, advanced RBAC, or SAML-specific packages was found as *separately named*
directories beyond what's implied by `enterprise/packages/auth`; if these exist they are most likely
bundled inside that single `auth` EE package rather than split out — **NOT VERIFIED** without opening
that package's internals (not present/buildable outside Novu's own EE build, per the license's
no-redistribution terms — deliberately not attempted here).

---

## 19. Community Features (confirmed free under MIT)

- Full trigger pipeline: `POST /v1/events/trigger` (+ bulk/broadcast/cancel), workflow (Notification
  Template) CRUD, steps with delay/digest/conditional filters/variants.
- All channel provider adapters in `packages/providers` (email/sms/push/chat/tool) and the
  `Integration` CRUD API — self-hosters can configure any supported provider without a license.
- Subscribers, Topics (pub/sub grouping), Preferences (per-subscriber channel opt-in/out), Tenants
  (multi-tenant scoping — Section 15), Layouts, Feeds.
- `@novu/framework` code-first workflow SDK (the "Bridge") — fully MIT, not EE-gated (lives in
  `packages/framework`, outside `enterprise/`).
- JWT + API-key auth, GitHub OAuth (community `community.auth.module.config.ts`).
- Real-time in-app/Inbox delivery via `apps/ws`.
- Credential encryption (AES-256-CBC via `STORE_ENCRYPTION_KEY`), rate limiting, kill-switch — all in
  MIT-licensed `apps/api`/`libs/application-generic`.
- Self-host docker-compose / Helm deployment path itself.

---

## 20. Which parts should Orlixa reuse

- **The trigger API contract itself** (`workflow identifier + subscriberId + payload`, optional
  `tenant`) — this is exactly the shape Orlixa's `NOTIFY` node needs: call
  `POST /v1/events/trigger` with `name: <orlixaWorkflowId>`, `to: { subscriberId: <orlixaUserId> }`,
  `payload: <node's templated data>`, `tenant: { identifier: <orlixaCompanyId> }`. This is a pure
  API integration — zero Novu dashboard/UI ever needs to be shown to an Orlixa customer, confirmed both
  by source (auth guards require only an API key, no session) and by Novu's own docs statement that the
  dashboard is optional for triggering.
- **The provider adapter framework** (`packages/providers`) — reuse as-is rather than writing Orlixa's
  own SES/Twilio/FCM/Slack integrations; this is the single biggest time-saver and is fully MIT.
- **The Organization/Environment/Tenant model** — map one Orlixa production Environment to one shared
  Novu org, one Novu Tenant per Orlixa company (Section 15) — reuse the concept rather than
  reinventing per-tenant notification scoping inside Orlixa's own DB.
- **Credential encryption pattern** (`STORE_ENCRYPTION_KEY` AES-256-CBC) is a reasonable reference
  implementation if Orlixa ever needs to store its own provider credentials outside Novu.
- **BullMQ/Redis queue architecture as a reference**, not necessarily the code — the queue naming/retry
  separation (at-most-once trigger resolution vs. retryable per-step send) is a good pattern for
  Orlixa's own workflow engine to eventually adopt for its other node types, independent of using Novu.

---

## 21. Which parts should Orlixa replace

- **Novu's own Workflow/step editor and dashboard UI** — Orlixa customers should never see it; Orlixa's
  own chat-based AI-employee interface and existing `ApprovalRequest`/workflow-builder UI remain the
  only UI surface. Novu is purely a backend notification-delivery engine here.
- **Novu's dashboard-based workflow authoring** — Orlixa should define/register workflows via
  `@novu/framework` (code-first, MIT) driven by Orlixa's own workflow definitions, not by clicking
  through Novu's Dashboard, so that "define a notification workflow" stays inside Orlixa's existing
  authoring surface rather than forking users out to a second product.
- **Novu's own Organization/member/billing model** — Orlixa already has its own company/user/billing
  model; do not let Novu's Organization become a second source of truth for who a "customer" is. Only
  the Tenant + Subscriber IDs should be synced from Orlixa, one-way.
- **Any EE-gated auth/SSO/translation/billing feature** — must not be used at all without a separate
  paid agreement with Novu (Section 18); Orlixa should treat these as simply "not present."

---

## 22. Which parts should Orlixa ignore

- **The in-flight SQS/Cloudflare-Scheduler migration** and `enterprise/workers/thalamus-observer` /
  `step-resolver` / `socket` workers — these are Novu-cloud infrastructure concerns, irrelevant to a
  self-hosted or API-only integration.
- **Clerk-based EE auth entirely** — Orlixa has its own auth; no Orlixa employee or customer should ever
  authenticate against Novu directly.
- **The Inbox/`@novu/js`/`@novu/react` widget SDKs** — these render Novu's own notification-center UI
  component; Orlixa's chat interface is the UI, so these front-end widgets are not needed unless Orlixa
  later wants an embeddable "notification bell" — not part of the current NOTIFY-node gap.
- **`enterprise/packages/billing`** — irrelevant; Orlixa bills its own customers through its own
  existing billing system, not Novu's.
- **Novu's own translation/localization management package** — if Orlixa needs i18n for notification
  content, it should template content in Orlixa's own layer before calling Novu's trigger API with
  already-localized `payload` strings, rather than adopting Novu's (partly EE-gated) localization system.
