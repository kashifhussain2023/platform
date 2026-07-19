# Postiz → Orlixa Integration Plan: the "AI Marketing Manager" Employee

**Status:** design document (Phases 3-10 of the requested analysis). Phases 1-2 (raw architecture
analysis) live in the companion docs, read those first for evidence/citations:
- [`postiz-analysis.md`](./postiz-analysis.md) — Postiz, verified against a real clone of `gitroomhq/postiz-app`
- [`orlixa-current-architecture.md`](./orlixa-current-architecture.md) — Orlixa/V-AEP, verified against this repo

This document does not repeat that evidence in full; it cites section numbers back into those two
docs (`PZ§n` = Postiz doc section n, `OX§n` = Orlixa doc section n) and builds the design on top.

**No production code is written here.** Everything below is a plan to review before implementation starts.

> **Correction (post-publication):** the first version of this document, written from a source-only
> reading of Postiz, incorrectly flagged the OAuth-connect and analytics endpoints as missing from
> the public API and requiring a fork patch. Cross-checking the official docs at docs.postiz.com
> (`https://docs.postiz.com/llms.txt` gives the full doc index) and re-reading
> `public.integrations.controller.ts` in full — rather than via the SDK, which only wraps a subset —
> found both already exist (`GET /public/v1/social/:integration`, `GET /public/v1/analytics/*`, see
> `PZ§27`). Postiz also ships a **self-hosted MCP server** (`PZ§28`) not covered in the original
> Phase 1 questions. Every place below that changes as a result is marked **[corrected]**.

---

## Headline recommendation

Run **one self-hosted Postiz instance as a black-box publishing engine**, called only through its
public API (`/public/v1/posts|upload|integrations`, `PZ§22`). Orlixa's new `modules/marketing`
backend module is the *only* thing the customer, or the rest of Orlixa, ever talks to — Postiz's own
UI, login, and org concept are never customer-facing. A new **AI Marketing Manager** `AiEmployee`
drives the whole thing through the existing agent runtime (`OX§3`).

This is **"wrap as a service,"** not "embed" or "extract." Three facts from the source drove that call:

1. **No clean internal seam exists to extract.** Postiz's actual publish logic lives inside Temporal
   workflows/activities that are tightly coupled to `nestjs-temporal-core` and share Prisma services
   in-process with the backend (`PZ§22`). Pulling that logic out means either adopting Temporal +
   its own Postgres + Elasticsearch (`PZ§26`) as new Orlixa infrastructure, or reimplementing 34
   providers' worth of vendor-API quirks from scratch. Neither is embedding-friendly.
2. **The public API is unexpectedly capable — more so than first found.** `POST /public/v1/posts`
   accepts `type: 'draft'|'schedule'|'now'|'update'` plus an ISO `date` (verified directly in
   `CreatePostDto`, `libraries/nestjs-libraries/src/dtos/posts/create.post.dto.ts:93-112`) — so
   **Postiz's own Temporal engine already durably holds a post until its scheduled time**; Orlixa
   does not need to reinvent that half of the problem. **[corrected]** A closer re-read of the full
   public API controller (`PZ§27`), prompted by checking the official docs, also found the
   OAuth-connect endpoint (`GET /public/v1/social/:integration`) and analytics endpoints
   (`GET /public/v1/analytics/*`) already exist under `/public/v1` — the original version of this
   document incorrectly called both of those missing and recommended patching Postiz to add them.
   **No fork of Postiz is required for this integration at all** — vanilla self-hosted Postiz's
   public API is sufficient, with one narrow exception (customer-tagging at connect time, see Phase
   3). Postiz additionally ships a self-hosted **MCP server** (`PZ§28`, 9 tools, same auth as the
   REST API) as an alternative tool-exposure surface — evaluated below and not chosen for v1, but
   worth knowing about since it changes what "integrate with Postiz" could mean in the future.
3. **AGPL-3.0 licensing** (`LICENSE`, `package.json: "license": "AGPL-3.0"`) still needs a legal
   look before this ships as a paid feature, but **[corrected]** the risk is meaningfully smaller
   than originally framed: since no source modification is needed (point 2), this is "call an
   unmodified AGPL network service from a separate proprietary backend via its documented API" —
   a common, comparatively well-understood pattern — rather than "distribute a patched copy of AGPL
   code as part of a paid product." Still flagged as the top item for legal sign-off (Phase 9 /
   Risks), just not framed as a blocker on the same order as before.

The one real gap that remains (Phase 3, module 4) is narrow: Postiz's public API can list Customers
(`GET /public/v1/groups`) and filter integrations by Customer, but **cannot tag a newly-connected
integration to a Customer** — that one action (`PUT /:id/group`) only exists on Postiz's internal,
logged-in-user-session controller (`PZ§27`). Closing that gap is the only piece of *Postiz-side* work
this plan might still require, and even that has a non-fork workaround (see Phase 3, module 4).

---

## Phase 3 — Module-by-module mapping

| Postiz module | Verdict | Why |
|---|---|---|
| `apps/backend` (NestJS API) | **Wrap as a service** | Run unmodified (see one exception below) behind its own infra; Orlixa never imports its code, only calls its public API. |
| `apps/orchestrator` (Temporal workflows) | **Wrap as a service** (do not adopt Temporal in Orlixa) | This is what actually gives Orlixa "schedule a post for next Tuesday 9am" for free — see headline point 2. Standing up Temporal *inside* Orlixa's own infra would duplicate a scheduler Orlixa doesn't need to own. |
| 34 social-provider integration classes (`PZ§5/§6`) | **Wrap as a service** (reference-only if ever forked) | The expensive part (per-vendor API quirks: OAuth1 for X, cookie-auth for Skool, Web3 signing for Farcaster/Nostr, etc.) is exactly what you get for free by depending on Postiz rather than reimplementing it. Read as reference only if a specific platform is later brought in-house. |
| OAuth-connect flow, social side (`PZ§4a`, corrected in `PZ§27`) | **Wrap as-is — no patch needed** | `GET /public/v1/social/:integration` is already API-key-authenticated and returns the provider redirect URL (`PZ§27`, verified at `public.integrations.controller.ts:326`). The only sub-piece not covered by the public API is tagging the resulting integration to a Customer/group (`PUT /:id/group` is internal-session-only) — see the dedicated row below. |
| Assigning a connected account to a Customer/group at connect-time (`PZ§27`'s narrow gap) | **Small additive patch, or a session-bridge workaround** | Real, narrow gap: `PUT /:id/group`/`PUT /:id/customer-name` (`integrations.controller.ts:66,79`) is only reachable via a logged-in Postiz user session, not `/public/v1`. Two options: (a) small additive public-API endpoint exposing just this one call (much smaller patch than originally proposed for the whole connect+analytics surface); or (b) Orlixa's backend holds one internal service-account session against the single shared Postiz org and calls this one internal route directly, skipping a fork entirely at the cost of depending on an unversioned internal route. Recommend (a) if any Postiz-side change is going to be made at all, since it's a one-endpoint addition, not a fork of core logic. |
| MCP server (`PZ§28`) | **Reference / optional future path, not used for v1** | Real, self-hosted, same auth as the public API, 9 tools closely matching the REST surface. Not adopted for v1 because Orlixa's tool-calling and `ApprovalRequest` gating are entirely bespoke (`OX§5`) — using MCP would mean building a net-new MCP-client capability in Orlixa *and* still needing an interception layer to enforce approval before a tool fires, so it doesn't remove the approval-gating work, only shifts the tool-schema-maintenance work. Worth revisiting if Orlixa ever invests in being a general-purpose MCP client for reasons beyond just Postiz. |
| OAuth-as-a-server flow (`PZ§4b`, `/oauth/*`) | **Ignore** | This is Postiz letting *3rd parties* delegate into a Postiz org — irrelevant to Orlixa wrapping Postiz as a backend. |
| Database schema (`PZ§7`) | **Reference only** | Orlixa doesn't get a database connection to Postiz's Postgres at all in the wrap-as-a-service model — everything Orlixa needs (which posts exist, their state) comes back over the public API or webhooks. The schema is useful only as a design reference for Orlixa's own new tables (Phase 6). |
| Scheduling engine / Temporal sleep (`PZ§8`) | **Wrap as a service** | See headline point 2 — this is the actual value being bought by depending on Postiz. |
| Queue system (Temporal task queues, `PZ§9`) | **Ignore** (infra Orlixa doesn't run) | Lives entirely inside the self-hosted Postiz deployment. |
| Refresh-token handling (`PZ§17`) | **Wrap as a service** | Postiz already does reactive + proactive + batch-sweep refresh per-integration. Orlixa doesn't need to know a token is about to expire — Postiz keeps its own `Integration` rows alive. Orlixa only needs to react if Postiz reports a channel `disabled`/`refreshNeeded` back (surfaced via the reconciliation poll in Phase 7). |
| Media upload + storage factory (`PZ§14`) | **Wrap as a service, but mirror the hardening pattern** | Orlixa needs its *own* media library (Phase 6, for drafts/brand assets before a post is ever sent to Postiz) — build that using Orlixa's own existing `KnowledgeDocument.storageKey` pattern (`OX§11`), then hand a finished asset to Postiz's `/public/v1/upload` only at send-time. Do explicitly copy Postiz's byte-sniffed MIME allow-listing + SSRF-guarded URL fetch (`PZ§14`) into Orlixa's own upload path — that hardening is worth lifting regardless of the wrap-vs-embed decision. |
| Outbound webhooks (`PZ§13`) | **Wrap as a service (as the callback mechanism), but assume unreliable** | Register one Orlixa webhook URL per environment (not per company — see Phase 7) against Postiz's `Webhooks` model to receive publish-success/failure pings. Because Postiz's webhook delivery has no signing, no retry, and silently swallows failures (`PZ§13`), Orlixa must **not** treat the webhook as the only source of truth — pair it with a periodic reconciliation poll (`GET /public/v1/posts`), exactly mirroring the `connector-reconcile` pattern Orlixa already has (`OX§9/§10`). |
| Analytics (`PZ§21`, corrected in `PZ§27`) | **Wrap as a service — no patch needed** | `GET /public/v1/analytics/:integration` and `/analytics/post/:postId` are already under the public API (`PZ§27`, verified at `public.integrations.controller.ts:497,507`) — the original version of this document incorrectly flagged this as missing. |
| Multi-tenant model: `Organization`/`UserOrganization`/`Customer` (`PZ§18/§19`) | **Reference + reuse the `Customer` sub-entity specifically** | Recommended bridge: run **one** Postiz Organization owned by Orlixa, and map **each Orlixa `Company` to one Postiz `Customer` row** (`Integration.customerId`) rather than provisioning a new Postiz Organization per signup. **[confirmed, not just inferred]** Postiz's own public API (`GET /public/v1/groups`, `GET /public/v1/integrations?group=`) and its official MCP tool docs (`groupList`, `integrationList(group)`) treat "group" and "Customer" as synonymous, first-class, API-key-reachable concepts — this is evidently the intended usage pattern for exactly this kind of multi-client-per-org setup, not a repurposing of an unrelated schema field. Reasoning in Phase 5. |
| RBAC / CASL billing-tier gating (`PZ§20`) | **Ignore** | This is Postiz's own plan-tier gating; irrelevant once Orlixa owns the one Postiz org and its own billing lives in Orlixa's `billing` module (`OX§12`). |
| Marketplace/agency layer (`Orders`/`Messages`/`SocialMediaAgency`, `PZ§19`) | **Ignore** | A distinct bolted-on product, not part of the publishing capability. |
| AI copilot / chat / Mastra tables (`PZ§11`) | **Ignore** | Orlixa already has its own AI Employee runtime (`OX§3`) — the AI Marketing Manager's "brain" is Orlixa's `AgentRuntimeService`, not Postiz's copilot. |
| Error handling / typed-failure pattern (`PZ§23`) | **Reference only** | Good pattern (global exception filters, typed discriminators across an async boundary) to keep in mind for Orlixa's own new marketing module, but nothing to literally reuse across the service boundary. |
| Newsletter / short-link providers (`PZ§6`) | **Ignore for v1** | Out of scope unless a future phase wants email-newsletter or link-shortening as part of the Marketing Manager's toolkit. |

---

## Phase 4 — The "AI Marketing Manager" AI Employee

Modeled exactly like every other Orlixa employee (`OX§3`) — same `AgentRuntimeService` loop
(guard → budget → plan → retrieve → memory → act → validate), same `Skill`/`ToolExecutorService`
tool-calling pattern, same `ApprovalRequest` gate. Nothing about the runtime itself is new; only the
**tools it's given** and a handful of **new backing tables** are new.

- **Model row**: `AiEmployee { role: 'CUSTOM', persona: '...' }` — no schema migration required to
  ship v1 (a dedicated `MARKETING` enum value is a trivial follow-up if wanted for cleaner UI labels).
- **Knowledge access**: uses the existing `KnowledgeDocument`/RAG system (`OX§7`) for brand
  voice/guidelines — no new retrieval mechanism needed, just point it at a `category` of knowledge
  docs the company uploads (brand guide, tone-of-voice doc, past campaign briefs).
- **New Skill**: `marketing_publisher` (or similar `skillKey`), whose `connection.type` is `oauth`
  but whose *tools* are backed by a new dedicated executor (Phase 7) that talks to the self-hosted
  Postiz instance's public API — not a generic `http` skill, because token handling, retries, and
  scheduling semantics are publish-specific.
- **Tools exposed to the employee** (JSON-schema, same shape as every other skill's `tools[]`,
  `OX§5`):
  - `list_connected_accounts` — read-only, returns the company's connected channels (from Orlixa's
    own `SocialAccount` table, Phase 6 — no live Postiz call needed for this one).
  - `start_connect_account(platform)` — returns a redirect URL for the OAuth-connect popup, calling
    `GET /public/v1/social/:integration` directly (`PZ§27` — confirmed to need no Postiz-side patch).
  - `get_platform_constraints(platform)` **[new, added after finding Postiz's official MCP tool
    list, `PZ§28`]** — mirrors Postiz's own `integrationSchema` tool: character limits, required
    settings, editor type per platform. Lets the drafting step validate against real per-platform
    constraints before a draft ever reaches approval, rather than failing validation after the fact.
  - `generate_post_draft(brief, platforms[])` — **not** a Postiz call at all; this is an `AI_STEP`
    inside Orlixa using the company's Knowledge (brand voice) + the employee's own LLM — produces
    text + references image/brand-asset ids from `media_library`.
  - `generate_image(prompt, brandAssetRefs[])` / `generate_video(prompt, options)` **[corrected]** —
    calls Postiz's own `POST /public/v1/generate-image`/`/generate-video` (backing Postiz's AI-video
    vendor integrations, `PZ§15`) rather than a new Orlixa-side image/video-generation provider. This
    resolves what the first version of this document listed as an open item needing confirmation —
    Postiz already provides this, so no new Orlixa infrastructure is needed for it.
  - `run_platform_helper(accountId, action, params)` **[new]** — mirrors Postiz's `triggerTool` /
    `POST /public/v1/integration-trigger/:id` (e.g. "list this Discord server's channels," "search
    subreddits") for platforms whose posting flow needs a helper lookup first.
  - `schedule_post(campaignId, platform, content, mediaRefs[], publishAt)` — `highRisk: true`,
    routes through `ApprovalRequest` before it ever calls Postiz (see approval mapping below).
  - `publish_now(postId)` — same, `highRisk: true`.
  - `get_post_status(postId)` / `list_scheduled_posts()` / `get_analytics(accountId, range)` —
    read-only tools, backed by Orlixa's own mirrored tables (kept in sync via webhook + reconciliation,
    Phase 7) so the employee never blocks on a live Postiz round-trip mid-conversation.
- **Approval mapping** — reuses `ApprovalRequest.kind: 'WORKFLOW'` exactly as `OX§13`'s answer
  describes: model "draft → approve → publish" as a `Workflow` graph
  `AI_STEP (draft) → APPROVAL (manager reviews) → TOOL_ACTION (schedule_post/publish_now)`. No new
  `ApprovalRequest` kind needed. The paused run's `context` (already a JSON blob) carries the drafted
  post text + media refs, and `ApprovalRequest.description` renders the human-readable preview — the
  approver sees exactly what will go out before approving.
- **Monthly reports** — a new `SCHEDULE`-triggered `Workflow` (Orlixa already supports
  `triggerType: SCHEDULE`, `OX§6`) that runs monthly, calls `get_analytics` per connected account,
  and produces a summary via `AI_STEP`, delivered however Orlixa delivers reports today (extend
  `NOTIFY` to a real channel — see the `NOTIFY` gap below — or attach to the existing `analytics`
  module's dashboard, `OX§12`).

---

## Phase 5 — Company flow (verified against real primitives, not assumed ones)

```
Company Signup
  │  (existing: OX§1 register() → Company+owner User in one txn)
  ▼
Create Organization
  │  (no-op beyond today: Company already IS the tenant — OX§2, no split needed)
  ▼
Hire AI Marketing Manager
  │  (existing employees.service hire flow, OX§3 — role:'CUSTOM', persona pre-filled)
  ▼
Connect Instagram / LinkedIn / Facebook  ┐
  │  each:                                │  repeat per platform
  │  1. Employee tool call → start_connect_account(platform)
  │  2. Orlixa backend calls Postiz's existing public API
  │     (`GET /public/v1/social/:integration`, PZ§27 — no patch needed) →
  │     gets a provider OAuth redirect URL
  │  3. Orlixa frontend opens it in a popup — customer sees Orlixa's own
  │     "Connect Instagram" UI, then the REAL provider consent screen
  │     (unavoidable — that screen belongs to Instagram/LinkedIn/etc, not Postiz)
  │  4. Provider redirects back to Postiz's own callback (self-hosted, invisible
  │     to the customer — a background hop, not a page they land on)
  │  5. Postiz creates the Integration row, tagged to this company's Postiz
  │     `Customer` id (Phase 3's mapping)
  │  6. Postiz's webhook (or Orlixa's reconciliation poll) tells Orlixa the
  │     connection succeeded → Orlixa writes/updates its own `SocialAccount` row
  ┘
  ▼
Grant OAuth permissions
  │  (same step as above — OAuth consent IS the permission grant, no separate step)
  ▼
Store encrypted tokens
  │  Tokens live in Postiz's `Integration.token` (plaintext today, PZ§16 — flagged
  │  as a real gap, Phase 9). Orlixa itself never receives or stores the raw token —
  │  only the fact that a channel is connected (`SocialAccount.status`). This is a
  │  genuine advantage of the wrap-as-a-service model: Orlixa's own encrypted-credentials
  │  surface (CryptoService, OX§9) never needs to hold social tokens at all.
  ▼
AI learns company website
  │  Existing Knowledge/RAG ingestion (OX§7) — company uploads or links brand
  │  material; no new ingestion mechanism, just a new document category.
  ▼
AI generates first campaign
  │  New `campaigns` row (Phase 6) + generate_post_draft tool calls per platform,
  │  producing `scheduled_posts` rows in `DRAFT` state.
  ▼
Manager reviews
  │  ApprovalRequest (kind: WORKFLOW) queue, existing `/approvals` UI (OX§12),
  │  extended to render a post preview (Phase 8).
  ▼
Schedule
  │  On approval, TOOL_ACTION → schedule_post → Orlixa calls Postiz's
  │  POST /public/v1/posts with type:'schedule', date:<publishAt> — Postiz's own
  │  Temporal engine now owns the wait (PZ§8). Orlixa's `scheduled_posts` row
  │  flips to SCHEDULED and stores the returned Postiz post id.
  ▼
Publish
  │  Postiz publishes at the scheduled time (its own infra, its own retries,
  │  PZ§22/§24) and either (a) fires its outbound webhook, or (b) is caught by
  │  Orlixa's reconciliation poll. Either way, Orlixa's `scheduled_posts` row
  │  moves to `published_posts` with the real platform post id/URL.
  ▼
Analytics
  │  Scheduled `analytics` snapshot job (Phase 7) periodically calls Postiz's
  │  analytics data (pending the Phase 3 gap — needs the same public-API
  │  exposure treatment as OAuth-connect) and stores snapshots for the
  │  dashboard + monthly report.
```

---

## Phase 6 — Database (new Orlixa tables)

All new tables carry `companyId` and follow the manual-scoping convention already used everywhere
in Orlixa (`OX§2`) — no new tenancy mechanism, no RLS, same discipline as every existing module.

```
Company (existing)
  │
  ├── SocialAccount            companyId, provider, postizIntegrationId, postizCustomerId,
  │                            employeeId?, displayName, externalAccountId, status
  │                            (CONNECTED/DISCONNECTED/DEGRADED — mirrors SkillConnectionStatus
  │                            enum shape, OX§5, but is its own table — see Phase 3's reasoning:
  │                            InstalledSkill's unique(companyId, skillKey, employeeId) can't hold
  │                            N accounts of the same provider)
  │       │
  │       ├── ScheduledPost    companyId, socialAccountId, campaignId?, content, mediaRefs[],
  │       │                    publishAt, status (DRAFT/PENDING_APPROVAL/SCHEDULED/FAILED),
  │       │                    postizPostId?, approvalRequestId?
  │       │
  │       └── PublishedPost    companyId, socialAccountId, scheduledPostId, platformPostId,
  │                            permalink, publishedAt, lastMetricsSyncAt
  │
  ├── Campaign                 companyId, aiEmployeeId, name, goal, dateRange, status
  │       └── ScheduledPost.campaignId (FK, optional — a post can exist outside a campaign)
  │
  ├── MediaAsset                companyId, storageKey (same pattern as KnowledgeDocument.storageKey,
  │                            OX§11), mimeType, kind (IMAGE/VIDEO/BRAND_LOGO/BRAND_FONT/...),
  │                            uploadedBy
  │
  ├── BrandAsset                companyId, kind (LOGO/COLOR_PALETTE/FONT/VOICE_DOC), mediaAssetId?,
  │                            structuredValue (Json — e.g. hex codes), knowledgeDocumentId?
  │                            (voice/guideline docs stay in KnowledgeDocument + RAG, OX§11 — this
  │                            table is only for the structured, non-text brand facts)
  │
  └── MarketingAnalyticsSnapshot  companyId, socialAccountId, capturedAt, metrics (Json —
                               follower count, impressions, engagement, per Postiz's
                               AnalyticsData shape, PZ§21)

(reused, not new — ApprovalRequest.kind:'WORKFLOW' already covers approval_requests, OX§13)
```

**Explicitly not new tables:** `social_tokens` (tokens never leave Postiz, see Phase 5) and
`approval_requests` (reused as-is). This is a smaller net-new schema footprint than the phase 6
prompt's example list implied, because the wrap-as-a-service decision moves token custody and
scheduling-timer state out of Orlixa entirely.

---

## Phase 7 — Backend

**New module**: `apps/api/src/modules/marketing/` — controller(s), service(s), DTOs, mirroring the
existing module shape (`OX§12`).

- **`PostizClientService`** — thin typed wrapper around the self-hosted Postiz public API
  (`POST /public/v1/posts`, `/upload`, `/upload-from-url`, `GET /integrations`,
  `GET /social/:integration`, `GET /analytics/*`, `GET /groups`, `POST /generate-image`,
  `/generate-video`, `POST /integration-trigger/:id` — all confirmed to need **no Postiz-side
  patch**, `PZ§27`). One shared API key (Postiz org-level, `Organization.apiKey`, `PZ§7`), stored via
  Orlixa's own `CryptoService` (`OX§9`) — this is the *only* secret Orlixa needs to hold for the
  whole integration, versus one token per social channel per company. If the customer-tagging patch
  (Phase 3) is built, this service also calls that one additional endpoint.
- **New queues** (follow the existing `common/resilience` pattern exactly — named queue + constants
  file + `RESILIENT_JOB_OPTIONS` + DLQ wiring, `OX§10`):
  - `marketing-publish-dispatch` — near-immediate job: "call Postiz's createPost now that it's
    approved." Not a delayed/scheduled job itself (Postiz owns the actual wait, per the headline
    finding) — this queue just needs to reliably make the *one* API call with retry/DLQ if Postiz's
    API is briefly unreachable.
  - `marketing-reconcile` — periodic sweep (mirrors `connector-reconcile`, `OX§9`), polls
    `GET /public/v1/posts` for state changes Orlixa's local rows haven't seen (backstop for the
    unsigned, no-retry Postiz webhook, `PZ§13`).
  - `marketing-analytics-sync` — periodic (e.g. daily) pull into `MarketingAnalyticsSnapshot`.
- **New webhook receiver**: `POST /marketing/postiz-webhook` — one URL, registered once against the
  single shared Postiz `Webhooks` row (not per-company, since there's one shared Postiz org). Because
  Postiz signs nothing (`PZ§13`), this endpoint must not be trusted blindly — recommend a shared
  secret query-param/header convention added as part of the same additive Postiz patch that adds the
  OAuth-connect endpoint (small, controlled fork change), plus always cross-checking against the
  reconciliation poll rather than acting on the webhook alone for anything state-changing.
- **Retry logic**: standard `RESILIENT_JOB_OPTIONS` (`OX§10`) for the dispatch queue; Postiz's own
  Temporal retry (3 attempts / fixed 2-min backoff, `PZ§24`) already covers the actual publish
  attempt once Postiz has accepted the job, so Orlixa's own retry only needs to cover "did the
  create-post API call itself succeed," not "did the eventual publish succeed."
- **Token refresh jobs**: **none needed in Orlixa** — Postiz owns this entirely (`PZ§17`). Orlixa
  only needs to notice (via reconciliation) if Postiz reports a channel `disabled`/needing
  reconnect, and surface that in the Social Accounts screen (Phase 8).
- **Media pipeline**: draft assets live in Orlixa's own `MediaAsset` + storage provider until a post
  is actually sent to Postiz, at which point the dispatch job uploads the asset bytes to
  `/public/v1/upload` and substitutes the returned Postiz media reference into the `createPost` call.

---

## Phase 8 — Frontend

New route group `apps/web/src/app/(app)/marketing/` + `features/marketing/` — same mirrored
`api.ts`/`hooks.ts`/`schemas.ts`/`components/` shape as every existing feature (`OX§13`).

- **Marketing Dashboard** — overview cards (connected accounts, posts this week, upcoming approvals,
  headline analytics), entry point.
- **Campaigns** — list/detail, each campaign showing its generated posts and their status.
- **Calendar** — week/month view of `ScheduledPost.publishAt` across all connected accounts.
- **Social Accounts** — connect/disconnect per platform (triggers `start_connect_account`), shows
  `SocialAccount.status`, surfaces any Postiz-reported disconnect/refresh-needed state.
- **Media Library** — `MediaAsset` grid/upload, reused by the composer when attaching images/video.
- **Approvals** — extends the existing `/approvals` screen (`OX§12`) with a post-preview renderer
  for marketing-flavored `ApprovalRequest`s (reads the resolved `context`/`description`).
- **Analytics** — per-account and per-post metrics from `MarketingAnalyticsSnapshot`.
- **Brand Settings** — `BrandAsset` CRUD (logo, palette, fonts) + a pointer to the brand-voice
  Knowledge documents.
- **AI Marketing Manager (employee chat)** — the existing `/employees` chat UI (`OX§3`), no new
  chat surface needed, just a hired employee like any other.

---

## Phase 9 — Security

- **OAuth security**: the provider-consent step itself is unavoidable and identical regardless of
  who orchestrates it — the customer will see the real Instagram/LinkedIn/etc. consent screen once.
  What Orlixa controls is everything *around* it: the connect-initiation and callback-landing hops
  should be presented as Orlixa-branded popups so the intermediate "Postiz" hop is invisible. **[corrected]**
  Since `GET /public/v1/social/:integration` is Postiz's own existing, already-hardened public
  endpoint (`PZ§27`), Orlixa doesn't need to build or validate any new state-signing logic here at
  all — only the narrow customer-tagging patch (Phase 3), if built, needs its own auth review.
- **Token encryption**: **tokens never enter Orlixa's database or memory** in the recommended
  design — they live only inside the self-hosted Postiz instance, which itself stores them in
  **plaintext** today (`PZ§16`, confirmed gap). This is a real risk to close, but it's Postiz's
  database to harden (field-level encryption on `Integration.token`/`refreshToken` — a
  straightforward, scoped patch to the self-hosted fork), not a new burden on Orlixa's own
  `CryptoService`. The one secret Orlixa itself must protect is the single shared Postiz API key.
- **Permission model**: reuse Orlixa's existing `@Roles()`/`RolesGuard` (`OX§4`) for "who can approve
  a post" / "who can connect/disconnect a channel" — no new permission primitive, consistent with
  how every other module gates admin actions.
- **Workspace/tenant isolation**: enforced at the Orlixa layer as usual (manual `companyId`
  filtering, `OX§2`) for all the new tables. On the Postiz side, isolation is enforced via the
  `Customer` tag on each `Integration`/`Post` (Phase 3's mapping) — **this needs explicit
  verification during implementation** that every Postiz call Orlixa makes is scoped to the right
  `customerId`/`Integration` ids and can't leak across Orlixa companies sharing one Postiz org; this
  is the single most important security review item in the whole plan, since a bug here means one
  Orlixa customer's post could target another's connected account.
- **Rate limiting**: reuse Orlixa's existing per-tenant HTTP rate limiter (`tenant-throttler.guard.ts`,
  `OX§10`) on the new marketing endpoints. **[sharpened with confirmed numbers]** Postiz's own
  public API rate limit is **90 requests/hour for post-creation endpoints specifically, instance-wide
  (not per-user/per-org)**, self-hosted default (100/hour on the cloud version), adjustable via the
  `API_LIMIT` env (`PZ§25`, confirmed at docs.postiz.com). Because the recommended design shares
  **one** Postiz instance and API key across every Orlixa company, this ceiling applies to the whole
  Orlixa customer base combined, not per company — a real capacity-planning input, not just a
  note: model expected combined post-creation volume before launch and raise `API_LIMIT` on the
  self-hosted instance accordingly (it's Orlixa's own deployment, so this is a config change, not a
  negotiation with a vendor) — but it does mean Orlixa-side per-company throttling on top is
  necessary so one company's burst can't exhaust the shared ceiling for everyone else.
- **Secrets management**: exactly one new secret class (the shared Postiz API key) vs. the
  per-company-per-platform token custody a "build our own OAuth" approach would have required —
  this is a meaningful security-surface reduction, worth stating as a benefit of the wrap-as-a-service
  choice, not just a constraint.
- **Provider scopes**: whatever scopes each Postiz provider class requests (`PZ§5`) apply as-is;
  no Orlixa-side control over per-provider scope requests unless patched into the fork.
- **Revoking access**: disconnect flow needs to call through to Postiz (delete/disable the
  `Integration`) — confirm the additive endpoint set includes a disconnect call, not just connect.
- **Audit logs**: reuse Orlixa's existing `AuditLog` model (`OX§12`) for "who connected/disconnected
  a channel," "who approved/rejected a post" — no new audit mechanism.
- **AGPL-3.0 licensing (flagged here, not purely a legal-department footnote):** Postiz is AGPL-3.0
  (`LICENSE`). **[corrected]** The original version of this document treated this as the highest,
  blocking risk on the assumption that shipping meant running a *modified* Postiz (fork patches for
  connect+analytics). Now that both of those are confirmed to already exist in vanilla Postiz
  (`PZ§27`), the more likely v1 deployment is an **unmodified** self-hosted instance, called only
  over its own documented public API — which is a materially more comfortable position: AGPL's
  network-copyleft clause (§13) is specifically about conveying/running a *modified* version and
  making corresponding source of that version available; a separate, proprietary system (Orlixa)
  calling an unmodified AGPL network service via its own public API is closer to the well-trodden
  "any SaaS calling any other AGPL/GPL-licensed API over the network" pattern, which is not generally
  understood to place copyleft obligations on the *caller's* own codebase. Two things still make this
  worth a real legal look rather than closing it as a non-issue: (1) confirm the running instance is
  and stays genuinely unmodified (the moment the customer-tagging patch from Phase 3 is written, this
  reasoning weakens and the "modified version" analysis applies again to at least that patch); (2)
  the specific arrangement — Orlixa's own UI as the only thing the customer ever sees, orchestrating
  a backend service the customer never directly interacts with — is exactly the kind of "is this
  really a separate program or one combined work" question AGPL §13 exists to test, and that is a
  judgment call for counsel, not an engineering one. Recommend also checking whether Postiz/gitroom
  offers a commercial license for this exact embedding use case (the repo's `CCLA.md`/`ICLA.md` files
  are a signal, not proof, that one might exist). **Still the top item for legal sign-off, but
  downgraded from "blocking, assume the worst" to "needs a real answer, likely resolvable."**

---

## Phase 10 — Final deliverable

### 1. Architecture document
See headline recommendation + the three referenced docs (this file, `postiz-analysis.md`,
`orlixa-current-architecture.md`) — together they are the architecture document.

### 2. Gap analysis

| Gap | Severity | Resolution |
|---|---|---|
| ~~No API-key-authenticated OAuth-connect endpoint~~ **[corrected: resolved, was never actually a gap]** | — | `GET /public/v1/social/:integration` already does this (`PZ§27`) — no work needed |
| ~~No API-key-authenticated analytics endpoint~~ **[corrected: resolved, was never actually a gap]** | — | `GET /public/v1/analytics/*` already exists under `/public/v1` (`PZ§27`) — no work needed |
| Assigning a connected account to a Customer/group is internal-session-only, not public-API (`PZ§27`'s narrow gap) | Medium (was previously conflated with the two above and overstated) | Small additive one-endpoint patch, or a service-account session workaround (Phase 3) |
| Postiz stores access tokens in plaintext (`PZ§16`) | High | If self-hosting a patched fork anyway, add field-level encryption to `Integration.token`/`refreshToken`; otherwise track as an accepted risk of depending on vanilla Postiz and revisit if/when Postiz addresses it upstream |
| Postiz outbound webhooks are unsigned, no-retry (`PZ§13`) | Medium | Always pair with reconciliation polling, never trust the webhook alone; add shared-secret signing only if a fork is already being maintained for the Customer-tagging gap |
| AGPL-3.0 licensing implications of running Postiz (modified or not) as a paid SaaS backend | **High — legal, not engineering — [corrected: downgraded from "highest/blocking" now that no fork is required for v1]** | Legal review before any of this ships to paying customers; check for a commercial license option; keep the "is it still unmodified" question live if the Customer-tagging patch is ever built |
| `InstalledSkill`'s unique-per-provider constraint can't model N accounts of one platform (`OX`'s own finding) | Medium | Resolved by design — new dedicated `SocialAccount` table (Phase 6), not `InstalledSkill` |
| `NOTIFY` workflow node is log-only (`OX` discrepancy #2) | Low-medium | If the Marketing Manager's monthly report or approval-needed alert should ping Slack/email, `NOTIFY` needs real delivery wired first — currently a stub |
| One shared Postiz org serving all Orlixa companies via the `Customer` tag — isolation correctness | High (security) | Needs explicit test coverage during implementation (Phase 9) — this is new cross-tenant-in-a-third-party-system territory Orlixa hasn't had before. **[sharpened]** Now confirmed this is Postiz's own intended pattern for multi-client orgs (`groupList`/`group` filters exist precisely for this, `PZ§27`/`PZ§28`), which raises confidence the mechanism is sound, but Orlixa still owns verifying every one of *its own* calls passes the right `group`/integration id — the isolation guarantee is only as strong as Orlixa's usage of it. |
| Postiz's public-API post-creation rate limit is 90/hour, instance-wide, shared across every Orlixa company (`PZ§25`, confirmed via docs) | Medium-high (capacity planning, not correctness) | Raise `API_LIMIT` on the self-hosted instance to match expected combined volume; add Orlixa-side per-company throttling so one company can't starve the shared ceiling (Phase 9) |

### 3. Integration roadmap (suggested build order — not yet a committed plan, for discussion)

1. Stand up self-hosted Postiz (single instance, one Organization, Docker Compose incl. Temporal
   stack) in a non-production environment; get the **vanilla, unmodified** public API working
   end-to-end manually (connect one real test account via `GET /public/v1/social/:integration`,
   schedule a post via `POST /public/v1/posts`, see it publish, pull analytics back) — **[corrected]**
   this no longer requires any fork/patch step to prove out the core loop.
2. Legal review of the AGPL question, in parallel with (1) so it isn't a late blocker — now scoped
   more narrowly (unmodified-instance posture, see Phase 9), which should make this faster than
   originally framed.
3. Decide and (if needed) build the one narrow Customer-tagging patch (Phase 3) — small enough to
   be its own short spike, not a multi-endpoint fork effort.
4. Backend: `modules/marketing` skeleton + new Prisma tables (Phase 6) + `PostizClientService` +
   the three new queues (Phase 7), no AI employee yet — prove the plumbing with a manual/admin-only
   trigger.
5. AI Marketing Manager employee + tools (Phase 4) + the `AI_STEP → APPROVAL → TOOL_ACTION` workflow
   pattern, wired to the plumbing from step 4.
6. Frontend (Phase 8), screen by screen, in the order a customer would actually hit them: Social
   Accounts → Approvals-preview extension → Campaigns/Calendar → Media Library → Analytics → Brand
   Settings.
7. Reconciliation/analytics polish, monthly report workflow, hardening pass on the security items
   (Phase 9 — including setting `API_LIMIT` for expected combined volume) before general availability.

### 4. Risks
Ranked, most important first:
1. **AGPL licensing** for running Postiz (even unmodified) as the backend of a paid network service
   (Phase 9) — **[corrected: still #1, but lower magnitude than originally stated** now that v1 needs
   no source modification).
2. **Cross-tenant isolation correctness** in the one-shared-Postiz-org design (Phase 9) — a bug class
   Orlixa hasn't had to defend against before (isolation enforced by a third-party system's tagging
   convention, not Orlixa's own `companyId` filtering) — **[sharpened]** confirmed to be Postiz's own
   intended pattern (`PZ§27`/`§28`), which is reassuring about the mechanism but doesn't reduce
   Orlixa's own obligation to use it correctly on every call.
3. **Operational dependency on a whole extra service stack** (Postiz + its Postgres + Temporal + its
   own Postgres + Elasticsearch, `PZ§26`) that Orlixa now has to run, monitor, patch, and upgrade —
   this is a real new piece of infrastructure, not a library import.
4. **Unsigned/no-retry Postiz webhooks** mean "post published" notifications are best-effort;
   reconciliation polling is required, not optional, or customers will see stale post statuses.
5. **Shared instance-wide rate limit (90/hour for post-creation, `PZ§25`)** across every Orlixa
   company — needs capacity planning and Orlixa-side per-company throttling, or one customer's burst
   degrades service for all others. **[new, added after confirming the exact numbers in the docs.]**
6. **[corrected — downgraded, not removed]** Depending on the one narrow internal-only route
   (Customer-tagging, if patched per Phase 3) means depending on an unversioned internal API shape
   that could silently change on a Postiz upstream bump — a real but now much smaller-surface-area
   risk than the original draft's "the whole connect+analytics surface is unstable internal API."

### 5. Required refactoring
- Orlixa side: none of the *existing* modules need refactoring — the design deliberately reuses
  `AiEmployee`/`Skill`/`ApprovalRequest`/`Workflow`/`common/resilience` as-is. The only structural
  addition is the new `modules/marketing` module and its tables.
- Postiz side: **[corrected]** none required to reach a working v1 — connect and analytics are
  already public-API reachable. Optional, if a fork is taken on anyway: one endpoint for
  Customer-tagging at connect-time, field-level encryption for `Integration.token`/`refreshToken`,
  and webhook signing — all "nice to have hardening," none "must build to make it work."

### 6. Development phases
See "Integration roadmap" above — same list, framed as phases 1-7.

### 7. Estimated effort
Given as rough order-of-magnitude only (no team size assumed, no story-pointing done — flag any
of these back if a real estimate is needed): infra stand-up + Postiz fork patches is the highest
unknown (depends entirely on how invasive the fork changes turn out to be once attempted against
real Postiz code, and on the AGPL/legal timeline, which this document cannot estimate). Backend
`modules/marketing` + queues, given how much is reused from existing patterns (Phase 7), is
comparable in size to the smaller existing modules (e.g. `scheduling`, `OX§12`). Frontend is
comparable to the `workflows` or `skills` feature in scope (multiple screens, but all following an
established mirrored pattern). The AI employee + tool wiring is small (Phase 4 reuses the runtime
entirely) once the backend plumbing exists.

### 8. API contracts
Sketched at the level needed for review, not final DTOs:
- `POST /marketing/social-accounts/:provider/connect` → `{ redirectUrl }`
- `GET /marketing/social-accounts` → `SocialAccount[]`
- `POST /marketing/campaigns` / `GET /marketing/campaigns/:id`
- `POST /marketing/posts` (draft) → creates `ScheduledPost` in `DRAFT`, kicks off the approval workflow
- `GET /marketing/posts?status=...` / `GET /marketing/posts/:id`
- `POST /marketing/media` (upload to Orlixa's own `MediaAsset`, not Postiz, until send-time)
- `GET /marketing/analytics/:socialAccountId?range=...`
- `POST /marketing/postiz-webhook` (internal, Postiz → Orlixa, signed once the fork adds signing)
- Postiz-side (consumed, not exposed by Orlixa): `POST /public/v1/posts`, `/upload`,
  `/upload-from-url`, `GET /integrations`, plus the two new additive endpoints.

### 9. Database changes
Phase 6, verbatim: `SocialAccount`, `ScheduledPost`, `PublishedPost`, `Campaign`, `MediaAsset`,
`BrandAsset`, `MarketingAnalyticsSnapshot` — all new, all `companyId`-scoped. No changes to any
existing Orlixa table. No Orlixa access to Postiz's own database at all (by design).

### 10. UI flow
Phase 8's screen list, in the navigation order given there.

### 11. Sequence diagrams
The Phase 5 flow above (Company Signup → ... → Analytics) already *is* the sequence diagram, written
against real primitives rather than a generic example. A second, narrower one for the publish step
specifically:

```
Employee (AgentRuntimeService)      Orlixa API (modules/marketing)      Self-hosted Postiz
        │                                    │                                  │
        │  schedule_post tool call           │                                  │
        ├───────────────────────────────────>│                                  │
        │                                    │  create ApprovalRequest          │
        │                                    │  (workflow pauses, WAITING)      │
        │                                    │                                  │
        │           (manager approves in /approvals UI)                        │
        │                                    │                                  │
        │                                    │  resumeRun → TOOL_ACTION          │
        │                                    │  enqueue marketing-publish-      │
        │                                    │  dispatch job                    │
        │                                    ├─────────────────────────────────>│
        │                                    │  POST /public/v1/posts           │
        │                                    │  {type:'schedule', date, ...}    │
        │                                    │<─────────────────────────────────┤
        │                                    │  {id: postizPostId}              │
        │                                    │  ScheduledPost.status=SCHEDULED  │
        │                                    │                                  │
        │                                    │      ... time passes ...         │
        │                                    │                                  │
        │                                    │        Postiz's own Temporal     │
        │                                    │        engine wakes up and       │
        │                                    │        publishes to the real     │
        │                                    │        platform (PZ§22)          │
        │                                    │<─────────────────────────────────┤
        │                                    │  webhook: post published         │
        │                                    │  (+ reconciliation poll backstop)│
        │                                    │  PublishedPost created           │
```

### 12. Migration strategy
No migration in the "moving existing data" sense — this is greenfield for Orlixa (new tables, no
existing marketing data to migrate). The real "migration" is operational: standing up the self-hosted
Postiz instance and fork in a lower environment first (roadmap step 1), proving the manual flow
before any Orlixa code depends on it, and only then wiring the AI employee on top — so a failure at
any layer is caught before customer-facing rollout, not discovered in production.

---

## Open items needing a decision before implementation starts (not resolved by this document)

1. **AGPL legal review** — still needed, though **[corrected]** narrower in scope now (unmodified-
   instance posture) than originally framed (Phase 9/Risks #1).
2. ~~Analytics endpoint gap~~ **[resolved]** — confirmed to already exist under `/public/v1`
   (`PZ§27`); no design pass needed, just wire `PostizClientService` to it.
3. ~~Image/video generation~~ **[resolved]** — Postiz's own `/public/v1/generate-image`,
   `/generate-video`, `/video/function` endpoints cover this (`PZ§27`/`§28`); no new Orlixa-side
   provider needed, corrected in Phase 4's tool list.
4. **`NOTIFY` node real delivery** — only needed if the Marketing Manager should push alerts
   (approval-needed, monthly report ready) somewhere beyond the in-app approvals queue.
5. **Customer-tagging patch: build it, or use the session-bridge workaround?** **[new]** — the one
   remaining real Postiz-side decision (Phase 3): a small additive endpoint (cleaner, but is a fork)
   vs. an internal service-account session call (no fork, but depends on an unversioned internal
   route). Needs a decision before Phase 7 implementation of the connect flow.
6. **MCP vs. REST, revisit later?** **[new]** — v1 recommendation is REST (Phase 3), since Orlixa has
   no MCP-client infrastructure today and would still need an approval-gate interception layer either
   way. Worth a fresh look only if Orlixa separately decides to become a general-purpose MCP client for
   reasons beyond this one integration.
