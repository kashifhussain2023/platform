# Orlixa / V-AEP Platform — Enterprise-Readiness Audit
**Date:** 2026-07-12 · **Prepared for:** Vishal Sharma · **Method:** 8 independent read-only code audits (multi-tenancy, security, scalability, operations, testing, compliance, frontend, workflow-engine), each verifying claims directly against source — not just against `platform/CLAUDE.md`'s self-reported status.

---

## 1. Verdict

**Not production/enterprise-ready as-is.** Core product logic — multi-tenancy, the workflow engine, approval flows, RBAC — is genuinely well-built, better than most Series-A SaaS codebases. But the platform is missing the entire *operational skeleton* (CI/CD, backups, monitoring, rate limiting) that "enterprise-ready" requires, and there's a real gap between what's **sold** (Enterprise plan: SSO, Audit Logs) and what **exists** (neither is built). That second category is a contract/legal risk, not technical debt.

---

## 2. Priority-ranked findings

### P0 — Critical (fix before any real customer traffic)

| # | Area | Finding | Evidence | Fix |
|---|------|---------|----------|-----|
| 1 | Security | Live API keys sit in plaintext `apps/api/.env` — real OpenAI key, Google OAuth client secret, Slack client secret. | `apps/api/.env:17,21-24` | Rotate all three now, regardless of everything else below. |
| 2 | Security | `ENCRYPTION_KEY` in that same file is a low-entropy placeholder (`0123456789abcdef` ×4) that *passes* the 64-hex format check; if the var is unset entirely, `CryptoService` silently derives a key from a **hardcoded public seed** (`DEV_KEY_SEED`) instead of failing, in any environment. | `crypto.service.ts:20,113-135` | Throw at boot when `NODE_ENV==='production'` and the key is unset; reject low-entropy/repeated-byte keys. |
| 3 | Security | No rate limiting anywhere — `/auth/login`/`/auth/register` open to brute-force, credential-stuffing, signup-spam. The only limiter in the repo guards outbound connector egress, not inbound auth. | no `@nestjs/throttler` in `apps/api/package.json`; no `APP_GUARD` in `app.module.ts` | Add `@nestjs/throttler` globally + per-email/IP lockout on repeated failed logins. |
| 4 | Security | Knowledge-document upload has no file-size limit; fully memory-buffered. Combined with #3, any authenticated member of any tenant can OOM the single API process, taking down every tenant. | `knowledge.controller.ts:30-31`, `FileInterceptor('file')` with no `limits` | Add `limits: { fileSize }`, reject oversize with 413. |
| 5 | Compliance | Marketing/billing catalog sells **"SSO"** and **"Audit Logs"** as billed `ENTERPRISE`-tier line items. Neither exists in code — no SAML/OIDC anywhere, no `AuditLog` model in `schema.prisma`. | `billing.plans.ts:54,58`; confirmed absent across `apps/api/src` | Strip from the plan catalog until built, or build before selling the tier. If any live customer is on this plan, this is a contractual gap today. |
| 6 | Compliance | Marketing "Security" section claims **"SOC 2 Compliant"** and **"GDPR Ready"** with zero backing: no DPA template, no data-export/erasure endpoint, no documented retention policy, no privacy-policy page. Signup's "Terms of Service"/"Privacy Policy" consent text isn't even a link (`<span>`, no `href`); footer links point to `href:'#'`. | `SecuritySection.tsx:4`; `RegisterForm.tsx:115-125`; `SiteFooter.tsx:26-33` | Remove both badges until a real audit/DPA program + real legal pages exist. |
| 7 | Ops | No CI/CD pipeline anywhere (`.github/workflows`, `.gitlab-ci.yml`, etc. all absent) and **no git remote configured at all** — the 151 e2e + 34 unit tests are 100% run-on-demand locally. Nothing blocks a broken build from being deployed, and there's no off-machine copy of the repo. | repo-wide search, confirmed empty `git remote -v` | Stand up a minimal pipeline (typecheck → lint → unit → e2e → build) once a remote exists; add husky pre-commit as an interim local gate; push a remote today regardless. |
| 8 | Ops | No backup automation for Postgres or MinIO/S3 — only artifact is one manual one-off dump (`backups/vaep_backup_before_testdata_purge_2026-07-11.dump`), not scheduled, not scripted, no restore runbook. | repo-wide search for backup/pg_dump/pitr | Scheduled `pg_dump`/WAL archiving (or managed Postgres with PITR) + MinIO/S3 versioning + a tested restore runbook. |
| 9 | Ops | Zero APM/error-tracking instrumentation (no Sentry/Datadog/OTel/anything). The **only** operational visibility in the entire platform is the tenant-scoped DLQ + circuit-breaker admin panel. | no APM SDK in either `package.json` | Minimum viable: Sentry for exceptions now; OTel SDK+collector as the documented longer-term target. |
| 10 | Scalability | Every BullMQ processor runs at the library default concurrency of **1** — workflow runs, event-normalize, ingestion, Gmail-inbound, connector-reconcile/health all process one job at a time, platform-wide. Directly contradicts "ready for hundreds of tenants." | `workflow.processor.ts:29`, `event-normalize.processor.ts:34`, `ingestion.processor.ts:30`, `gmail-inbound.processor.ts:20`, `connector-reconcile.processor.ts:19`, `connector-health.processor.ts:21` — all bare `@Processor(QUEUE)` | `@Processor(QUEUE, { concurrency: N })`, tuned per queue (workflow-run/event-normalize likely 10-20). |
| 11 | Scalability | No pagination anywhere: employees/conversations/messages, workflows/runs, knowledge docs are plain `findMany` with no `take`/cursor and no page-size query param. A heavy tenant gets the whole table in one response. | `employees.service.ts:95-101,180-185,194-199`; `workflows.service.ts:80-86,293-300`; `knowledge.service.ts:78-84` | Cursor pagination (id+createdAt), server-enforced max page size (~50-100) on all six. |
| 12 | Scalability | The stuck-run watchdog fails any run in **PENDING or RUNNING** >10 min (`WORKFLOW_RUN_STUCK_TIMEOUT_MS`). Combined with #10, a run that's merely queued behind backlog — not actually orphaned — gets wrongly killed and its work silently dropped. | `workflow-engine.service.ts:253-278`; `workflows.constants.ts:33` | Only sweep RUNNING with a stale heartbeat; monitor PENDING backlog depth separately. |
| 13 | Frontend | No React error boundary anywhere (`error.tsx`/`global-error.tsx` absent under `apps/web/src/app`). Any render-time exception unmounts the whole client tree — true white screen, no recovery. | glob confirmed absent | Add root `app/global-error.tsx` + per-segment `error.tsx` under `(app)/`. |
| 14 | Frontend | Forgot-password/Reset-password pages have zero backend wiring — `onSubmit={(e)=>e.preventDefault()}`, no mutation, confirm-password field fully uncontrolled. (Built this way deliberately as a UI-only shell during the auth-screens redesign — flagging again because it's a real flow users will hit in production.) | `(auth)/forgot-password/page.tsx:14`, `(auth)/reset-password/page.tsx:20`; `features/auth/hooks.ts` has no `useForgotPassword`/`useResetPassword` | Wire both to real endpoints before launch. |
| 15 | Workflow engine | Tool arguments are never validated against their declared schema before dispatch — including the Manager "Modify" approval path. A typo'd field, wrong type, or malicious extra field passes straight to the executor. | `approval.service.ts:154-174` → `skills.service.ts:322-400` only checks the tool *exists*, never validates `args` | Validate `args` against `ToolDefinition.parameters` before every dispatch (both LLM- and human-initiated). |

### P1 — High

- **Auth/session**: Refresh tokens have no rotation/reuse detection — stateless JWT, no persisted `jti`/family; a stolen refresh token stays valid up to 7 days undetectably (`auth.service.ts:99-117`, `jwt-auth.provider.ts:39-43`).
- **Headers**: No `helmet`/security-headers middleware in `main.ts` — missing HSTS/X-Content-Type-Options/X-Frame-Options/CSP.
- **Webhooks**: Replay protection is dedupe-only for connectors without a delivery-id header — no signed-timestamp window (`signature-verifier.ts`, `events.service.ts:97-108`).
- **DB indexes**: `Message`, `EmployeeMemory`, `WorkflowStepRun`, `SkillExecution`, `RawEvent` each have only a single-column `companyId` index — no composite `companyId+createdAt`, no index on FK columns (`conversationId`/`employeeId`/`runId`); Postgres doesn't auto-index FKs.
- **Connection pooling**: `PrismaService` passes zero pool options; no `connection_limit` on `DATABASE_URL`, no PgBouncer. Horizontally scaling API instances will exhaust Postgres `max_connections`.
- **Chat path fairness**: `POST /conversations/:id/messages` runs the agent runtime synchronously in-request, up to 3 sequential LLM calls, no timeout/AbortSignal, and the Redis rate-limiter isn't wired into this path — one tenant's chat burst can starve everyone else.
- **Health checks**: No `/health`/`/healthz` liveness/readiness endpoint (`@nestjs/terminus` absent) — no orchestrator can distinguish "process up" from "can actually serve traffic."
- **Logging**: No structured/JSON logging (plain Nest `Logger`/`console.log` only); a per-workflow-run `correlationId` exists but doesn't span the whole HTTP-request lifecycle or other queues.
- **Deployment**: No production compose/k8s/helm manifest — Dockerfiles are solid multi-stage builds but nothing wires them to a real environment; both Dockerfiles also run as root with no `HEALTHCHECK`, and `main.ts` never calls `enableShutdownHooks()` so SIGTERM doesn't drain in-flight BullMQ jobs (same class of bug as the previously-fixed stuck-chat-run issue).
- **Tool least-privilege**: `SkillsService.runTool()` only checks global catalog existence, never that `skillKey` belongs to *this employee's* assigned+enabled skills — least-privilege is enforced only by trusting the LLM provider to honor the schema it was given.
- **Idempotency**: Workflow re-runs after a crash/watchdog-fail aren't deduped per `(runId, nodeId)` — a manual retry re-executes every already-completed `TOOL_ACTION` (duplicate email/calendar invite, eventually duplicate Stripe charge).
- **Notifications**: Inviting a teammate creates a user row directly (admin sets the password) — no mail library exists anywhere in the backend, so invited users have no way to learn credentials.
- **Test gaps on critical paths**: Stripe webhook signature verification has no dedicated test; `POST /auth/refresh` has **zero** test coverage (not even happy-path) and no reuse-detection test exists anywhere.
- **Frontend query states**: `SkillCatalog`, `DocumentList`, `WorkflowList`, `ApprovalList`, `EmployeeList` all destructure only `{data, isLoading}` — never `isError` — so a failed fetch renders identically to a genuinely empty tenant (contrast: `DlqPanel.tsx` handles all three states correctly).
- **Frontend test coverage**: Exactly one test file exists in `apps/web/src` total (a hook test, not a component test); no Playwright/Cypress config anywhere — the recent large dark-theme UI overhaul shipped on manual/visual verification only.
- **Approvals staleness**: `useApprovals` has no `refetchInterval` — the human-in-the-loop safety gate can sit on a stale "Pending" list indefinitely (contrast: workflows/knowledge/events/admin all poll).

### P2 — Medium

- No automated data-retention enforcement (`SecurityPolicy.dataRetentionDays` field exists, UI labels it "stored only," nothing ever prunes `Message`/`SkillExecution`/`RawEvent`/`CanonicalEvent`).
- No MFA backend — `two-factor`/`verify-otp` auth pages are visual mockups with `e.preventDefault()`, no OTP route exists.
- No session management — no revocation list, no concurrent-session cap, no force-logout-all-devices; `sessionTimeoutMinutes` is stored-only.
- Single global `ENCRYPTION_KEY` (not per-tenant) — one key compromise decrypts every tenant's stored credentials platform-wide; acceptable for current scale, a real ceiling for enterprise/compliance buyers later.
- Argon2 hashing uses unpinned library defaults (works today, will silently drift on a dependency bump).
- pgvector HNSW index created with library defaults, no `ef_search` tuning, no re-index/VACUUM job — fine under ~1M chunks.
- WAIT workflow node is a bounded (10s) in-process sleep, not durably resumable — documented TODO; fails safe via an idempotency guard (no-ops rather than replaying) but the run then sits orphaned until the watchdog kills it.
- Onboarding completion (`OnboardingService.complete()`) isn't wrapped in a transaction and isn't retry-safe — a retry after a partial crash can re-create already-hired employees (contrast: `EmployeesService.create()` correctly uses `$transaction` + advisory lock).
- `EmployeeMemory` recall pulls the 5 most-recent rows with no `kind` weighting — a manager-taught FACT can be crowded out by routine per-turn SUMMARY rows the same day, not just "weeks" as previously documented.
- Migration safety (the pgvector/HNSW `migrate dev` vs `migrate deploy` gotcha) is pure tribal knowledge — no CI lint step checks generated SQL for a destructive index drop.
- Theme seam: `globals.css` still defines the old light-theme body default (`bg-paper`/`color-scheme: light`), and `(app)/layout.tsx`'s loading fallback sets no explicit dark background (unlike the equivalent `(auth)` fallback) — a light flash is plausible on session rehydration.
- WCAG contrast failures: `text-zinc-600`/`zinc-700` used for real body/label text in ~20 places, computing to ~2.0-2.7:1 against the `#02030a` background (fails AA's 4.5:1).
- No SEO basics on public marketing pages — no `robots.txt`/`sitemap.xml`, no Open Graph/Twitter-card metadata.
- Hand-rolled tab UIs (workflow status filter, approvals Pending/Approved/Rejected) have no `role="tablist"/"tab"`/`aria-selected` — mouse/basic-keyboard works, screen readers get no tab semantics.
- Login resolves by email globally, not per-company (`auth.service.ts:79-81`), despite `User` modeling `@@unique([companyId, email])` — if two companies register the same email, one of them may never be able to log in via the naive first-match lookup.
- Tenant/auth guard is applied per-controller (100% consistent today, verified), not registered as a global `APP_GUARD` — structurally fragile against a future controller that simply forgets the decorator.
- No runtime validation of API responses against the shared `@vaep/types` zod schemas on the frontend — contract safety is compile-time-only (`apiClient` trusts a TS cast).

### P3 — Low / informational

No dependency-vulnerability scan wired into anything (`pnpm audit` never run in CI) · password policy is length-only (8 chars) · `ValidationPipe({forbidNonWhitelisted:false})` silently strips rather than rejects extra fields · unbounded JSON blob fields (`args`/`config`) with no size/depth cap · template resolver silently stringifies nested objects (`"[object Object]"`) instead of erroring — silent data corruption, not a crash · no timeout on the LLM SDK call itself · three slightly different near-black color tokens from independent design sessions (cosmetic) · `next/image` unused anywhere · no load-testing tooling (k6/artillery) · single-region/single-instance Postgres/Redis/MinIO with no replicas — reasonably deferred given current stage, noted for completeness only.

---

## 3. What's already genuinely solid (do not "fix" these)

- **Multi-tenancy came back clean** — no Critical/High findings. `companyId` is extracted once, server-side, from the verified JWT (`CurrentTenant`/`CurrentUser` decorators, never from body/query) and manually threaded through every service; every module implements the identical `findOwned(companyId, id)` ownership-check helper before any mutation. Full IDOR sweep across every `.update`/`.delete` call site found no gaps.
- **All four unauthenticated webhook/callback routes verify cryptographically before trusting anything**: Stripe via `stripe.webhooks.constructEvent`, connector webhooks via per-connector HMAC-SHA256 + `timingSafeEqual`, workflow webhooks via a 192-bit random token, OAuth callback via an HMAC-signed 10-minute-TTL state param.
- **RBAC is genuinely server-enforced**, not UI-hidden — `RolesGuard` reads role from the verified JWT and throws 403 server-side; clean OWNER > ADMIN > MEMBER hierarchy applied to essentially every mutating controller.
- **Credentials-at-rest encryption is correctly implemented** — AES-256-GCM, fresh random 12-byte IV per encryption (never reused), authenticated + versioned envelope, `timingSafeEqual` for comparisons. Only the key-management story around it (P0 #2, P2 single-global-key) is weak.
- **No raw/unsafe SQL anywhere** — only tagged-template `$queryRaw`/`$executeRaw`, fully parameterized; no string-concatenated queries found across the whole backend.
- **Event-ingestion dedup is correct at both layers** (`RawEvent` unique `connectorId+externalId`, `CanonicalEvent` unique `companyId+dedupeKey`, both with P2002 race handling).
- **Approval decisions use a race-safe conditional `updateMany` claim**, closing a real double-approval bug class; workflow APPROVAL-resume correctly continues from `resumeNodeId` with zero re-execution of prior nodes.
- **The template resolver has no `eval`, blocks `__proto__`/`constructor` paths, and secrets are never merged into workflow context** — the injection risk this was built to prevent genuinely doesn't exist.
- **Resilience primitives (circuit breaker, rate limiter) are genuinely Redis-backed** (not just defined) and actually wired into real skill egress; all recurring background work uses BullMQ's Redis-coordinated `upsertJobScheduler` — safe across replicas, no in-process cron duplication risk.
- **Frontend route protection is complete** — all 15 authenticated pages carry the same accessToken guard, backed by a centralized redirect guard at the layout level; a full-tree sweep found zero unauthenticated gaps and zero leftover light-theme classes after the recent dark-theme overhaul.
- **Analytics/KPI endpoints use pure `count`/`groupBy` aggregation** — no N+1 pattern found anywhere in that module.

---

## 4. Flow / process changes recommended

1. **CI is the actual gap, not "more tests."** 151 e2e + 34 unit tests already exist — they're just not gating anything. Standing up even a minimal pipeline (typecheck → lint → unit → e2e → build) turns "done" from "a developer ran it locally" into an enforced guarantee. A git remote should exist today regardless, independent of CI.
2. **Marketing/billing claims need an engineering sign-off gate before shipping.** SSO and Audit Logs were sold before they were built — a process gap between whoever owns pricing copy and whoever owns the roadmap, not a coding bug.
3. **Migration safety needs to stop being tribal knowledge.** The pgvector/HNSW gotcha is documented in CLAUDE.md but nothing enforces it in practice.
4. **Insert an explicit "hardening" turn alongside the module-by-module delivery cadence** — rate limiting, CI, pagination, and error boundaries have each been "next" for a while; they won't get done as a side effect of building the 16th feature module.

## 5. New modules recommended

1. **A real Audit Log module** (login attempts, permission/role changes, data exports/deletions) — already sold, so this is the highest-priority net-new module.
2. **SSO/SAML-OIDC module** — same reasoning as above.
3. **Notifications/Email module** — nothing sends real email anywhere today (invites, workflow failures, approval requests all fail silently to notify a human).
4. **Health-check module** (`@nestjs/terminus`, `/health/live` + `/health/ready`) — small, foundational, currently absent.
5. **Data-retention + tenant-offboarding job** — needed for the GDPR claim to become true.
6. **MFA (TOTP at minimum)** — the auth UI already promises this.

---

*Methodology note: each dimension above was audited by an independent process with no visibility into the others' findings, then cross-referenced and deduplicated during synthesis. All file:line references were read directly from source at audit time (2026-07-12); re-verify before acting if this document is consulted much later, since the codebase will have moved on.*
