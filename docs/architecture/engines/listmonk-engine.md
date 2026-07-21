# Listmonk — Engine Study (for Orlixa "AI Email Marketing Employee")

Source verified against: local clone at `C:\Users\Admin\AppData\Local\Temp\claude\listmonk-src` (Go backend +
Vue frontend) and official docs at listmonk.app/docs (fetched live). All file paths below are real paths in the
clone unless marked NOT VERIFIED.

---

## 1. Executive Summary

Listmonk is a self-hosted, single-binary, **single-tenant** newsletter/mailing-list manager written in Go
(backend, Echo framework) with a Vue 3 admin SPA (frontend). It is 100% open source under **AGPLv3** — there is
no separate Enterprise edition, no `enterprise/` directory, and no second license file anywhere in the repo
(verified: only `LICENSE` at repo root, AGPLv3 text, plus an unrelated `frontend/email-builder/LICENSE` for a
vendored email-builder component — not a product license split).

Architecturally it is one Postgres database + one Go process that (a) serves a REST API and admin UI, (b) polls
its own database for campaigns to send, and (c) dispatches mail directly over SMTP using in-process goroutines
and channels — there is no external queue/broker (no Redis, no Kafka, no RabbitMQ). All sending identity
(SMTP credentials, `from_email` defaults, public site branding, unsubscribe/archive pages) is **instance-wide**,
not scoped to any sub-entity. This is the central architectural fact that drives every decision Orlixa has to
make about it (see §15, §20-22).

The REST API is complete enough to run 100% headlessly: every admin-UI action (create/send campaigns, manage
lists/subscribers/templates/media, transactional sends) has a corresponding token-authenticated REST endpoint.
Orlixa's AI Email Marketing Employee could, in principle, never touch the Listmonk admin UI.

---

## 2. Architecture Diagram

```
                    ┌─────────────────────────────────────────────┐
                    │              listmonk binary                │
                    │  (single Go process, cmd/main.go)            │
                    │                                               │
   HTTPS  ────────► │  Echo HTTP router (cmd/handlers.go)          │
  (Admin UI /        │   ├── /admin/*      (Vue SPA, static assets) │
   REST API /        │   ├── /api/*        (REST API, token/cookie)│
   public pages)     │   └── /subscription/*, /link/*, /campaign/* │
                    │        (public: unsubscribe, tracking, view) │
                    │                                               │
                    │  internal/core       (business logic /        │
                    │                        query wrappers)         │
                    │  internal/auth       (sessions, API tokens,   │
                    │                        OIDC, RBAC)             │
                    │  internal/manager    (campaign scheduler +     │
                    │                        worker pool + queues)   │
                    │  internal/messenger/email  (SMTP pools)        │
                    │  internal/messenger/postback (webhook          │
                    │                        messenger, generic)     │
                    │  internal/bounce     (bounce mailbox scanner + │
                    │                        webhook receivers)       │
                    └───────────────────┬───────────────────────────┘
                                        │ database/sql (lib/pq)
                                        ▼
                    ┌─────────────────────────────────────────────┐
                    │           PostgreSQL >= 12                    │
                    │  campaigns, lists, subscribers,                │
                    │  subscriber_lists, templates, media,           │
                    │  campaign_views, link_clicks, bounces,         │
                    │  settings, users, roles, sessions,             │
                    │  materialized views (mat_dashboard_*)          │
                    └─────────────────────────────────────────────┘
                                        ▲
                                        │ (optional, external)
                    SMTP relay(s) ◄─────┘ real mail sent directly by the
                    (configured in       Go process itself over net/smtp —
                    `settings.smtp`)     no separate mail-sending service
```

There is no separate worker process/binary — `internal/manager.Manager.Run()` is started as a goroutine inside
the same binary that serves HTTP (`cmd/main.go`), controlled by a `ScanCampaigns` config flag that lets an
operator run one instance in "API-only" mode and another in "sender" mode against the same DB (still one shared
Postgres, still one shared settings/SMTP config).

---

## 3. Component Diagram

```
cmd/                  Go entrypoint + all HTTP handlers (one file per resource: campaigns.go,
                       lists.go, subscribers.go, templates.go, media.go, users.go, roles.go, ...)
internal/core/        Thin business-logic layer wrapping SQL queries (core.go + one file per
                       resource) — called by cmd/*.go handlers
internal/manager/     Campaign scheduler, in-memory send queues, goroutine worker pool,
                       SMTP dispatch orchestration, link-tracking cache
internal/messenger/
  email/              SMTP messenger implementation (net/smtp + knadh/smtppool)
  postback/           Generic HTTP-webhook messenger (push messages to an external URL
                       instead of / in addition to email)
internal/auth/        Session management (simplesessions + Postgres store), API-token
                       validation, OIDC (SSO) client, permission checks
internal/bounce/      Bounce processing: SES/SendGrid/Postmark/forwardemail/lettermint
                       webhooks + POP3/IMAP mailbox scanning
internal/subimporter/ CSV/bulk subscriber import worker
internal/media/       Media storage abstraction (filesystem or S3-compatible)
internal/captcha/     Altcha / hCaptcha for public subscription forms
models/                Go structs mirroring DB rows + SQL-query-string constants (queries.go)
queries/*.sql          Raw, named SQL queries loaded at startup (goyesql-style) and prepared
                       once against the DB
schema.sql             Full Postgres schema (source of truth for §6)
frontend/src/          Vue 3 admin SPA (views/, components/, store/, api/)
```

---

## 4. Request Flow (campaign create → send → track)

Traced through real files:

1. **Create campaign** — `POST /api/campaigns` → `cmd/campaigns.go:CreateCampaign` → `internal/core/campaigns.go`
   → `INSERT` via `queries/campaigns.sql` (`create-campaign` query) → row created with `status='draft'`,
   `messenger='email'`, `from_email` defaulted from global `app.from_email` setting if not supplied
   (`cmd/campaigns.go` lines ~681-685: `if c.FromEmail == "" { c.FromEmail = a.cfg.FromEmail }`).
2. **Attach lists** — campaign↔list association written to `campaign_lists` (list IDs + a frozen copy of
   `list_name`, so a later list rename/delete doesn't corrupt campaign history).
3. **Start sending** — `PUT /api/campaigns/:id/status` with `status=running` (permission `campaigns:send`) →
   `UpdateCampaignStatus`.
4. **Scheduler pickup** — `internal/manager.Manager.scanCampaigns()` runs on a ticker (`ScanInterval`), calls
   `store.NextCampaigns()` (SQL query against `campaigns` filtered on `status IN ('running','scheduled')`), and
   for each new/changed campaign builds a `pipe` (`internal/manager/pipe.go:newPipe`) — this resolves the
   messenger, compiles the Go `html/template` body, and loads media attachments.
5. **Subscriber resolution** — the pipe repeatedly calls `store.NextSubscribers(campID, batchSize)`
   (`internal/manager/pipe.go:NextSubscribers`), a paginated SQL query (`queries/campaigns.sql`,
   `next-campaign-subscribers`) that joins `campaign_lists` → `subscriber_lists` → `subscribers`, respecting
   subscription status (`unconfirmed`/`confirmed` for opt-in lists) and `last_subscriber_id` checkpointing so a
   restarted/paused campaign resumes without re-sending.
6. **Message render + queue** — for each subscriber, `pipe.newMessage()` → `Manager.NewCampaignMessage`
   compiles the per-subscriber HTML (tracking pixel/link rewriting via `TrackLink`/`TrackView` template funcs),
   then pushes a `CampaignMessage` onto the in-memory Go channel `m.campMsgQ`.
7. **Worker dispatch** — one of `Concurrency` goroutines (`Manager.worker()`, `internal/manager/manager.go`)
   reads from `campMsgQ`, applies the global `MessageRate` per-second throttle, and calls
   `m.messengers[msg.Campaign.Messenger].Push(out)`.
8. **SMTP send** — `internal/messenger/email/email.go:(*Emailer).Push()` picks an SMTP server (round-robin,
   optionally routed by `From` address/domain — see §15), builds a `smtppool.Email`, and sends it over real
   SMTP via `github.com/knadh/smtppool`.
9. **Tracking** — the rendered body contains a `/link/:uuid/:campUUID/:subUUID` redirect URL for every link
   (registered via `manager.trackLink()` → `links` table) and a `/campaign/:uuid/:subUUID/px.png` tracking
   pixel. Clicks/opens hit `cmd/public.go` handlers that insert into `link_clicks` / `campaign_views`.
10. **Completion** — when a pipe's subscriber batches are exhausted, `pipe.cleanup()` sets
    `campaigns.status='finished'` and fires an admin notification email (`internal/notifs`).

---

## 5. Authentication Flow

Two independent, coexisting auth mechanisms, both implemented in `internal/auth/auth.go`:

**A. Admin UI login (session-based)**
- Username/password (`users.password`, bcrypt-style via Postgres `pgcrypto`) or OIDC/SSO (`security.oidc`
  global setting: provider URL, client id/secret, auto-create-users flag).
- On success, `Auth.SaveSession()` creates a server-side session via `zerodha/simplesessions` backed by a
  Postgres `sessions` table (verified table in schema.sql), and sets an **HTTP-only cookie** (`session=...`).
- `Auth.Middleware()` on every request: if a `session=` cookie is present, cookie auth is used exclusively
  (Basic-Auth header is explicitly ignored in that case — a documented backward-compat shim from a v3→v4
  migration, see comment in `auth.go` lines 293-300).
- Optional TOTP 2FA (`users.twofa_type`, `/api/users/:id/twofa/totp`).

**B. REST API auth (headless / what Orlixa would use)**
- `Authorization: token <api_username>:<api_token>` header (custom scheme, not OAuth), or legacy
  `Authorization: Basic <base64(user:token)>` for backward compatibility.
- Tokens are created as a special `users.type='api'` user; the token itself is stored **hashed** —
  `Auth.HashAPIToken()` is a straight SHA-256 hex digest (`internal/auth/auth.go`), compared with
  `subtle.ConstantTimeCompare` in `GetAPIToken()`.
- API users/tokens are cached in-memory (`Auth.apiUsers map[string]User`) and refreshed via
  `CacheAPIUsers()`/`CacheAPIUser()` — meaning token revocation requires an explicit cache refresh path, not
  just a DB delete (verify DB delete triggers a cache refresh in the caller — NOT VERIFIED beyond this file).
- Permission checks are RBAC (`Auth.Perm()` middleware) against a `PermissionsMap` on the `User`, derived from
  `roles.permissions TEXT[]` (see §16, §11).

---

## 6. Database Design

Real schema, `schema.sql` (repo root), Postgres ≥ 12. Key tables (all verified by reading the file):

- **`subscribers`**: `id SERIAL`, `uuid UNIQUE`, **`email TEXT NOT NULL UNIQUE`** (case-insensitively enforced
  via `idx_subs_email UNIQUE INDEX ... (LOWER(email))`), `name`, `attribs JSONB` (arbitrary custom fields),
  `status` enum (`enabled`/`disabled`/`blocklisted`). **The email uniqueness constraint is global to the whole
  instance** — critical for §15.
- **`lists`**: `id`, `uuid`, `name`, `type` enum (`public`/`private`/`temporary`), `optin` enum
  (`single`/`double`), `status`, `tags[]`. No owner/tenant/organization column of any kind.
- **`subscriber_lists`**: composite PK `(subscriber_id, list_id)`, `status` enum
  (`unconfirmed`/`confirmed`/`unsubscribed`), `meta JSONB`.
- **`templates`**: `id`, `type` enum (`campaign`/`campaign_visual`/`tx`), `subject`, `body`, `body_source`,
  `is_default BOOLEAN` (unique-indexed so exactly one default template can exist instance-wide).
- **`campaigns`**: `id`, `uuid`, `name`, `subject`, `from_email TEXT` (free text, per-campaign, but only usable
  if it matches an SMTP server's configured `from_addresses` for real routing — see §15), `body`,
  `content_type` enum, `send_at`, `status` enum (`draft/running/scheduled/paused/cancelled/finished`),
  `type` enum (`regular`/`optin`), `messenger TEXT` (references a messenger backend by string ID, not an FK),
  `template_id FK`, progress counters (`to_send`, `sent`, `max_subscriber_id`, `last_subscriber_id` — the
  checkpointing fields used by the resumable sender), archive fields (`archive`, `archive_slug UNIQUE`,
  `archive_template_id`).
- **`campaign_lists`**: join table, freezes `list_name` at attach-time so history survives list deletion.
- **`campaign_views`**: open-tracking events, `campaign_id`, nullable `subscriber_id` (kept even if subscriber
  deleted).
- **`media`** / **`campaign_media`**: uploaded assets (filesystem or S3 provider), linked to campaigns.
- **`links`** / **`link_clicks`**: every unique URL in a campaign body is registered once in `links`; each click
  is a row in `link_clicks` with `campaign_id`, `link_id`, nullable `subscriber_id`.
- **`settings`**: a single generic **key/value JSONB table** — this is where `smtp` (an array of SMTP server
  configs), `app.from_email`, `app.root_url`, `app.site_name`, `security.oidc`, `bounce.*`, `upload.*` etc. all
  live. There is exactly one row per key, instance-wide — **no tenant dimension anywhere in this table**.
- **`bounces`**: `subscriber_id`, nullable `campaign_id`, `type` enum (`soft`/`hard`/`complaint`), `source`.
- **`roles`** / **`users`**: RBAC. `roles.type` enum is `user` or **`list`** — a "list role" grants
  get/manage permissions scoped to specific `list_id`s (`roles.list_id`, nullable, FK to `lists`). This is the
  *only* row-level scoping concept in the whole schema (see §15).
- **`sessions`**: server-side cookie session store (`simplesessions` Postgres backend).
- Three **materialized views** (`mat_dashboard_counts`, `mat_dashboard_charts`, `mat_list_subscriber_stats`)
  precompute dashboard aggregates instance-wide.

---

## 7. Folder Structure (annotated)

```
cmd/                    Go backend: main.go (entrypoint, flag/config parsing, Echo server bootstrap),
                        one *.go file per REST resource (handlers only — thin, delegate to internal/core)
internal/
  auth/                 Sessions, API tokens, OIDC, RBAC middleware
  bounce/                Bounce webhook receivers + mailbox (POP/IMAP) scanner
  captcha/               Altcha/hCaptcha verification for public subscribe forms
  core/                  Business logic, one file per resource, wraps prepared SQL queries
  events/                Server-sent-events stream for live admin UI updates (/api/events)
  i18n/                  Backend string translation loader
  manager/               Campaign scheduler + worker pool + SMTP dispatch orchestration (§9-10)
  media/                 Filesystem / S3 media storage abstraction
  messenger/
    email/               SMTP messenger (net/smtp + smtppool)
    postback/             Generic webhook messenger
  migrations/            Versioned Postgres migrations (applied by `--upgrade`)
  notifs/                Admin notification e-mails (campaign started/finished/paused)
  subimporter/           CSV subscriber bulk-import background worker
  tmptokens/             Short-lived tokens (e.g. password reset / signed URLs) NOT VERIFIED in depth
  utils/                 Misc helpers
models/                 Go structs + `queries.go` (maps named SQL query strings to Go vars)
queries/*.sql            Raw named SQL, one file per resource, loaded/prepared at boot
schema.sql               Full DB schema (source of truth, §6)
permissions.json          Declarative RBAC permission catalogue (loaded into role UI, §16)
config.toml.sample        Sample instance config (DB DSN, listen address, upload dir, etc.)
docker-compose.yml         Reference Docker deployment (app + Postgres, §8)
frontend/
  src/
    views/                 Route-level Vue pages (Campaigns, Lists, Subscribers, Settings...)
    components/            Reusable Vue components
    store/                  Vuex/Pinia state
    api/                    Axios wrappers calling the same /api/* REST endpoints Orlixa would call
  email-builder/            Vendored drag-and-drop visual email builder (own LICENSE file, MIT-style,
                             NOT VERIFIED beyond noting it exists and has its own license)
docs/                       Doc source (mirrors listmonk.app/docs)
static/                     Public static assets served by the binary
i18n/                       Backend/frontend translation JSON files
```

---

## 8. Deployment Architecture

Per official docs (listmonk.app/docs/installation) and `docker-compose.yml` in the repo:

- **Single Go binary** + **mandatory PostgreSQL ≥ 12**. No other required runtime dependency (no Redis, no
  message broker, no separate cache).
- Reference `docker-compose.yml` runs exactly two containers: `app` (the listmonk binary) and `db` (Postgres
  17-alpine), connected on one Docker network. The `app` container is given `--install --idempotent` then
  `--upgrade` then a normal run command — all against the same DB.
- Config is via `config.toml` or `LISTMONK_*` environment variables (including a `_FILE` suffix convention for
  Docker/Podman secrets).
- Official docs also list third-party one-click hosts (Elestio, PikaPods, Northflank, Railway, AWS Lightsail)
  and a community Helm chart for Kubernetes — but the docs do **not** describe any clustering, load-balancing,
  or multi-instance-against-one-DB pattern beyond the `ScanCampaigns` split described in §2/§9.
- There is no documented officially-supported horizontal-scaling story: the docs frame this explicitly as a
  single-instance, single-organization mail tool.

---

## 9. Worker Architecture

Verified in `internal/manager/manager.go` and `pipe.go` — **not** a goroutine pool reading off an external
queue; it is:

1. A **ticker-driven DB poller**, `scanCampaigns(tick)`, running as one goroutine, querying
   `campaigns WHERE status IN ('running','scheduled')` (via `store.NextCampaigns`) on interval `ScanInterval`.
2. For every campaign found, a `pipe` struct is created (one per active campaign) that pulls subscriber batches
   from Postgres (`NextSubscribers`, size = `app.batch_size`, default 1000) and streams `CampaignMessage`s onto
   an **in-memory buffered Go channel** `campMsgQ` (capacity `Concurrency * MessageRate * 2`).
3. A **fixed pool of `Concurrency` goroutines** (`app.concurrency` setting, default 10) started once in
   `Manager.Run()` — each is a `for { select { case msg := <-m.campMsgQ: ... } }` loop that dequeues, applies a
   simple per-second `MessageRate` sleep-based throttle, and calls the messenger's `Push()`.
4. Per-campaign progress/rate is tracked with `atomic.Int64`/`sync.WaitGroup` counters on the `pipe`
   (`pipe.sent`, `pipe.rate` via `ratecounter.RateCounter`), and errors beyond `MaxSendErrors` auto-pause the
   campaign (`pipe.OnError()` → `Stop(true)`).
5. All of this lives **inside the one binary process** — there is no separate "worker" executable; the same
   binary can be told not to run the scheduler (`ScanCampaigns: false`) to split "web/API" instances from
   "sender" instances, but they still share the one Postgres DB and one global `settings` row.

---

## 10. Queue Architecture

**DB-based scheduling + in-process Go channels — not a message broker.** Verified precisely:

- The "task list" is the `campaigns` table itself, filtered by `status`; there is no separate jobs/queue table.
- Once a campaign is picked up, the actual message queue is a plain **in-memory Go channel**
  (`chan CampaignMessage`, `chan models.Message`) — `campMsgQ` and `msgQ` in `manager.go`. These do not survive
  a process restart: if the process is killed mid-send, in-flight buffered messages in the channel are lost,
  though the `last_subscriber_id` checkpoint in Postgres means a resumed campaign re-fetches from where the DB
  says it left off (at-least-once at the batch boundary, not per-message).
- Throttling is two-layered: a simple per-second counter (`MessageRate`) inside the worker loop, and an
  optional "sliding window" (`app.message_sliding_window*` settings) enforced in `pipe.NextSubscribers()` that
  sleeps once a rolling count of messages sent in a configurable duration is exceeded.
- **No Redis/RabbitMQ/Kafka/SQS anywhere in `go.mod` or the source** (verified by directory listing of
  `internal/` — no queue-client package is imported).

---

## 11. API Structure

REST API confirmed via `cmd/handlers.go` route table (`/api/*`), authenticated per §5. Representative
endpoints (all real, read from source):

- **Campaigns**: `GET/POST /api/campaigns`, `GET/PUT/DELETE /api/campaigns/:id`, `PUT /api/campaigns/:id/status`
  (start/pause/cancel), `PUT /api/campaigns/:id/archive`, `POST /api/campaigns/:id/test` (send test),
  `POST /api/campaigns/:id/preview`, `GET /api/campaigns/analytics/:type`, `GET /api/campaigns/running/stats`.
- **Lists**: `GET/POST /api/lists`, `GET/PUT/DELETE /api/lists/:id`.
- **Subscribers**: `GET/POST /api/subscribers`, `GET/PUT/DELETE /api/subscribers/:id`,
  `PUT /api/subscribers/lists(:id)` (list membership management), `PUT /api/subscribers/blocklist`,
  `POST /api/subscribers/:id/optin`, bulk operations by SQL query (`/api/subscribers/query/delete`,
  `/query/blocklist`, `/query/lists` — i.e. segment-by-arbitrary-SQL-predicate, then bulk act), CSV import
  (`POST /api/import/subscribers`).
- **Templates**: full CRUD + `PUT /api/templates/:id/default`, `POST /api/templates/preview`.
- **Media**: `GET/POST /api/media`, `GET/DELETE /api/media/:id`.
- **Transactional**: `POST /api/tx` (`tx:send` permission) — send a one-off templated message outside the
  campaign system, the mechanism Orlixa would likely reuse for transactional AI-employee sends.
- **Users/Roles**: full CRUD, plus 2FA endpoints and `roles:manage`.
- **Settings**: `GET/PUT /api/settings`, `PUT /api/settings/:key`, `POST /api/settings/smtp/test` — this is
  where the global SMTP array (§6, §15) is read/written.
- Auth is always the same token/Basic/cookie scheme from §5 — there is no separate API-key scoping mechanism
  beyond the RBAC permission strings in `roles.permissions[]` (i.e., an API user is just a `users.type='api'`
  row with a role, not a narrower "API key with scopes" object).

**Verdict for headless operation**: Yes — every action needed to draft, target, send, and track a campaign is
exposed over the REST API with token auth; nothing requires the admin UI.

---

## 12. Extension Points

- **`internal/messenger/postback`**: a generic webhook messenger — instead of (or alongside) SMTP, a campaign
  can be configured to push messages to an arbitrary HTTP endpoint. This is the closest thing to a plugin
  mechanism and could plausibly be used by Orlixa to intercept sends rather than replacing SMTP.
  (Confirmed this package exists and is registered as a `Messenger` implementation alongside `email`; full
  request/response contract NOT VERIFIED beyond package presence in this pass.)
- **Bounce webhooks**: dedicated inbound webhook endpoints for SES, SendGrid, Postmark, Azure, forwardemail,
  lettermint (`settings.bounce.*` keys, `internal/bounce`) — these are integration points, not a generic
  plugin API.
- **OIDC**: pluggable SSO identity provider (any OIDC-compliant IdP), configured per-instance.
- No webhook system exists for *outbound* events (e.g. "notify me when a campaign finishes") beyond the
  hardcoded admin-notification e-mail (`internal/notifs`) — there is no generic "campaign.finished" webhook a
  third party can subscribe to. (Checked `internal/notifs` and `cmd/events.go` — `events.go` implements a
  Server-Sent-Events stream for the admin UI, not an external webhook registry.)

---

## 13. Plugin System

**None exists.** There is no plugin/module loader, no manifest format, no marketplace, and no dynamic-loading
mechanism (no `.so`/WASM/script-plugin loading code anywhere in `internal/` or `cmd/`). The only points of
extensibility are the messenger interface (§12, requires a Go rebuild to add a new messenger — `postback` is
the one generic escape hatch that doesn't require a rebuild) and OIDC/webhook integrations that are config, not
code, extension points.

---

## 14. Scalability

- Official docs give no distributed/clustering guidance (verified via WebFetch of the installation docs) —
  the framing throughout is single-binary, single-Postgres.
- Sending throughput is governed by `app.concurrency` (worker goroutines), `app.message_rate` (msgs/sec cap),
  and the optional sliding-window limiter (`app.message_sliding_window*`) — all instance-wide settings, not
  per-campaign or per-tenant.
- The one documented scale-out pattern is the `ScanCampaigns` split (§2, §9): run N "front" instances serving
  API/UI traffic with `ScanCampaigns=false`, and exactly one (or a few, uncoordinated — there's no leader
  election) "sender" instance with `ScanCampaigns=true`, all pointed at the same Postgres DB. This scales web
  traffic, not send throughput, and running more than one `ScanCampaigns=true` instance risks duplicate/overlap
  processing since there's no distributed lock in `scanCampaigns()` beyond the in-memory `pipes` map,
  which is **not shared across processes** (NOT VERIFIED whether concurrent multi-sender instances are
  officially unsupported vs. just undocumented — but the in-memory-only pipe map is strong evidence it is
  unsafe to run more than one).
- Postgres itself is the actual scaling bottleneck for send throughput at high subscriber counts, since every
  batch of subscribers and every tracking event is a DB round-trip.

---

## 15. Multi-tenancy

**Confirmed: Listmonk is single-tenant by design.** Verified precisely across three independent angles:

1. **Global settings, no tenant column.** The entire `settings` table (§6) is a flat key/value store with one
   row per key — `smtp` (SMTP server credentials), `app.from_email`, `app.site_name`, `app.root_url`,
   `app.logo_url`, `security.oidc`, `bounce.*` are all single, instance-wide values. There is no
   `tenant_id`/`organization_id` column on `settings`, `lists`, `subscribers`, `campaigns`, or `templates`
   anywhere in `schema.sql`.
2. **Globally-unique subscriber email.** `subscribers.email` has a hard `UNIQUE` constraint
   (case-insensitive, `idx_subs_email`). If Orlixa tried to share one Listmonk instance across two customer
   companies, and both companies happen to have a subscriber with the same email address (e.g. a shared
   business contact, or just coincidence), they would collide onto **the same subscriber row** and share list
   memberships/attributes/history — a real data-isolation bug, not a cosmetic one.
3. **Instance-wide sending & public-facing identity.** Public pages (unsubscribe, subscription-preferences,
   opt-in, archive) are rendered by `cmd/public.go` using a single global `tplRenderer` populated from
   `app.site_name`/`app.root_url`/`app.logo_url`/`app.favicon_url` (confirmed in `public.go` struct fields) —
   every customer's subscribers would see the same branding on unsubscribe/opt-in pages unless Orlixa built a
   proxy layer in front of them.

**One partial exception worth noting**: `internal/messenger/email/email.go` supports **multiple SMTP servers
per instance, keyed by `from_addresses`/domain** (`Emailer.pools map[string][]*Server`, `getPool()` matches
the campaign's `From` address or its domain to a specific server group; falls back to round-robin over all
servers if no match). This means a single Listmonk instance genuinely can send different campaigns through
different SMTP identities/domains — **this is a real, code-level mechanism**, not a guess. It solves the SMTP
sending-identity part of multi-tenancy.

It does **not** solve the rest: lists have no owner field (only `role_type='list'` RBAC roles restrict which
*admin user* can manage which list — that is an access-control boundary for Listmonk operators, not a
data/branding isolation boundary for end customers), subscriber email is globally unique, and public pages are
single-branded. A "list per customer + naming convention" scheme is workable **only** for the send-side
(campaigns/lists/list-role RBAC) but **breaks** the moment two customers share a subscriber email address, and
does nothing for public-page branding or per-customer unsubscribe-page domains.

**Operational verdict for Orlixa**: a genuinely safe multi-tenant deployment requires **one Listmonk instance
(and ideally one Postgres schema/DB) per customer company** — not because of SMTP routing (which the
`from_addresses` mechanism actually handles fine within one instance) but because of the global email-uniqueness
constraint and global public-page branding. A shared instance with list-naming-convention "isolation" is
**not workable** as a production multi-tenant boundary; it would work only for a low-scale internal pilot with
customers who guarantee non-overlapping subscriber emails and don't care about branded public pages — an
explicit risk to flag, not a design to ship.

---

## 16. Security

- **SMTP credential storage**: stored as **plaintext JSON** inside the `settings.value JSONB` column (the
  `smtp` key's sample value in `schema.sql` literally embeds `"password":"password"` as the default) — there is
  no field-level encryption-at-rest for SMTP passwords in the schema itself; protection is whatever Postgres
  disk/transport encryption an operator layers on. (NOT VERIFIED whether the settings API response redacts
  passwords on `GET /api/settings` — would need to check `cmd/settings.go` response serialization to confirm;
  not done in this pass.)
- **API tokens**: stored hashed with SHA-256 (`HashAPIToken`), compared with constant-time comparison
  (`subtle.ConstantTimeCompare`) — reasonable token-at-rest hygiene, though SHA-256 alone (no per-token salt
  beyond the token's own entropy) is weaker than a proper KDF; acceptable for high-entropy random tokens.
  No scoping narrower than the full permission set of the API-user's assigned role (§11) — an API token is as
  powerful as the user account it belongs to, there's no "read-only campaigns" token concept independent of
  RBAC roles.
- **Sessions**: HTTP-only cookies, server-side session store in Postgres, periodic pruning goroutine
  (`sessPruneInterval = 12h`).
- **RBAC**: declarative permission catalogue (`permissions.json`) mapped onto `roles.permissions TEXT[]`; a
  `SuperAdminRoleID` bypasses all permission checks (`Auth.Perm()`).
- **OIDC**: standard authorization-code exchange + ID-token verification against the provider's JWKS, nonce
  checked to prevent replay.
- **CAPTCHA**: Altcha (proof-of-work) or hCaptcha available on public subscription forms to deter bot signups.

---

## 17. Limitations

- **No multi-tenancy** (§15) — the single biggest structural limitation for Orlixa's use case.
- **No distributed/HA send guarantee** — in-memory Go channels mean a crash mid-batch can drop buffered
  messages (only DB-checkpoint-level resume, not per-message durability); no dead-letter queue.
- **No true API-key scoping** — a token is exactly as powerful as its owning user's RBAC role; no "just let
  this token send campaigns, nothing else, expiring in 30 days" concept.
- **No generic outbound webhook/event system** — Orlixa cannot subscribe to "campaign sent"/"link clicked"
  events from Listmonk; it would have to poll the API or read `campaign_views`/`link_clicks` directly from
  Postgres (feasible since it's the same DB, but bypasses the API entirely, which weakens the "Listmonk should
  be invisible plumbing" boundary Orlixa wants).
- **No native rate-limiting per recipient domain** (only global message-rate/sliding-window) — bulk sending
  to e.g. Gmail vs. a small ISP isn't differentiated, a real deliverability risk at scale.
- **SMTP credentials in plaintext JSONB** — needs an operator-side mitigation (DB encryption at rest, network
  isolation) since Listmonk itself doesn't encrypt them.
- **Single default template** (`templates.is_default` unique-indexed) instance-wide — another single-tenant
  smell; can't have a different "default" template per customer without app-side workarounds.

---

## 18. Enterprise-only Features

**Confirmed: none exist.** The repo has exactly one `LICENSE` file at root (AGPLv3, verified by reading the
full preamble) and no `LICENSE-EE`, `enterprise/`, or feature-gating code (no license-key checks, no
`if enterprise.Enabled` branches found in `cmd/` or `internal/`). The only other license file in the whole
repo is `frontend/email-builder/LICENSE`, which belongs to the vendored open-source drag-and-drop email-builder
component bundled into the frontend, not a Listmonk product tier. Listmonk is **fully open-core-free** — one
edition, one license, everything in this document is available to every self-hoster.

---

## 19. Community Features

Everything documented above ships in the single open-source edition, since there is no split (§18): full
campaign/list/subscriber/template/media management, REST API, RBAC with list-scoped roles, OIDC SSO, 2FA,
bounce processing (multiple ESP webhook integrations), CSV import, public subscription/archive pages, CAPTCHA,
S3-or-filesystem media storage, transactional send API, dashboard analytics (materialized views), Docker/Helm
deployment tooling.

---

## 20. Which parts should Orlixa reuse

- **The REST API surface wholesale** (§11) — campaigns/lists/subscribers/templates/media/tx endpoints are
  complete and well-shaped for the AI employee to drive entirely headlessly; rebuilding this would be pure
  waste.
- **The SMTP messenger + `from_addresses` routing mechanism** (§9, §15) — genuinely reusable per-customer
  sending-identity routing within one instance, which is non-trivial to build correctly (SMTP pooling, TLS/auth
  variants, round-robin) and Listmonk already does it well.
- **The campaign send engine / pipe checkpointing model** (§4, §9) — the resumable-batch-with-checkpoint
  design (`last_subscriber_id`) is a solid, simple pattern worth keeping as-is inside each per-customer
  instance.
- **Bounce-handling integrations** (§12, SES/SendGrid/Postmark/etc. webhooks) — deliverability plumbing Orlixa
  should not reinvent.
- **Tracking (`links`/`link_clicks`/`campaign_views`)** — proven schema for open/click analytics that the AI
  employee can query/report on directly.
- **List-scoped RBAC roles** (`role_type='list'`) — useful if Orlixa ever exposes a human reviewer role scoped
  to specific customer lists within one deployment.

---

## 21. Which parts should Orlixa replace

- **The admin UI entirely** — by design, Orlixa customers never see it; the Vue SPA (§3, §7) is dead weight
  Orlixa should keep disabled/unrouted in production, driving everything through the API instead.
- **Per-tenant deployment/provisioning** — since Listmonk has no tenant concept (§15), Orlixa needs its own
  provisioning layer (one Listmonk instance + DB per customer, spun up/torn down programmatically) — this is
  new infrastructure Orlixa must build, not something to take from Listmonk.
- **API-token scoping/lifecycle** — Orlixa's own control plane should mint, rotate, and narrowly scope
  credentials per customer/workflow rather than relying on Listmonk's coarse RBAC-role-as-token model (§16).
- **Outbound eventing** — since Listmonk has no webhook/event system (§12, §17), Orlixa needs its own poller or
  direct-DB-read layer to learn "campaign finished" / "bounced" / "clicked" and feed that back into the AI
  employee's conversation/approval loop.
- **SMTP credential-at-rest protection** — wrap Listmonk's plaintext-JSONB settings with Orlixa's own secrets
  manager/vault rather than trusting Listmonk's storage directly.

---

## 22. Which parts should Orlixa ignore

- **Plugin system** — doesn't exist (§13); no need to evaluate or build against one.
- **OIDC/SSO login** — irrelevant if Orlixa customers never log into Listmonk directly; only useful if Orlixa
  ever needs a human ops team to access a given customer's Listmonk instance directly for support, in which
  case it's a nice-to-have, not core.
- **Public subscription/opt-in page theming** (`appearance.public.*` settings) — since these are single-branded
  per instance (§15) and Orlixa likely wants its *own* customer-facing subscribe/unsubscribe experience anyway
  (consistent with "customers never see Listmonk"), these built-in public pages are not worth customizing —
  either proxy/rebrand them per-instance minimally, or bypass them and manage unsubscribe UX at the Orlixa layer.
- **CAPTCHA integrations** — only relevant if Listmonk's own public subscribe forms are exposed directly to
  end users, which contradicts the "invisible plumbing" model; skip unless a customer explicitly needs a public
  self-serve subscribe form.
- **Helm chart / Kubernetes tooling** — useful only if Orlixa's ops team chooses container orchestration for
  the per-customer-instance fleet; not an architectural decision driven by Listmonk itself.
- **Dashboard materialized views / built-in analytics UI** — Orlixa's AI employee will present its own
  synthesized reporting to customers; Listmonk's dashboard is redundant once the AI chat interface is the only
  surface customers see.
