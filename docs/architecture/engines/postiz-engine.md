# Engine Study: Postiz (Community/Self-Hosted Edition) → AI Marketing Employee

**Status: reformatted from prior source-verified research, not re-researched from scratch** (user
decision, 2026-07-19 — see [[orlixa-foundation-engines-research]] in memory). Underlying evidence is
identical to `../postiz-analysis.md` (28 sections, verified against a real clone of
`gitroomhq/postiz-app` at commit `ab3b1ed` / 2026-07-18) and `../postiz-integration-plan.md`
(corrected against official docs at docs.postiz.com on 2026-07-19). This document maps that same
verified evidence onto the 22-section template requested for the full 10-engine study; it does not
introduce new claims. Every fact below cites back to the section number in those two docs
(`PZ§n` = postiz-analysis.md, `PLAN§n` = postiz-integration-plan.md) so it can be re-verified at the source.

**License**: AGPL-3.0 (confirmed, `LICENSE`/`package.json`). No separate "Enterprise Edition" exists
as a distinct codebase or repo — Postiz has one open-source codebase (self-hosted = Community
Edition, everything in this repo) plus a **hosted Cloud** offering (`api.postiz.com`) that gates
some limits via Stripe subscription tiers. Self-hosting without `STRIPE_PUBLISHABLE_KEY` configured
**bypasses all tier gating and unlocks everything** (`PZ§20`) — so unlike some other projects in this
study, "Community Edition" here effectively means "the entire product," not a stripped-down tier.
Anywhere this doc would otherwise say "ENTERPRISE ONLY," the honest statement is: **no such split
exists in Postiz** — it's Cloud (hosted, tiered) vs. self-hosted (all code, ungated by default).

---

## 1. Executive Summary

Postiz is a self-hostable social-media scheduling/publishing platform: connect accounts across 34
platforms, draft/schedule/publish posts, pull back analytics, with an AI copilot for content
generation. Architecturally it's a pnpm monorepo of 5 apps (backend API, frontend, a Temporal-worker
orchestrator, a CLI-command runner, a Chrome extension) sharing one domain library
(`libraries/nestjs-libraries`). The single most distinctive design choice is using **Temporal**
(not BullMQ/cron) as the entire scheduling/retry/worker substrate — this is both its biggest
strength (durable, retry-safe, horizontally scalable scheduling for free) and its biggest adoption
cost (a whole extra service stack: Temporal server + its own Postgres + Elasticsearch). For Orlixa,
the verified, decisive finding is that **none of this needs to be adopted or extracted** — Postiz's
own public REST API (and an MCP server) already expose everything an AI Marketing Employee needs,
so the recommended integration is "run vanilla self-hosted Postiz, call it only over its documented
API" (`PLAN§headline`).

## 2. Architecture Diagram

```
                        ┌─────────────┐
                        │  Frontend   │  Next.js 16 / React 19
                        │ (apps/frontend)
                        └──────┬──────┘
                               │ REST (cookie/JWT)
                        ┌──────▼──────┐        ┌──────────────┐
      AI agents/3rd───► │   Backend   │◄──────►│  Postgres    │ (Prisma)
      party (public API)│(apps/backend)        └──────────────┘
                        │  NestJS     │        ┌──────────────┐
                        └──────┬──────┘◄──────►│  Redis       │ (OAuth state + throttle only)
                               │ starts/queries └──────────────┘
                        ┌──────▼──────────────────────────────┐
                        │        Temporal Server               │
                        │  (+ its OWN Postgres + Elasticsearch) │
                        └──────┬───────────────────────────────┘
                               │ dispatches workflow tasks
                        ┌──────▼──────┐
                        │ Orchestrator│  Temporal Worker process
                        │(apps/orchestrator)── outbound HTTP ──► X/LinkedIn/Instagram/.../34 platforms
                        └─────────────┘
```
(Derived from `PZ§1`, `PZ§9`, `PZ§26`, and Postiz's own `howitworks.md`, fetched verbatim — see
`PZ§Overview` in the correction section.)

## 3. Component Diagram

Five apps + three shared libraries, exactly as inventoried in `PZ§1`/`PZ§2`:
`apps/backend` (REST, auth, billing, media, public API), `apps/frontend` (Next.js UI),
`apps/orchestrator` (Temporal workflows/activities — the actual publish logic), `apps/commands`
(CLI cron-adjacent tasks, e.g. token-refresh sweep), `apps/extension` (Chrome extension for
cookie-auth platforms), `apps/sdk` (thin public-API client). Shared:
`libraries/nestjs-libraries` (Prisma models, 34 social-provider integrations, OAuth/upload/Temporal
glue, Stripe billing, Mastra AI/MCP), `libraries/helpers` (JWT, utils), `libraries/react-shared-libraries`.

## 4. Request Flow

Full verified trace, "post scheduled" → "live on the platform," in `PZ§22`: create (`POST /posts`)
→ persist `Post` row (`state:'QUEUE'`) → start Temporal workflow `postWorkflowV105` → durable
`sleep()` until `publishDate` → pre-flight token/subscription checks → provider `.post()` call
(actual outbound HTTP) → on success, write back `releaseId`/`releaseURL`, fire webhooks, handle
repeat-posts/plugs; on failure, typed retry (refresh-token retry vs. terminal error) — full detail
in `PZ§22`, don't re-derive, it's already a byte-for-byte trace against the real activity/workflow files.

## 5. Authentication Flow

Two separate systems, not one (`PZ§3`, `PZ§4`): (a) **end-user login** — stateless JWT
(`jsonwebtoken`, `AuthMiddleware` re-resolves the full user from Postgres by id rather than trusting
JWT claims, supports super-admin impersonation); (b) **social-provider OAuth-connect** — per-provider
`IAuthenticator.generateAuthUrl()/authenticate()`, Redis as short-lived OAuth-state store, now
confirmed reachable via the public API (`GET /public/v1/social/:integration`, `PZ§27`) — no
logged-in session required for this specific action, contrary to the first-pass finding.

## 6. Database Design

Single `schema.prisma`, 970 lines, Postgres (`PZ§7`). Core: `Organization` (tenant root) →
`Integration` (connected channel, plaintext token — flagged gap, `PZ§16`) → `Post` (state machine
`QUEUE|PUBLISHED|ERROR|DRAFT`, self-referencing for threads, `creationMethod` enum tracks
WEB/MCP/API/AUTOPOST/CLI origin). `User`↔`Organization` via `UserOrganization` (role +
disabled flag). `Customer` sub-entity groups `Integration`s for agency/white-label multi-client use
— **this is the exact primitive Orlixa's integration plan maps onto** (`PLAN§Phase3/5`). Full
model-by-model detail in `PZ§7`.

## 7. Folder Structure

See `PZ§2` for the full annotated tree (`apps/*` vs `libraries/*`, path-aliased imports, one
service+repository pair per Prisma model under `database/prisma/<model>/`).

## 8. Deployment Architecture

Docker Compose reference deployment (`PZ§26`): app Postgres, Redis, and the full Temporal stack
(Temporal server + its own dedicated Postgres + Elasticsearch + admin-tools + UI) — production
compose runs Postiz itself (backend+frontend+orchestrator) as **one bundled container**
(`ghcr.io/gitroomhq/postiz-app:latest`), though the `apps/*` split supports separating them for
scaled deployments. `TEMPORAL_ADDRESS`/`TEMPORAL_API_KEY` env vars allow pointing at Temporal Cloud
instead of self-hosting that piece.

## 9. Worker Architecture

No `@nestjs/schedule`/`@Cron` usage anywhere (`PZ§10`, confirmed by grep). Workers are Temporal
Worker processes (one per task queue, auto-derived per social provider + a generic `main` queue),
hosted by `apps/orchestrator`. "Cron-like" recurring behavior is implemented as long-running
Temporal workflows that `sleep()` in a loop (e.g. the hourly `missingPostWorkflow` safety-net sweep)
— this *is* the worker/cron mechanism, not a separate system.

## 10. Queue Architecture

**No BullMQ/Redis-queue library exists in this codebase** (`PZ§9`, confirmed absent by dependency
and source search) — a common wrong assumption. The queue system is entirely **Temporal task
queues**, one per social-provider identifier plus `main`, with per-provider concurrency caps
(`maxConcurrentJob`, divided by `WORKER_CONCURRENCY_DIVIDER` for horizontal scaling). Retry policy:
`{maximumAttempts: 3, backoffCoefficient: 1 (fixed, not exponential), initialInterval: '2 minutes'}`,
uniform across every workflow file (`PZ§9`/`§24`).

## 11. API Structure

27 authenticated app controllers (`PZ§12`) plus a documented, API-key-authenticated public API
under `/public/v1/*` — verified to be considerably larger than first assumed (`PZ§27`): posts
(create/list/delete/change-status), integrations (list/connect/disconnect/settings/is-connected),
**groups** (Customer list — confirms the multi-client-per-org pattern is first-class), analytics
(per-integration and per-post), media upload (direct + from-URL), AI image/video generation, and
platform-specific helper triggers. Full route table with line numbers in `PZ§27`.

## 12. Extension Points

Per-provider `SocialProvider` interface (`social.integrations.interface.ts`) is the primary
extension point for adding a new platform (`PZ§5`) — implement `IAuthenticator` (OAuth) +
`ISocialMediaIntegration` (post/comment/analytics), register in `integration.manager.ts`'s
`socialIntegrationList`. Storage backend is a factory (`UploadFactory`) switchable via
`STORAGE_PROVIDER` (`local`|`cloudflare`) — a second real extension point (`PZ§14`).

## 13. Plugin System

`Plugs`/`ExisingPlugData` Prisma models — post-publish automation rules (e.g. auto-repost to
another channel, delayed repeat-posts) processed inline at the end of the publish workflow
(`PZ§11`). This is Postiz's own internal "plugin" concept for post-publish actions, distinct from
the provider-extension mechanism in §12.

## 14. Scalability

Horizontal scaling is via Temporal worker concurrency (`WORKER_CONCURRENCY_DIVIDER`, per-provider
`EXCLUDE_QUEUE` pinning for low-limit providers like Reddit/Twitch, `PZ§9`). The public API has an
**instance-wide** (not per-user) post-creation rate limit — 90/hour self-hosted default, 100/hour
cloud, adjustable via `API_LIMIT` (`PZ§25`, confirmed via official docs) — a real capacity-planning
input for Orlixa if many companies share one Postiz instance (`PLAN§Phase9/Risks`).

## 15. Multi-tenancy

`Organization` is the tenant root; enforcement is **application-layer**, not DB-level RLS — every
service method takes an explicit `orgId` and every query filters by it manually, with no single
enforced choke point (`PZ§18`, explicitly flagged as "not verified to be defense-in-depth," not
assumed safe). Sub-tenancy for agency/white-label use exists via `Customer` (`PZ§19`) — confirmed
by official docs/MCP tool list (`groupList`) to be the intended mechanism for exactly this kind of
"one org, many end-clients" scenario (`PLAN§Phase3`, corrected/strengthened finding).

## 16. Security

Real findings, not assumed: access tokens stored **plaintext** on `Integration` (`PZ§16`, gap);
outbound webhooks **unsigned, no retry** (`PZ§13`, gap); media upload has genuinely strong
hardening worth copying (byte-sniffed MIME allow-listing + SSRF-guarded remote-URL fetch, `PZ§14`);
RBAC is coarse (`ADMIN`/`SUPERADMIN` role gate only; everything else is billing-tier CASL gating,
not per-feature RBAC, `PZ§20`). AGPL-3.0 licensing implications for anyone embedding Postiz as a
SaaS backend are a real, separate legal question — see `PLAN§Phase9` for the full analysis (not
repeated here to avoid drift between two copies of the same legal reasoning).

## 17. Limitations

No dead-letter-queue concept beyond `Post.state='ERROR'` + the `Errors` log table (`PZ§24`); no
video transcoding for arbitrary user uploads, only AI-video-generation vendor integrations
(`PZ§15`); analytics only exist for providers that implement the optional `analytics()` method, not
universally across all 34 (`PZ§21`); `MastodonCustomProvider` exists in source but is commented out
of the active registry (`PZ§6`).

## 18. Enterprise-only Features

**None exist as a code-level split** — see the license note at the top of this document. Postiz's
Cloud product gates by subscription tier (channel count, webhook count, posts/month, team members,
AI, community features — `PZ§20`'s `pricing[tier]` object), but self-hosting bypasses this
entirely when Stripe isn't configured. If asked "what's Enterprise-only," the accurate answer is
"nothing in the self-hosted codebase is held back; Cloud simply meters usage."

## 19. Community Features

Effectively the entire feature set documented in `PZ§1`–`§26`: all 34 social providers, full
publishing/scheduling pipeline, analytics, media pipeline, public API, MCP server, OAuth-as-a-server
(3rd-party delegated access), newsletter/short-link providers, marketplace/agency layer — all ship
in the open-source self-hosted repo.

## 20. Which parts should Orlixa reuse

- The **public REST API** (`/public/v1/*`) and the **self-hosted MCP server** as the sole
  integration surfaces — call, don't embed (`PLAN§headline`).
- The **`Organization`→`Customer` mapping** as the tenancy bridge: one Orlixa-owned Postiz org,
  one Postiz `Customer` per Orlixa `Company` (`PLAN§Phase3/5`).
- The **conceptual** three-layer refresh pattern (reactive mid-publish + proactive scheduled +
  batch-sweep backstop) and the **media-upload hardening pattern** (byte-sniffing, SSRF guard) —
  worth mirroring in Orlixa's own upload path even though token custody itself stays inside Postiz.

## 21. Which parts should Orlixa replace

Nothing needs replacing to reach v1 — the wrap-as-a-service design means Orlixa never runs or
depends on Postiz's internals (Temporal, Prisma schema, provider classes) directly, so there's
nothing of Postiz's *inside* Orlixa to replace. The one thing Orlixa *builds itself*, matching but
not replacing Postiz's shape, is its own smaller mirror schema (`SocialAccount`, `Campaign`,
`ScheduledPost`, `PublishedPost`, `MediaAsset`, `BrandAsset`, `MarketingAnalyticsSnapshot` —
`PLAN§Phase6`) so the AI Marketing Employee has fast local reads without round-tripping to Postiz
on every query.

## 22. Which parts should Orlixa ignore

Temporal adoption (unneeded — Postiz's own instance owns it, `PLAN§headline`); the marketplace/
agency buyer-seller layer (`Orders`/`Messages`/`SocialMediaAgency`, `PZ§19`); the Mastra-based
in-app AI copilot/chat subsystem (Orlixa has its own agent runtime, `OX§3`); newsletter/short-link
provider integrations (out of scope for v1, `PLAN§Phase3`); Postiz's own CASL billing-tier RBAC
(irrelevant once Orlixa owns billing and the single shared org, `PZ§20`).

---

**Cross-reference:** the full company-flow, DB schema additions, backend/frontend/security design,
gap analysis, roadmap, and risks for the Marketing Employee already exist in
`../postiz-integration-plan.md` — that document is the Phase-3-through-10 output for this engine and
is not duplicated here.
