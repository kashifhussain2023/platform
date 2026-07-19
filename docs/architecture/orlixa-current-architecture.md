# Orlixa (V-AEP) — Current Architecture (verified against code)

**Purpose of this doc:** a single, code-grounded reference for how the platform actually works today,
written to support designing a new **AI Marketing Manager** employee that publishes to social media via
a wrapped Postiz-like publishing engine. Every claim below was checked against the real files in this
repo on 2026-07-19 (not just the existing docs, which sometimes describe [TARGET]/roadmap state as if
it were shipped — discrepancies are flagged explicitly where found).

Stack recap (from `platform/CLAUDE.md`): pnpm + Turborepo · `apps/web` (Next.js App Router) ·
`apps/api` (NestJS + Prisma + Postgres/pgvector) · `packages/types` (`@vaep/types`, shared DTOs) ·
BullMQ/Redis · Docker infra (`infra/docker-compose.yml`).

---

## 1. Authentication

Real files: `apps/api/src/modules/auth/{auth.service.ts,auth.controller.ts,auth.provider.ts,jwt.strategy.ts,jwt-auth.guard.ts,jwt-auth.provider.ts,roles.guard.ts,decorators/*}`.

- **JWT access + refresh tokens.** `AuthProvider` (`auth.provider.ts`) issues `{ accessToken, refreshToken }`
  from a `JwtPayload = { sub: userId, companyId, role }`. The access token is returned in the JSON body;
  the refresh token is set as an **httpOnly cookie** (handled in `auth.controller.ts`) and posted back to
  `POST /auth/refresh`.
- **Passport JWT strategy** (`jwt.strategy.ts`) extracts the bearer token from the `Authorization` header
  and validates it against `JWT_ACCESS_SECRET`; `validate()` returns `AuthenticatedUser { userId, companyId, role }`
  which NestJS attaches to `request.user`.
- **`AuthService`** (`auth.service.ts`):
  - `register()` creates `Company` + owner `User` (role `OWNER`) in one `$transaction`, generates a unique
    slug, then calls `BillingService.ensureDefaultSubscription` to attach a STARTER plan.
  - `login()` resolves the user **by email alone** (not company-scoped) — the code comment explicitly notes
    this: *"email is unique per-company, not global... a later pass adds company-scoped login."* Rejects
    `DISABLED` users.
  - `refresh()` verifies the refresh token, reloads the user + company, reissues both tokens.
  - `me()` returns `{ user, company }` for `GET /auth/me`.
- **Frontend**: `apps/web/src/lib/apiClient.ts` is the single axios instance. It attaches the access token
  from a Zustand store (`useSessionStore`) on every request, and on a `401` de-dupes concurrent refresh
  attempts into one in-flight `POST /auth/refresh` call (cookie-based), replaying the original request.
- **2FA/OTP, account-lock, verify-email, forgot/reset-password pages exist in the frontend route tree**
  (`apps/web/src/app/(auth)/two-factor`, `/verify-otp`, `/account-locked`, etc.) — these are UI shells;
  confirm server-side enforcement separately before assuming they are fully wired end-to-end for a new
  feature that depends on them.

## 2. Organizations / Companies

Real file: `apps/api/prisma/schema.prisma` (`model Company`, lines 153–182).

- **`Company` IS the tenant.** There is **no separate Organization/Workspace model** — `CLAUDE.md` states
  this explicitly ("Company = org = workspace (decided, no split)") and the schema confirms it: every
  tenant-scoped model (`User`, `AiEmployee`, `KnowledgeDocument`, `InstalledSkill`, `Workflow`,
  `ApprovalRequest`, `Subscription`, `Department`, `Team`, `SecurityPolicy`, `InterviewSlot`, `AuditLog`,
  `UsageEvent`, `RawEvent`, `CanonicalEvent`) carries a plain `companyId String` column, most with a real
  `@relation` back to `Company` and an `@@index([companyId])`.
- `Company` fields: `name`, `slug` (unique), `industry/size/country/timezone/website/logoUrl/description`
  (onboarding profile), `onboardedAt` (null = wizard not completed).
- **Sub-org structure exists but is flat under Company**, not a separate tenant boundary:
  `Department` (name, description) and `Team` (`departmentId?` → `Department`, `SetNull` on delete) —
  see schema.prisma lines 611–636, `modules/organization/*`. A `SecurityPolicy` (one per company) holds
  `passwordMinLength/mfaRequired/sessionTimeoutMinutes/allowedEmailDomains/dataRetentionDays` — CLAUDE.md
  notes most of these are **stored but not enforced** yet.
- **Tenant scoping mechanism**: `CurrentTenant` param decorator (`auth/decorators/current-tenant.decorator.ts`)
  pulls `companyId` off `request.user` (populated by the JWT strategy) — every service method takes
  `companyId` explicitly and filters by it; there is no automatic Prisma middleware/RLS layer doing this
  for you. **Any new marketing tables must follow this same manual-companyId-everywhere convention.**

## 3. AI Employees

Real files: `apps/api/src/modules/employees/{employees.service.ts,employees.controller.ts,employees.constants.ts,runtime/*}`, schema.prisma lines 291–327.

- **`AiEmployee` model**: `name`, `role` (enum `EmployeeRole`: SUPPORT/SALES/RECRUITER/HR/ACCOUNTANT/
  PROJECT_MANAGER/**CUSTOM**), `status` (ACTIVE/PAUSED/DISABLED), `persona`, `model`, plus rich config:
  `department/managerName/workingHoursStart/End/timezone/language`, `knowledgeAccess` (ALL/NONE),
  `budgetLimit`, `permissions` (Json), `approvalRules` (Json), `goals`/`kpiTargets` (Json).
  A new "AI Marketing Manager" employee would use `role: 'CUSTOM'` (there is no MARKETING enum value yet —
  adding one is a trivial Prisma enum migration, or CUSTOM + persona text works with zero migration).
- **Runtime = `AgentRuntimeService`** (`runtime/agent-runtime.service.ts`), a single-purpose-service
  pipeline exactly matching the architecture doc's claim:
  1. **Guard** — `PAUSED`/`DISABLED` employees reject with 409 (`ConflictException`).
  2. **Budget check** (`assertUnderBudget`) — re-checked every loop iteration, not just once (a documented
     fix for a race where concurrent requests could blow past `budgetLimit`).
  3. Persist the user `Message`.
  4. **PLAN** — `PlannerService.plan(role, name, userText)`.
  5. **RETRIEVE** — `RetrievalService.retrieve(companyId, userText, knowledgeAccess, RETRIEVAL_K=5, role)`
     (reuses the Knowledge module's pgvector search, role-scoped).
  6. **MEMORY** — `MemoryService.load(companyId, conversationId, employeeId)`.
  7. **ACT** — bounded tool-calling loop, `MAX_ACT_ITERATIONS = 3` (`employees.constants.ts`), via
     `ToolExecutorService` (which delegates into the Skills module).
  8. **VALIDATE** — `ValidationService.validate(role, answer, sources)` (grounding/confidence check;
     `APPROVAL_CONFIDENCE_THRESHOLD = 0.5`; `HIGH_STAKES_ROLES = ['ACCOUNTANT', 'HR']` always flagged).
  9. Persist the assistant `Message` with `metadata: { plan, sources, validation, toolCalls }`, append a
     rolling `SUMMARY` `EmployeeMemory`, record LLM usage (`UsageService`).
- **Role-boundary guardrail**: `buildSystemPrompt` injects a hard "ROLE BOUNDARY" instruction plus a list
  of *other* hired employees so an off-role request gets redirected by name rather than answered — this is
  a prompt-level guardrail only (no schema/tool restriction), per user's own memory
  (`systemic-guardrail-tool-refusal.md`) it can be inconsistent.
- **Swappable `LlmProvider`** (`employees/llm/llm.provider.ts` + `mock-llm.provider.ts` / `anthropic-llm.provider.ts` /
  `openai-llm.provider.ts`), selected via `LLM_PROVIDER` env (`mock` default, offline/deterministic for tests).

## 4. Permissions / RBAC

Real files: `apps/api/src/modules/auth/{roles.guard.ts,decorators/roles.decorator.ts}`, `modules/users/*`.

- **Three-tier hierarchy**: `enum Role { OWNER, ADMIN, MEMBER }` (schema.prisma). `RolesGuard`
  (`roles.guard.ts`) ranks them `MEMBER:0 < ADMIN:1 < OWNER:2` and implements a **satisfies-or-higher**
  check (`roleSatisfies`): `@Roles('ADMIN')` also admits an `OWNER` caller. A handler with no `@Roles(...)`
  metadata is open to any authenticated user (guard only runs after `JwtAuthGuard`).
- **Decorator**: `@Roles(...roles: Role[])` (`SetMetadata(ROLES_KEY, roles)`), applied per-controller-method
  (method overrides class). Example usage seen in `SkillsOAuthController.authorize` → `@Roles('OWNER','ADMIN')`.
- This is **coarse RBAC** — role-based, not permission/resource-based. There is no separate "permission"
  table; `AiEmployee.permissions` (Json) is a free-form field for employee tool permissions, unrelated to
  user RBAC. **A marketing module gating "who can approve/publish a post" would reuse the same
  `@Roles()`/`RolesGuard` pattern** (e.g. `@Roles('ADMIN')` on a publish-approval endpoint) — there is no
  finer per-resource ACL to build on.
- `modules/users` (`users.service.ts`, `users.controller.ts`) is the CRUD layer for team members
  (`/team` in the frontend) enforcing `UserStatus` (ACTIVE/DISABLED) at login.

## 5. Skills

Real files: `apps/api/src/modules/skills/{catalog.ts,skills.service.ts,executors/*,oauth/*,connectors/*}`.

- **Code-defined catalog** (`catalog.ts`) — the single source of truth for which skills exist and their
  tools/parameter schemas (JSON-schema-like). Current catalog keys: `slack`, `email`, `stripe`, `github`,
  `http`, `gmail`, `hubspot`, `jira`, `calendar`, `gdrive`, `scheduling` (internal, no OAuth/API key).
  Each entry has `connection: { type: 'oauth'|'api_key'|'none' }`, a `configSchema` (data-driven form
  fields, some `secret: true`), and `tools[]` (some flagged `highRisk: true`, e.g. `stripe.create_payment_link`).
- **DB layer** (schema.prisma lines 389–464): `InstalledSkill` (company-wide or **per-employee** via
  nullable `employeeId`, unique on `[companyId, skillKey, employeeId]`) tracks `connectionType`,
  `connectionStatus` (enum `SkillConnectionStatus`: NOT_CONNECTED/CONNECTED/DEGRADED/DISCONNECTED),
  encrypted `credentials` (Json, AES-256-GCM via `CryptoService`), `config` (Json, non-secret settings),
  plus connector-health fields (`lastHealthCheckAt`, `consecutiveErrors`, `tokenExpiresAt`, `inboundCursor`).
  `EmployeeSkill` is the assignment join table (which employee may use which installed skill).
  `SkillExecution` is the append-only audit log of every tool call (args/result/status/error).
- **Executor pattern** — swappable via `SKILL_EXECUTOR` env (`mock` | `real` | `auto`), DI token
  `SKILL_EXECUTOR_TOKEN` (`executors/skill-executor.ts`). Verified REAL implementations
  (`executors/real-skill-executor.ts`) exist for:
  - `slack.send_message` (webhook URL or bot token `chat.postMessage`, with channel-name→ID resolution)
  - `http.request` (real fetch, SSRF-guarded via `executors/ssrf.ts` — blocks private/internal hosts)
  - `gmail.send_email` (Gmail API `users.messages.send`)
  - `calendar.create_event` (Google Calendar API, optional real Google Meet link via `conferenceData`)
  - `gdrive.upload_file` / `create_folder` / `move_file` / `list_files` / `read_file` (Drive API v3)
  - `scheduling.claim_slot` / `reschedule_slot` (internal — no OAuth, delegates to `SchedulingService`)
  Every other tool (`stripe.*`, `github.*`, `hubspot.*`, `jira.*`) **falls through to the mock executor**
  — confirmed by the `default:` case in `RealSkillExecutor.execute()`, which explicitly comments
  "No real implementation for this tool → mock (never 500)." This directly matches the memory note
  (`hr-ai-mnc-scenario.md`) that only ~11 tools have real executors, not the full catalog.
- **OAuth flow** — `modules/skills/oauth/{oauth.controller.ts,oauth.service.ts,oauth.providers.ts}`:
  `GET /skills/installed/:id/oauth/authorize` (JWT+`@Roles('OWNER','ADMIN')`) builds the provider URL with
  a **signed, stateless `state`** (HMAC over `{companyId, connectorId, nonce, issuedAt}`, verified via
  `CryptoService.sign/verify`, ~10-min TTL per the architecture doc). `GET /skills/oauth/callback` is
  **deliberately public** (no `JwtAuthGuard`) since the provider redirects the user's raw browser there;
  tenant identity is recovered entirely from the verified `state`, never trusted from the request.
  PKCE is **not yet implemented** (architecture doc marks it `[TARGET]`).
- **Connector health** (`modules/skills/connectors/*`): `ConnectorHealthService` + `connector-health.processor.ts`
  drive `CONNECTOR_FAILURE_THRESHOLD = 3` consecutive failures → DEGRADED; a repeatable BullMQ sweep
  (`connector-health` queue, every ~10 min) actively probes. Token refresh is single-flight
  (`connector-token.service.ts`) with a `TOKEN_REFRESH_SKEW_MS = 60_000` margin.

## 6. Workflows

Real files: `apps/api/src/modules/workflows/{workflows.service.ts,workflows.constants.ts,engine/*}`.

- **Models** (schema.prisma 472–548): `Workflow` (`definition: Json` graph of `{nodes, edges}`,
  `status` DRAFT/ACTIVE/PAUSED, `triggerType` MANUAL/SCHEDULE/WEBHOOK/EVENT, `triggerConfig: Json`,
  `webhookToken` unique). `WorkflowRun` (`status` PENDING/RUNNING/**WAITING**/COMPLETED/FAILED, `source`,
  `dryRun` boolean — a real test-mode that previews `TOOL_ACTION` without side effects, `triggerEventId`/
  `correlationId` for event lineage, `resumeNodeId` for paused-at-approval resumption). `WorkflowStepRun`
  (per-node audit: `nodeId`, `type`, `status`, `input`/`output` Json, timestamps).
- **Node types** (confirmed live in `engine/workflow-engine.service.ts` `executeNode()` switch):
  `TRIGGER`, `RETRIEVE` (Knowledge search → `context[outputKey]`), `AI_STEP` (LLM completion, optionally
  as a named `AiEmployee`'s persona, budget-checked the same way as chat), `TOOL_ACTION` (runs a Skill tool
  via `SkillsService.runTool`, quarantines if the resolved connector is DEGRADED/DISCONNECTED, honors
  `dryRun`), `WAIT` (bounded sleep, `MAX_WAIT_MS = 10_000` — **not a durable/resumable delay**, an
  in-process `setTimeout`), `CONDITION` (manual `eq/neq/contains/gt/lt` comparator, no `eval`, branches via
  edge `.branch` tag), `NOTIFY` (logs a templated message — **does not actually send anything**, it's a
  log-only stub today despite the name), `APPROVAL` (pauses the run to `WAITING`, creates a `WORKFLOW`-kind
  `ApprovalRequest`, unless `config.autoApprove: true`).
- **`{{a.b.c}}` template resolver** (`engine/template.ts`) — explicitly no `eval`.
- **`WorkflowEngine`** runs on the BullMQ **`workflow-run`** queue (`workflows.constants.ts`:
  `WORKFLOW_RUN_QUEUE = 'workflow-run'`), processed by `engine/workflow.processor.ts`. Job payload shapes:
  `{runId}` (execute a created run), `{runId, resume:true}` (resume WAITING), `{workflowId, source}`
  (SCHEDULE-triggered), `{watchdog:true}` (repeatable stuck-run sweep, every 5 min,
  `WORKFLOW_RUN_STUCK_TIMEOUT_MS = 10 min`, fails orphaned PENDING/RUNNING runs — does NOT retry, per the
  memory note that side effects aren't safe to replay). `MAX_WORKFLOW_NODES = 50` bounds cyclic graphs.
- **AI-assisted drafting**: `POST /workflows/generate` (`engine/workflow-generator.service.ts`,
  Business/Enterprise-gated) grounds a chat prompt in the company's real installed skills + hired
  employees and returns a draft definition — never persists directly.
- Bottom line: **the workflow engine already has the right node vocabulary to model "gather content →
  draft post → get approval → publish"** as `AI_STEP → APPROVAL → TOOL_ACTION`, but `NOTIFY` would need to
  become a real notification (or reuse Slack/email tools) and `WAIT` cannot durably hold a post until a
  scheduled publish time beyond 10 seconds — see §Marketing design questions below for what that implies.

## 7. Memory

Real files: `apps/api/src/modules/employees/runtime/memory.service.ts`, `employees.constants.ts`, schema.prisma 329–368.

- **`Conversation`** (per employee) → **`Message`** (`role` USER/ASSISTANT/SYSTEM, `content`, `metadata: Json`).
- **`EmployeeMemory`** (`kind`: FACT | SUMMARY, `source`: FEEDBACK/MANUAL/RUN nullable) is the durable
  long-term store.
- **Confirmed: recall is recency-only, no vectors.** `MemoryService.load()` does two plain Prisma queries:
  recent `Message`s (`orderBy createdAt desc, take RECENT_MESSAGE_LIMIT=10`) and recent `EmployeeMemory`
  rows (`orderBy createdAt desc, take RECENT_MEMORY_LIMIT=5`, **no `kind` filter** — both SUMMARY and FACT
  memories compete for the same 5 slots). The code comment on `RECENT_MEMORY_LIMIT` (constants file) and
  `CLAUDE.md`'s "FACTs can be crowded past RECENT_MEMORY_LIMIT" both match what the code actually does —
  **no discrepancy found here**; semantic/embedding-based recall is genuinely not implemented (`[TARGET]`
  in the architecture doc, consistent with code).
- Retrieval (RAG) is a **separate system** — `KnowledgeDocument`/`KnowledgeChunk` with real pgvector
  (384-dim, HNSW) — reused by `RetrievalService`, not part of `EmployeeMemory`.

## 8. MCP integrations

**Searched explicitly for Model Context Protocol support across the whole repo** (`apps/api/src`,
`apps/web/src`, `packages/`, docs) for `MCP`, `ModelContextProtocol`, `@modelcontextprotocol`, case-insensitive.
**Result: no MCP support exists anywhere in this codebase.** The only "mcp" string hit in the entire repo
is an unrelated base64 hash substring inside `pnpm-lock.yaml` (a package integrity checksum), not a
real dependency or code reference. Tool-calling in this platform is entirely bespoke: the LLM provider's
own function/tool-calling interface (`LlmProvider.complete(..., tools)`) feeds a JSON-schema tool list
built from the Skills catalog (`ToolExecutorService.listTools`) — there is no MCP client, server, or
resource/tool discovery protocol anywhere. **If MCP-based tool exposure is wanted for the marketing
employee (e.g. wrapping a Postiz MCP server), it would be new infrastructure, not an extension of
something that exists.**

## 9. Connectors

Real files: `apps/api/src/modules/skills/connectors/*`, `apps/api/src/modules/events/*`,
`docs/architecture/connector-event-workflow-architecture.md` (verified against code, not just trusted).

- **The Connector concept is "fused" into `InstalledSkill`** exactly as the architecture doc's §1.2
  states, and this was independently confirmed by reading `catalog.ts`/`skills.service.ts`/schema.prisma:
  there is no separate `Connector` table. `InstalledSkill` plays both roles (connection/auth state +
  which tools it backs).
- **Health/lifecycle**: `SkillConnectionStatus` enum (NOT_CONNECTED/CONNECTED/DEGRADED/DISCONNECTED) is
  real and implemented (not just documented) — `ConnectorHealthService` + `connector-health.processor.ts`
  drive transitions on a BullMQ repeatable (`connector-health` queue, ~10 min, up to
  `CONNECTOR_HEALTH_BATCH=100` per sweep). `connector-health.service.ts`/`health-probe.ts` implement the
  active-probe pattern described in the architecture doc.
- **OAuth authorize/callback** — real, signed-state flow, described in §5 above; confirmed live in
  `oauth.controller.ts`/`oauth.service.ts`/`oauth.providers.ts`.
- **Token encryption** — real, `CryptoService` (`common/crypto/crypto.service.ts`), AES-256-GCM,
  versioned envelope `v1:iv:tag:ciphertext`, key from `ENCRYPTION_KEY` (64 hex or base64-32; **refuses to
  boot in production without one**, derives an insecure dev key with a loud warning otherwise). Also used
  for the HMAC-signed OAuth `state` (`sign`/`verify`, constant-time compare).
- **Event ingestion pipeline** (Unit A per the architecture doc, and genuinely implemented, not just
  planned): `modules/events/*` — signed `POST /connectors/:id/webhook` (`connector-webhook.controller.ts`)
  → `RawEvent` (append-only) → BullMQ `event-normalize` queue (`event-normalize.processor.ts`) →
  provider mapper (`normalization/event-mapper.ts`) → `CanonicalEvent` (idempotent on
  `[companyId, dedupeKey]`) → `WorkflowsService.fireEvent()`. A real **Gmail inbound poller**
  (`inbound/gmail-inbound.processor.ts` + `.service.ts`) exists on its own `gmail-inbound` queue (~60s)
  — this is further along than the architecture doc's own "not yet built" appendix claims for per-provider
  drivers; **treat the doc's "Appendix — current-state summary" as slightly stale** (it predates the Gmail
  inbound poller and reconciliation processor, both of which are real files with real BullMQ registration).
  There's also a `reconciliation/connector-reconcile.processor.ts` (hourly sweep, `connector-reconcile` queue).

## 10. Queues / Jobs

All confirmed live via grep across `apps/api/src` for BullMQ `Queue(`/`@nestjs/bull` usage. Real queue
names (constants, not guesses):

| Queue name | Constant / file | Purpose |
|---|---|---|
| `knowledge-ingest` | `modules/knowledge/knowledge.constants.ts` | Document upload → extract/chunk/embed |
| `workflow-run` | `modules/workflows/workflows.constants.ts` | Execute/resume/schedule-trigger workflow runs + watchdog sweep |
| `event-normalize` | `modules/events/events.constants.ts` | Raw provider event → canonical event |
| `connector-health` | `modules/skills/connectors/connector.constants.ts` | Scheduled active health probes (~10 min) |
| `connector-reconcile` | `modules/events/events.constants.ts` | Hourly catch-up reconciliation sweep |
| `gmail-inbound` | `modules/events/events.constants.ts` | Real Gmail inbound poll (~60s) |

Cross-cutting resilience lives in `common/resilience/*`: `redis-connection.ts`/`redis.provider.ts`
(shared Redis connection), `circuit-breaker.ts`/`circuit-breaker.registry.ts` (per-connector breaker),
`rate-limiter.ts` (per-connector), `error-classifier.ts` (retryable vs terminal), `queue-retry.ts`
(`RESILIENT_JOB_OPTIONS`), `dlq.service.ts`/`dlq.constants.ts` (dead-letter queue + `/admin/dlq`),
`tenant-throttler.guard.ts` (per-tenant HTTP rate limiting). **A new marketing publish queue should
follow this exact pattern**: its own named queue + constants file + `RESILIENT_JOB_OPTIONS` + DLQ wiring,
not ad-hoc `setTimeout`/cron.

## 11. Database — models relevant to a marketing/social module

Full schema at `apps/api/prisma/schema.prisma` (749 lines). Models a new marketing module would touch or
sit beside:

- **`Company`** — the tenant every new table must carry `companyId` for.
- **`AiEmployee`** — the "AI Marketing Manager" is a row here (`role: 'CUSTOM'`, or add a `MARKETING`
  enum value). Its `permissions`/`approvalRules`/`knowledgeAccess`/`budgetLimit` all already generalize
  to marketing use unmodified.
- **`InstalledSkill`** / **`EmployeeSkill`** / **`SkillExecution`** — the existing connector+capability+audit
  triad. A "connect a social account via OAuth" flow is naturally an `InstalledSkill` row per platform
  (e.g. `skillKey: 'linkedin'`, `'twitter'`, `'instagram'`) with `connectionType: 'oauth'`, reusing
  `CryptoService`-encrypted `credentials` and the existing OAuth authorize/callback controller pattern.
- **`Workflow`** / **`WorkflowRun`** / **`WorkflowStepRun`** — could express "draft → approve → publish"
  as a graph, but see §Marketing design questions — scheduling a publish for a future wall-clock time
  needs new machinery (BullMQ delayed jobs), not the current `WAIT` node (capped at 10s).
- **`ApprovalRequest`** — already generalizes to gating a workflow node (`kind: WORKFLOW`) or a tool call
  (`kind: TOOL`); seehe §13 answer below for exactly how "approve a marketing post" would map.
- **`KnowledgeDocument`/`KnowledgeChunk`** — the natural home for **brand-guideline RAG** (tone-of-voice
  docs, brand assets metadata could reuse the role-scoping mechanism, `category: EmployeeRole` — though
  a media library needs its own table, RAG isn't a file store).
- **No existing model for**: social accounts/tokens as first-class objects (would be layered on
  `InstalledSkill` or a new dedicated table — see design questions), campaigns, scheduled/published posts,
  media library, analytics snapshots, or brand assets. **All of these are new tables.**
- Storage: `KnowledgeDocument.storageKey` shows the existing pattern for large-object storage — files go
  to `STORAGE_PROVIDER` (`local` dir or S3/MinIO), DB holds only the key/metadata. A media library would
  follow the same pattern.

## 12. APIs — `apps/api/src/modules/*`

Confirmed module directories and what each exposes (controllers found in each):

| Module | Exposes |
|---|---|
| `auth` | register/login/refresh/me, JWT issuance, guards |
| `users` | Team CRUD, RBAC (`/team`) |
| `tenant` | (tenant-scoping helpers/guards, no dedicated controller found separate from auth) |
| `organization` | Departments, Teams, SecurityPolicy (`/organization`) |
| `employees` | AI Employee CRUD, chat (`Conversation`/`Message`), learning/feedback (`/employees`, `/employees/:id/learning`) |
| `knowledge` | Document upload/list/search, role-scoped RAG (`/knowledge`) |
| `skills` | Catalog, install/configure/connect, OAuth authorize+callback, per-employee assignment, connector health (`/skills`, `/connectors`) |
| `workflows` | Workflow CRUD, run/resume/cancel, triggers (manual/schedule/webhook/event), AI generation, public webhook route (`/workflows`) |
| `events` | Canonical event querying/lineage, connector webhook ingestion, inbound Gmail poll admin (`/events`, `/connectors/:id/webhook`, `/connectors/:id/events`) |
| `approvals` | Approval queue, approve/reject/modify (`/approvals`) |
| `analytics` | KPI dashboards, attainment vs targets (`/analytics`) |
| `billing` | Subscription/plan, usage-based billing provider (`/billing`) |
| `usage` | LLM usage/cost tracking (`UsageEvent`) |
| `marketplace` | Install AI-employee/workflow templates (`/marketplace`) |
| `onboarding` | Onboarding wizard status/catalog/complete |
| `scheduling` | Bulk-hiring interview slot pool + real Calendar integration |
| `admin` | DLQ view, platform health (`/admin/dlq`, `/admin/health`) |
| `audit` | `AuditLog` read (who-did-what trail) |

A new marketing module would be `modules/marketing` (backend) mirroring this same shape: its own
controller(s), service(s), DTOs, and a Prisma schema addition — consistent with the "Module status" list
in `CLAUDE.md` (one module per turn: backend + mirrored frontend feature).

## 13. Frontend architecture

Real root: `apps/web/src/{app,features,components,lib,stores}`.

- **Routing**: Next.js App Router with route groups `(app)` (authenticated shell) and `(auth)` (login/
  register/2FA/etc). Each top-level feature has both a route folder under `app/(app)/<feature>/page.tsx`
  (+ `[id]/page.tsx` for detail views, e.g. `workflows/[id]/page.tsx`) **and** a mirrored
  `features/<feature>/` folder holding the actual logic: confirmed pattern for `workflows`:
  `features/workflows/{api.ts, hooks.ts, schemas.ts, labels.ts, components/*.tsx}`. The page component is
  a thin shell; `api.ts` wraps `apiClient` calls, `hooks.ts` wraps TanStack Query
  (`useQuery`/`useMutation` with `onMutate`/`onError` rollback/`onSettled` invalidate, per `CLAUDE.md`
  conventions), `schemas.ts` holds zod validation for react-hook-form.
- **Single axios instance** `lib/apiClient.ts` — attaches JWT, handles 401 → single in-flight refresh →
  replay (shown in full in §1 above). **Single** `queryClient` (`lib/queryClient.ts`) and **Zustand**
  session store (`stores/session.store.ts`) — CLAUDE.md's "singletons both sides" convention confirmed.
- **`components/`** holds cross-feature UI: `app-shell` (nav/layout), `ui` (design system primitives),
  `svg`, `system`, `marketing-dark` (the public marketing site components, separate from the authenticated
  app), `onboarding`, `auth`.
- A new marketing employee feature would add `app/(app)/marketing/page.tsx` (+ sub-routes for
  campaigns/calendar/composer) and `features/marketing/{api.ts,hooks.ts,schemas.ts,components/*}`,
  exactly mirroring the `modules/marketing` backend module — this is a well-established, repeatable
  pattern in this codebase, not a new convention to invent.

---

## Marketing-module design questions (explicit answers)

### Where would social_accounts/tokens/campaigns/scheduled_posts/published_posts/media_library/approval_requests/analytics/brand_assets plug in?

All under `Company` (the tenant), following the exact conventions already used everywhere else:

- **`social_accounts`** (the connected LinkedIn/X/Instagram/etc account + OAuth tokens): two viable shapes —
  (a) reuse `InstalledSkill` per platform (`skillKey: 'linkedin'` etc, `employeeId` nullable exactly like
  today's per-employee-or-company-wide connections), storing tokens in the existing encrypted
  `credentials` Json via `CryptoService`; or (b) a new dedicated `SocialAccount` table (companyId,
  provider, externalAccountId, displayName, encrypted tokens, status) if social accounts need richer
  fields than `InstalledSkill.config`/`credentials` comfortably hold (e.g. multiple accounts of the same
  provider per employee, which today's `@@unique([companyId, skillKey, employeeId])` constraint does
  NOT support — you can only have one `linkedin` InstalledSkill per employee/company today). **Recommend
  (b)**: a first-class `SocialAccount` table that *is* a Connector in spirit but supports N accounts per
  provider — this is a genuinely new shape the current unique-key design doesn't allow.
- **`campaigns` / `scheduled_posts` / `published_posts`**: new tables, companyId-scoped, FK to the owning
  `AiEmployee` and to `SocialAccount`. `scheduled_posts` needs a real "publish at time T" mechanism —
  **new** BullMQ delayed jobs (`queue.add(name, data, { delay })`) on a new `social-publish` queue,
  following the `RESILIENT_JOB_OPTIONS`/DLQ pattern from `common/resilience`. This does **not** exist
  today; the closest today is `WAIT` (capped at 10 seconds, in-process sleep) and BullMQ *repeatable*
  jobs (fixed interval, not "at this exact future timestamp") — neither is a fit for "publish this post
  next Tuesday at 9am."
  `published_posts` mirrors `SkillExecution`'s audit-log role but needs richer per-platform fields
  (post id, permalink, per-platform status) than the generic `{args, result}` shape SkillExecution has.
- **`media_library`**: new table + object storage, following `KnowledgeDocument.storageKey` +
  `STORAGE_PROVIDER` pattern exactly (local dir or S3/MinIO already wired).
- **`approval_requests`**: **reuse the existing `ApprovalRequest` model** — see dedicated answer below.
- **`analytics`**: new tables/aggregation, following the existing `modules/analytics` pattern (it already
  does KPI aggregation with no dedicated schema beyond querying existing tables — a marketing analytics
  slice would likely need its own snapshot table since platform APIs need periodic polling, not live query).
- **`brand_assets`**: could live in `KnowledgeDocument` with a new `category`-like tag, or (cleaner) a
  dedicated table if brand assets need structured fields (logo variants, color palette, fonts) beyond a
  blob + text chunks.

### Does Skill/Connector/Workflow already have the right shape for "connect a social account via OAuth" and "schedule then publish a post"?

**OAuth connect: mostly yes, with one real gap.** The OAuth authorize/callback controller pattern
(signed HMAC state, encrypted token storage, `connectionStatus` state machine) is a proven, working
primitive — wrapping a new provider (or a Postiz-style aggregator that itself exposes one OAuth callback
per platform) is additive work following an established template, not new architecture. The one real gap:
today's `InstalledSkill` unique constraint (`companyId, skillKey, employeeId`) assumes **one connection
per provider per employee/company** — it cannot represent "3 different Instagram accounts for 3 different
brands under one company," which is a very plausible marketing requirement. That needs either a schema
change (drop/relax the unique constraint, add an account-slot dimension) or the new dedicated
`SocialAccount` table recommended above.

**Schedule-then-publish: no, this needs a new primitive.** `TOOL_ACTION` can call a "publish now" tool
fine (that's exactly what it's for), and `APPROVAL` can gate it. But nothing in the current Workflow
engine can hold a run open until an arbitrary future timestamp — `WAIT` sleeps in-process for at most 10
seconds (`MAX_WAIT_MS`), and BullMQ usage today is either immediate execution or fixed-interval
repeatables (`SCHEDULE` trigger type), never a one-shot delayed job for a specific future instant. The
clean fix is a **new BullMQ delayed-job queue** (`social-publish`, `queue.add(jobId, data, { delay: msUntilPublish })`)
that a `scheduled_posts` row enqueues into directly — probably simpler than trying to force the durable
wait into the generic workflow graph, though a `TOOL_ACTION` step could still be what actually calls the
publish executor when that delayed job fires.

### Does ApprovalRequest already generalize to "approve a marketing post before it publishes"?

**Yes, cleanly, via the existing `WORKFLOW`-kind path — this is the best-fitting existing primitive found
in the whole codebase.** `ApprovalRequest.kind` is already an enum with exactly two members: `TOOL` (gates
a single tool call — approve executes it via `SkillsService.runTool`) and `WORKFLOW` (gates a paused
workflow run at an `APPROVAL` node — approve calls `WorkflowsService.resumeRun`, reject calls
`cancelRun`). Both paths are real, tested code in `ApprovalService` (`approve`/`reject`/`modify`), not
just documented — confirmed by reading `approval.service.ts` in full. For "approve a marketing post":
model it as a `Workflow` with `AI_STEP` (draft copy) → `APPROVAL` (manager reviews the drafted post) →
`TOOL_ACTION` (publish). The paused run's `context` already carries whatever the AI_STEP produced
(the draft text/image refs), so the approver's UI can show exactly what will be published — the
`ApprovalRequest.description` field (a resolved-template message) is the natural place to render a post
preview. **No new ApprovalRequest kind is needed**; at most, the `args`/`result` Json fields could carry
a small marketing-specific shape (e.g. `{platform, previewText, mediaRefs}`) that the frontend renders
specially. It is **not tied to tool-calls only** — the workflow-level generalization already exists and
is exactly the shape a "approve before publish" gate needs.

---

## Summary of doc-vs-code discrepancies found

1. **Architecture doc's own appendix undersells shipped ingestion work.** The "Appendix — current-state
   summary" in `connector-event-workflow-architecture.md` lists per-provider ingestion drivers as "not yet
   built," but a real Gmail inbound poller (`inbound/gmail-inbound.processor.ts`/`.service.ts`) and a
   connector reconciliation sweep (`reconciliation/connector-reconcile.processor.ts`) are both live,
   registered BullMQ processors with dedicated queues. Treat that appendix as slightly stale, not current.
2. **`NOTIFY` node is log-only.** Nothing in `CLAUDE.md` or the architecture doc calls this out plainly:
   `execNotify` in `workflow-engine.service.ts` only writes a logger line and a step output — it does not
   send a Slack message, email, or any real notification despite the node's name and the architecture
   doc's "NOTIFY (Slack/Teams/email/in-app)" framing in its enterprise diagram (§8, which is explicitly
   `[TARGET]` there, but easy to misread as already wired).
3. **`WAIT` is a 10-second in-process sleep**, not a durable timer — confirmed by `MAX_WAIT_MS = 10_000`
   and a plain `setTimeout`-based `sleep()`. Both `CLAUDE.md` and the architecture doc already flag this
   as a TODO, so this is confirmation rather than a new discrepancy — but it is the single most important
   fact for the marketing module, since "schedule a post for next week" is exactly the durable-wait use
   case that doesn't exist yet.
4. **No MCP support anywhere** — not documented as absent anywhere else in the repo, but worth stating
   explicitly since the task depends on knowing whether to build on it or add it fresh: confirmed absent.
