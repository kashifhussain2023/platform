# Postiz Architecture Analysis

Source analyzed: full clone of `gitroomhq/postiz-app` at
`C:\Users\Admin\AppData\Local\Temp\claude\postiz-src`. All file paths below are relative to
that repo root. Everything here was read directly from source — where something could not be
verified, it says so explicitly rather than guessing. Purpose: decide what to reuse/rewrite when
building a "Postiz-powered" publishing capability inside Orlixa/V-AEP as a wrapped AI Marketing
Employee service.

---

## 1. Overall architecture

Postiz is an **Nx-less pnpm workspace monorepo** (`pnpm-workspace.yaml`: `apps/*`, `libraries/*`;
`package.json` still ships an `nx.json`-shaped script set but the actual task runner is plain
`pnpm --filter`). Node engine pinned to `>=22.12.0 <23`.

Apps (`apps/*`), each an independent deployable:
- **`apps/backend`** — NestJS API (Express platform). The monolith: REST controllers, auth,
  billing, media, DTO validation, Swagger. This is where the frontend and the public API talk to.
- **`apps/frontend`** — Next.js 16 / React 19 app (calendar UI, editor, settings, billing UI).
- **`apps/orchestrator`** — a **separate Temporal worker process**. Hosts the actual publishing
  workflows/activities (`workflows/*.ts`, `activities/*.ts`). This is the most surprising piece
  architecturally (see §9).
- **`apps/commands`** — a `nestjs-command` CLI process for one-off/cron-adjacent tasks
  (`tasks/refresh.tokens.ts`, `tasks/configuration.ts`, `tasks/agent.run.ts`). Meant to be invoked
  externally (shell/k8s CronJob), not scheduled in-process.
- **`apps/extension`** — a Chrome extension (cookie-based auth for platforms with no public API,
  e.g. Skool; also used to relay Temporal task-queue-style browser actions).
- **`apps/sdk`** — a ~95-line thin HTTP client (`apps/sdk/src/index.ts`) wrapping the public API
  (`/public/v1/posts`, `/public/v1/upload`, `/public/v1/integrations`). This is effectively
  Postiz's own "how to integrate as a 3rd party" reference implementation.

Libraries (`libraries/*`), imported via TS path aliases (`@gitroom/...`), not published packages:
- **`libraries/nestjs-libraries/src`** — the actual meat: Prisma schema + per-model services,
  all 34 social-provider integrations, OAuth machinery, upload/storage, Temporal module glue,
  newsletter/short-link providers, AI ("agent"/"chat"/"openai") code, Stripe billing.
  Consumed by **both** `apps/backend` and `apps/orchestrator` — this is the shared domain layer.
- **`libraries/helpers/src`** — small stateless utilities (JWT helpers, timers, subdomain
  cookie logic, config checker).
  `libraries/helpers/src/auth/auth.service.ts` is the actual JWT sign/verify implementation used by the backend's `AuthService`.
- **`libraries/react-shared-libraries/src`** — shared React components/hooks used by both
  `apps/frontend` and `apps/extension`.

**What talks to what:** Frontend → Backend REST API (cookie/header JWT) → Prisma/Postgres +
Redis (ephemeral OAuth state) directly, and → Temporal server (to enqueue/inspect publishing
workflows) via `nestjs-temporal-core`. The Orchestrator worker process independently connects to
the same Postgres (via the same Prisma services, imported straight from
`nestjs-libraries`) and to the same Temporal server, and does the actual outbound HTTP calls to
X/LinkedIn/etc. **There is no separate "publishing microservice" REST boundary** — the
orchestrator is a Temporal worker sharing the backend's own service/repository classes in-process,
not a network service you call over HTTP. The one real network-callable seam is the public API
(`/public/v1/*`, see §12/§22 and the SDK).

**Reuse verdict:** The workspace shape (apps vs. shared libraries, path-aliased imports) is a
reasonable pattern to mirror — reuse with modification (would need adapting to whatever monorepo
tool V-AEP already uses). The backend+orchestrator coupling via shared in-process services is
**not** a clean integration boundary for a "plug this into another SaaS" use case — see §22 for
the practical seam to target instead.

---

## 2. Folder structure (annotated)

```
apps/
  backend/src/
    api/routes/            REST controllers (auth, posts, integrations, media, webhooks, billing…)
    public-api/routes/v1/  The externally-documented API (public.integrations.controller.ts)
    services/auth/         JWT middleware, CASL permissions/guard, OAuth-login providers (Google/GitHub/Farcaster/Wallet)
    assets/                Static/email templates(ish)
  orchestrator/src/
    workflows/             Temporal workflow functions (deterministic, no I/O directly)
    workflows/post-workflows/  5 versioned iterations of the publish workflow (v1.0.1 → v1.0.5, latest wired up)
    activities/            Temporal activities — the actual I/O (DB, provider APIs, email)
    signals/               Temporal signal defs (e.g. digest email signal)
  commands/src/tasks/      CLI tasks: refresh.tokens.ts, configuration.ts (env sanity check), agent.run.ts
  frontend/src/
    app/(app)/…            Main authenticated Next.js app router tree
    app/(provider)/…       Per-provider connect/callback pages
    app/(extension)/…      Chrome-extension-specific pages
    components/            One folder per feature area (launches, billing, webhooks, plugs, agents…)
  sdk/src/index.ts         Minimal public-API HTTP client (reference 3rd-party integration)
  extension/src/           Chrome extension (manifest, background scripts) for cookie-auth platforms
libraries/
  nestjs-libraries/src/
    database/prisma/       schema.prisma + one service+repository pair per domain model
    integrations/social/   All 34 social-platform provider classes + the shared interface/abstract
    integrations/          integration.manager.ts (provider registry), refresh.integration.service.ts
    temporal/              Temporal module wiring, per-provider task-queue registration, search attrs
    auth (n/a — auth lives in apps/backend/src/services/auth, not here)
    upload/                Storage backends: local.storage.ts, cloudflare.storage.ts, r2.uploader.ts
    redis/redis.service.ts Single ioredis client (falls back to an in-memory mock if no REDIS_URL)
    newsletter/, short-linking/  Pluggable provider interfaces for email newsletters & link shorteners
    chat/, agent/, openai/  Copilot/agent/AI-generation features (LangChain/LangGraph/Mastra-based)
    services/exception.filter.ts  Global HTTP exception filter
    throttler/              Redis-backed NestJS throttler storage
  helpers/src/              JWT sign/verify, misc utils, Swagger loader, config checker
  react-shared-libraries/src/  Shared UI primitives
dynamicconfig/              Temporal server dynamic config (used by docker-compose's Temporal stack)
var/docker/                 Docker image build scripts
```

**Reuse verdict:** the `database/prisma/<model>/` (one service + one repository class per domain)
pattern is clean and reuse-worthy as-is if the target platform is also NestJS+Prisma.

---

## 3. Authentication system

JWT-based, stateless (no server-side session store). Implementation:
- `libraries/helpers/src/auth/auth.service.ts` — `AuthService.signJWT` / `verifyJWT` (wraps
  `jsonwebtoken`, secret from `process.env.JWT_SECRET`), plus `comparePassword` (bcrypt).
- `apps/backend/src/services/auth/auth.service.ts` (`AuthService`, distinct class, same name) —
  the actual login/register orchestration: local email+password, or a Provider enum
  (`LOCAL | GITHUB | GOOGLE | FARCASTER | WALLET | GENERIC`) via
  `apps/backend/src/services/auth/providers/*.provider.ts` + `providers.manager.ts`.
- `apps/backend/src/services/auth/auth.middleware.ts` (`AuthMiddleware`) — reads JWT from the
  `auth` header or `auth` cookie, **verifies signature only**, then **re-resolves the full user
  from Postgres by id** rather than trusting claims in the token body (explicit comment in code
  warns against trusting `isSuperAdmin`/`activated` from the JWT payload). Also resolves which
  `Organization` the request is scoped to (`showorg` cookie/header, defaulting to the user's
  first org) and attaches both `req.user` and `req.org`.
- Supports super-admin **impersonation** via an `impersonate` cookie/header (only if
  `user.isSuperAdmin`).
- `removeAuth()` in the same file clears the cookie for logout (`secure/httpOnly/sameSite:none`
  in production, relaxed if `NOT_SECURED` env is set for local dev).

No session table in Prisma, no refresh-token-for-login concept — the login JWT itself has no
visible expiry check in `verifyJWT` beyond what `jsonwebtoken` enforces from `signJWT`'s options
(not fully inspected here, but activation/expiry-style checks that exist, e.g. `forgot`/`activate`,
are done with a separate manually-embedded `expires`/`timeLimit` field checked in application code
with `dayjs`, not JWT `exp`).

**Reuse verdict:** reuse with modification — the "trust only the id, re-resolve from DB" pattern
is good practice and worth keeping; the org-switch-via-cookie multi-org model is Postiz-specific
and would need to map onto V-AEP's own tenant model.

---

## 4. OAuth implementation (generic machinery)

Two **distinct** OAuth systems exist in this codebase — don't conflate them:

**(a) Social-provider-connect OAuth** (Postiz-as-OAuth-client, connecting a user's X/LinkedIn/etc.
account) — this is *not* one generic reusable class; each provider implements
`generateAuthUrl()` / `authenticate()` per the `IAuthenticator` interface
(`libraries/nestjs-libraries/src/integrations/social/social.integrations.interface.ts`). The
*shared* plumbing that **is** generic:
  - Redis is used purely as short-lived state storage for the OAuth dance: keys like
    `login:{state}` (code verifier), `organization:{state}`, `external:{state}`,
    `refresh:{state}`, `onboarding:{state}` — all read/deleted in
    `apps/backend/src/api/routes/no.auth.integrations.controller.ts`
    (`connectSocialMedia`, `POST /integrations/social-connect/:integration`).
  - `IntegrationManager.getSocialIntegration(identifier)` looks up the right provider instance
    from the static `socialIntegrationList` array
    (`libraries/nestjs-libraries/src/integrations/integration.manager.ts`).
  - `NotEnoughScopesFilter` (`libraries/nestjs-libraries/src/integrations/integration.missing.scopes.ts`)
    is a Nest `ExceptionFilter` specifically for provider scope errors.
  - Each provider's PKCE/verifier/state handling is bespoke (e.g. X uses old-style OAuth1
    `oauth_token:oauth_token_secret` packed into the `codeVerifier` field, see §5 evidence below).

**(b) Postiz-as-OAuth-server** (3rd parties can register an "OAuth App" against a Postiz org and
get delegated access) — this one **is** a clean, generic implementation:
  `apps/backend/src/api/routes/oauth.controller.ts` (`OAuthController`,
  `OAuthAuthorizedController`) implements a standard authorization-code flow: `GET /oauth/authorize`
  (validate client_id, show consent), `POST /oauth/authorize` (issue code), `POST /oauth/token`
  (exchange code+secret for token; only `authorization_code` grant supported — no refresh grant
  implemented). Backed by `OAuthService`
  (`libraries/nestjs-libraries/src/database/prisma/oauth/oauth.service.ts`) and the
  `OAuthApp`/`OAuthAuthorization` Prisma models (§7).

**Reuse verdict:** (a) reuse with modification per-provider (there is no single "OAuth2 generic
class" to lift out — expect to re-derive one, using Postiz's providers as a reference for each
platform's quirks). (b) reuse as-is if V-AEP needs to expose its own OAuth-app-style delegated
API access — it's a small, self-contained, standard implementation.

---

## 5. Social provider integrations

All under `libraries/nestjs-libraries/src/integrations/social/`. Every provider implements the
`SocialProvider` interface (`social.integrations.interface.ts`, extending `IAuthenticator` +
`ISocialMediaIntegration`) and extends the `SocialAbstract` base class
(`libraries/nestjs-libraries/src/integrations/social.abstract.ts`, which defines
`NotEnoughScopes`/`RefreshToken` custom exception types and shared HTTP-fetch helpers).

Key interface members every provider must supply (`social.integrations.interface.ts`):
```ts
export interface SocialProvider extends IAuthenticator, ISocialMediaIntegration {
  identifier: string;
  scopes: string[];
  editor: 'none' | 'normal' | 'markdown' | 'html';
  maxLength: (additionalSettings?: any) => number;
  checkValidity(posts, settings, additionalSettings): Promise<string | true>;
  isBetweenSteps: boolean;
  // + optional: comment(), analytics(), postAnalytics(), refreshCron, refreshWait, mention(), …
}
```
`IAuthenticator.authenticate()` / `generateAuthUrl()` / `refreshToken()` are the OAuth entry
points; `ISocialMediaIntegration.post()` / `comment()` are the publish entry points.

Evidence from a real provider (`x.provider.ts`, `XProvider extends SocialAbstract implements
SocialProvider`, `identifier = 'x'`): `generateAuthUrl()` builds an old-style OAuth1 3-legged link
via `twitter-api-v2`'s `TwitterApi.generateAuthLink`, packs `oauth_token:oauth_token_secret` into
`codeVerifier`; `authenticate()` unpacks it and calls `client.v2.me()` to fetch the profile.

The **registry** (`integration.manager.ts`, `socialIntegrationList` array) instantiates one object
per provider — this array is also reused by `apps/orchestrator/src/../temporal.module.ts` to
auto-derive one Temporal task queue per provider (see §9/§10).

**Reuse verdict (per-integration, category-level):** reuse as-is for any of the 34 already-built
platforms if V-AEP needs that exact platform (the request/response wiring against each vendor API
is the expensive part to rebuild from scratch); rewrite the registry/DI plumbing to fit V-AEP's
own DI container if not using Nest.

---

## 6. Supported social platforms (definitive list)

Cross-checked directly against the files in
`libraries/nestjs-libraries/src/integrations/social/*.provider.ts` **and** their registration in
`integration.manager.ts`'s `socialIntegrationList` (34 active entries; one file present but
commented out of the list):

| # | Identifier / file | Class | Notes |
|---|---|---|---|
| 1 | `x.provider.ts` | XProvider | Twitter/X, OAuth1-style via `twitter-api-v2` |
| 2 | `linkedin.provider.ts` | LinkedinProvider | Personal profile |
| 3 | `linkedin.page.provider.ts` | LinkedinPageProvider | Company page variant |
| 4 | `reddit.provider.ts` | RedditProvider | |
| 5 | `instagram.provider.ts` | InstagramProvider | Via Facebook Graph API (business) |
| 6 | `instagram.standalone.provider.ts` | InstagramStandaloneProvider | Direct IG login (non-FB-linked) |
| 7 | `facebook.provider.ts` | FacebookProvider | |
| 8 | `threads.provider.ts` | ThreadsProvider | |
| 9 | `youtube.provider.ts` | YoutubeProvider | via `googleapis` |
| 10 | `gmb.provider.ts` | GmbProvider | Google My Business |
| 11 | `tiktok.provider.ts` | TiktokProvider | |
| 12 | `pinterest.provider.ts` | PinterestProvider | |
| 13 | `dribbble.provider.ts` | DribbbleProvider | |
| 14 | `discord.provider.ts` | DiscordProvider | Bot-token based |
| 15 | `slack.provider.ts` | SlackProvider | |
| 16 | `kick.provider.ts` | KickProvider | |
| 17 | `twitch.provider.ts` | TwitchProvider | |
| 18 | `mastodon.provider.ts` | MastodonProvider | Instance URL configurable |
| 19 | `bluesky.provider.ts` | BlueskyProvider | AT Protocol, `@atproto/api` |
| 20 | `lemmy.provider.ts` | LemmyProvider | |
| 21 | `farcaster.provider.ts` | FarcasterProvider | Web3 (`isWeb3`), `@neynar/*` |
| 22 | `telegram.provider.ts` | TelegramProvider | Bot API, `node-telegram-bot-api` |
| 23 | `nostr.provider.ts` | NostrProvider | Web3, `nostr-tools` |
| 24 | `vk.provider.ts` | VkProvider | |
| 25 | `medium.provider.ts` | MediumProvider | Article/blog platform |
| 26 | `dev.to.provider.ts` | DevToProvider | Article/blog platform |
| 27 | `hashnode.provider.ts` | HashnodeProvider | Article/blog platform (+ `hashnode.tags.ts` static tag list) |
| 28 | `wordpress.provider.ts` | WordpressProvider | Self-hosted URL, SSRF-guarded |
| 29 | `listmonk.provider.ts` | ListmonkProvider | Also has a separate newsletter-provider variant (§ below) |
| 30 | `moltbook.provider.ts` | MoltbookProvider | |
| 31 | `whop.provider.ts` | WhopProvider | |
| 32 | `skool.provider.ts` | SkoolProvider | Cookie/extension-based (`isChromeExtension`) |
| 33 | `mewe.provider.ts` | MeweProvider | |
| 34 | `tumblr.provider.ts` | TumblrProvider | |
| — | `mastodon.custom.provider.ts` | MastodonCustomProvider | **File exists but is commented out** of `socialIntegrationList` (`// new MastodonCustomProvider()`) — present in source, not currently active. |

Separately, **newsletter** platforms (different abstraction, `INewsletterProvider`, not
`SocialProvider`) live in `libraries/nestjs-libraries/src/newsletter/providers/`:
`beehiiv.provider.ts`, `listmonk.provider.ts` (a second implementation), `email-empty.provider.ts`
(no-op fallback). And **link-shortener** integrations (`ILinkShortener`) in
`libraries/nestjs-libraries/src/short-linking/providers/`: `dub.ts`, `kutt.ts`, `short.io.ts`,
`linkdrip.ts`, `empty.ts`.

**Reuse verdict:** treat the 34-platform social list as the real, load-bearing count — marketing
pages sometimes round this up/down; this list was derived from the actual registry, not the
website.

---

## 7. Database schema

Single file: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` (970 lines,
PostgreSQL, `@prisma/client` 6.5.0). Core models (relationships as declared):

- **`Organization`** — the tenant root. Has `apiKey`, `paymentId`/`Subscription`, `streakSince`,
  `shortlink` preference enum. Owns almost everything: `Integration[]`, `Post[]` (2 relations:
  `organization` and `submittedForOrg` for marketplace-style cross-org submission), `Media[]`,
  `Webhooks[]`, `Signatures[]`, `Sets[]`, `Tags[]`, `ThirdParty[]`, `Plugs[]`, `Credits[]`,
  `Comments[]`, `Errors[]`, `Notifications[]`, `UsedCodes[]`, `GitHub[]`, `OAuthApp[]`,
  `OAuthAuthorization[]`.
- **`User`** — `providerName: Provider` enum (`LOCAL|GITHUB|GOOGLE|FARCASTER|WALLET|GENERIC`),
  `isSuperAdmin`, per-user email-notification toggles (`sendSuccessEmails`,
  `sendFailureEmails`, `sendStreakEmails`). Unique on `[email, providerName]` (same email can
  exist once per provider). Many-to-many with `Organization` via **`UserOrganization`**
  (join table carrying `role: Role` enum `SUPERADMIN|ADMIN|USER` and `disabled: Boolean`).
- **`Integration`** — one connected social/channel account. `providerIdentifier` (matches the
  `identifier` string on the provider class), `token`/`refreshToken`/`tokenExpiration`,
  `disabled`, `refreshNeeded`, `inBetweenSteps` (mid-reconnect state), `postingTimes` (JSON string,
  default 3 slots/day), `customerId` (optional link to a `Customer` sub-entity for
  agency/white-label use), `rootInternalId` (for provider reconnect chains, e.g. LinkedIn
  page re-auth). Indexed on `organizationId`, `providerIdentifier`, `refreshNeeded`, `disabled`,
  etc. — clearly built for the refresh-sweep query pattern.
- **`Post`** — `state: State` enum (`QUEUE|PUBLISHED|ERROR|DRAFT`), `publishDate`,
  `organizationId`, `integrationId`, `content`, `group` (groups sibling posts scheduled together
  across channels), `parentPostId`/`childrenPost` self-relation (thread/comment chains),
  `intervalInDays` (repeat-post support), `creationMethod: CreationMethod` enum
  (`UNKNOWN|WEB|MCP|API|AUTOPOST|CLI` — tells you how the post was created), `settings` (JSON
  string, per-provider post options), `releaseId`/`releaseURL` (the platform's own post id/url
  after publish), `error` (last failure message). Marketplace fields:
  `submittedForOrderId`/`submittedForOrganizationId`/`approvedSubmitForOrder`.
- **`Errors`** — per-post publish failure log (`platform`, `message`, `body` JSON).
- **`Webhooks`** + **`IntegrationsWebhooks`** (join table) — org-level outbound webhooks,
  optionally scoped to specific integrations.
- **`OAuthApp`** + **`OAuthAuthorization`** — the Postiz-as-OAuth-server models (§4b):
  `clientId`/`clientSecret`, `redirectUrl`; authorizations carry `accessToken`,
  `authorizationCode`, `codeExpiresAt`, `revokedAt`.
- **Billing:** `Subscription` (`subscriptionTier: STANDARD|PRO|TEAM|ULTIMATE`, `period:
  MONTHLY|YEARLY`, `totalChannels`, `isLifetime`), `Credits` (AI-image credit ledger).
- **Marketplace/agency (a whole sub-domain):** `SocialMediaAgency`, `Customer`, `Orders`,
  `OrderItems`, `MessagesGroup`/`Messages` (buyer↔seller chat), `PayoutProblems`. This looks like
  a "hire an agency to manage your socials" marketplace feature bolted onto the core scheduler.
- **Misc:** `Tags`/`TagsPosts`, `Sets` (reusable post templates), `AutoPost` (RSS-style
  auto-posting config), `Plugs`/`ExisingPlugData` (post-publish automation, e.g. auto-repost),
  `Trending`/`TrendingLog`/`PopularPosts` (content-idea features), `Announcement`, `Mentions`
  (cached @mention lookups), `ItemUser` (generic per-user key/value flags).
- **AI/agent observability (Mastra framework tables):** `mastra_ai_spans`, `mastra_evals`,
  `mastra_messages`, `mastra_resources`, `mastra_scorers`, `mastra_threads`, `mastra_traces`,
  `mastra_workflow_snapshot` — these back the in-app AI copilot/agent chat feature, not core
  publishing.

**Reuse verdict:** the core `Organization → Integration → Post` shape is directly reusable as a
reference model (reuse with modification — you'd trim the marketplace/agency/Mastra tables which
are unrelated to pure publishing). `Integration.providerIdentifier` + JSON `settings`/`postingTimes`
strings are a reasonable "one row per connected channel" design to copy.

---

## 8. Scheduling engine

A scheduled post is a `Post` row with `state = 'QUEUE'` and a `publishDate: DateTime`. There is
**no separate "scheduled jobs" table** — the row itself *is* the schedule. "Time to publish" is
decided by a **Temporal workflow sleeping until that timestamp**, not by a poller scanning the DB
for due rows (see `postWorkflowV105` below) — though a poller *does* exist as a safety net (§10).

Flow: `PostsService.createPost()` (creates/updates the `Post` row) calls
`PostsService.startWorkflow(taskQueue, postId, orgId, state)`
(`libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts:694`). This:
1. Terminates any already-running Temporal workflow for that `postId` (idempotent reschedule).
2. If `state === 'DRAFT'`, stops here (no workflow started for drafts).
3. Otherwise starts workflow `postWorkflowV105` with `workflowId: post_${postId}`,
   `workflowIdConflictPolicy: 'TERMINATE_EXISTING'` — args carry a **provider-specific
   `taskQueue`** (derived from `integration.providerIdentifier`, e.g. `'x'`, `'linkedin'`) plus
   the generic launcher queue `'main'`.

Inside the workflow (`apps/orchestrator/src/workflows/post-workflows/post.workflow.v1.0.5.ts`):
```ts
if (!postNow) {
  await sleep(dayjs(firstPost.publishDate).isBefore(dayjs())
    ? 0
    : dayjs(firstPost.publishDate).diff(dayjs(), 'millisecond'));
}
```
i.e. it literally durably sleeps (a Temporal workflow timer, survives worker restarts) until
`publishDate`, then proceeds to publish. 5 successive workflow versions exist in
`post-workflows/` (`v1.0.1` … `v1.0.5`); only `v1.0.5` is wired into `startWorkflow` — the others
are retained (Temporal requires old workflow code to stay deployed while any old execution history
might still reference it, a normal Temporal versioning practice) but not the current code path.

**Reuse verdict:** rewrite for a non-Temporal target (this is the single most Temporal-coupled
piece of the whole codebase) but the underlying *design* — "the schedule sleeps, doesn't poll,
falls back to a periodic reconciliation sweep" — is worth keeping conceptually with BullMQ delayed
jobs or a DB-poll+lock pattern instead.

---

## 9. Queue system

**There is no BullMQ / Redis-queue library in this codebase** (confirmed: no `bullmq`,
`@nestjs/bull`, or similar package in `package.json`, and no matches anywhere in the source tree).
This is a notable divergence from what a lot of Postiz write-ups/forks assume. Redis is used only
as an ephemeral key/value store for OAuth state (§4) and as the NestJS throttler's storage backend
(`libraries/nestjs-libraries/src/throttler/throttler.provider.ts`, `@nest-lab/throttler-storage-redis`).

The actual "queue" is **Temporal** (`temporalio` SDK + `nestjs-temporal-core` wrapper), run as a
full external service stack (`docker-compose.yaml`: `temporal`, `temporal-postgresql`,
`temporal-elasticsearch`, `temporal-ui`, `temporal-admin-tools`). Concepts:
- **Task queues** — one per social provider identifier (`x`, `linkedin`, `reddit`, …), auto-derived
  from `socialIntegrationList` in
  `libraries/nestjs-libraries/src/temporal/temporal.module.ts`, plus a generic `main` queue for
  launcher/utility workflows (streak, digest email, missing-post sweep, autopost).
- **Per-provider concurrency caps**: each provider can declare `maxConcurrentJob`; the module
  divides that cap by `WORKER_CONCURRENCY_DIVIDER` (for horizontally-scaled workers sharing a
  queue) and supports `EXCLUDE_QUEUE` env to pin low-concurrency-limit providers (e.g. reddit,
  twitch) to one dedicated server.
- **Workflows enqueued:** `postWorkflowV105` (per-post publish, §8), `autoPostWorkflow` (RSS-style
  auto-posting, hourly loop), `refreshTokenWorkflow` (per-integration, sleeps until token expiry
  then refreshes — §17), `streakWorkflow` (gamification email reminder), `missingPostWorkflow`
  (hourly safety-net sweep, §10/§11), `digestEmailWorkflow`/`sendEmailWorkflow` (async email).
- **Retry policy** is declared per `proxyActivities` call, uniformly
  `{ maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes' }` across essentially
  every workflow file — i.e. 3 attempts, 2-minute fixed (non-exponential, coefficient 1) delay.

**Reuse verdict:** rewrite/ignore for reuse purposes unless V-AEP is willing to adopt Temporal as
infrastructure — it's a powerful but heavyweight choice (a whole extra service stack: Temporal
server + its own Postgres + Elasticsearch + UI) for "schedule a post and retry on failure." A
BullMQ-based reimplementation of the same *behavior* (delayed job = sleep-until-publishDate, retry
policy = 3 attempts / fixed backoff, one queue per provider for concurrency isolation) is very
achievable and much lighter-weight if adopting this pattern rather than the literal code.

---

## 10. Workers / cron jobs

**No in-process `@nestjs/schedule` `@Cron` decorators exist anywhere in the codebase** (grepped
`apps/` and `libraries/` — zero matches), despite `@nestjs/schedule` being a listed dependency.
"Cron-like" behavior is implemented two ways instead:
1. **Long-running Temporal workflows that `sleep()` in a loop** — this *is* the cron mechanism.
   E.g. `missingPostWorkflow` (`apps/orchestrator/src/workflows/missing.post.workflow.ts`):
   ```ts
   export async function missingPostWorkflow() {
     await searchForMissingThreeHoursPosts();
     while (true) {
       await sleep('1 hour');
       await searchForMissingThreeHoursPosts();
     }
   }
   ```
   This is the safety-net sweep: it re-signals (`workflow.signalWithStart`, `USE_EXISTING`
   conflict policy) any post whose workflow may have been lost/missed, restarting
   `postWorkflowV105` for it (`PostActivity.searchForMissingThreeHoursPosts`,
   `apps/orchestrator/src/activities/post.activity.ts:74`).
2. **External CLI invocation** via `apps/commands` (`nestjs-command`): `refresh.tokens.ts` (command
   name `refresh`) calls `IntegrationService.refreshTokens()` for a batch refresh sweep — meant to
   be triggered by an *external* scheduler (OS cron / k8s CronJob), not scheduled by the app itself.

The orchestrator worker process itself is started via `nestjs-temporal-core`'s worker registration
(`getTemporalModule(isWorkers=true, …)` in `temporal.module.ts`), one Temporal Worker per task
queue, each polling its queue continuously — this is the actual "worker process" in the classic
queue-worker sense.

**Reuse verdict:** ignore the Temporal-loop cron pattern if not adopting Temporal; the "external
CLI + scheduler" pattern for token refresh is simple and reusable as-is regardless of stack.

---

## 11. Background processing

Beyond scheduling/queueing, other async work:
- **Digest / streak emails** — `digest.email.workflow.ts`, `send.email.workflow.ts`,
  `streak.workflow.ts` (gamification: reminds a user 2h before they'd lose their "posting streak,"
  `apps/orchestrator/src/workflows/streak.workflow.ts`).
- **Webhook fan-out** — `PostActivity.sendWebhooks` (§13) fires-and-forgets `fetch()` calls to all
  matching `Webhooks` rows after a successful publish, swallowing individual failures
  (`catch { /**empty**/ }` — no retry, no dead-letter).
- **Plugs** (`Plugs`/`ExisingPlugData` models) — post-publish automations (e.g. auto-repost to
  another channel, or a "global plug" that fires N times after a delay) processed inline at the
  end of `postWorkflowV105`, itself running as a Temporal child workflow for infinite repeat-posts
  (`startChild(postWorkflowV105, { parentClosePolicy: 'ABANDON', ... })`).
- **AI generation** — `AgentGraphService.start()` (LangGraph-based, streamed via chunked JSON over
  an HTTP response in `PostsController.generatePosts`) and a Mastra-based chat/copilot subsystem
  (`libraries/nestjs-libraries/src/chat/`, `agent/`) — separate from publishing, not further
  traced here as it's out of scope for the publishing-capability question.

**Reuse verdict:** ignore (streak/gamification, AI copilot) unless explicitly wanted; the
fire-and-forget webhook pattern is simple but has **no retry/backoff and no delivery guarantee** —
would need hardening (signature, retry, dead-letter) if reused.

---

## 12. API structure

`apps/backend/src/api/routes/*.controller.ts` — 27 controllers. Representative ones (route
prefixes from `@Controller(...)`):

| Controller | Prefix | High-level routes |
|---|---|---|
| `auth.controller.ts` | `/user` (per file, not shown fully) | login/register/forgot/activate |
| `oauth.controller.ts` | `/oauth` | `GET /authorize`, `POST /authorize`, `POST /token` (Postiz-as-OAuth-server, §4b) |
| `oauth-app.controller.ts` | `/oauth-apps`(ish) | CRUD for registered OAuth apps |
| `integrations.controller.ts` | `/integrations` | `GET /list`, `GET /:id`, `POST /provider/:id/connect`, `POST /:id/settings`, `POST /:id/time`, `POST /disable`/`enable`, `GET /:id/plugs`, `POST /:id/plugs`, `GET /telegram/updates`, `POST /moltbook/register` |
| `no.auth.integrations.controller.ts` | `/integrations` | `GET /` (list all providers, unauthenticated metadata), `POST /social-connect/:integration` (OAuth callback landing, §4a), `POST /public/provider/:id/connect`, `POST /extension-refresh` |
| `posts.controller.ts` | `/posts` | `GET /`, `POST /` (create+validate+schedule), `PUT /:id/date` (reschedule), `DELETE /:group`, `GET /find-slot`, `POST /generator` (AI draft, streamed), `GET /:id/statistics` |
| `media.controller.ts` | `/media` | `POST /upload-server`, `POST /upload-simple`, `POST /:endpoint` (R2 multipart relay), `POST /generate-image`, `POST /generate-video`, `GET /` |
| `webhooks.controller.ts` | `/webhooks` | `GET /`, `POST /`, `PUT /`, `DELETE /:id`, `POST /send` |
| `analytics.controller.ts` | `/analytics` | `GET /:integration`, `GET /post/:postId` |
| `billing.controller.ts` | `/billing`(ish) | Stripe checkout/portal/subscription management |
| `stripe.controller.ts` | `/stripe` | Stripe webhook receiver |
| `admin.controller.ts` | `/admin` | Superadmin-only ops |
| `third-party.controller.ts` | `/third-party`(ish) | External integrations not in the social list |
| `public-api/routes/v1/public.integrations.controller.ts` | `/public/v1` | `POST /upload`, `POST /upload-from-url`, (+ posts/integrations endpoints per SDK usage in §22) — **the documented external API, API-key authenticated** |

Validation is via `class-validator` DTOs + a global `ValidationPipe({ transform: true })`
(`apps/backend/src/main.ts`). Swagger is wired via `loadSwagger(app)`
(`libraries/helpers/src/swagger/load.swagger.ts`, not fully traced but present).

**Reuse verdict:** reuse with modification — standard Nest REST-controller-per-domain shape,
directly portable if the target stack is also Nest; otherwise use as a reference route/DTO list.

---

## 13. Webhook handling

**Outbound (Postiz → external URL), on publish success:**
`PostActivity.sendWebhooks(postId, orgId, integrationId)`
(`apps/orchestrator/src/activities/post.activity.ts:315`) — looks up all `Webhooks` for the org
whose `integrations` filter is empty (fires for all channels) or includes the specific
`integrationId`, then does a bare `fetch(webhook.url, { method: 'POST', body: JSON.stringify(post) })`
per webhook, silently swallowing errors. No HMAC signature, no retry, no delivery log beyond
whatever the receiver's own logs show.

**Inbound webhooks Postiz receives:**
- **Stripe webhook** — `stripe.controller.ts` (raw-body signature verification via
  `STRIPE_SIGNING_KEY`/`STRIPE_SIGNING_KEY_CONNECT` env vars, `app.create(AppModule, { rawBody:
  true })` in `main.ts` enables this).
- **Provider OAuth callbacks** land as normal API calls (not true "push" webhooks) — see §4a's
  `POST /integrations/social-connect/:integration`.
- **`WebhookController.sendWebhook` (`POST /webhooks/send`)** is actually an outbound relay
  endpoint (frontend asks the backend to fire a webhook on its behalf), not an inbound receiver.

**Reuse verdict:** rewrite — the outbound webhook delivery has no signing, no retry, and no
audit trail; production-grade needs (HMAC signature header, exponential backoff, delivery log)
would have to be added regardless of whether the rest is reused.

---

## 14. Media upload flow

Entry points: `apps/backend/src/api/routes/media.controller.ts` (authenticated) and
`apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (API-key, `/public/v1/upload`,
`/public/v1/upload-from-url`).

Storage backend is selected at startup via a factory:
`libraries/nestjs-libraries/src/upload/upload.factory.ts` (`UploadFactory.createStorage()`),
switching on `process.env.STORAGE_PROVIDER`:
- `'local'` → `local.storage.ts` (`LocalStorage`) — writes to `UPLOAD_DIRECTORY` on local disk,
  organized `/{year}/{month}/{day}/{random32hex}.{ext}`, served back out under
  `${FRONTEND_URL}/uploads/...`.
- `'cloudflare'` → `cloudflare.storage.ts` — Cloudflare R2 via S3-compatible API
  (`@aws-sdk/client-s3`), using `CLOUDFLARE_ACCOUNT_ID/ACCESS_KEY/SECRET_ACCESS_KEY/BUCKETNAME/BUCKET_URL/REGION`.
- Large/direct-to-R2 multipart uploads go through `r2.uploader.ts` (`handleR2Upload`), invoked via
  `media.controller.ts`'s catch-all `POST /media/:endpoint` (used by the Uppy.js frontend
  uploader — `@uppy/aws-s3`, `@uppy/dashboard` etc. are frontend deps for this).

**Security hardening present (verified in code, worth calling out for reuse):**
- Both `local.storage.ts` and the public API's upload-from-url path **sniff the real file type
  from bytes** (`file-type`'s `fromBuffer`) against an explicit MIME allow-list
  (`LOCAL_STORAGE_ALLOWED_MIME` / `PUBLIC_API_ALLOWED_MIME`) rather than trusting the
  client-declared content-type or extension — explicit comment: "an attacker could write an
  arbitrary file (e.g. .html/.svg with embedded script) into the publicly served uploads
  directory."
- Fetching a remote URL server-side goes through `isSafePublicHttpsUrl` +
  `ssrfSafeDispatcher` (`libraries/nestjs-libraries/src/dtos/webhooks/`) to block
  private/loopback/link-local IP targets (SSRF protection), overridable only via
  `DISABLE_SSRF_PROTECTION` env for same-network self-hosted-provider fetches (documented in
  `.env.example`).

**Reuse verdict:** reuse as-is — the storage-factory abstraction plus the byte-sniffing/SSRF
hardening is exactly the kind of thing worth lifting wholesale into a new upload pipeline.

---

## 15. Image/video processing

- **`sharp`** (native image processing) is a direct dependency and is actually used in:
  `posts.service.ts`, `bluesky.provider.ts`, `linkedin.provider.ts`, `x.provider.ts`, and the
  shared `social.abstract.ts` — i.e. per-provider image prep (e.g. converting to JPEG when a
  provider's `convertToJPEG` flag is set — referenced in `post.activity.ts`'s call to
  `this._postService.updateMedia(p.id, ..., getIntegration?.convertToJPEG || false)`).
- **Video** handling exists under `libraries/nestjs-libraries/src/videos/`
  (`videos/images-slides`, `videos/veo3` — Google Veo3 AI video generation integration) and
  `libraries/nestjs-libraries/src/3rdparties/heygen/`, `3rdparties/reelfarm/` (external
  AI-video-generation vendor integrations) — this is AI-video-generation tooling, not
  transcoding of user-uploaded video for platform compatibility. No dedicated transcoding library
  (e.g. ffmpeg wrapper) was found for arbitrary video re-encoding; `music-metadata` is present
  (audio metadata extraction) and `canvas` is present (likely for image/canvas compositing in
  slide-style video generation).
- No resizing pipeline for arbitrary dimensions/thumbnails was found beyond what's described
  above (`thumbnail`/`thumbnailTimestamp` fields exist on the `Media` Prisma model, but the
  generation logic for those wasn't located in the areas read — **not fully verified**, flagging
  rather than guessing).

**Reuse verdict:** reuse with modification for the per-provider JPEG-conversion pattern; ignore
the AI-video-generation vendor integrations (HeyGen/Reelfarm/Veo3) unless V-AEP specifically wants
AI video generation as a feature.

---

## 16. Access token lifecycle

Stored directly on the `Integration` Prisma row (§7): `token` (access token, plain string column —
**not encrypted at the DB layer** as far as the schema shows; no `@db` annotation or separate
encrypted-secrets table), `refreshToken`, `tokenExpiration: DateTime?`.

Used at publish time by simply reading `integration.token` and passing it straight into the
provider's `.post()` call (`PostActivity.postSocial`,
`apps/orchestrator/src/activities/post.activity.ts:208`) — no decrypt step observed, implying
tokens are stored as-received from the provider (whatever encoding the provider itself uses, e.g.
X's `accessToken:accessSecret` packed string).

On (re)connect, `IntegrationService.createOrUpdateIntegration(...)` (called from both the OAuth
connect flow and `RefreshIntegrationService.refresh`) persists the new token/refreshToken/expiry.

**Reuse verdict:** rewrite this part specifically — plaintext token storage in the primary DB with
no field-level encryption is a real gap to close before reusing this for a production multi-tenant
SaaS (V-AEP already tracks "leaked API keys" as a P0 in its own enterprise-readiness audit per
project memory — this is the same category of risk).

---

## 17. Refresh token handling

Generic entry point: `RefreshIntegrationService.refresh(integration, cause)`
(`libraries/nestjs-libraries/src/integrations/refresh.integration.service.ts`) — looks up the
provider via `IntegrationManager`, calls `socialProvider.refreshToken(integration.refreshToken)`
(so the **refresh logic itself is per-provider**, generic only at the orchestration level), then
persists via `IntegrationService.createOrUpdateIntegration`. Handles an optional
`socialProvider.reConnect(...)` step for providers where a refreshed token requires re-resolving a
"root" account id (e.g. LinkedIn Page reconnect chains, `rootInternalId` field).

Two trigger paths:
1. **Reactive**, mid-publish: `postWorkflowV105` catches a Temporal `ApplicationFailure` with
   `type === 'refresh_token'` thrown by the provider's `.post()` call, calls the
   `refreshTokenWithCause` activity, swaps `post.integration.token = refresh.accessToken`, and
   retries the same post (bounded by the `iterate` 5x loop in the workflow) — §22 walks this in
   full.
2. **Proactive**, scheduled ahead of expiry: `refreshTokenWorkflow`
   (`apps/orchestrator/src/workflows/refresh.token.workflow.ts`) — a Temporal workflow per
   integration that computes `tokenExpiration - now`, `sleep()`s exactly that long, re-checks the
   integration hasn't been deleted/disabled/already-mid-refresh in the meantime, then calls
   `refreshToken` activity and loops. Only started for providers that declare `refreshCron: true`
   on their `SocialProvider` instance (`RefreshIntegrationService.startRefreshWorkflow`).

On failure to refresh: `IntegrationService.refreshNeeded(...)` flags the integration
(`refreshNeeded: true` on the row), `informAboutRefreshError` sends the user an in-app/email
notification, and `disconnectChannel` is called — i.e. a failed refresh **disables the channel**
rather than leaving it silently broken.

Fallback: `apps/commands/src/tasks/refresh.tokens.ts` — an externally-triggered batch sweep
(`IntegrationService.refreshTokens()`) as a backstop for any integration whose per-row Temporal
refresh workflow didn't fire.

**Reuse verdict:** reuse the *design* (reactive mid-publish catch + proactive scheduled-ahead
refresh + batch-sweep backstop, with explicit "flag as broken and tell the user" on terminal
failure) regardless of stack — this is a solid three-layer pattern worth copying even if rewritten
away from Temporal.

---

## 18. Multi-tenant support

Yes — `Organization` is the tenant boundary, and a `User` can belong to multiple organizations via
`UserOrganization` (role: `SUPERADMIN|ADMIN|USER`, plus a `disabled` flag per membership).

Enforcement mechanism: **not** row-level security at the DB — it's **application-layer**, via:
- `AuthMiddleware` resolving `req.org` from the JWT user + `showorg` cookie/header (§3), scoped to
  orgs the user actually belongs to (`getOrgsByUserId(user.id)`, filtered to non-disabled
  memberships).
- Every service method that touches tenant data takes an explicit `orgId`/`organizationId`
  parameter (visible throughout `posts.service.ts`, `integration.service.ts`, etc.) and every
  relevant Prisma query filters by it — there is **no global-query-scoping middleware**; each
  repository method is individually responsible for including the org filter. This means
  tenant isolation is only as strong as each individual query — **not verified to be
  systematically enforced by a single choke point**, worth flagging as a review item rather than
  assuming Prisma/middleware guarantees it centrally.
- `@GetOrgFromRequest()` param decorator (`libraries/nestjs-libraries/src/user/org.from.request.ts`)
  is the standard way controllers pull the resolved org into handler params.

**Reuse verdict:** reuse with modification — the org-as-tenant + per-query-orgId-filter pattern is
workable and matches common Prisma-multi-tenant practice, but it's not defense-in-depth; a target
implementation should still audit that every query path filters by org (this codebase does not
appear to have a single enforced choke point that would catch a missed filter).

---

## 19. Organization/workspace model

Prisma models specifically for this (from schema.prisma, §7): `Organization`, `UserOrganization`
(join table with `role`/`disabled`), plus the agency/marketplace layer built on top:
`SocialMediaAgency` (a user-level "I am an agency" profile, not an org-level thing — `userId
@unique`), `Customer` (a sub-client *within* an org, used to group `Integration`s for
white-label/agency use — `Integration.customerId` optional FK), `Orders`/`OrderItems`/
`MessagesGroup`/`Messages`/`PayoutProblems` (a buyer-seller marketplace for hiring social-media
management, cross-org: `Post.submittedForOrganizationId` lets one org submit a post for approval
into *another* org).

**Reuse verdict:** reuse the core `Organization`/`UserOrganization`/`Customer` shape; ignore the
marketplace (`Orders`/`Messages`/`PayoutProblems`/`SocialMediaAgency`) layer entirely unless V-AEP
wants a literal agency-marketplace feature — it's clearly a distinct product bolted onto the
scheduler, not part of the publishing capability.

---

## 20. RBAC

Real, implemented — but coarser than a full RBAC matrix. Two layers:

1. **Role enum on `UserOrganization`**: `SUPERADMIN | ADMIN | USER` (per-org-membership role, plus
   a separate `User.isSuperAdmin` boolean that's global/platform-level, used for impersonation
   and admin-only debug routes like `PostsController`'s `group/:group/debug-export`).
2. **CASL-based ability/policy system**, gating *feature access tied to subscription tier*, not a
   granular per-role permission matrix:
   - `PoliciesGuard` (`apps/backend/src/services/auth/permissions/permissions.guard.ts`) — a
     global-ish Nest guard reading a `@CheckPolicies([action, section])` metadata decorator
     (`permissions.ability.ts`) off route handlers, and calling
     `PermissionsService.check(orgId, org.createdAt, role, policyHandlers, refreshChannelId)`.
   - `PermissionsService.check` (`permissions.service.ts`) builds a CASL `Ability` **primarily
     from subscription-tier limits** (`pricing[tier]` — channel count, webhooks count, posts/month,
     team_members, AI, community_features, etc.), **only** consulting `permission` (the role
     string) for the `Sections.ADMIN` section (`['ADMIN','SUPERADMIN'].includes(permission)`).
     If `STRIPE_PUBLISHABLE_KEY` isn't set (self-hosted/no billing), **all requested permissions
     are granted unconditionally** — i.e. the whole CASL system is effectively a billing-limit
     gate that only engages when Stripe billing is configured.
   - Route-level examples: `webhooks.controller.ts`'s `createAWebhook` requires
     `[Create, Sections.WEBHOOKS]`; `posts.controller.ts`'s `createPost` requires `[Create,
     Sections.POSTS_PER_MONTH]`.

So: **role-based** access exists only for the single `ADMIN`/`SUPERADMIN` "section," and is
otherwise **plan-tier-based** access control, not classic per-feature RBAC. There is no evidence
of, e.g., a `USER` role being blocked from creating posts or connecting channels within an org —
worth stating explicitly rather than assuming a fuller RBAC exists.

**Reuse verdict:** reuse with modification — CASL as the mechanism is fine and reusable, but the
actual policy content (billing-tier gates) would need to be rewritten if V-AEP wants genuine
per-role feature RBAC rather than per-plan gating.

---

## 21. Analytics

Real, not a UI mockup — backed by actual provider API calls. `AnalyticsController`
(`apps/backend/src/api/routes/analytics.controller.ts`) exposes `GET /analytics/:integration` →
`IntegrationService.checkAnalytics(org, integration, date)` and `GET /analytics/post/:postId` →
`PostsService.checkPostAnalytics(...)`. These ultimately call the optional `analytics()` /
`postAnalytics()` methods on `IAuthenticator` (§3's interface) — i.e. **only providers that
implement those optional methods return real data**; providers that don't implement them simply
don't support analytics (this wasn't exhaustively cross-checked per-provider, but the interface
being `analytics?()` (optional) confirms it's not universally implemented across all 34).
`AnalyticsData` return shape: `{ label, data: [{ total, date }], percentageChange }`.

**Reuse verdict:** reuse with modification — real per-provider analytics fetch is valuable to
copy, but expect gaps (not every one of the 34 providers necessarily implements `analytics()` —
verify per-platform before assuming coverage for the platforms V-AEP cares about).

---

## 22. Publishing pipeline (full trace, "post scheduled" → "live on platform")

This is the seam that matters most for a "wrap Postiz's publishing as an AI Marketing Employee
service" integration. Full call chain, evidence-based:

1. **Create/schedule** — `POST /posts` → `PostsController.createPost` (validates via
   `PostsService.validatePosts`, throws a structured `PostValidationException` on any invalid
   provider-specific field) → `PostsService.createPost(org.id, body, 'WEB')` (persists the `Post`
   row(s), `state: 'QUEUE'`) → `PostsService.startWorkflow(taskQueue, postId, orgId, state)`
   (`posts.service.ts:694`) → Temporal `workflow.start('postWorkflowV105', { workflowId:
   'post_'+postId, taskQueue: 'main', args: [{ taskQueue: providerTaskQueue, postId, organizationId
   }] })`.
   *(Alternatively, `Post.creationMethod` records `MCP`/`API`/`AUTOPOST`/`CLI` for
   non-web creation paths — the public API's `/public/v1/posts` endpoint and the Postiz SDK
   (`apps/sdk/src/index.ts`) both ultimately hit the same `PostsService.createPost` path.)*

2. **Wait** — `postWorkflowV105` (`apps/orchestrator/.../post.workflow.v1.0.5.ts`) durably
   `sleep()`s until `publishDate` (§8), then re-fetches the post
   (`getPostsList` activity — re-validates it's still `QUEUE`, not deleted, subscription still
   active if Stripe billing is on).

3. **Pre-flight checks** — if `integration.refreshNeeded` or `integration.disabled`, the workflow
   sends an in-app notification and marks the post `ERROR` **without attempting to publish**.

4. **Publish** — `postSocial` activity
   (`apps/orchestrator/src/activities/post.activity.ts:208`) → 
   `IntegrationManager.getSocialIntegration(providerIdentifier)` → builds `PostDetails[]` (message
   HTML-stripped via `stripHtmlValidation`, media resolved via `PostsService.updateMedia`,
   JPEG-converted if the provider requires it) → calls the provider's own
   `.post(internalId, token, postDetails, integration)` — this is where the actual outbound HTTP
   call to X/LinkedIn/etc. happens, entirely inside each `*.provider.ts` file.

5. **Comments** (if the post has a comment chain and the provider's `isCommentable` — determined
   by whether the provider implements the optional `.comment()` method) — same flow via the
   `postComment` activity, chained to the parent post's returned platform post id.

6. **On success** — `updatePost` activity writes back `releaseId`/`releaseURL`/state=`PUBLISHED`;
   `inAppNotification` fires a user notification; `sendWebhooks` fans out to registered org
   webhooks (§13); a `streakWorkflow` is (re)started for gamification; then any **plugs**
   (repost/automation rules) and **repeat-post** logic run (§11), the latter by spawning a Temporal
   *child* workflow so infinite recurring posts don't block the parent.

7. **On failure** — if the provider throws a Temporal `ApplicationFailure` typed `refresh_token`,
   the workflow calls `refreshTokenWithCause` (§17) and **retries the same post** (bounded 5x loop,
   `iterate = Array.from({ length: 5 })`); if typed `bad_body`, it notifies the user and stops
   (no point retrying a malformed request); any other error marks the post `ERROR` and stops. Note
   this in-workflow retry is *layered on top of* Temporal's own activity-level retry policy (3
   attempts / 2-min backoff, §9) — so a transient network failure gets Temporal's retry, while a
   token-expiry failure gets this workflow-level refresh-and-resubmit loop.

**Integration-seam verdict (the key question for reuse):** there is **no clean internal
"publish this post" API boundary** you could call as a standalone library or microservice without
either (a) adopting Temporal as infrastructure and depending on `nestjs-temporal-core` +
`apps/orchestrator`'s workflow/activity code, or (b) reaching in and calling
`IntegrationManager.getSocialIntegration(id).post(...)` directly yourself, which skips all the
scheduling/retry/refresh/notification/webhook orchestration Temporal was providing — leaving you
to re-implement that orchestration layer. The **one genuinely clean, network-callable boundary
that already exists** is the **public API** (`/public/v1/posts`, `/public/v1/upload`,
`/public/v1/integrations`, API-key authenticated, exactly what `apps/sdk` wraps) — that's the
realistic integration point for "call Postiz's publishing as a service from V-AEP," treating a
whole self-hosted Postiz instance as a black-box publishing backend rather than trying to extract
its internals.

---

## 23. Error handling

Three global Nest exception filters, registered in order in `apps/backend/src/main.ts`:
`SubscriptionExceptionFilter` (`services/auth/permissions/subscription.exception.ts`, catches
`SubscriptionException` thrown by the CASL `PoliciesGuard`, §20), `PostValidationExceptionFilter`
(`api/routes/posts.validation.exception.ts`, catches `PostValidationException`, turns
provider-specific validation failures into a structured 400 response body), and
`HttpExceptionFilter` (`services/exception.filter.ts`, catches a custom `HttpForbiddenException`
used throughout auth middleware).

Elsewhere: mostly ad-hoc `try/catch` with either silent swallow (webhook delivery, notification
sends — deliberately non-fatal side effects) or explicit typed exceptions thrown across the
Temporal activity/workflow boundary (`ApplicationFailure` with a `type` discriminator string —
`'refresh_token'`, `'bad_body'` — is the mechanism workflows use to distinguish retry-worthy vs.
terminal failures from activities, since plain JS errors get wrapped in Temporal's own
`ActivityFailure`). Sentry (`@sentry/nestjs`, `@sentry/nextjs`) is wired at both backend
(`initializeSentry('backend', true)` in `main.ts`) and frontend for uncaught-error capture and
some manual `Sentry.metrics.count(...)` calls (e.g. public API upload endpoint).

**Reuse verdict:** reuse with modification — global exception filters + a typed-failure
discriminator across an async boundary is a solid pattern regardless of whether Temporal is kept;
the ad-hoc silent-swallow spots (webhooks, notifications) should be tightened if rebuilt for
production reliability guarantees.

---

## 24. Retry mechanisms

Two independent retry layers, both already covered above but summarized together since the
question is specifically "how many times, and how":
1. **Temporal activity retry policy** — declared per `proxyActivities(...)` call, consistently
   `{ maximumAttempts: 3, backoffCoefficient: 1, initialInterval: '2 minutes' }` across every
   workflow file checked (`autopost.workflow.ts`, `post.workflow.v1.0.5.ts`,
   `missing.post.workflow.ts`, `refresh.token.workflow.ts`). Coefficient `1` means **fixed** 2-minute
   delay between attempts, not exponential, despite the "backoffCoefficient" naming suggesting
   otherwise — worth double-checking against Temporal's own default (its SDK default coefficient
   is 2/exponential; this codebase explicitly overrides it to fixed).
2. **Workflow-level manual retry loop** for the specific "token expired mid-publish" case — up to
   5 iterations (`iterate = Array.from({ length: 5 })` in `post.workflow.v1.0.5.ts`), each
   attempting a fresh token refresh before retrying the same publish call. This is **on top of**
   layer 1, not instead of it.

No dead-letter-queue concept was found — a post that exhausts retries simply ends in `state:
'ERROR'` with the `error` field populated and an in-app notification sent; there's no separate
"failed jobs" store beyond that `Post.error` field and the `Errors` Prisma model (per-post failure
log, §7).

**Reuse verdict:** reuse the two-layer concept (transient-error retry + explicit refresh-and-retry
for auth failures) regardless of underlying queue tech; note the fixed (non-exponential) backoff
choice was deliberate in this codebase and may or may not be what you want to copy.

---

## 25. Environment variables

From `.env.example` and `docker-compose.yaml`, grouped by purpose:

**Core/required:**
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `FRONTEND_URL`, `NEXT_PUBLIC_BACKEND_URL`,
`BACKEND_INTERNAL_URL`, `TEMPORAL_ADDRESS` (+ `TEMPORAL_TLS`, `TEMPORAL_API_KEY`,
`TEMPORAL_NAMESPACE`), `IS_GENERAL`, `DISABLE_REGISTRATION`.

**Storage:**
`STORAGE_PROVIDER` (`local`|`cloudflare`), `UPLOAD_DIRECTORY`, `NEXT_PUBLIC_UPLOAD_DIRECTORY`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ACCESS_KEY`, `CLOUDFLARE_SECRET_ACCESS_KEY`,
`CLOUDFLARE_BUCKETNAME`, `CLOUDFLARE_BUCKET_URL`, `CLOUDFLARE_REGION`.

**Social platform API credentials (one pair+ per platform):**
`X_URL/X_API_KEY/X_API_SECRET`, `LINKEDIN_CLIENT_ID/SECRET`, `REDDIT_CLIENT_ID/SECRET`,
`GITHUB_CLIENT_ID/SECRET` (this one is actually for GitHub-as-login-provider, §3, not a social
publish target), `BEEHIIVE_API_KEY/PUBLICATION_ID`, `LISTMONK_DOMAIN/USER/API_KEY/LIST_ID`,
`THREADS_APP_ID/SECRET`, `FACEBOOK_APP_ID/SECRET`, `YOUTUBE_CLIENT_ID/SECRET`,
`TIKTOK_CLIENT_ID/SECRET`, `PINTEREST_CLIENT_ID/SECRET`, `DRIBBBLE_CLIENT_ID/SECRET`,
`TUMBLR_CLIENT_ID/SECRET`, `DISCORD_CLIENT_ID/SECRET/BOT_TOKEN_ID`,
`SLACK_ID/SECRET/SIGNING_SECRET`, `MASTODON_URL/CLIENT_ID/SECRET`, `EXTENSION_ID` (Chrome
extension id for cookie-based platforms like Skool).

**Postiz-as-OAuth-server / generic OAuth login for self-hosters:**
`NEXT_PUBLIC_POSTIZ_OAUTH_DISPLAY_NAME/LOGO_URL`, `POSTIZ_GENERIC_OAUTH`, `POSTIZ_OAUTH_URL`,
`POSTIZ_OAUTH_AUTH_URL`, `POSTIZ_OAUTH_TOKEN_URL`, `POSTIZ_OAUTH_USERINFO_URL`,
`POSTIZ_OAUTH_CLIENT_ID/SECRET`, `POSTIZ_OAUTH_SCOPE`.

**Billing:** `FEE_AMOUNT`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_SIGNING_KEY`,
`STRIPE_SIGNING_KEY_CONNECT`.

**Email/notifications:** `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`.

**AI/misc:** `OPENAI_API_KEY`, `NEXT_PUBLIC_DISCORD_SUPPORT`, `NEXT_PUBLIC_POLOTNO`, `API_LIMIT`
(public API hourly rate limit), `NX_ADD_PLUGINS`.

**Security:** `DISABLE_SSRF_PROTECTION` (default off — see §14), `NOT_SECURED` (relaxes
cookie security flags for local dev), `DISALLOW_PLUS` (blocks `+` in emails to prevent
alias-based duplicate signups).

**Short-link providers (optional):** `DUB_TOKEN/API_ENDPOINT/SHORT_LINK_DOMAIN`,
`SHORT_IO_SECRET_KEY`, `KUTT_API_KEY/API_ENDPOINT/SHORT_LINK_DOMAIN`,
`LINK_DRIP_API_KEY/API_ENDPOINT/SHORT_LINK_DOMAIN`.

**Reuse verdict:** reuse as a checklist as-is — this is exactly the shape of config surface a
publishing platform needs; it's a good reference for what V-AEP's own env schema should cover if
building an equivalent capability.

---

## 26. Required infrastructure

Confirmed by reading `docker-compose.yaml` (production reference) and `docker-compose.dev.yaml`
(local dev) directly:

- **PostgreSQL** (`postgres:17-alpine`) — primary app database (Prisma).
- **Redis** (`redis:7.2` / `redis:7-alpine`) — OAuth-state cache + throttler storage (§9); **not**
  a job queue in this codebase.
- **Temporal server stack** — this is the big one, and it's **not optional** if running the real
  publishing pipeline: `temporalio/auto-setup` (the Temporal server itself), its own dedicated
  **`temporal-postgresql`** (`postgres:16`, separate from the app DB), **Elasticsearch**
  (`elasticsearch:7.17.27`, required by Temporal for visibility/search-attribute queries — the
  workflow code relies on `workflow.list({ query: 'postId="..." AND ExecutionStatus="Running"' })`,
  §8), `temporal-admin-tools` (CLI), `temporal-ui` (dashboard, port 8080).
  `dynamicconfig/` at repo root supplies Temporal's dynamic config file, mounted into the
  container.
  In production, `TEMPORAL_ADDRESS`/`TEMPORAL_TLS`/`TEMPORAL_API_KEY`/`TEMPORAL_NAMESPACE` allow
  pointing at Temporal Cloud instead of self-hosting the stack.
- **Object storage** — either local disk (bind-mounted volume `postiz-uploads`) or Cloudflare R2
  (S3-compatible) — no other provider (e.g. plain AWS S3, GCS) found wired in as a first-class
  `STORAGE_PROVIDER` option, only `local` and `cloudflare` are switched on in
  `upload.factory.ts`.
- **Sentry / Spotlight** (`ghcr.io/getsentry/spotlight`) — optional local error-tracking relay,
  dev-only per the compose comment.
- Production `docker-compose.yaml` runs Postiz itself as a **single container**
  (`ghcr.io/gitroomhq/postiz-app:latest`) — meaning the backend, frontend, and orchestrator worker
  are bundled into one image/process group for the "simple self-host" deployment path (contradicts
  the apps/* separation being separate deployables in more advanced/scaled setups — both are valid
  readings of the same codebase depending on deployment choice).

**Reuse verdict:** this is the single biggest cost/complexity flag for reuse — adopting Postiz's
publishing pipeline as-is means standing up **Postgres + Redis + a full Temporal cluster
(including its own Postgres and Elasticsearch)**, which is a lot of infrastructure for "schedule
and publish a social post." If V-AEP integrates via the public API (§22's recommended seam)
against a self-hosted Postiz instance, V-AEP doesn't have to run any of this itself — Postiz does.
If instead extracting/reimplementing the *logic*, plan to swap Temporal for something lighter
(BullMQ + Postgres) rather than carrying the Temporal/Elasticsearch stack into V-AEP's own infra.

---

## 27. Correction & addendum (added after cross-checking official docs at docs.postiz.com)

The original §12 route table for `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts`
was **incomplete** — it was built from the SDK (`apps/sdk/src/index.ts`, which only wraps a handful of
routes) rather than a full read of the controller file. Re-reading the file in full (949 lines,
`PublicIntegrationsController`) surfaces a materially larger public API surface. Corrected/expanded
route list, confirmed by line number in the actual file:

| Route | Line | Purpose |
|---|---|---|
| `POST /public/v1/upload`, `/upload-from-url` | 80, 100 | (already known) |
| `GET /public/v1/find-slot/:id` | 164 | Free posting-time slot finder |
| `GET /public/v1/posts`, `POST /public/v1/posts` | 173, 186 | (already known) |
| `DELETE /public/v1/posts/:id`, `/posts/:group` (by group) | 267, 277 | Delete post(s) |
| `GET /public/v1/is-connected` | 285 | Cheap liveness/connectivity check |
| **`GET /public/v1/groups`** | 291 | **Lists `Customer` sub-entities for the org** (`IntegrationService.customers(org.id)`) — confirms group=Customer is a first-class, API-key-reachable concept, not just a schema detail |
| **`GET /public/v1/integrations?group=`** | 302 | Lists integrations, **filterable by Customer/group id** |
| **`GET /public/v1/social/:integration?refresh=`** | 326 | **This is the OAuth-connect endpoint** — API-key-authenticated, returns `{ url }` to redirect the end user to for provider consent. §4a and §22 below previously stated no such public-API path existed — **that was wrong**; it exists and is exactly this route. Rejects (400) any provider with `externalUrl` set (e.g. Mastodon-style self-hosted-URL providers) as "not supported via the public API." Does **not** accept a `group`/customer id — a newly connected integration is not tagged to a Customer through this call (see gap below). |
| `DELETE /public/v1/:id` (channel) | 403 | Disconnect a channel |
| `GET /public/v1/integration-settings/:id` | 421 | Per-integration settings/posting-time config |
| `GET /public/v1/posts/:id/missing` | 468 | Missing-content check |
| `POST /public/v1/posts/:id/change-status`, `/update-release-id` | ~478, 488 | Post state management |
| **`GET /public/v1/analytics/:integration`, `GET /public/v1/analytics/post/:postId`** | 497, 507 | **Analytics IS under the public API** — §21/§Gap-analysis previously flagged this as needing an additive endpoint; **that was wrong**, it already exists. |
| `POST /public/v1/integration-trigger/:id` | 517 | Platform-specific helper actions (e.g. "list Discord channels," "search subreddits") — the public-API equivalent of the MCP `triggerTool` (§28) |
| `POST /public/v1/generate-video`, `POST /public/v1/video/function` | 383, 392 | AI video generation + its helper-function pattern, also public-API reachable |

**The one real, narrow gap that does still exist** (verified in
`libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts:143` +
`apps/backend/src/api/routes/integrations.controller.ts:66,79`): assigning a newly-connected
integration to a specific Customer/group (`PUT /:id/group`, `PUT /:id/customer-name`) is **only**
exposed on the internal, logged-in-session-authenticated controller — **not** under `/public/v1`.
Everything else needed for the "one shared Postiz org, one Customer per external company" model
(§19's reuse verdict) is reachable via the public API; only the customer-tagging step at
connect-time is not. This is a much smaller gap than originally stated.

**Practical effect on the reuse verdict for §4a and §22:** upgrade both from "reuse with
modification" / "no clean seam, reach into internals" to **reuse as-is** for everything except the
single customer-tagging call.

---

## 28. MCP server (found via official docs, confirmed in source — not covered by the original Phase 1 questions, added because it's directly relevant to any "expose Postiz to an AI agent" integration)

Confirmed real and self-hosted (not a cloud-only feature): `apps/backend/src/main.ts:51` calls
`startMcp(app)`, implemented in
`libraries/nestjs-libraries/src/chat/start.mcp.ts`. Built on `@mastra/mcp`'s `MCPServer`, reusing the
**same Mastra "postiz" agent that backs Postiz's own in-app AI copilot chat** (§11's Mastra-based
chat subsystem, previously noted as "ignore, unrelated to publishing" — turns out this is also the
literal implementation backing MCP, worth knowing even though the reuse verdict for Orlixa doesn't
change).

- **Auth**: identical `resolveAuth()` to the REST public API — API key (`Organization.apiKey`) or
  an OAuth `pos_`-prefixed token, resolved to the same `Organization`. No separate credential system.
- **Transports**: streamable-HTTP at `/mcp` (bearer token) and `/mcp/:apiKey` (URL-embedded key),
  plus a legacy SSE transport at `/sse/:id` + `/message/:id`. Self-hosted base is
  `NEXT_PUBLIC_BACKEND_URL`, not the `api.postiz.com` shown in the docs' quick-start examples.
- **9 tools exposed** (per official docs, names as given there): `integrationList`, `groupList`,
  `integrationSchema`, `triggerTool`, `schedulePostTool`, `generateImageTool`,
  `generateVideoOptions`, `videoFunctionTool`, `generateVideoTool`. These map closely 1:1 onto the
  REST routes in §27's table (`integrationList`≈`/integrations`, `groupList`≈`/groups`,
  `schedulePostTool`≈`POST /posts`, `triggerTool`≈`/integration-trigger/:id`,
  `generateImageTool`/`generateVideoTool`/`generateVideoOptions`/`videoFunctionTool`≈the
  video/image-generation routes). `integrationSchema` (platform posting constraints/character
  limits/settings schema) has **no direct REST-route equivalent found in §27's table** — it appears
  to be MCP-only, or backed by a route not yet located; flagging rather than assuming it's absent.

**Reuse verdict:** two legitimate integration paths exist for the AI Marketing Manager employee —
(a) Orlixa's `PostizClientService` calls the plain REST routes in §27 directly, using Orlixa's own
existing bespoke tool-calling/`ApprovalRequest` pattern (`OX§3/§5`) — no new protocol infrastructure
needed since Orlixa doesn't have an MCP client today; or (b) Orlixa builds a generic MCP-client
capability and connects to `/mcp` directly, gaining `integrationSchema` for free and slightly less
hand-maintained tool-schema code, at the cost of building MCP-client infrastructure from scratch and
still needing an interception layer to enforce the approval gate before any tool actually fires. See
the integration plan doc for the recommendation (REST for v1; MCP flagged as a legitimate future
path, not chosen for v1).
