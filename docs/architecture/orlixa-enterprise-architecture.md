# Orlixa Enterprise Architecture — AI Workforce Platform

**Status:** Phase 2 synthesis, built on the 10 source-verified engine studies under
`docs/architecture/engines/*.md` and the existing Orlixa architecture doc
(`docs/architecture/orlixa-current-architecture.md`). Every design choice below cites back to a
specific finding in one of those docs — nothing here is invented independently of that research.

**The one rule everything else follows:** Orlixa is an **AI Workforce Platform, not a dashboard
aggregator**. Every engine studied (Postiz, Chatwoot, Plane, n8n, Metabase, Meilisearch, Novu,
Listmonk, MinIO/replacement, Keycloak) is wrapped as an **invisible internal service**, called only
through its documented API/webhook surface, never embedded as a UI, never exposing its own login,
branding, or data model to an Orlixa customer. The customer's only surface is Orlixa's own AI
Employee chat interface. This mirrors, at scale, the exact pattern already validated for Postiz
(`postiz-integration-plan.md`) and confirmed to generalize cleanly across all nine other engines.

---

## 1. C4 Context Diagram

```
                                   ┌────────────────────┐
                                   │   Orlixa Customer    │
                                   │ (company employee/   │
                                   │  owner/admin)         │
                                   └──────────┬───────────┘
                                              │ https, chat + a few admin screens
                                   ┌──────────▼───────────┐
                                   │        ORLIXA          │◄──── the ONLY system boundary
                                   │  AI Workforce Platform │      the customer ever sees
                                   └──────────┬───────────┘
                     ┌──────────┬─────────────┼─────────────┬──────────┬─────────┐
                     │          │             │             │          │         │
              ┌──────▼───┐ ┌───▼────┐  ┌─────▼─────┐  ┌────▼───┐ ┌────▼───┐ ┌───▼────┐
              │ Postiz    │ │Chatwoot│  │  Plane     │  │  n8n   │ │Metabase│ │ ...6   │
              │(Marketing)│ │(Support)│  │(Proj.Mgr) │  │(Workflow)│(Analytics) more   │
              └──────────┘ └────────┘  └───────────┘  └────────┘ └────────┘ └────────┘
                     │          │             │             │          │         │
              ┌──────▼──────────▼─────────────▼─────────────▼──────────▼─────────▼──┐
              │        Real external systems each engine itself talks to:              │
              │  X/LinkedIn/Instagram/... · WhatsApp/Email/SMS · Slack/Email(SMTP) ·   │
              │  customer's own data warehouse · customer's own IdP (SSO) · etc.       │
              └─────────────────────────────────────────────────────────────────────┘
```

External actors: the Orlixa customer (never sees engines), an Orlixa platform operator (manages the
shared engine fleet), and — one layer further out — each engine's own external dependencies (social
platforms, messaging channels, the customer's own data sources), which Orlixa never touches directly.

## 2. Container Diagram

```
┌─────────────────────────────── Orlixa Platform Boundary ───────────────────────────────┐
│                                                                                          │
│  apps/web (Next.js)  ──────►  apps/api (NestJS)  ──────►  Postgres (Orlixa's own)       │
│                                     │        │                pgvector (Knowledge/RAG)   │
│                                     │        └──────►  Redis (BullMQ — Orlixa's own      │
│                                     │                   queues: workflow-run, knowledge-  │
│                                     │                   ingest, event-normalize, connector-│
│                                     │                   health/reconcile, gmail-inbound,   │
│                                     │                   NEW: engine-sync, engine-webhook) │
│                                     │                                                     │
│                                     ▼                                                     │
│                  ┌──────────────────────────────────────┐                                │
│                  │   modules/engines/* (NEW — one per    │                                │
│                  │   engine: marketing, support, pm,     │                                │
│                  │   automation, analytics, search,      │                                │
│                  │   notification, email, storage, sso)  │                                │
│                  │   each: <Engine>ClientService +       │                                │
│                  │   webhook receiver + sync job         │                                │
│                  └──────────────────┬───────────────────┘                                │
└─────────────────────────────────────┼─────────────────────────────────────────────────────┘
                                       │ REST/webhook only, one shared service-account
                                       │ credential per engine, held in CryptoService
              ┌────────────────────────┼─────────────────────────────────────────────┐
              ▼            ▼            ▼            ▼            ▼        ▼         ▼
        ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌──────────┐ ┌───────┐ ┌────────┐
        │ Postiz  │ │ Chatwoot │ │  Plane   │ │  n8n   │ │ Metabase │ │Meili- │ │  Novu  │ ...
        │ self-   │ │  self-   │ │  self-   │ │ self-  │ │  self-   │ │search │ │ self-  │
        │ hosted  │ │  hosted  │ │  hosted  │ │ hosted │ │  hosted  │ │       │ │ hosted │
        │(+Temporal│ │(+Sidekiq)│ │(+Celery) │ │(+Bull) │ │          │ │       │ │(+BullMQ)│
        │+its own │ │+its own  │ │+its own  │ │+its own│ │+its own  │ │       │ │+MongoDB│
        │Postgres)│ │Postgres) │ │Postgres) │ │Postgres│ │app DB    │ │       │ │        │
        └─────────┘ └──────────┘ └──────────┘ └────────┘ └──────────┘ └───────┘ └────────┘
        (34 social)  (WhatsApp/   (workspaces/  (307       (customer's  (search   (email/SMS/
                      email/etc)   issues)       nodes)     warehouse)   index)    push/in-app)

              plus: Listmonk (ONE INSTANCE PER CUSTOMER — see §14 Multi-Tenant), a storage
              engine (MinIO's repo is archived — see §Deployment for the SeaweedFS/Garage
              call), and Keycloak (optional, enterprise-tier SSO only, not default auth).
```

Every engine box above is reached **only** through its own container's documented REST/webhook API —
never a shared database connection, never an embedded iframe of its UI (with the narrow, unavoidable
exception of a provider's own OAuth consent screen, which belongs to that provider, not the engine).

## 3. Component Diagram (inside `apps/api`)

```
modules/engines/marketing/      → PostizClientService, webhook receiver, sync jobs        (existing plan)
modules/engines/support/        → ChatwootClientService, AgentBot webhook receiver
modules/engines/project/        → PlaneClientService, webhook receiver (or MCP client)
modules/engines/automation/     → N8nClientService (triggers workflows, receives results)
modules/engines/analytics/      → MetabaseClientService (or its own MCP client)
modules/engines/search/         → MeilisearchClientService (tenant-token issuance)
modules/engines/notification/   → NovuClientService (fixes NOTIFY node — see §9)
modules/engines/email/          → ListmonkClientService (one instance per tenant — see §14)
modules/engines/storage/        → StorageClientService (S3-compatible; MinIO or replacement)
modules/engines/sso/            → KeycloakClientService (enterprise-tier only, optional)

Each of the above is a peer of the EXISTING modules/skills, modules/workflows,
modules/employees, modules/approvals — an engine client is registered as a normal Skill
(catalog.ts entry) so every AI Employee's tool-calling loop (ToolExecutorService) can reach it
through the SAME mechanism already used for Slack/Gmail/HTTP — no new tool-calling protocol per
engine, this is the single most important consistency decision in this whole synthesis.
```

## 4. Request Flow (canonical, generalized across all 10 engines)

```
Customer → chat with an AI Employee → AgentRuntimeService.
  1. PLAN         (existing, unchanged)
  2. RETRIEVE     (existing Knowledge/RAG, unchanged)
  3. MEMORY       (existing, unchanged)
  4. ACT           → ToolExecutorService resolves the tool to a Skill →
                     if the Skill's executor is an <Engine>ClientService, it makes ONE
                     REST call (or a small sequence of them) against that engine's self-
                     hosted instance, using the ONE shared service-account credential for
                     that engine (never a per-customer credential unless the engine's own
                     multi-tenancy model requires per-tenant scoping — see §14).
  5. VALIDATE      (existing, unchanged)
  6. Persist + reply — exactly as today.

  Async/webhook path (new, generalized from the Postiz design):
  <engine> event (post published, ticket replied, issue updated, workflow finished,
  query result ready, index updated, notification delivered, campaign sent, upload
  complete, SSO login) → POST /engines/<engine>/webhook (signed where the engine
  supports it) → RawEvent-style append-only log → normalize → update the relevant
  Orlixa mirror table → (optionally) fireEvent() into Orlixa's EXISTING event/workflow
  pipeline (modules/events, already built for the connector-event-workflow architecture).
```

This is a direct generalization of the already-built Orlixa event ingestion pipeline
(`RawEvent`→`event-normalize`→`CanonicalEvent`→`fireEvent()`) — no new ingestion mechanism is
needed, only one new webhook controller + mapper per engine, following the exact pattern already
used for the Gmail inbound poller and connector webhooks.

## 5. Authentication Flow

Orlixa's own JWT stack (access+refresh, `Passport` strategy, `RolesGuard`, per-`Company` tenancy)
remains the **one and only customer-facing identity system** — no engine's own login is ever
customer-facing. Two distinct concerns, kept separate:

- **Orlixa ↔ Engine** (service-to-service): one shared service-account credential per engine
  (Postiz API key, Chatwoot Platform-API token, Plane API token, n8n API key, Metabase API key,
  Meilisearch master/scoped key, Novu API key, Listmonk API token, storage-engine access/secret
  key), held via Orlixa's existing `CryptoService` (AES-256-GCM) — exactly one new secret class per
  engine, not one per customer, in every case except Listmonk (one credential per customer instance,
  see §14) and Meilisearch (tenant tokens are *derived*, not separately stored, per-request).
- **Enterprise SSO** (optional, Keycloak): only for enterprise-tier customers who demand SAML/OIDC
  against their own IdP. Keycloak acts as a broker in front of Orlixa's login — a successful
  Keycloak-mediated login is translated at the boundary into Orlixa's own JWT (`keycloak-engine.md
  §20`); Keycloak never becomes the primary identity store for non-enterprise tenants.

## 6. Database Design

**No shared database, ever, across the boundary.** Every engine keeps its own database exactly as
it ships (Postgres for Postiz/Plane/Listmonk/Chatwoot, MongoDB for Novu, embedded LMDB for
Meilisearch, a relational app DB for Metabase, Keycloak's own RDBMS). Orlixa's own Postgres holds
only:
- The existing schema (`Company`, `AiEmployee`, `Skill`/`InstalledSkill`, `Workflow*`,
  `ApprovalRequest`, `KnowledgeDocument`, events, etc.).
- One new **mirror table per engine** (following the pattern already designed for Postiz:
  `SocialAccount`/`ScheduledPost`/`PublishedPost` etc.) holding just enough denormalized state
  (external id, status, last-synced-at, a JSON blob of the last-known payload) for Orlixa's own UI
  and AI Employees to read fast without a live round-trip to the engine on every query — never the
  engine's full data model, never a foreign key into the engine's own DB.
- Credentials for each engine (encrypted) and, for Listmonk specifically, the connection details for
  *which* per-customer instance/DB a given `Company` maps to (§14).

## 7. Folder Structure

`apps/api/src/modules/engines/<engine>/` per engine, each containing: `<engine>.module.ts`,
`<engine>-client.service.ts` (the REST wrapper), `<engine>-webhook.controller.ts`,
`<engine>-sync.processor.ts` (BullMQ reconciliation job), and a `dto/`/`entities/` folder for the
mirror table(s) — an exact structural repeat of `modules/skills/connectors` and
`modules/events`, which this whole design is a generalization of.

## 8. Deployment Architecture

One Docker Compose stack (or Helm chart set, §16) per engine, deployed on an **internal-only
network** — no public ingress to any engine except through Orlixa's own API gateway. Concretely:
Postiz (+ Temporal + its Postgres + Elasticsearch), Chatwoot (+ Sidekiq/Redis), Plane (+ Celery/
RabbitMQ/Redis), n8n (+ its Postgres, queue mode with Redis), Metabase (+ its app DB), Meilisearch
(single binary, no extra services), Novu (+ MongoDB + Redis), Listmonk (**one full stack per
customer** — see §14, the one genuine outlier), a storage engine (**not MinIO** — see below), and
Keycloak (+ Infinispan, only stood up once the first enterprise-SSO customer needs it, not by
default).

**Storage engine call, carried forward from the MinIO study:** the `minio/minio` repo is archived
and no longer maintained (verified directly in its README, `minio-engine.md §1/§18`) — do not stand
up new infrastructure on it. Evaluate **SeaweedFS (Apache-2.0, actively maintained)** or **Garage
(AGPLv3, actively maintained)** instead; either slots into Orlixa's existing `STORAGE_PROVIDER`
abstraction (already used by Knowledge/media, `orlixa-current-architecture.md §11`) with no
application-code change beyond a new provider adapter.

## 9. Worker Architecture

Every engine's own worker tier stays **entirely inside that engine's deployment** and is never
touched by Orlixa: Temporal workers (Postiz), Sidekiq (Chatwoot), Celery (Plane), Bull workers
(n8n), Novu's BullMQ workers, Metabase's in-process scheduler, Meilisearch's in-process
`index-scheduler`, Listmonk's in-process goroutine pool, Keycloak's in-process cleanup tasks.
Orlixa's own worker tier (BullMQ) only needs new processors for: `<engine>-sync` (poll-based
reconciliation, mirroring `connector-reconcile`) and `<engine>-webhook-normalize` per engine that
supports outbound webhooks — everything else is the target engine's own problem, by design.

## 10. Queue Architecture

Orlixa's customer-facing queue technology stays **BullMQ/Redis, exclusively** — no new queue tech is
introduced into Orlixa itself despite the wide variety used internally by the wrapped engines
(Temporal, Bull v4, Sidekiq, Celery/RabbitMQ). New Orlixa queues, following the existing
`common/resilience` pattern (`RESILIENT_JOB_OPTIONS` + DLQ, exactly like `connector-health`/
`connector-reconcile`): one `engine-sync` queue per engine (periodic reconciliation) and one
`engine-webhook-normalize` queue (shared, tagged by engine) for inbound webhook processing.

## 11. API Structure

Every `<engine>ClientService` exposes a small, typed method set to the rest of Orlixa (not a raw
HTTP passthrough) — e.g. `PostizClientService.schedulePost()`, `ChatwootClientService.replyToConversation()`,
`PlaneClientService.createIssue()`, `N8nClientService.triggerWorkflow()`,
`MetabaseClientService.runQuestion()`, `MeilisearchClientService.search()`,
`NovuClientService.trigger()`, `ListmonkClientService.sendCampaign()`,
`StorageClientService.presignUpload()`, `KeycloakClientService.exchangeSsoToken()` — each backed by
one Skill catalog entry with a JSON-schema tool definition, so every AI Employee calls every engine
through the identical `ToolExecutorService.execute()` path already used today.

## 12. Extension Points

Each engine's own native extension mechanism (Postiz's `SocialProvider` interface, n8n's
`INodeType`, Keycloak's SPIs, Meilisearch's driver-free single-binary design, Metabase's driver
multimethod system) is a **future lever**, not something Orlixa builds against directly in v1 — if
Orlixa later needs a social platform Postiz doesn't support, or a DB Metabase doesn't support, the
engine's own extension point is where that work would go (inside that engine's own codebase/fork),
never inside Orlixa's own codebase.

## 13. MCP Integration Architecture

Three of the ten engines already ship their own official MCP servers: **Postiz** (9 tools,
`postiz-engine.md §28`), **Plane** (`plane-mcp-server`, works against self-hosted via
`PLANE_BASE_URL`), and **Metabase** (`src/metabase/mcp`, free/AGPL, not Enterprise-gated). This is a
real, repeated signal across the ecosystem, not a one-off. **Decision for v1: still REST, not MCP**
— consistent with the earlier Postiz-specific call (`postiz-integration-plan.md §Phase3`), because
Orlixa's `ToolExecutorService`/`ApprovalRequest` approval-gating is bespoke and MCP adoption doesn't
remove that plumbing, only relocates tool-schema maintenance. **Revisit as a platform-wide decision,
not per-engine**, if Orlixa ever invests in being a general-purpose MCP *client* — at that point
three engines' MCP servers become usable for free, and the same client infrastructure would also
open the door to third-party MCP servers Orlixa doesn't control at all. This is future work, tracked
here so it isn't re-litigated per engine.

## 14. OAuth Architecture

Two distinct OAuth surfaces, kept conceptually separate everywhere in this study:
- **End-customer social/data connect flows** (Postiz's 34 social platforms) — handled entirely
  inside the wrapped engine (`postiz-integration-plan.md §Phase5`); Orlixa's popup only brands the
  redirect hop, never re-implements the OAuth dance itself.
- **Orlixa's own future OAuth-as-a-server** (letting a 3rd party integrate with Orlixa) — not yet
  built; several engines studied (Postiz, n8n) already have a working reference implementation of
  this exact pattern if/when Orlixa needs it.

## 15. Multi-Tenant Architecture (the master mapping table — the single most important synthesis output)

| Engine | Native multi-tenancy primitive | Recommended Orlixa mapping | Source |
|---|---|---|---|
| Postiz | `Organization`→`Customer` sub-entity | **1 shared Postiz org, 1 Customer per Orlixa Company** | `postiz-integration-plan.md §Phase3/5` |
| Chatwoot | `Account` | **1 Chatwoot Account per Orlixa Company** (provisioned via the Platform API at onboarding) | `chatwoot-engine.md §15/§20` |
| Plane | `Workspace` | **1 Plane Workspace per Orlixa Company** (provisioned via `api/v1`) | `plane-engine.md §15` |
| n8n | None native (single-tenant credential store per instance) | **1 shared n8n instance, Orlixa's own `companyId` scoping enforced entirely at the Orlixa orchestration layer** — n8n itself has no concept of it | `n8n-engine.md §15` |
| Metabase | `:feature :tenants` — **Enterprise-only** | **Do NOT pay for Metabase's tenancy feature** — 1 shared Metabase instance, isolation enforced via one DB connection/permission-group per Orlixa Company in Orlixa's own orchestration | `metabase-engine.md §15/§18` |
| Meilisearch | Tenant tokens (signed JWTs with embedded filters) + scoped API keys — **both free/Community** | **1 shared Meilisearch instance, 1 tenant-token-scoped index (or index-per-tenant) per Company** | `meilisearch-engine.md §15` |
| Novu | `Organization`→`Environment` (admin) + a dedicated lightweight `Tenant` entity | **1 shared Novu org/environment, 1 Novu Tenant per Orlixa Company** | `novu-engine.md §15` |
| Listmonk | **None — single-tenant by design**, verified (`subscribers.email` global `UNIQUE`) | **1 full Listmonk instance + DB per Orlixa Company** — the one genuine outlier requiring per-tenant infrastructure, not just per-tenant config | `listmonk-engine.md §15` |
| Storage (replacing MinIO) | Bucket/prefix + IAM policy scoping (native to S3-compatible systems) | **1 shared instance, 1 bucket-or-prefix + scoped policy per Company** | `minio-engine.md §15`, carried to replacement |
| Keycloak | `Realm` (heavy) vs. newer `Organization` within one realm (light, free/Community) | **1 shared realm, 1 Keycloak Organization per enterprise-tier Company** — only stood up per customer that actually needs SSO | `keycloak-engine.md §15/§20` |

**Cost implication worth stating plainly:** nine of ten engines support cheap, shared-instance
multi-tenancy. Listmonk is the deliberate exception — budget for it as genuinely
per-customer infrastructure (its own compute + DB + ops overhead), not a config toggle, when
estimating the AI Email Marketing Employee's operating cost per customer.

## 16. Kubernetes Deployment

Each engine becomes its own Deployment/StatefulSet (StatefulSet for anything with local state —
Postiz's Temporal+Elasticsearch, Meilisearch's LMDB volume, the storage engine's data volumes) with
a ClusterIP Service, **no Ingress object for any engine** — only Orlixa's own `apps/api` gets a
public Ingress. Listmonk's per-customer requirement (§14) means its Helm release is templated to be
installed *per Company* (a genuinely different operational shape from every other engine, which get
one release total). Secrets (service-account credentials per engine) are K8s Secrets, synced from
whatever Orlixa's existing secrets-management approach is (not newly designed here).

## 17. Docker Architecture

For anything below production K8s scale: one `docker-compose.<engine>.yml` per engine (mirroring
each project's own official self-host compose file, e.g. Postiz's `docker-compose.yaml`, Chatwoot's,
n8n's, Novu's) on a shared internal Docker network, with Orlixa's own `apps/api` as the only
container exposing a host port. This is the natural local-dev/staging shape before K8s.

## 18. Scaling Strategy

Each engine scales using its own native mechanism, unchanged: Postiz via Temporal worker
concurrency (`WORKER_CONCURRENCY_DIVIDER`, per-provider task queues), Chatwoot via Sidekiq
concurrency, Plane via Celery worker count, n8n via Bull queue-mode worker processes, Novu via
BullMQ worker concurrency, Metabase via JVM heap/connection-pool tuning, Meilisearch via more
RAM/CPU on a single node (no native sharding in Community, confirmed), the storage engine via its
own clustering (erasure coding style, engine-dependent), Keycloak via Infinispan clustering. Orlixa's
own scaling (BullMQ worker concurrency, `apps/api` horizontal replicas) is unaffected by any of this
— the whole point of the wrap-as-a-service pattern is that each engine's scaling is that engine's own
concern, decoupled from Orlixa's.

## 19. Disaster Recovery

Per-engine backup responsibility, matching where each engine's state actually lives: Postgres
snapshots for every Postgres-backed engine (Postiz, Chatwoot, Plane, n8n, Listmonk), a MongoDB
backup routine for Novu, a Meilisearch snapshot/dump routine (its own documented mechanism, not a
generic file backup), object-storage-level backup/replication for the storage engine, and a
Postgres backup for Keycloak. **Listmonk's per-customer instances multiply this obligation by
customer count** — this needs to be automated (one backup job templated per Company), not manual,
given §14's finding. Orlixa's own DR plan (existing, unchanged) covers its own Postgres/Redis and the
new mirror tables — those mirrors are regenerable from each engine's own source of truth via the
`<engine>-sync` reconciliation jobs (§10), which is a genuine resilience benefit of the mirror-table
design: Orlixa's own DB loss doesn't lose the underlying engine data, only the fast-read cache of it.

## 20. High Availability

Each engine's own HA story is inherited as-is: Temporal supports multi-worker HA (Postiz), Keycloak
supports Infinispan clustering for multi-node HA, n8n supports `multi-main` HA (**Enterprise-only**,
confirmed, `n8n-engine.md §18` — a real cost to budget for if Orlixa needs HA n8n), Metabase/Plane/
Chatwoot scale via standard multi-process-behind-a-load-balancer patterns. Orlixa's own HA (its own
`apps/api` replicas + Postgres/Redis HA) is unaffected. The one HA gap worth flagging: Listmonk's
send-queue has **no distributed lock** protecting against two sender processes running concurrently
against the same DB (`listmonk-engine.md §17`, verified) — since each customer gets one instance
anyway (§14), this is naturally mitigated (no reason to run more than one process per customer
instance) rather than requiring a fix, but it should not be run active-active regardless.

---

## Summary table: reuse / replace / ignore, one line per engine (rolled up from each engine doc's §20-22)

| Engine | Reuse | Replace | Ignore |
|---|---|---|---|
| Postiz | Public API + MCP as publishing engine | Nothing (no fork needed) | Temporal adoption, marketplace layer, its AI copilot |
| Chatwoot | AgentBot + Channel::Api + Platform API | Its Vue dashboard/widget UI (never shown) | Captain AI (competes with Orlixa's runtime), Enterprise modules |
| Plane | `api/v1` + official MCP server + webhooks | Its 3 frontends (never shown) | Its own OAuth-app marketplace |
| n8n | Node-execution engine + 307 integrations, as an added capability | Nothing (don't replace Orlixa's own workflow engine) | Its editor UI, Enterprise SSO/RBAC/HA modules |
| Metabase | REST API + free MCP server for query execution | Nothing structural | Its dashboard UI, Enterprise sandboxing/tenancy (build isolation in Orlixa instead) |
| Meilisearch | Tenant tokens + scoped keys, hybrid search as RAG complement | Nothing structural | Enterprise sharding/federation (not needed at current scale) |
| Novu | `POST /v1/events/trigger` to fix the log-only `NOTIFY` gap | Nothing structural | Its dashboard UI, Enterprise packages (need Novu's written approval) |
| Listmonk | Full REST API for headless campaign sending | Nothing structural, but budget per-customer infra | Nothing to ignore — it's fully free, just per-tenant |
| MinIO | Its S3-compatible API *shape* as the interface contract | **The project itself** — build on SeaweedFS/Garage instead | The MinIO codebase going forward (abandoned) |
| Keycloak | Free "Organizations" feature, OIDC/SAML broker for enterprise SSO | Nothing — augment, don't replace Orlixa's own JWT auth | Realm-per-tenant (too heavy), its own admin console UI |

---

## Open items carried forward (not resolved by this document)

1. **Per-engine AGPL/BSL/proprietary-license legal review**, consolidated: Postiz (AGPL, lower risk
   since unmodified), Chatwoot/n8n/Metabase/Meilisearch/Novu (open-core, production use of
   Enterprise-marked code requires an actual paid license/approval regardless of code presence —
   verified directly in each project's license file, not assumed). This should go to counsel as ONE
   consolidated review covering all five, not five separate asks.
2. **Storage engine final pick** (SeaweedFS vs. Garage) — needs its own short bake-off, not decided
   here; both satisfy the `STORAGE_PROVIDER` abstraction equally at the architecture level.
3. **Listmonk's per-customer cost model** — needs real infra-cost modeling (compute+DB+ops per
   customer) before quoting AI Email Marketing Employee pricing, given it's the one engine that
   doesn't share infrastructure across tenants.
4. **MCP-as-a-platform-decision** (§13) — deferred, but flagged as worth revisiting holistically
   (three engines already offer it for free) rather than per-engine, if/when Orlixa considers
   becoming a general-purpose MCP client.
5. **n8n vs. Orlixa's own workflow engine, product-level positioning** — architecturally they should
   coexist (§9's Summary table), but the *product* question of how an AI Workflow Employee is
   marketed/priced relative to Orlixa's own native workflow builder is a business decision, not an
   architecture one, and isn't resolved here.
