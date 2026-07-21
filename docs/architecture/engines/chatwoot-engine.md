# Engine Study: Chatwoot → AI Customer Support Employee

**Source basis**: real clone of `chatwoot/chatwoot` (Ruby on Rails + Vue.js) at
`C:\Users\Admin\AppData\Local\Temp\claude\chatwoot-src`, read directly (models, controllers, jobs,
listeners, `db/schema.rb`, `config/routes.rb`, `config/sidekiq.yml`, `enterprise/`), plus official
docs (`www.chatwoot.com/hc`, `developers.chatwoot.com`) fetched live. Where a docs page 404'd/502'd
and could not be re-verified, this is marked **NOT VERIFIED** rather than guessed. No blog posts or
third-party articles were used.

---

## 1. Executive Summary

Chatwoot is a self-hostable, multi-channel customer-engagement platform (Rails 7 API + Vue 3 SPA):
one shared inbox across email, live-chat widget, WhatsApp, Facebook/Instagram, Twitter, SMS,
Telegram, Line, TikTok, and a generic "API channel," with agents, teams, canned responses,
automation rules, and reporting. The single most important architectural fact for this study is
that **Chatwoot's "Enterprise Edition" is not a separate codebase** — it is a literal `enterprise/`
folder inside the same public repo, loaded automatically whenever that folder exists on disk
(`ChatwootApp.enterprise?` just checks `root.join('enterprise').exist?`), and premium behavior is
enabled/disabled per-account via a bitset (`accounts.feature_flags`) reconciled against an
externally-fetched `pricing_plan` string (default `'community'`) pulled from Chatwoot's own hosted
license service (`ChatwootHub`, `hub.2.chatwoot.com`) — not by removing code, and with **no
cryptographic license-key check found in source**.

> **This is a licensing fact, not a loophole, and must not be treated as one.** The repo's root
> `LICENSE` file explicitly states everything under `enterprise/` is governed by a *separate*
> license (`enterprise/LICENSE`), confirmed by reading that file directly: it is a proprietary,
> BSL-style license that permits copying/modifying the code for development and testing **without**
> a subscription, but explicitly requires "a valid Chatwoot Enterprise License for the correct
> number of user seats" for **any production use**, regardless of whether the technical gate is
> enabled. The weak technical enforcement described above does not change this — it only means the
> gate is easy to defeat, not that defeating it is permitted. **Orlixa must not enable or run any
> `enterprise/` feature (Captain AI, SLA, SAML, Audit Logs, Custom Roles, Voice/Twilio, Advanced
> Search) in anything customer-facing or production without an actual paid Chatwoot Enterprise
> subscription.** This document describes the mechanism for architectural understanding only.

For Orlixa, the clean integration seam is
the **Agent Bot** model (`app/models/agent_bot.rb`) plus a generic **`Channel::Api` inbox** — Chatwoot
already supports "assign this inbox/conversation to a webhook bot that receives every event and
replies over the normal Messages API," which is exactly the black-box shape needed to plug in
Orlixa's own AI Customer Support Employee without ever exposing Chatwoot's own UI. Chatwoot's own
"Captain" AI (an Enterprise/premium feature, OpenAI-backed, living entirely in `enterprise/app/services/captain/`)
would compete with, not complement, Orlixa's own reasoning layer — see §20-22.

## 2. Architecture Diagram

```
                 ┌───────────────────────────┐
  End customer──►│  Widget JS / Email / WA /  │
                 │  FB/IG/Twitter/SMS/Telegram│
                 │  /Line/TikTok/API channel  │
                 └────────────┬───────────────┘
                              │ inbound webhook (per-channel controller)
                     ┌────────▼─────────┐        ┌───────────────┐
                     │   Rails app       │◄──────►│  PostgreSQL   │
                     │ (app/controllers, │        │  (schema.rb)  │
                     │  app/models,      │        └───────────────┘
                     │  app/builders)    │        ┌───────────────┐
                     └────────┬──────────┘◄──────►│    Redis      │ (Sidekiq queues,
                              │ ActiveSupport::Notifications /       ActionCable, cache,
                              │ Wisper events (Dispatcher)            pubsub tokens)
                     ┌────────▼──────────┐        └───────────────┘
                     │    Listeners      │  (app/listeners/*)
                     │ webhook_listener, │───► outbound Webhook (account/inbox subscriptions)
                     │ agent_bot_listener│───► outbound Agent-Bot webhook (AI/automation seam)
                     │ automation_rule,  │───► Sidekiq jobs (app/jobs/*, enterprise/app/jobs/*)
                     │ notification, ... │
                     └────────┬──────────┘
                              │ ActionCable broadcast
                     ┌────────▼──────────┐
                     │  Vue 3 SPA        │  Agent dashboard (app/javascript)
                     │  (agent browser)  │
                     └───────────────────┘
```
(Derived from `app/dispatchers/dispatcher.rb`, `app/listeners/*.rb`, `config/sidekiq.yml`,
`docker-compose.production.yaml`.)

## 3. Component Diagram

- **Rails monolith** (`app/`): `controllers` (REST API, widget API, platform API, public API),
  `models` (Account/Inbox/Conversation/Message/Contact/User + `channel/*` STI-like per-channel
  models), `builders` (e.g. message/conversation builders), `services` (business logic objects,
  per-channel `SendOnXService`), `jobs` (Sidekiq/ActiveJob), `listeners` (Wisper event subscribers），
  `dispatchers` (sync/async event fan-out), `mailboxes` (ActionMailbox inbound email routing),
  `policies` (Pundit authorization).
- **`enterprise/`**: mirrors the same `app/` structure (`enterprise/app/{models,controllers,
  services,jobs,...}`) and is `require`d only when the folder is present — see §18. Contains Captain
  AI, SLA, SAML, Audit Logs, Custom Roles, Voice/Twilio calling, "Companies" CRM object.
- **`app/javascript`**: Vue 3 SPA (agent dashboard) + a separate widget bundle served to end
  customers embedding the live-chat widget.
- **Sidekiq workers**: separate process (`worker` in `Procfile`) consuming Redis-backed queues.
- **Postgres**: system of record (also stores `pgvector`-style embeddings for Captain via
  `article_embeddings`/`nearest_neighbors`, enterprise-only).
- **Redis**: Sidekiq queues, ActionCable pub/sub, contact/user `pubsub_token` presence.

## 4. Request Flow

Concrete trace: **inbound WhatsApp message → conversation → reply**, using real classes.

1. WhatsApp Cloud API/360dialog POSTs to the WhatsApp webhook controller
   (`app/controllers/webhooks/whatsapp_controller.rb`-family, routed per `Channel::Whatsapp`'s
   `phone_number`/`provider_config`).
2. A per-provider inbound builder (`app/builders` / `app/services` under `whatsapp/`) resolves the
   `Channel::Whatsapp` → its `Inbox` (via the `Channelable` concern's `has_one :inbox, as: :channel`),
   finds/creates a `Contact` + `ContactInbox` (keyed by `source_id`), and finds/creates a
   `Conversation` (`account_id`, `inbox_id`, `contact_id`, `display_id`).
3. A `Message` row is created (`message_type: incoming`, `sender_type: 'Contact'`).
4. `Message` creation fires ActiveRecord callbacks → `Dispatcher.dispatch('message_created', ...)`
   (`app/dispatchers/dispatcher.rb`) → both `SyncDispatcher` and `AsyncDispatcher` walk
   `app/listeners/*` (Wisper pattern). Relevant listeners on `message_created`:
   - `WebhookListener#message_created` → if `message.webhook_sendable?`, enqueues
     `WebhookJob.perform_later(webhook.url, payload, :account_webhook, secret:, delivery_id:)` for
     every `Webhook` row subscribed to `message_created` (`app/listeners/webhook_listener.rb`).
   - `AgentBotListener#message_created` → if an `AgentBot` is assigned to the conversation or the
     inbox (`conversation.assignee_agent_bot` / `inbox.agent_bot_inbox`), enqueues
     `AgentBots::WebhookJob.perform_later(agent_bot.outgoing_url, payload, :agent_bot_webhook,
     secret: agent_bot.secret, ...)` (`app/listeners/agent_bot_listener.rb`).
   - `NotificationListener`, `ReportingEventListener`, `ActionCableListener` also fire (agent UI
     real-time update, reporting rollups).
5. **Agent/AI assignment**: either a human agent picks up the conversation in the Vue dashboard
   (assignee via `conversations.assignee_id`), or — if this is the seam Orlixa uses — the external
   Agent Bot receives the webhook payload, computes a reply, and calls back into Chatwoot's normal
   Conversation/Message **API** (`POST /api/v1/accounts/:account_id/conversations/:id/messages`) to
   post an `outgoing` message.
6. Reply message creation triggers `SendReplyJob` (`app/jobs/send_reply_job.rb`), which looks up
   `CHANNEL_SERVICES['Channel::Whatsapp'] = Whatsapp::SendOnWhatsappService` and calls
   `.new(message:).perform` to actually push the reply back out over the WhatsApp Business API.
7. `message_updated`/`conversation_updated` events re-fire the same listener fan-out (webhooks,
   ActionCable) so the agent UI and any external webhook subscriber see the outgoing message live.

## 5. Authentication Flow

Two genuinely separate mechanisms, verified in source:

**Agent/admin login** — `ApplicationController` includes
`DeviseTokenAuth::Concerns::SetUserByToken` (`app/controllers/application_controller.rb`); Chatwoot
uses the `devise_token_auth` gem on top of Devise (`config/initializers/devise.rb` +
`devise_token_auth.rb`). Login issues `access-token` / `client` / `uid` headers the SPA stores and
replays on every API call; `users` table (`db/schema.rb:1428`) carries
`encrypted_password, otp_secret, otp_required_for_login, otp_backup_codes` — TOTP-based MFA is
built into Community Edition (`app/controllers/*/profile/mfa_controller.rb`-style), not
enterprise-gated. `AccountUser` join row scopes a user to an account with a `role` int
(agent/administrator).

**End-customer / widget auth** — no Devise session at all. The widget authenticates via a signed
"website token" resolved to an `Inbox` (`WebsiteTokenHelper`), then a `Contact` +
`ContactInbox` pair is created/found; `contact_inboxes.source_id` is the channel-specific identity
and `contact_inboxes.hmac_verified` (boolean) + `contacts`/`users`'s own `pubsub_token` columns
(`schema.rb:1450`, `:712`) are the two real trust anchors:
- **HMAC identity verification**: if the business configures `Inbox#hmac_token`/`identity_validation`,
  the frontend must pass an HMAC of the customer's external ID; `Api::V1::Widget::BaseController`
  branches conversation lookup on `@contact_inbox.hmac_verified?` (verified code, see §4 file
  `app/controllers/api/v1/widget/base_controller.rb`).
- **`pubsub_token`**: a random per-contact/per-user token used to authorize the ActionCable
  websocket subscription (real-time delivery), not a general API bearer credential.
- The generic **`Channel::Api`** channel (`app/models/channel/api.rb`) is the "headless inbox" case:
  it has its own `hmac_token`/`secret`/`webhook_url` columns and `hmac_mandatory` flag — an external
  system (like Orlixa) posts messages via the **Public API**
  (`namespace :public do ... resources :inboxes/:contacts/:conversations/:messages`,
  `config/routes.rb:590-611`) and Chatwoot pushes replies back to `webhook_url`, HMAC-signed with
  `secret`. This requires no widget, no cookies, no Devise session — pure API+webhook, which is the
  seam Orlixa should use (see §20).

**Platform API auth** (account/user provisioning) — a third, separate mechanism:
`PlatformController` (`app/controllers/platform_controller.rb`) authenticates via a static
`api_access_token` header looked up against an `AccessToken` row whose `owner` is a `PlatformApp`
record, then checks `PlatformAppPermissible` join rows before allowing access to a given
account/user — i.e. a Chatwoot-cloud-style "reseller" credential, scoped per-resource.

## 6. Database Design

All read directly from `db/schema.rb` (Postgres, migrations via ActiveRecord):

- **`accounts`** (schema.rb:62): `id (serial)`, `name`, `locale`, `domain`, `support_email`,
  `feature_flags`/`feature_flags_ext_1` (bitset, see §18), `limits` (jsonb), `custom_attributes`
  (jsonb), `status`, `internal_attributes` (jsonb), `settings` (jsonb). This is the tenant root
  (see §15).
- **`account_users`** (schema.rb:43): join of `account_id`+`user_id`, `role` int, `inviter_id`,
  `availability`, `auto_offline`, `custom_role_id` (enterprise), `agent_capacity_policy_id`
  (enterprise). Unique index on `(account_id, user_id)`.
- **`users`** (schema.rb:1428): Devise/DeviseTokenAuth columns (`encrypted_password`, `tokens` json,
  `otp_secret`, `otp_required_for_login`, `otp_backup_codes`), `pubsub_token`, `ui_settings` (jsonb),
  `type` (STI — `User`/`SuperAdmin` per `super_admin.rb`).
- **`inboxes`** (schema.rb:1034): `channel_id`+`channel_type` (polymorphic pointer to one of the
  `channel_*` tables), `account_id`, `enable_auto_assignment`, `greeting_*`, `working_hours_enabled`,
  `auto_assignment_config` (jsonb), `lock_to_single_conversation`, `portal_id` (help-center link),
  `csat_survey_enabled`/`csat_config`.
- **`contacts`** (schema.rb:720): `account_id`, `email`/`phone_number`/`identifier` (each unique
  *per account*, not globally — `uniq_email_per_account_contact` etc.), `additional_attributes`/
  `custom_attributes` (jsonb), `blocked`, `company_id` (enterprise CRM link), GIN trigram index for
  fuzzy name/email search.
- **`contact_inboxes`** (schema.rb:705): `contact_id`+`inbox_id`+`source_id` (unique per inbox),
  `hmac_verified`, `pubsub_token` (unique) — the per-channel identity/session row.
- **`conversations`** (schema.rb:764): `account_id`, `inbox_id`, `status` int, `assignee_id`
  (a `User`), `assignee_agent_bot_id` (an `AgentBot` — bots can literally own a conversation),
  `contact_id`, `contact_inbox_id`, `display_id` (per-account sequential number, unique with
  `account_id`), `team_id`, `campaign_id`, `sla_policy_id` (enterprise), `priority`,
  `snoozed_until`, `waiting_since`, `cached_label_list`, `uuid`.
- **`messages`** (schema.rb:1140): `account_id`, `inbox_id`, `conversation_id`, `message_type` int
  (incoming/outgoing/activity/template), `private` (internal note flag), `content_type`,
  `content_attributes`/`external_source_ids`/`additional_attributes`/`sentiment` (jsonb),
  polymorphic `sender_type`+`sender_id` (a `Contact`, `User`, or `AgentBot`), `source_id`
  (dedupe/idempotency key for provider message IDs).
- **`teams`** (schema.rb:1395): `account_id`, `name`, `allow_auto_assign`.
- **`automation_rules`** (schema.rb:280): `account_id`, `event_name`, `conditions`/`actions`
  (jsonb — a rules-engine, not code), `active`.
- **`webhooks`** (schema.rb:1468): `account_id`, `inbox_id`, `url`, `webhook_type`, `subscriptions`
  (jsonb array default: `conversation_status_changed, conversation_updated, conversation_created,
  contact_created, contact_updated, message_created, message_updated, webwidget_triggered`),
  `secret` — the outbound webhook subscription table Orlixa would use for API-out.
- **`agent_bots`** (schema.rb:126) / **`agent_bot_inboxes`**: `outgoing_url`, `secret`, `bot_type`
  (enum, only `webhook` defined), `bot_config` (jsonb) — the AI/automation seam (§4, §12, §20).
- Enterprise-only tables present in the same schema (code ships, feature-gated): `calls`
  (schema.rb:293, Voice/Twilio), `agent_capacity_policies`, `agent_sessions` (Captain), `leaves`
  (HR-ish "Companies" module).

## 7. Folder Structure

```
app/
  controllers/        Rails controllers: api/v1 (agent-facing REST), api/v2 (reports),
                       api/v1/widget (end-customer widget API), platform/api/v1 (provisioning API),
                       public/api/v1 (headless inbox API for contacts/conversations/messages),
                       webhooks/ (inbound channel webhooks: whatsapp, facebook, twilio, etc.)
  models/              Account, Inbox, Conversation, Message, Contact, User, Team, AutomationRule,
                       Webhook, AgentBot + channel/*.rb (one model per channel type)
  models/channel/      Channel::Email, ::Whatsapp, ::FacebookPage, ::Api, ::Sms, ::Telegram, ::Line,
                       ::Twilio_sms, ::Twitter_profile, ::Tiktok, ::Instagram, ::Web_widget
  services/            business logic: <Provider>::SendOnXService (outbound), builders for messages
  builders/            object builders used across contact/conversation/message creation
  jobs/                ActiveJob classes run via Sidekiq (86 files at top level)
  listeners/           Wisper event subscribers: webhook_listener, agent_bot_listener,
                       automation_rule_listener, notification_listener, action_cable_listener,
                       csat_survey_listener, campaign_listener, hook_listener,
                       installation_webhook_listener, participation_listener, reporting_event_listener
  dispatchers/          Dispatcher/SyncDispatcher/AsyncDispatcher — event fan-out plumbing
  mailboxes/            ActionMailbox inbound-email routing
  policies/             Pundit authorization policies
  javascript/           Vue 3 SPA (agent dashboard) + widget frontend bundle
enterprise/            mirror of the same app/ tree — only loaded if this folder exists (§18)
config/
  routes.rb            all namespaces: api/v1, api/v2, widget, platform/api/v1, public/api/v1,
                       enterprise/api/v1 (gated by `if ChatwootApp.enterprise?`)
  sidekiq.yml           queue priority list (§10)
  features.yml          the feature-flag catalog with `premium:`/`chatwoot_internal:` metadata (§18)
db/schema.rb            source of truth for the schema (read directly for §6)
lib/chatwoot_app.rb      ChatwootApp.enterprise?/chatwoot_cloud?/self_hosted_enterprise? (§18)
lib/chatwoot_hub.rb      license/telemetry client talking to hub.2.chatwoot.com (§18)
spec/                    RSpec tests — useful for confirming intended behavior of jobs/listeners
```

## 8. Deployment Architecture

Per `docker-compose.production.yaml` (read directly) and the official self-host Docker guide
(`developers.chatwoot.com/self-hosted/deployment/docker`, fetched live): four services are required
— **`rails`** (web, port 3000, proxy via Nginx), **`sidekiq`** (worker), **`postgres`**, **`redis`**.
Docs confirm Postgres/Redis can be swapped for managed equivalents via environment variables. The
`Procfile` (read directly) shows the process model used by Render/Heroku-style PaaS deploys:
`release` runs `rails db:chatwoot_prepare`, `web` runs `bin/rails server`, `worker` runs
`bundle exec sidekiq -C config/sidekiq.yml`. Official docs give **no explicit horizontal-scaling
recipe** (confirmed by direct fetch) beyond "point Sidekiq concurrency at `SIDEKIQ_CONCURRENCY` env
var" and "you can build separate web/worker images from the base image" — this is a real gap, see
§14/§17.

## 9. Worker Architecture

Sidekiq (via ActiveJob `ApplicationJob`), 86 job classes in `app/jobs/` plus more under
`enterprise/app/jobs/`. Representative real classes (all read directly):
- `SendReplyJob` — dispatches outgoing message to the correct `SendOnXService` per channel (§4).
- `WebhookJob` / `AgentBots::WebhookJob` — deliver signed outbound HTTP webhooks.
- `EventDispatcherJob` — async half of the Dispatcher event fan-out.
- `AutomationRuleListener`-triggered jobs — run automation-rule actions.
- `ConversationReplyEmailJob`, `SendOnSlackJob`, `SlackUnfurlJob`, `UpdateSlackMessageJob` —
  integration-specific delivery.
- `ContactIpLookupJob`, `UserSessionIpLookupJob` — enrichment.
- `DataImportJob`, `BulkActionsJob`, `MacrosExecutionJob`, `TriggerScheduledItemsJob` — bulk/admin ops.
- `DeleteObjectJob`, `MutexApplicationJob` (base class enforcing a Redis mutex per job key).
- Enterprise-only jobs (`enterprise/app/jobs/captain/**`): `Captain::Documents::*`,
  `Captain::Conversation::*`, `Captain::Llm::*`, `Captain::Copilot::*` — AI response generation,
  document ingestion/embedding, FAQ suggestion.

## 10. Queue Architecture

Confirmed directly from `config/sidekiq.yml`: Redis-backed Sidekiq, single shared queue set with a
**strict priority order** (higher queues drain first, lower queues starve under load — this is a
simple priority list, not weighted round-robin):
```
critical > high > medium > default > mailers > action_mailbox_routing > low > scheduled_jobs
> deferred > purgable > housekeeping > async_database_migration > bulk_reindex_low
> active_storage_analysis > active_storage_purge > action_mailbox_incineration
```
`:max_retries: 3`, `:timeout: 25`, concurrency defaults to `ENV['SIDEKIQ_CONCURRENCY'] || 10`
(same value used for both `production` and `staging` — no differentiated tuning in the shipped
config). `SendReplyJob` runs on `:high`.

## 11. API Structure

Real namespaces from `config/routes.rb`:
- **`api/v1/accounts/:account_id/...`** — the main agent-facing REST API: conversations, messages,
  contacts, inboxes, teams, labels, macros, canned responses, automation rules, custom attributes,
  reports (v1). Auth via DeviseTokenAuth headers (§5).
- **`api/v2/accounts/:account_id/...`** — newer reporting endpoints (`summary_reports`, `reports`,
  `live_reports`) — a versioned split for analytics only, not a full v2 of the whole API.
- **`api/v1/widget/...`** (`namespace :widget`) — end-customer widget API: `messages`,
  `conversations`, `contact`, `events`, `campaigns`, `direct_uploads`, `inbox_members`. Session
  established via website-token + HMAC/pubsub, not DeviseTokenAuth (§5).
- **`platform/api/v1/...`** — provisioning API: `users` (create/show/update/destroy + `login`/
  `token`), `accounts` (create/update/destroy + `account_users`), `agent_bots`. Auth via
  `api_access_token` header against a `PlatformApp` owner (§5). **This is the API Orlixa would call
  to programmatically provision one Chatwoot account per Orlixa customer.**
- **`public/api/v1/...`** (`namespace :public`) — the headless inbox API: `inboxes/:id/contacts/
  :id/conversations/:id/messages`, plus `csat_survey`. No agent session needed; designed for the
  `Channel::Api` inbox type. **This is the API Orlixa's own chat UI would call to push
  end-customer messages into Chatwoot without ever rendering Chatwoot's widget.**
- **`enterprise/api/v1/...`** — only routed `if ChatwootApp.enterprise?` (billing/checkout,
  Stripe/Firecrawl webhooks) — confirmed conditional routing in source (`routes.rb:539-560`).
- Help Center (`hc/:slug/...`) — public knowledge-base routes, separate from the ticketing API.

## 12. Extension Points

New channel = new `Channel::X` model including the `Channelable` concern (`app/models/concerns/
channelable.rb`, gives it `belongs_to :account` + `has_one :inbox, as: :channel`), a matching
inbound-webhook controller under `app/controllers/webhooks/`, and a new
`<Provider>::SendOnXService` registered in `SendReplyJob::CHANNEL_SERVICES` (`app/jobs/
send_reply_job.rb`, verified: 11 channels wired this way today — Twitter, Twilio SMS, Line,
Telegram, WhatsApp, Sms, Instagram, TikTok, Email, WebWidget, Api, plus a special-cased Facebook
branch). This is a real, code-level extension pattern, not just configuration. Automations
(`automation_rules.conditions`/`actions` as jsonb) are a data-driven rules engine, not a plugin
system — new **trigger event types** or **action types** still require a Ruby code change
(`app/models/automation_rule.rb` + a handler), confirmed by inspecting the jsonb-driven design; no
user-installable trigger/action registration mechanism was found.

## 13. Plugin System

**No general third-party plugin/extension-marketplace system exists** in the source. There is no
plugin manifest, no dynamic-loading directory for community add-ons, and no plugin API surface
distinct from the extension points in §12. The closest analogues are: (a) the Agent Bot webhook
mechanism (an integration point, not a plugin), (b) `Integrations::App`/`IntegrationsHooks` records
(`app/models/integrations.rb`, `integrations_hooks` table) which model a fixed catalog of built-in
integrations (Slack, Dialogflow, Linear, Notion, etc.), not arbitrary user code. Confirmed by
directory search — no `plugins/` folder, no dynamic `require` of external gems for features.

## 14. Scalability

Official self-host docs (fetched live) give **no explicit horizontal-scaling walkthrough**; they
confirm Postgres/Redis can be externalized to managed services and that web/worker can run as
separate container images/processes, but do not document read replicas, multi-node Sidekiq sharding,
or queue partitioning — **NOT VERIFIED beyond what the docs literally state**. From source:
Sidekiq concurrency is a single `SIDEKIQ_CONCURRENCY` env var (default 10) with no per-queue
concurrency split (`config/sidekiq.yml`), meaning all queues share one worker pool per process —
scaling is "run more Sidekiq processes/containers," a standard Sidekiq pattern, not something
Chatwoot documents specially. No ActiveRecord read-replica configuration was found in
`config/database.yml`-equivalent files during this pass — **NOT VERIFIED as absent**, only as "not
found in the files inspected."

## 15. Multi-tenancy

`Account` is the tenant root (schema §6). Isolation is **manual, controller-level scoping**, not a
database-level or ORM-level global scope:
- `EnsureCurrentAccountHelper#current_account` (`app/controllers/.../ensure_current_account_helper.rb`,
  read directly) loads `Account.find(params[:account_id])`, checks `account.active?`, then verifies
  the current user has an `AccountUser` row for that account (`account_accessible_for_user?`) —
  or, for Agent-Bot-authenticated requests, that the bot belongs to that account
  (`account_accessible_for_bot?`). Sets `Current.account`/`Current.account_user` (Rails
  `CurrentAttributes`) for the rest of the request.
- Nearly every table carries an explicit `account_id` column with an index (verified across
  `contacts`, `conversations`, `messages`, `inboxes`, `teams`, `webhooks`, `automation_rules`, etc.
  in schema.rb) — isolation is enforced by every query being scoped through `Current.account`/
  associations, not by Postgres row-level security or a gem like `acts_as_tenant`. No RLS policies
  were found in `db/schema.rb`.

## 16. Security

- Agent auth: Devise + `devise_token_auth` (bcrypt password hashing via `encrypted_password`), TOTP
  MFA columns present on `users` (`otp_secret`, `otp_required_for_login`, `otp_backup_codes`) —
  built into Community Edition, confirmed non-enterprise (not listed in `features.yml` as
  `premium: true`, and the migration/model code lives outside `enterprise/`).
- Channel credential storage: channel tables store secrets in plain columns (e.g.
  `channel_whatsapp.provider_config` jsonb, `channel_api.secret`/`hmac_token`, `agent_bots.secret`)
  — **no column-level encryption (e.g. Rails `encrypts`) was found on these columns** in the schema
  read; this is a real, verified gap, not an assumption (see §17).
  Outbound webhook payloads are HMAC-signed using each `Webhook`/`AgentBot`/`Channel::Api`'s own
  `secret` (`WebhookSecretable` concern, referenced in `agent_bot.rb`, `channel/api.rb`).
- Widget/customer identity: optional HMAC "identity validation" ties a `ContactInbox` to a
  business-verified external ID (`contact_inboxes.hmac_verified`), preventing a customer from
  spoofing another customer's conversation history.
- Rate limiting: **not found/verified** in the files inspected during this pass — no `rack-attack`
  config or equivalent was located; marked **NOT VERIFIED** rather than assumed absent, since a
  full repo-wide search was not exhaustive at this reasoning depth.

## 17. Limitations

Verified/observed gaps (not invented):
- No first-party horizontal-scaling guide (§14) — operators are left to standard Rails/Sidekiq
  scaling knowledge.
- Channel provider secrets stored without visible column-level encryption (§16).
- The "Enterprise" gate is a **self-reported config value** (`InstallationConfig` row
  `INSTALLATION_PRICING_PLAN`) reconciled against a remote hub call
  (`Internal::ReconcilePlanConfigService`, `ChatwootHub.pricing_plan`) — there is no cryptographic
  license-key verification visible in source; a self-hoster with database access could set this
  value directly. **This is a description of a technical mechanism, not a usable option**: the root
  `LICENSE` file states `enterprise/` is governed by its own proprietary license
  (`enterprise/LICENSE`, read directly), which requires a paid Enterprise subscription for any
  production use regardless of whether the technical gate is bypassed. Weak enforcement does not
  make bypassing it permitted — see §1's callout.
- `AgentBot#bot_type` enum defines only `webhook: 0` — there is no first-class SDK/gRPC/streaming
  bot protocol, only fire-and-forget HTTP webhook + reply-via-API, which is simple but means no
  built-in retry/ack semantics beyond what `AgentBots::WebhookJob`'s own job-retry provides.
- Reporting API is split awkwardly across `v1` (legacy) and `v2` (`summary_reports`/`live_reports`)
  namespaces (§11) rather than a single coherent version.

## 18. Enterprise-only Features

Mechanism (verified in source, `lib/chatwoot_app.rb` + `config/features.yml` +
`enterprise/app/services/internal/reconcile_plan_config_service.rb`):
`ChatwootApp.enterprise?` is true whenever the `enterprise/` directory physically exists (true for
this clone, and true for anyone who clones the full public repo) unless `DISABLE_ENTERPRISE` env is
set. Every feature in `config/features.yml` marked `premium: true` gets **disabled at the account
level** by `Internal::ReconcilePlanConfigService#reconcile_premium_features` whenever
`ChatwootHub.pricing_plan` (fetched from the account's own `InstallationConfig` row, defaulting to
`'community'`) is `'community'`. **Legally, this list requires a paid Chatwoot Enterprise
subscription for production use regardless of the technical flag state** — see §1/§17. Features
marked `premium: true` in `config/features.yml` (verified list, ENTERPRISE ONLY, license required
for production use, under default self-hosted config):
- `disable_branding` — ENTERPRISE ONLY
- `audit_logs` — ENTERPRISE ONLY
- `custom_tools` (Captain) — ENTERPRISE ONLY
- `sla` — ENTERPRISE ONLY
- `help_center_embedding_search` — ENTERPRISE ONLY
- `captain_integration` / `captain_integration_v2` / `captain_v1_action_classifier` /
  `captain_document_auto_sync` — ENTERPRISE ONLY (Captain AI, all variants)
- `custom_roles` — ENTERPRISE ONLY
- `channel_voice` — ENTERPRISE ONLY (Twilio-backed voice calling, `calls` table)
- `advanced_search` / `advanced_search_indexing` — ENTERPRISE ONLY (OpenSearch-backed; also gated
  separately by `ChatwootApp.advanced_search_allowed?` requiring `OPENSEARCH_URL` env)
- `saml` — ENTERPRISE ONLY (SSO)
- `companies` — ENTERPRISE ONLY (a CRM "Company" object linking contacts, `enterprise/app/models`)
- `csat_review_notes` — ENTERPRISE ONLY
- `conversation_required_attributes` — ENTERPRISE ONLY
- `advanced_assignment` — ENTERPRISE ONLY (assignment policies beyond basic auto-assign)

Confirmed by official pricing page (fetched live, `chatwoot.com/pricing`): Captain AI, SSO/SAML, and
Audit Logs are explicitly cloud-paid-tier features; SLA is "Included in Business and Enterprise."
This matches the source-level `premium: true` list above — **cross-verified, not assumed**.

## 19. Community Features (self-hosted, confirmed free)

From `config/features.yml`, everything **not** marked `premium: true` and not living exclusively
under `enterprise/`: multi-channel inboxes (email, website widget, WhatsApp, Facebook, Instagram,
Twitter, SMS, Telegram, TikTok, generic API channel), conversations/contacts/teams/labels/canned
responses/macros, automation rules, campaigns, basic reporting (`reports` v1/v2), CRM-lite
(`crm`/`crm_integration`), Agent Bots (webhook-based — the AI seam itself is Community, not
Enterprise, confirmed: `agent_bots` feature has `enabled: true`, no `premium` key), Help Center,
Integrations (Slack, Dialogflow, Linear, Notion, Shopify), TOTP MFA, Data Import, and the Platform/
Public/Widget APIs themselves (none are `premium`-gated route namespaces).

## 20. Which parts should Orlixa reuse

- **The `Channel::Api` inbox + Public API** (`public/api/v1/inboxes/.../messages`) as the inbound
  path for end-customer messages, and the **outbound webhook** mechanism
  (`webhooks` table + `WebhookListener`) or, more precisely, the **`AgentBot`** model as the
  reply-seam: assign an `AgentBot` to the inbox/conversation, receive every
  `message_created`/`conversation_*` event at `outgoing_url` (HMAC-signed), and post replies back via
  the normal Messages API. This mirrors exactly the Postiz precedent (§ per `postiz-engine.md`):
  treat Chatwoot as a black-box backend, reached only through its documented API/webhook surface —
  Orlixa's own AI-employee runtime never touches Chatwoot's DB or internals.
- **The Platform API** (`platform/api/v1/accounts`, `.../users`, `.../agent_bots`) for
  programmatically provisioning one Chatwoot account (and one pre-wired Agent Bot) per Orlixa
  customer at onboarding time — this is a real, already-built multi-tenant provisioning surface, not
  something Orlixa would need to build from scratch.
- **Multi-channel ingestion** itself (WhatsApp/Email/FB/IG/SMS/Telegram/etc.) — reimplementing 10+
  channel integrations (webhook verification, provider auth, template management for WhatsApp, etc.)
  is exactly the kind of undifferentiated heavy lifting Chatwoot has already solved; Orlixa should
  not rebuild this.
- Team/label/canned-response/automation-rule primitives as the underlying "ticketing substrate" if
  Orlixa ever needs a human-agent escalation path behind the AI employee.

## 21. Which parts should Orlixa replace

- **The entire Vue 3 agent dashboard and widget UI** — per the stated Orlixa design constraint,
  customers must never see Chatwoot's own UI or know it exists. Orlixa's own AI-employee chat
  interface is the only front end; Chatwoot's dashboard/widget become invisible internal plumbing
  (or are not deployed publicly at all).
- **Captain AI** (`enterprise/app/services/captain/**`) — this is Chatwoot's own OpenAI-backed
  reasoning/reply-generation layer and it **directly overlaps** with Orlixa's own AI-employee
  runtime (both want to be "the brain that decides what to reply"). Running both would mean either
  double LLM calls or a confusing hand-off between two independent AI systems. Orlixa should not
  enable Captain; instead Orlixa's own runtime should own reasoning, and only use Chatwoot for
  conversation/contact/channel plumbing via the Agent Bot webhook seam (§20). This is also cheaper:
  Captain is Enterprise/premium-gated and metered in credits per the cloud pricing page, whereas the
  Agent Bot webhook mechanism is a Community feature with none of that gating.
- **Devise/DeviseTokenAuth agent login** as *the* identity system for Orlixa's own operators — Orlixa
  already has its own auth; if a human-in-the-loop escalation view onto Chatwoot is ever needed, it
  should be provisioned/SSO'd via the Platform API, not exposed as a separate login a customer's
  staff must manage.

## 22. Which parts should Orlixa ignore

- **Enterprise-only modules Orlixa doesn't need**: SLA policies, SAML/SSO, Custom Roles, Audit
  Logs, Voice/Twilio calling, the "Companies" CRM object, Advanced (OpenSearch) Search — none of
  these serve "AI answers customer support chats," and several require additional infrastructure
  (OpenSearch, Twilio account) Orlixa has no reason to stand up for this engine.
  Also skip: the enterprise conditional route group `enterprise/api/v1` (Stripe/Firecrawl billing
  webhooks) — Chatwoot's own commercial billing, irrelevant to Orlixa.
- **Help Center / public knowledge-base module** (`hc/:slug` routes, `Portal`/`Article` models) —
  out of scope unless Orlixa later wants a public self-serve FAQ product; not needed for the chat-
  based AI employee.
- **Campaigns** (proactive outbound messaging/drip campaigns) — a marketing-adjacent feature,
  overlapping with Orlixa's separate AI Marketing Employee (Postiz-backed) rather than Customer
  Support; ignore here to avoid duplicate functionality across engines.
- **v2 reporting endpoints / dashboard analytics UI** — Orlixa will want its own cross-engine
  analytics surfaced through its own product, not Chatwoot's report screens.
