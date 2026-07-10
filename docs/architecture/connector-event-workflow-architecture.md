# V-AEP — Connector, Event Detection & Workflow Trigger Architecture

**Document type:** Solution Architecture (production reference)
**Scope:** How V-AEP connects to external SaaS systems, detects that "something happened" (new email, new lead, payment, Jira issue), normalizes it, and drives an AI Employee workflow to completion — safely, at multi-tenant scale.
**Audience:** Platform engineering, SRE, security.
**Legend:** **[NOW]** = implemented in the current codebase · **[TARGET]** = production design this document specifies (roadmap). This separation is deliberate — do not treat TARGET as shipped.

---

## 0. Design principles (non-negotiable)

1. **Event-driven, not request-driven.** External systems are the source of truth for "what happened." We react to their events; we never block a user request on external work.
2. **Ingestion is decoupled from processing.** The edge that receives a webhook does almost nothing except authenticate, deduplicate, persist, enqueue, and `200 OK` fast. All real work happens asynchronously behind a queue.
3. **Everything is tenant-scoped.** Every event, connection, token, queue job, workflow, and log carries `companyId`. Cross-tenant leakage is a Sev-1 class of bug; isolation is enforced at every layer, not assumed.
4. **Normalize at the boundary.** Each provider is ugly in its own way. We translate provider payloads into a single **canonical event envelope** the instant they enter the platform. Nothing downstream knows what "Gmail" is.
5. **Idempotent by construction.** Providers deliver at-least-once (Stripe, GitHub, Graph all re-deliver). Every event carries a stable dedupe key; every consumer is safe to run twice.
6. **Fail loud, retry smart, never lose.** Retries with backoff + jitter, dead-letter queues, and reconciliation sweeps guarantee no event is silently dropped.

---

## 1. Connector Architecture

### 1.1 What is a Connector?
A **Connector** is the platform-owned, provider-specific adapter that manages the *relationship* with one external system for one tenant. It owns four responsibilities:

1. **Authentication** — establishing and maintaining credentials (OAuth tokens / API keys) for a tenant's account.
2. **Egress (actions)** — calling the provider's API to *do* things (send email, create Jira issue, create Stripe payment link).
3. **Ingress (events)** — registering for and receiving the provider's change notifications, and/or polling.
4. **Lifecycle** — connection status, health, token refresh, subscription/watch renewal, revocation.

A Connector is an *instance* concept: `(tenant × provider × account)`. Company A's Gmail connector and Company B's Gmail connector are different Connector instances sharing the same **Connector Type** (the code/driver).

### 1.2 Skill vs Connector — the critical distinction
These are two layers people conflate. They are not the same.

| | **Connector** | **Skill** |
|---|---|---|
| Concern | *Connectivity* — auth + transport to a provider | *Capability* — a business action an AI Employee can invoke |
| Granularity | One per provider account | One per action/tool |
| Example | "Gmail connection (OAuth, tokens, health)" | "`send_email`", "`read_inbox`" tools |
| Lifecycle | Connect / refresh / disconnect | Install / assign to employee / call |
| Analogy | The network cable + login | The verbs you're allowed to speak over it |

A **Skill** is *backed by* a Connector. `Gmail.send_email` (Skill/tool) executes through the Gmail Connector (auth + HTTP). One Connector powers many Skills; a Skill without a healthy Connector is inert.

> **[NOW] V-AEP mapping:** today the two are partially fused inside the Skills module — `InstalledSkill` (catalog `skillKey`, `connectionType`, `connectionStatus`, encrypted `credentials`, per-skill `config`) plays the **Connector** role, while the catalog's `tools[]` + `EmployeeSkill` assignment + `SkillExecutor` play the **Skill** role. **[TARGET]** promote the connection concern into a first-class `Connector` aggregate (its own table + driver registry) so one connector can back multiple skills and own event subscriptions independently of tool assignment.

### 1.3 How connectors are installed
1. Admin opens the Integration Marketplace and selects a provider. **[NOW]** `POST /skills/install` creates the `InstalledSkill` row (`connectionStatus = NOT_CONNECTED`).
2. Admin **connects** the account (OAuth or API key — §1.4/1.5). **[NOW]** `POST /skills/installed/:id/connect` (API key) and `GET /skills/installed/:id/oauth/authorize` → `GET /skills/oauth/callback` (OAuth).
3. On success the Connector: stores credentials **encrypted at rest** (§1.6), flips `connectionStatus = CONNECTED`, and **[TARGET]** registers event ingress (webhook subscription / watch channel — §2) and runs a first health check.
4. Admin **configures** provider-specific settings (§Skill Config): sender identity, daily limits, HubSpot pipeline, Jira project, etc. **[NOW]** `PATCH /skills/installed/:id/config` validated against a data-driven `configSchema`.
5. Admin **assigns** the resulting Skills to specific AI Employees (least privilege). **[NOW]** `EmployeeSkill`.

### 1.4 OAuth flow (authorization code + PKCE)
Used for user-delegated providers: Gmail, Outlook/Graph, Slack, HubSpot, Salesforce, Jira, Google Drive, Dropbox, Notion, GitHub (App).

```
Admin ── click "Connect Gmail" ──▶ API: GET /connectors/:id/oauth/authorize
API builds provider authorize URL:
   client_id, redirect_uri, scope(minimal), state=HMAC{companyId,connectorId,nonce,ts}, code_challenge(PKCE)
Admin browser ──▶ Provider consent screen ──▶ redirect_uri?code&state
API: GET /connectors/oauth/callback
   1. verify state HMAC + TTL (CSRF/replay guard)   2. exchange code + code_verifier → tokens at token endpoint
   3. encrypt {access_token, refresh_token, expires_at, scope} at rest
   4. connectionStatus = CONNECTED; register ingress; health check
   5. redirect → WEB_ORIGIN/skills?connected=<provider>
```

- **State is signed and stateless** (HMAC over `{companyId, connectorId, nonce, issuedAt}`, short TTL). No server-side session needed; tamper/replay is rejected. **[NOW]** implemented exactly this way (`CryptoService.sign/verify`, 10-min TTL).
- **PKCE** for public-ish flows and defense in depth. **[TARGET]** (current flow is code-exchange without PKCE).
- **Minimal scopes** — request only what the assigned Skills need (`gmail.send` vs full mailbox). Scope creep is an audit finding.

### 1.5 API Keys
Used for providers without user-OAuth or for service accounts: Stripe (secret key), some HubSpot/private-app tokens, generic HTTP.
- Entered once, **encrypted immediately**, never returned to the client (responses expose only `credentialsSet: true`). **[NOW]**.
- Treated as bearer secrets: rotate on a schedule, support multiple active keys during rotation, scope to least privilege (Stripe **restricted keys**, not the root secret).

### 1.6 Token management, refresh tokens, encryption
- **At rest:** all credentials stored as an AES-256-GCM envelope (`v1:iv:tag:ciphertext`), key from `ENCRYPTION_KEY` (**[NOW]** `CryptoService`; **[TARGET]** key in a KMS/Secrets Manager with envelope-encryption + rotation).
- **Access tokens** are short-lived. The Connector caches them in memory/Redis with their `expires_at` and treats them as disposable.
- **Refresh tokens** are long-lived and the crown jewels. On `401`/near-expiry, a **single-flight refresh** (per connector) exchanges the refresh token for a new access token, re-encrypts, and persists. Single-flight (a per-connector mutex/lock) prevents a thundering herd of concurrent refreshes racing and invalidating each other. **[TARGET]** (today tokens are used as-is; refresh-on-expiry is a documented TODO).
- **Refresh failure** (revoked consent, rotated secret) → connector transitions to `DEGRADED`/`DISCONNECTED`, raises an alert, and **quarantines** dependent workflows (they pause rather than fail-loop).

### 1.7 Connection status (state machine)
```
NOT_CONNECTED ──connect──▶ CONNECTED ──token/health fail──▶ DEGRADED ──recover──▶ CONNECTED
     ▲                          │                                  │
     └──────── disconnect ◀─────┴────────── revoked/expired ───────┴──▶ DISCONNECTED
```
`CONNECTED` (healthy), `DEGRADED` (auth OK but recent errors / rate-limited / subscription lapsed), `DISCONNECTED` (needs re-auth). **[NOW]** `NOT_CONNECTED | CONNECTED`; **[TARGET]** add `DEGRADED`.

### 1.8 Health checks
- **Active probe:** a cheap authenticated call (e.g. Gmail `getProfile`, Stripe `GET /account`, Slack `auth.test`) on a schedule (e.g. every 5–15 min) and on-demand before high-stakes actions.
- **Passive signals:** rolling error rate, `401/403` counts, rate-limit headers, webhook-delivery gaps → drive `DEGRADED`.
- **Subscription/watch health:** Gmail `watch`, Graph subscriptions, Drive channels **expire** (days) — the health job **renews them before expiry** and flags misses. This is the #1 cause of "events silently stopped" in production and must be monitored explicitly. **[TARGET]**

---

## 2. Event Detection

The core question: *how does the platform know a new email arrived / a lead was created / a payment succeeded?* There is no single answer — it is per-provider, and choosing wrong causes either missed events or rate-limit bans.

### 2.1 The five mechanisms

| Mechanism | What it is | Latency | Cost | Use when |
|---|---|---|---|---|
| **Webhooks** | Provider POSTs to our HTTPS endpoint on change | seconds | low | Provider supports signed push (preferred default) |
| **Push notifications** | Provider pings a channel (often via a broker like Google Pub/Sub) that carries a *change token*, not the data | seconds | low | Gmail/Drive (Google's model) |
| **Streaming / CDC** | Persistent subscription (gRPC/CometD/WebSocket) to a change feed | sub-second | medium | Salesforce (Pub/Sub API, CDC), Slack Socket Mode |
| **Polling** | We call "what changed since cursor X?" on an interval | minutes | high (API quota) | No push available, backfill, reconciliation |
| **Scheduled sync** | Full/delta reconciliation on a cron | minutes–hours | high | Catch-up after downtime, drift correction, historical import |

Key nuance: **push/webhook notifications are usually "thin"** — they tell you *something changed* and give you an ID or a change token; you then call the API to fetch the actual object (and to enforce your own view of permissions). Design consumers to *pull the authoritative record on notify*, never to trust the webhook body as complete.

### 2.2 Per-provider recommendation (production)

| Provider | Primary mechanism | Detail / gotchas | Backfill / reconcile |
|---|---|---|---|
| **Gmail** | **Push** (`users.watch` → **Google Pub/Sub** → our push endpoint) | Notification carries `historyId` only → call `users.history.list` to get changes. `watch` **expires ≤7 days → must renew daily**. | `historyId` cursor sync; periodic `history.list` |
| **Outlook / M365** | **Webhooks** (Graph **change notifications / subscriptions**) | Subscription **creation handshake** (`validationToken`); mail subs expire ~3 days → renew; **lifecycle notifications** for re-auth; optional **rich/encrypted** payloads. | **Delta query** (`/delta` + `deltaLink`) |
| **Slack** | **Webhooks** (**Events API**) or **Socket Mode** | URL_verification challenge; verify **signing secret** + timestamp (replay window). Socket Mode (WebSocket) when no public ingress. | `conversations.history` cursor |
| **HubSpot** | **Webhooks** (app subscriptions, **v3 signed**) | Subscribe to object change events; validate `X-HubSpot-Signature-v3`. | Search API by `hs_lastmodifieddate` |
| **Salesforce** | **Streaming** — **Pub/Sub API (gRPC)**: Change Data Capture / Platform Events | CometD/PushTopic legacy; **replayId** for resume; Outbound Messages as webhook alt. | SOQL by `SystemModstamp` |
| **Jira** | **Webhooks** (Connect app or admin-registered) | Filter by JQL + event type; verify shared secret / Connect JWT. | Search by `updated` |
| **GitHub** | **Webhooks** (prefer **GitHub App**, not per-repo PATs) | **HMAC-SHA256** `X-Hub-Signature-256`; App gives installation tokens, higher limits, fine-grained scopes; delivery redelivery API. | List endpoints by `since` |
| **Google Drive** | **Push** (Changes API **watch channels** → webhook) | Channel **expires → renew**; notification is thin → `changes.list` with `pageToken`. | `changes` `pageToken` cursor |
| **Dropbox** | **Webhooks** | Thin notify → `/files/list_folder/continue` with cursor. | folder cursor |
| **Notion** | **Polling** (limited/no general webhooks historically) | Poll `search`/DB queries by `last_edited_time`; respect strict rate limits. | timestamp cursor |
| **Stripe** | **Webhooks** (first-class) | Verify `Stripe-Signature` (HMAC + timestamp); events like `payment_intent.succeeded`, `checkout.session.completed`; **at-least-once**, out-of-order possible; use the API to fetch canonical object; enable event replay. | `GET /events` list |

> **[NOW] V-AEP mapping:** the platform already exposes a **generic signed inbound webhook** for workflows (`POST /workflows/webhooks/:token`) and an internal **`fireEvent(companyId, eventType, payload)`** dispatcher, plus SCHEDULE (BullMQ repeatable) triggers. **[TARGET]** the per-provider *connectors* above (Gmail watch, Graph subscriptions, Stripe endpoint, GitHub App, Salesforce Pub/Sub) are the ingestion drivers that will call the normalization layer (§3) and ultimately `fireEvent`.

### 2.3 Webhooks vs Polling — the decision rule
- **Prefer webhooks/push/streaming** whenever the provider supports **signed, reliable delivery** (Stripe, GitHub, Slack, HubSpot, Jira, Graph, Gmail-via-Pub/Sub, Salesforce CDC). Lower latency, lower cost, no quota burn.
- **Use polling when:** (a) the provider has **no push** (Notion); (b) **backfill/historical import** on first connect; (c) **catch-up** after our downtime or a missed webhook (gap detected via cursor); (d) **reconciliation** — a low-frequency sweep that compares provider state to ours to heal missed/duplicated events. 
- **Best practice is hybrid:** webhook for real-time + a **periodic reconciliation poll** (belt-and-suspenders). Webhooks *will* be missed (endpoint down, provider incident); the reconciliation sweep is what makes the system *eventually complete*. Cursors/sync-tokens (`historyId`, `deltaLink`, `replayId`, `pageToken`) make polling incremental and cheap.

### 2.4 The ingestion edge (what the webhook endpoint actually does)
A production webhook receiver is dumb on purpose. On each request, in order:
1. **Verify signature** (provider HMAC / JWT) + **timestamp/replay window** → reject `401` if invalid. *Before* parsing business logic.
2. **Resolve tenant + connector** from the route/subscription id (never trust body for tenant).
3. **Deduplicate** on the provider event id (`Stripe-Event-Id`, GitHub `X-GitHub-Delivery`, etc.) via `SETNX`/unique index → drop duplicates.
4. **Persist raw** event (append-only `raw_events`) for audit/replay.
5. **Enqueue** a normalization job and **return `2xx` immediately** (providers retry/disable endpoints that are slow or error). Target < 200 ms at the edge.

No parsing, no LLM, no external calls at the edge. Everything else is async.

---

## 3. Event Processing Layer (normalization)

### 3.1 The canonical event envelope
The instant a raw provider event is dequeued for normalization, a provider-specific **mapper** converts it into one internal shape. Downstream code is provider-agnostic.

```jsonc
{
  "eventId":       "evt_01H...",           // our ULID, primary key
  "schemaVersion": "1.0",
  "companyId":     "cmp_...",              // tenant — mandatory, everywhere
  "connectorId":   "con_...",              // which connector/InstalledSkill produced it
  "provider":      "gmail",
  "type":          "NEW_EMAIL",            // CANONICAL type (see below)
  "occurredAt":    "2026-07-10T09:12:01Z", // provider timestamp
  "receivedAt":    "2026-07-10T09:12:03Z",
  "dedupeKey":     "gmail:hist:987654",    // stable idempotency key
  "subject":       { "type": "candidate", "email": "a@b.com" }, // aggregate for ordering
  "data":          { /* normalized, minimal fields the platform cares about */ },
  "raw":           { "ref": "raw_events/…" },   // pointer to the untouched payload
  "signatureVerified": true
}
```

Canonical types (a controlled vocabulary, versioned): `NEW_EMAIL`, `EMAIL_REPLIED`, `NEW_LEAD`, `LEAD_STAGE_CHANGED`, `NEW_PAYMENT`, `PAYMENT_FAILED`, `NEW_JIRA_ISSUE`, `JIRA_ISSUE_UPDATED`, `NEW_GITHUB_PR`, `NEW_TICKET`, `NEW_DOCUMENT`, `NEW_CANDIDATE`, …

### 3.2 Why standardization is non-negotiable
- **Decoupling:** Workflows subscribe to `NEW_LEAD`, not to "HubSpot contact.creation v3." Swap HubSpot for Salesforce and workflows don't change — only the mapper does.
- **One workflow-matching engine:** matching, routing, filtering, and analytics all operate on ~30 canonical types instead of hundreds of provider shapes. Complexity is O(providers) at the edge, O(1) downstream.
- **Testability & evolution:** mappers are pure functions (raw → canonical), trivially unit-tested; `schemaVersion` lets envelopes evolve without breaking consumers.
- **Security & governance:** normalization is the choke point to strip PII we don't need, enforce tenant, and stamp provenance.
- **Analytics coherence:** "how many `NEW_PAYMENT` this week across all providers" is a single query.

---

## 4. Queue Architecture

### 4.1 Why we never process events inline
Processing an event means: fetch the authoritative record, run an AI plan, call external tools, maybe wait for approval, write to the DB, notify. That is **seconds to minutes** and involves flaky external systems. Doing it inside the webhook request would: block the provider (→ they disable the endpoint), lose events on any crash, prevent retries, and make bursts (a 5,000-email import) topple the API. **The queue is what turns unreliable, bursty, at-least-once event delivery into reliable, controlled, scalable processing.**

### 4.2 Topology
```
ingestion edge ─▶ [q:raw-normalize] ─▶ normalize worker ─▶ [q:events-canonical]
                                                              │
                                          workflow-matcher worker
                                                              │  (per matched workflow)
                                                     [q:workflow-run] ─▶ run worker ─▶ AI Runtime
                                                              │
                                              [q:notifications] [q:analytics]
```
Stage separation lets each queue scale, retry, and fail independently. A slow LLM stage never backs up webhook ingestion.

### 4.3 Technology choice
- **[NOW] BullMQ on Redis** — the platform's queue today (`workflow-run` queue + in-process `WorkerHost` processors; SCHEDULE = BullMQ **repeatable jobs**). Excellent for per-tenant fan-out, delays (WAIT nodes), retries, and rate-limiting groups. Right choice up to ~10⁴–10⁵ events/min.
- **[TARGET] Kafka (or Redpanda/Pulsar)** when we need durable, replayable, ordered logs, multi-consumer fan-out, and cross-service event sourcing at high volume. Model: providers → **Kafka topic per canonical type**, partitioned by `companyId`(+subject) for ordering; BullMQ remains the *task* executor pulling from Kafka. Kafka = event backbone; BullMQ = work scheduler.
- **[TARGET] AWS SQS/SNS** as a managed alternative (SNS fan-out + SQS + SQS-DLQ) when running lean on AWS without operating Kafka. FIFO queues for ordering where needed.

### 4.4 Retries, DLQ, idempotency, ordering, scalability
- **Retries:** exponential backoff **with jitter** (e.g. 1s→2s→4s→…, capped), bounded attempts. Distinguish **retryable** (429, 5xx, network) from **terminal** (400, 401 auth, validation) — terminal errors go straight to DLQ, no retry storm.
- **Dead-letter queue:** after N attempts the job moves to a DLQ with full context (envelope + error trail). DLQ is **monitored and alertable**, supports **manual/automated replay** after a fix. Nothing is discarded.
- **Idempotency:** every job keys on `dedupeKey`/`eventId`. A processed-set (`SETNX eventId`) or a unique `processed_events(companyId, dedupeKey)` row makes re-delivery and retries safe. Handlers are written to be **repeatable without side-effect duplication** (e.g. "create candidate" is an upsert on external id).
- **Ordering:** global ordering is neither needed nor affordable. We need **per-aggregate ordering** (all events for *one* candidate/lead/ticket in order). Achieve via a **partition/group key** = `companyId + subject.id` (Kafka partition, or BullMQ group/`FlowProducer`), so unrelated entities run in parallel while one entity's events serialize.
- **Scalability:** horizontal workers per queue (concurrency tuned per stage), **per-tenant rate-limit groups** so one noisy tenant can't starve others, **backpressure** (bounded queues + shed/deprioritize), and autoscaling on queue depth + age-of-oldest-message.

---

## 5. Workflow Engine

### 5.1 Receiving events
The **workflow-matcher** consumes canonical events. **[NOW]** the equivalent is `WorkflowsService.fireEvent(companyId, eventType, payload)` which finds active workflows by trigger; **[TARGET]** the matcher is fed by the normalization pipeline instead of only manual/HTTP calls.

### 5.2 Finding matching workflows
For the event's `(companyId, type)` it selects workflows where: `status = ACTIVE`, `triggerType = EVENT`, and `triggerConfig.eventType = event.type`, then applies optional **conditions/filters** (JQL-like predicates on the payload, e.g. "amount > 1000", "label = candidate"). **[NOW]** exact-match on `triggerConfig.eventType` via a Prisma JSON-path query; **[TARGET]** a condition DSL for richer filters. Each match produces one **`WorkflowRun`** (`source = EVENT`) enqueued on `workflow-run`.

### 5.3 Loading the correct AI Employee
A workflow node (AI_STEP / TOOL_ACTION) references the AI Employee that owns the step. The engine loads that `AiEmployee` (role, persona, `status` — a `PAUSED/DISABLED` employee short-circuits), its **assigned Skills** (`EmployeeSkill` → available tools), `knowledgeAccess`, `permissions`, `approvalRules`, `goals/kpiTargets`. This is where **least-privilege** is enforced: the employee can only use tools it's been assigned, on data its `knowledgeAccess` allows.

### 5.4 Executing skills
The engine walks the graph threading a shared **context** (`{{a.b.c}}` template resolution, no `eval`). Node types **[NOW]**: `TRIGGER · RETRIEVE (RAG) · AI_STEP (LLM) · TOOL_ACTION (skill/tool) · WAIT · CONDITION · NOTIFY · APPROVAL`. `TOOL_ACTION` calls a Skill through its Connector (egress + auth + rate-limit + retry). Each node writes a **`WorkflowStepRun`** (input/output/status) — the execution audit trail.

### 5.5 Handling failures
- Node error → step `FAILED`, run `FAILED`, context preserved; retryable tool errors use the queue's backoff; terminal errors stop the run with a diagnostic.
- **Connector `DEGRADED`/`DISCONNECTED`** → the run **pauses/quarantines** rather than fail-looping; resumes when the connector heals.
- Compensation/rollback for partially-completed multi-tool runs is modeled explicitly (saga-style) for money-moving flows. **[TARGET]**

### 5.6 Approvals
When a step is high-risk (per employee `approvalRules` or a catalog `highRisk` tool, e.g. Stripe payment, bulk email), execution **does not proceed**: it creates an **`ApprovalRequest` (PENDING)** and, for a workflow **`APPROVAL` node**, the run enters **`WAITING`** with a persisted `resumeNodeId`. A manager Approves → the run **resumes from the saved point**; Rejects → the run cancels. **[NOW]** both paths exist: runtime tool-level interception (creates a PENDING request instead of executing) and the workflow-level `APPROVAL` node (WAITING → resume/cancel). This is the human-in-the-loop safety boundary the enterprise requires.

---

## 6. AI Runtime

The runtime is the "brain" invoked by `AI_STEP` nodes and by direct employee chat. It is a pipeline of single-purpose services (**[NOW]** implemented as discrete services orchestrated by `AgentRuntimeService`).

1. **LLM Router** — selects the model/provider for the step (cost/quality/latency; failover). Behind a swappable `LlmProvider` interface (mock default; Anthropic/OpenAI real). *Model-agnostic by design → no vendor lock-in.*
2. **Planner** — decomposes the task into ordered steps given the employee's role/persona and the trigger context.
3. **Memory** — loads working memory (recent conversation) + durable `EmployeeMemory` (FACT/SUMMARY, incl. manager-feedback-derived facts) by recency. **[TARGET]** semantic recall via embeddings.
4. **Prompt Builder** — assembles the final prompt: system (role/persona/guardrails) + retrieved knowledge (RAG) + memory + tool schemas + task. Enforces token budget and PII policy.
5. **Tool Selection** — exposes only the employee's **assigned** tools to the model; the model requests a tool call (function-calling), bounded to N iterations to prevent loops.
6. **Execution** — the selected tool runs through its Connector (egress). High-risk calls divert to Approvals (§5.6).
7. **Validator** — checks the output is grounded (citations), within policy, non-empty, and confident; low-confidence/high-risk → `needsApproval`. This is the anti-hallucination gate before anything leaves the platform.
8. **Logging** — every step (plan, retrieved chunks, tool calls + results, validation verdict, tokens) is persisted to the run/step audit and telemetry. Full traceability of *why* the AI did what it did.

---

## 7. End-to-End Example — "Candidate emails a resume → hired-pipeline"

```
[1] Candidate sends email (resume attached) to jobs@acme.com
        │
[2] Gmail detects it → users.watch pushes a notification to Google Pub/Sub
        │   (notification is THIN: carries historyId only)
[3] Connector (Gmail, tenant=Acme) receives the Pub/Sub push at the ingestion edge:
        • verify token/signature + tenant + connector
        • dedupe on historyId  • persist raw  • return 200 fast
        • call users.history.list → fetch the new message id(s) + metadata
        │
[4] Normalize → canonical envelope { companyId:Acme, provider:gmail, type:NEW_EMAIL,
        dedupeKey:"gmail:hist:987654", subject:{type:candidate,email:…}, data:{msgId,…} }
        → enqueue on [q:events-canonical]
        │
[5] Queue (BullMQ/Redis) — idempotent, retryable, per-(company+candidate) ordering
        │
[6] Workflow Engine (matcher): finds Acme's ACTIVE workflow trigger EVENT=NEW_EMAIL
        with filter "to = jobs@acme.com" → creates WorkflowRun(source=EVENT) → [q:workflow-run]
        │
[7] Loads RecruitAI (role=RECRUITER, assigned skills: Gmail, Drive, ATS/HTTP, Calendar;
        knowledgeAccess=ALL; approvalRules)
        │
[8] Node: TOOL_ACTION Gmail.get_attachment → RETRIEVE resume text
        AI_STEP "Resume Parsing" (AI Runtime: plan→prompt→LLM) → structured candidate profile
        │
[9] AI_STEP "Candidate Scoring" → grounded in company RAG (job spec, rubric) → score 0–100
        CONDITION score ≥ 80 ?
             ├─ no  → TOOL_ACTION Gmail.send_email (polite rejection)  → END
             └─ yes → continue
        │
[10] TOOL_ACTION "Create Candidate" in ATS (idempotent upsert on email)
        │
[11] TOOL_ACTION "Schedule Interview" (Calendar): propose slots
        ⛔ APPROVAL node (offer/interview is high-stakes) → run = WAITING
           → ApprovalRequest(PENDING) surfaces in HR's Approval Center
        HR Approves → run RESUMES from resumeNodeId
        │
[12] NOTIFY HR (Slack/email): "9 candidates shortlisted, interview scheduled for X"
        │
[13] Analytics: increments RecruitAI KPIs (resumes reviewed, shortlisted, time-saved,
        attainment vs kpiTargets)
        │
[14] Audit Logs: every step (WorkflowStepRun), tool call, approval decision, and the
        canonical event lineage (eventId → runId) persisted, tenant-scoped
```
Every arrow crosses a queue boundary or a persisted checkpoint — the flow survives a crash at any step and resumes without duplicating side effects (idempotency + `resumeNodeId`).

---

## 8. Architecture Diagram (enterprise, ASCII)

```
                          ┌───────────────────────────── EXTERNAL SYSTEMS ─────────────────────────────┐
                          │ Gmail · Outlook · Slack · Teams · HubSpot · Salesforce · Jira · GitHub ·   │
                          │ Google Drive · Dropbox · Notion · Stripe                                    │
                          └───────┬───────────────┬───────────────┬───────────────┬───────────────────┘
                        webhook/push        streaming/CDC        polling         scheduled sync
                                  │               │               │               │
        ══════════════════════════▼═══════════════▼═══════════════▼═══════════════▼══════════════════════
        CONNECTOR LAYER   (per provider driver: ingress subscriptions, egress client, rate-limit, retry)
          • signature/HMAC verify  • tenant+connector resolve  • dedupe  • persist raw  • 200 fast
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        AUTHENTICATION LAYER   OAuth (authz-code+PKCE) · API keys · token cache · single-flight refresh ·
          encrypted secret store (AES-GCM / KMS) · connection state machine · health & watch-renewal
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        EVENT LAYER   raw_events (append-only, audit)  →  NORMALIZATION (provider mapper → canonical
          envelope: eventId, companyId, type=NEW_EMAIL|NEW_LEAD|NEW_PAYMENT|…, dedupeKey, subject)
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        QUEUE   [q:raw-normalize] → [q:events-canonical] → [q:workflow-run] → [q:notify] [q:analytics]
          BullMQ/Redis (now) · Kafka/SQS (target) · retries+jitter · DLQ · idempotency · per-tenant groups
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        WORKFLOW ENGINE   match (company,type,filters) → WorkflowRun → walk graph (TRIGGER·RETRIEVE·
          AI_STEP·TOOL_ACTION·WAIT·CONDITION·NOTIFY·APPROVAL) → context threading → WorkflowStepRun audit
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        AI RUNTIME   LLM Router → Planner → Memory → Prompt Builder → Tool Selection → Execution →
          Validator (grounding/guardrails) → Logging          [Approvals ⇄ human-in-the-loop, WAITING/resume]
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        EXECUTION LAYER   Skill/tool invocation via Connector egress (send email · create Jira · update
          CRM · generate report · Stripe) · circuit breakers · per-connector rate limits · sandboxing
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        NOTIFICATION SERVICE   Slack/Teams/email/in-app · Approval Center routing · digests
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        ANALYTICS   KPIs · attainment vs targets · time/cost saved · success/error rates · dashboards
        ══════════════════════════════════════════════╤═══════════════════════════════════════════════
        DATABASE   PostgreSQL (multi-tenant, companyId everywhere) + pgvector (RAG) · Redis (queue/cache)
          · object storage (raw payloads, files) · append-only audit log
        ─────────────────────────────────────────────────────────────────────────────────────────────
        CROSS-CUTTING  ▸ AuthN/AuthZ (RBAC, OWNER>ADMIN>MEMBER)  ▸ OpenTelemetry tracing (eventId→runId
          correlation)  ▸ metrics/alerts  ▸ audit logging  ▸ secrets/KMS  ▸ multi-tenant isolation
```

---

## 9. Enterprise Best Practices

**Event-driven architecture.** Producers (connectors) and consumers (workflows) are decoupled by the canonical event bus. Services react to events, not to synchronous calls; this yields independent scaling, graceful degradation, and replayability. Treat the event log as a first-class, versioned contract (`schemaVersion`).

**Retry policies.** Exponential backoff **+ jitter**, bounded attempts, retryable-vs-terminal classification, per-destination budgets. Never retry a `4xx` validation/auth error. Idempotency makes retries safe.

**Circuit breakers.** Per-connector breakers (closed→open→half-open) trip on error-rate/latency thresholds so a failing provider (Stripe outage) sheds load and fails fast instead of exhausting workers; half-open probes restore service. Pair with **bulkheads** (isolated worker pools per provider/tenant) so one dependency can't sink the platform.

**Rate limiting.** Respect provider limits (honor `Retry-After`/rate headers, token-bucket per connector) *and* protect the platform (per-tenant ingress limits, fair-share queue groups). Egress schedulers smooth bursts (e.g. Gmail daily send caps from Skill config).

**Webhook security.** Mandatory **signature verification** (provider HMAC/JWT) + **timestamp/replay window** + HTTPS + per-tenant secret + **allow-listed source** where offered. Verify **before** parsing. Return fast `2xx`; do work async. Rotate webhook secrets. Endpoints are unauthenticated to JWT but authenticated cryptographically by the provider secret.

**OAuth security.** Authorization-code **+ PKCE**, **signed state** (CSRF/replay), **least-privilege scopes**, encrypted token storage, single-flight refresh, immediate revocation handling, and per-tenant redirect/state binding. Never log tokens; expose only `credentialsSet`.

**API versioning.** Version public + webhook APIs (`/v1`, header, or media-type); version the **canonical event schema**; pin provider API versions per connector and upgrade deliberately. Backward-compatible additive changes; deprecate with sunset headers + timelines.

**Monitoring.** RED/USE metrics per queue and connector: queue depth, age-of-oldest-message, DLQ rate, webhook delivery success, connector health, token-refresh failures, LLM latency/cost, workflow success rate. Alert on **subscription/watch expiry misses** and DLQ growth specifically.

**Distributed tracing.** **OpenTelemetry** trace context propagated end-to-end (webhook → normalize → queue → workflow → AI runtime → tool call), correlated by `eventId ↔ runId ↔ companyId`. One trace answers "what happened to this candidate's email and why." **[NOW]** OTel is in the stack; **[TARGET]** full context propagation across queue hops.

**Audit logging.** Append-only, tamper-evident, tenant-scoped: raw event → canonical event → workflow run → each step → tool calls → approval decisions (who/when) → outcome. Retention + export for compliance (SOC 2 / GDPR). Distinct from application logs.

**Multi-tenancy.** `companyId` on every row, event, job, token, and log; enforced at query layer (tenant guard) and queue routing. Encrypted per-tenant secrets. **[TARGET]** options for tenant-partitioned Kafka topics / dedicated queues for large tenants, and per-tenant rate/quotas tied to the subscription plan.

**Scalability.** Stateless horizontally-scaled workers per queue stage; partition by `companyId(+subject)` for parallelism with per-aggregate ordering; autoscale on queue depth/age; Redis→Kafka for the event backbone at high volume; read replicas + pgvector scaling (→ dedicated vector store) for RAG; object storage for large payloads; cost controls via LLM routing/caching.

---

### Appendix — current-state summary (what exists in code today)
Multi-tenant Postgres+pgvector; `InstalledSkill` connector-ish entity with **encrypted** credentials, real **OAuth authorize/callback** (signed state) + API-key connect, `connectionStatus`; **BullMQ** `workflow-run` queue + processors; workflow engine with `TRIGGER/RETRIEVE/AI_STEP/TOOL_ACTION/WAIT/CONDITION/NOTIFY/APPROVAL`, triggers **MANUAL/SCHEDULE/WEBHOOK/EVENT** (`fireEvent`, public signed webhook route); **AI runtime** (router/planner/memory/tool-exec/validator); **Approval Center** (tool-level + workflow-level WAITING/resume); analytics/KPIs; RBAC. **Not yet built:** per-provider ingestion drivers (Gmail watch, Graph subs, Stripe endpoint, GitHub App, Salesforce Pub/Sub), the raw→canonical normalization pipeline as a distinct layer, token refresh, circuit breakers, Kafka backbone, full OTel context propagation. Those are the TARGET items above.
```
