# Metabase — Engine Study for Orlixa "AI Analytics Employee"

Source: local clone at `C:\Users\Admin\AppData\Local\Temp\claude\metabase-src` (backend Clojure, frontend
React/TypeScript) + official docs at `www.metabase.com/docs/latest` + `www.metabase.com/product/enterprise`.
All file paths below were opened and read directly; none are guessed from filenames.

---

## 1. Executive Summary

Metabase is a Clojure/JVM business-intelligence server with a React frontend. It stores its own
configuration (questions, dashboards, collections, permissions, connection credentials) in a relational
"application database" (Postgres/MySQL/H2), and separately connects out to one or more customer "analytics"
databases via a driver-multimethod system (`src/metabase/driver`). Queries are expressed either as MBQL
(Metabase's structured query language) or native SQL, compiled by the query processor
(`src/metabase/query_processor`), executed against the target warehouse, and returned as tabular JSON.

The codebase is **open-core**: everything outside the top-level `enterprise/` directory is AGPLv3
(`LICENSE-AGPL.txt`); everything inside `enterprise/` is proprietary, gated by a runtime license-token
check (`src/metabase/premium_features/token_check.clj`), and covered by the Metabase Commercial License
(`LICENSE-MCL.txt`). A third file, `LICENSE-EMBEDDING.txt`, covers the separately-distributed
`app-embed.js` embedding snippet.

For Orlixa's purposes, the most important discovery is that Metabase **already ships a first-class,
OSS, headless AI-agent interface**: `src/metabase/mcp` implements a full Model Context Protocol server
(`/api/metabase-mcp`), OAuth-scoped, exposing tools like `search`, `construct_query`, `execute_query`,
`execute_sql`, `execute_question`, `create_dashboard`, etc. This is architecturally almost exactly the shape
Orlixa needs for a chat-based "AI Analytics Employee": a tool-calling surface that returns structured data,
with no requirement to touch the Metabase dashboard UI at all. In addition, the plain REST API
(`/api/dataset`, `/api/card/:id/query`) can run ad-hoc or saved queries and stream back JSON/CSV/XLSX
without any UI involvement, which was already true before MCP existed.

Multi-tenancy (multiple isolated customer orgs sharing one instance) and row-level data sandboxing — both
central concerns for Orlixa — are **Enterprise/paid-only** in this codebase; the code is physically present
in OSS shim functions but the real implementation lives in `enterprise/backend/src/metabase_enterprise/tenants`
and `.../sandbox`, gated behind `:feature :tenants` / `:feature :sandboxes` checks that require a valid paid
license token from Metabase's MetaStore. See §18 for the mandatory legal caveat.

---

## 2. Architecture Diagram

```
                         ┌─────────────────────────────────────────────┐
                         │              Metabase JVM Process             │
                         │                                                │
   HTTP/S  ────────────▶│  Ring/Compojure HTTP server (src/metabase/server)
  (REST API,             │        │                                       │
   /api/mcp,             │        ▼                                       │
   dashboard UI,         │  api_routes/routes.clj  (route dispatch)       │
   embed iframe)         │        │                                       │
                         │        ├─▶ session/api.clj      (login/session) │
                         │        ├─▶ queries_rest/api/card.clj (Cards)    │
                         │        ├─▶ dashboards_rest (Dashboards)          │
                         │        ├─▶ query_processor/api.clj (/api/dataset)│
                         │        ├─▶ mcp/api.clj  (/api/metabase-mcp)      │
                         │        └─▶ ... ~40 more API namespaces           │
                         │                                                │
                         │  Query Processor (src/metabase/query_processor) │
                         │   MBQL/native → middleware stack → driver call  │
                         │        │                                       │
                         │        ▼                                       │
                         │  Driver layer (src/metabase/driver + modules/drivers/*)
                         │        │            (multimethod dispatch)      │
                         │        ▼                                       │
                         │  JDBC / native client per warehouse             │
                         │                                                │
                         │  Quartz scheduler + mq (src/metabase/mq)        │
                         │   - scheduled syncs, alerts, subscriptions      │
                         │   - durable outbox (queue_message_outbox table) │
                         └───────────────┬────────────────┬───────────────┘
                                         │                │
                          ┌──────────────▼───┐   ┌────────▼──────────────┐
                          │ Application DB     │   │ Connected "analytics" │
                          │ (Postgres/MySQL/H2)│   │ databases (Postgres,  │
                          │ report_card,        │   │ Snowflake, BigQuery,  │
                          │ report_dashboard,    │   │ Redshift, MySQL, ...) │
                          │ collection,          │   │ — customer data, only│
                          │ metabase_database,    │   │  ever queried, never │
                          │ permissions*, session│   │  written to by MB    │
                          └─────────────────────┘   └───────────────────────┘
```

---

## 3. Component Diagram

```
frontend/src/metabase/*          — React/Redux SPA (dashboards, query builder, admin)
frontend/src/embedding-sdk*       — Embedded Analytics SDK (EE-licensed, React components)
src/metabase/api_routes           — top-level route table, wires every *_rest namespace
src/metabase/queries               — Card ("Question") model + core logic
src/metabase/queries_rest          — Card REST API (/api/card, /api/cards)
src/metabase/dashboards            — Dashboard model, tabs, dashcards
src/metabase/dashboards_rest       — Dashboard REST API
src/metabase/collections           — Collection model (folder tree, incl. tenant-root type)
src/metabase/warehouses            — Database ("connected DB") model + connection settings
src/metabase/permissions           — Permissions/permissions_group/data_permissions models
src/metabase/driver + modules/drivers/* — driver multimethod core + concrete DB drivers
src/metabase/query_processor        — MBQL/native compiler + middleware pipeline
src/metabase/session                — login, session tokens, cookies
src/metabase/api_keys               — long-lived API key auth
src/metabase/embedding + embedding_rest — static/JWT embedding, iframe settings
src/metabase/mcp                    — OSS Model Context Protocol server (agent tool-calling)
src/metabase/agent_api              — underlying "Agent API" the MCP tools proxy to
src/metabase/premium_features       — token_check.clj + defenterprise macro (OSS/EE dispatch)
src/metabase/mq + task              — Quartz-backed scheduler + durable message queue
src/metabase/tenants                — OSS shim (no-op) for the EE tenants feature
enterprise/backend/src/metabase_enterprise/*  — paid-only implementations (sandbox, sso, tenants, ...)
```

---

## 4. Request Flow (ad-hoc query via API → warehouse → result)

Concrete trace for `POST /api/dataset` (the ad-hoc/ "run this query right now" endpoint used for
programmatic/headless access):

1. HTTP `POST /api/dataset` hits the endpoint defined in
   `src/metabase/query_processor/api.clj` (`ns metabase.query-processor.api "/api/dataset endpoints."`),
   specifically `(api.macros/defendpoint :post "/" ...)`.
2. The handler calls `run-streaming-query`, which:
   - Resolves `source-card-id` if the query nests a saved question (`query->source-card-id`), and does a
     permission read-check via `api/read-check :model/Card`.
   - Applies default constraints (`qp.constraints/default-query-constraints`) and streams results via
     `qp.streaming/streaming-response`.
   - Calls `qp/process-query` (in `metabase.query-processor`), which runs the query through the QP
     middleware pipeline (permissions check in
     `src/metabase/query_processor/middleware/permissions.clj`, then compilation).
3. Compilation: MBQL is normalized (`metabase.lib.core`) and compiled to native SQL/driver-specific query
   form for the target engine via the driver multimethod hierarchy in `src/metabase/driver` (e.g.
   `describe-database`, native query building implemented per-driver under `modules/drivers/*` or in-tree
   for h2/postgres/mysql/sqlite in `src/metabase/driver/{postgres,mysql,h2,sqlite}.clj`).
4. Execution: the compiled query is sent over JDBC (or a native client for non-JDBC drivers like MongoDB)
   to the connected warehouse (the `metabase_database` row identified by `:database` in the request body).
5. Results stream back as a `StreamingResponse` (`metabase.server.streaming_response`), formatted as JSON by
   default (or CSV/XLSX/etc. via the sibling `/api/dataset/:export-format` endpoint in the same file), with
   column metadata attached.
6. For saved questions, the equivalent flow is `GET/POST /api/card/:id/query`
   (`src/metabase/queries_rest/api/card.clj`), which loads the persisted `report_card.dataset_query` and
   runs it through the same QP pipeline.
7. The **MCP path** (new, chat-agent-oriented) is functionally parallel but sits one layer up: an MCP
   `tools/call` for `execute_query`/`execute_sql`/`execute_question` (`src/metabase/mcp/tools.clj`) builds a
   "synthetic Agent API request" and dispatches it to `metabase.agent-api.api`, which in turn drives the same
   Card/QP machinery described above — i.e., MCP is a thin, scope-checked, OAuth-authenticated wrapper around
   the same query execution path, not a separate query engine.

---

## 5. Authentication Flow

**A. Metabase's own user login / session** (`src/metabase/session/api.clj`, `ns "/api/session endpoints"`):
- Password login is throttled per-username and per-IP (`throttle.core`, `login-throttlers`).
- LDAP login is supported when enabled (`ldap-login` in `session/api.clj`, delegates to `metabase.sso.core`).
- On success, a session record is created (`src/metabase/session/models/session.clj`) with
  `generate-session-key`/`generate-session-id`/`hash-session-key` (only the **hash** of the session key is
  stored — the plaintext key is the cookie/token value, never persisted). Session cookie behavior
  (`session-cookies`) and `enable-password-login` are runtime settings (`session/settings.clj`).
- `metabase.session.core` also tracks last-activity with a throttled in-memory cache
  (`record-session-activity-update!`, 60s throttle) to avoid a DB write on every request.
- A separate `src/metabase/api_keys` module supports long-lived **API keys** as an alternative to session
  cookies, for machine-to-machine callers (`api_keys/models/api_key.clj`).
- The MCP server layers **OAuth 2.0** on top of this: Metabase runs its own embedded OAuth server
  (`src/metabase/oauth_server`), issuing access tokens scoped to a subset of the user's own permissions
  (`agent:search`, `agent:query:execute`, etc. — see §4/§11). Browser cookie sessions are also accepted by
  MCP and get unrestricted scope.

**B. Connecting to external (analytics) databases — credential storage**:
- Each connection is a row in `metabase_database` (Toucan model `metabase.warehouses.models.database`).
- Connection secrets live in the `details` (and `write_data_details`, `admin_details`) JSON columns, which
  are **encrypted at rest**: `(t2/deftransforms :model/Database {:details mi/transform-encrypted-json ...})`
  (`src/metabase/warehouses/models/database.clj` line ~53). A dedicated
  `results-transform` hook additionally strips secret properties from any row before it is returned to a
  client (`secret/clean-secret-properties-from-database`), i.e. defense-in-depth beyond the DB-level
  encryption.
- `src/metabase/secrets` handles secret-value plumbing (e.g. uploaded SSL certs) separately from the
  encrypted-JSON blob.
- Encryption key: application-level encryption is controlled by the `MB_ENCRYPTION_SECRET_KEY` setting
  (referenced by `mi/transform-encrypted-json`); if unset, Metabase stores `details` unencrypted (verified
  by the transform's use of the standard Metabase encryption utility, which no-ops without a configured key —
  this is documented Metabase behavior, flagged here as an operational risk to note for Orlixa, NOT VERIFIED
  beyond the transform wiring itself since the exact encryption utility internals were not separately opened).

---

## 6. Database Design (Metabase's own application database)

Confirmed real table names (Toucan `t2/table-name` multimethod definitions, not paraphrased):

| Model | File | Table |
|---|---|---|
| `:model/Card` (a "Question", loosely "report_card") | `src/metabase/queries/models/card.clj:59` | `report_card` |
| `:model/Dashboard` | `src/metabase/dashboards/models/dashboard.clj:39` | `report_dashboard` |
| `:model/Collection` | `src/metabase/collections/models/collection.clj` (table name set via shared infra; collections are the folder/permission-scoping unit for Cards/Dashboards) | `collection` |
| `:model/Database` (a connected warehouse) | `src/metabase/warehouses/models/database.clj:42` | `metabase_database` |
| `:model/PermissionsGroup` | `src/metabase/permissions/models/permissions_group.clj:26` | `permissions_group` |
| `:model/Permissions` (path-based ACL rows) | `src/metabase/permissions/models/permissions.clj` | `permissions` (not opened line-by-line beyond confirming the file exists at that path; module described in `permissions/path.clj`) |
| `:model/Tenant` (EE) | `enterprise/backend/src/metabase_enterprise/tenants/models.clj:15` | `tenant` |

Notable design points read directly from source:
- `report_card` carries a `card_schema` integer version column with an explicit upgrade pipeline
  (`upgrade-card-schema-to` multimethod, current version `23` as of this clone) — schema evolution is handled
  in application code at read-time (`after-select`), not just via migrations.
- `report_dashboard` is a genuine 1930s-era name inherited from Metabase's earliest "Pulse"/report era; it
  now backs the modern Dashboard feature. Confirmed via `t2/table-name :model/Dashboard` → `:report_dashboard`.
- Migrations are Liquibase changelogs under `resources/migrations/*.yaml` (plus a legacy consolidated file
  `resources/liquibase_legacy_migrations.yaml`, which contains the original `createTable: report_card`
  changeset). Migrations are versioned/dated per file (e.g. `resources/migrations/060/20260213_dimension_columns.yaml`).
- `metabase_database.details` etc. use `mi/transform-encrypted-json` (see §5) — credentials are not stored
  as plaintext columns.
- The EE `Tenant` model's `t2/define-before-insert` automatically provisions a dedicated root `Collection`
  per tenant (`tenant-specific-root-collection-type`), so tenant isolation piggybacks on the same collection
  hierarchy/permission system used for ordinary folders (see §15).

---

## 7. Folder Structure (annotated)

```
src/metabase/                       Backend, Clojure, AGPL (outside enterprise/)
  api_routes/                       Central route table wiring every *_rest namespace
  queries/ , queries_rest/          Card ("Question") model + REST API
  dashboards/ , dashboards_rest/    Dashboard model + REST API
  collections/ , collections_rest/  Collection (folder) model + REST API
  warehouses/ , warehouses_rest/    Connected-database model + REST API
  permissions/ , permissions_rest/  Permission graph, groups, data_permissions
  driver/                           Driver multimethod core (+ h2/postgres/mysql/sqlite in-tree)
  query_processor/                  MBQL/native compiler, middleware, /api/dataset
  session/ , api_keys/              Auth: cookie sessions, API keys
  embedding/ , embedding_rest/      Static/JWT embedding settings
  mcp/                              OSS Model Context Protocol server (agent tool-calling)
  agent_api/                        Underlying tool endpoints MCP proxies to
  mq/ , task/                       Durable queue (outbox) + Quartz scheduled jobs
  premium_features/                 defenterprise macro + MetaStore token-check client
  tenants/                          OSS no-op shim for the EE tenants feature
  sso/ , oauth_server/              OSS-side SSO plumbing (Google auth lives here; SAML/JWT/LDAP-details in EE)
  models/                           Legacy shared model infra (interface.clj, serialization.clj) — most
                                     concrete models have since moved to per-feature dirs (see
                                     `models/DO_NOT_ADD_NEW_FILES_HERE.txt`, an explicit repo convention
                                     telling contributors the flat models/ dir is deprecated)
modules/drivers/                    Out-of-tree driver plugins (bigquery, snowflake, redshift, mongo, oracle,
                                     sqlserver, athena, databricks, presto, clickhouse, vertica, etc.)
enterprise/backend/src/metabase_enterprise/   Proprietary (MCL), gated by premium-feature tokens
  sandbox/                          Row/column-level data sandboxing (:feature :sandboxes)
  sso/                              SAML, JWT, LDAP-integration niceties, OIDC (SSO integrations)
  tenants/                          Real multi-tenant implementation (:feature :tenants)
  audit_app/                        Audit logging (:feature :audit-app)
  advanced_permissions/             Impersonation, application-permission APIs
  embedding_hub/, embeddings/       Interactive/SDK embedding server-side support
  mcp/                              EE-only extensions to the OSS MCP server (usage trimming task, etc.)
  ... (scim, serialization, semantic_search, transforms_python, gsheets, metabot, etc.)
frontend/src/metabase/              React/Redux SPA (dashboard/query-builder/admin UI)
frontend/src/embedding-sdk*/        Embedded Analytics SDK packages (EE-licensed component library)
frontend/src/metabase-lib/          Shared query-building library used by both app and SDK
resources/migrations/               Liquibase schema migrations (app DB)
```

---

## 8. Deployment Architecture

Per official docs (`installation-and-operation/running-the-metabase-jar-file` and the H2-migration guide):
- Metabase requires a dedicated **application database**, separate from any analytics database: H2
  (bundled, file-based) for local/dev/testing only; **Postgres or MySQL** recommended/required for
  production.
- Config for the JAR is via `MB_DB_TYPE`, `MB_DB_DBNAME`, `MB_DB_HOST`, `MB_DB_PORT`, `MB_DB_USER`,
  `MB_DB_PASS` environment variables; a `Dockerfile` ships at the repo root for containerized deployment,
  and Docker is the documented recommended path for self-hosting over the bare JAR.
- Analytics/connected databases (Postgres, MySQL, Snowflake, BigQuery, Redshift, etc.) are configured
  per-connection through the admin UI/API and are architecturally distinct from the app DB — Metabase never
  writes application state into them (this is corroborated by the `write_data_details` field existing
  *separately* from `details` in the `Database` model, i.e. the schema itself distinguishes "read the
  warehouse" credentials from "write back to the warehouse" credentials used by newer write-back features
  like `action_v2`/`transforms`).
- Binaries: OSS binaries ship at `hub.docker.com/metabase/metabase` and the general downloads path; the EE
  binary (same source tree, `enterprise/` code compiled in) ships at
  `hub.docker.com/metabase/metabase-enterprise` and `downloads.metabase.com/enterprise` — per `LICENSE.txt`
  at the repo root, this is the exact mechanism by which "the same features exist in both binaries" claims
  should be read: the EE binary contains extra code, license-gated at runtime, not a different product build.

---

## 9. Worker Architecture

Background work runs on **Quartz** (JVM job scheduler), wired through `src/metabase/task` (see
`task/QUARTZ.md`, `task/job_factory.clj`, `task/bootstrap.clj`). Confirmed real usages:
- `src/metabase/session/task/session_cleanup.clj` — periodic sweep of expired sessions.
- `src/metabase/premium_features/task/{clear_token_cache,send_metering}.clj` — token-cache invalidation and
  usage metering to Metabase's own MetaStore.
- `src/metabase/mq/task/queue_reaper.clj` and `mq.task.outbox` (referenced in `mq/README.md`) — sweep stale
  queue rows / recover the transactional outbox.
- `enterprise/backend/src/metabase_enterprise/sso/task/delete_expired_relay_state.clj` — SAML relay-state
  cleanup (EE).
- Dashboard subscriptions/alerts (Pulses) are also Quartz-scheduled jobs (`src/metabase/pulse`), though the
  exact cron-trigger registration file was not individually opened in this pass — flagged as NOT VERIFIED
  at the line level, but the mechanism (Quartz cron trigger → render → send via `channel/email`) is strongly
  implied by `pulse/models/pulse_card.clj` existing alongside the general Quartz task infra.
- Quartz's JDBC job store is clustered against the application database, so scheduled jobs are safe across
  multiple Metabase nodes (`quartz_affinity*.clj` in `src/metabase/mq` explicitly implements Quartz-cluster
  affinity for the queue system — see §10).

---

## 10. Queue Architecture

Yes — Metabase has a real, documented internal queue system: `src/metabase/mq` (read in full,
`src/metabase/mq/README.md`). Key verified facts:
- It is **not** a message broker like RabbitMQ/Kafka/SQS. It is a first-party abstraction
  (`metabase.mq.core`) over two backends: **Quartz** (a one-shot Quartz job per batch, backed by Quartz's
  clustered JDBC job store — i.e. the same Postgres/MySQL app DB) and an **in-memory**
  `LinkedBlockingQueue` backend for single-node/dev/test use.
- Delivery model: at-least-once, no ordering guarantee, retries up to `queue-max-retries` (default 5), no
  dead-letter queue (a terminal-failure `:on-error` hook exists instead of a DLQ).
- Durability for transactional publishes goes through an **outbox pattern**: a `queue_message_outbox` table
  in the app DB holds messages inserted atomically inside the producing DB transaction; a periodic Quartz
  sweep (`recover-outbox!`, `metabase.mq.task.outbox`) republishes anything a crash left behind, using
  `FOR UPDATE SKIP LOCKED` for safe multi-node concurrency.
- Concurrency controls: `:exclusive true` (cluster-wide mutual exclusion) or `:max-concurrent-batches n`
  (soft per-node throttle) — the queue's own README explicitly warns these are enforced differently per
  backend and "don't layer."
- This is a genuinely sophisticated, recently-built subsystem (it reads like an internal platform team's
  answer to "we needed reliable pub/sub without adding infra") — worth studying on its own merits as a
  reference design for Orlixa's own job/notification plumbing, independent of the BI use case.

---

## 11. API Structure

Confirmed real endpoints (opened, not inferred):
- `POST /api/dataset` and `POST /api/dataset/:export-format` — ad-hoc query execution / download
  (`src/metabase/query_processor/api.clj`).
- `/api/card`, `/api/cards` — saved-question CRUD + `POST /api/card/:id/query` to run a saved question
  (`src/metabase/queries_rest/api/{card,cards}.clj`).
- `/api/dashboard` family — `src/metabase/dashboards_rest` (not opened line-by-line this pass, but its
  presence and naming convention mirror `queries_rest`, confirmed via directory listing).
- `/api/session` — login/logout/password-reset (`src/metabase/session/api.clj`).
- `/api/metabase-mcp` (canonical) / `/api/mcp` (legacy alias) — the MCP JSON-RPC endpoint
  (`src/metabase/mcp/api.clj`, documented in `src/metabase/mcp/README.md`).
- Auth options for programmatic callers: session cookie, or a long-lived **API key**
  (`src/metabase/api_keys`), or an MCP OAuth bearer token scoped to specific tool permissions
  (`agent:query:execute`, `agent:sql:execute`, etc. — full scope table in §5/§4).
- `metabase.api.open_api` exists (imported in `session/api.clj`) implying the API self-documents via an
  OpenAPI-style schema — consistent with `api.macros/defendpoint` carrying malli schemas for both request
  and response shapes throughout the codebase (seen directly in `query_processor/api.clj`).

---

## 12. Extension Points (driver architecture)

Verified from `src/metabase/driver.clj` and `src/metabase/driver/impl.clj`:
- Drivers are registered via `metabase.driver/register!`, and dispatch is via a **Clojure multimethod
  hierarchy** (`driver.impl/hierarchy`) — e.g. `(isa? driver/hierarchy (the-driver :postgres) (the-driver
  :sql-jdbc))`, so a new SQL-ish driver can inherit an enormous amount of behavior just by deriving from
  `:sql-jdbc` or `:sql`.
- Core multimethods a driver must/can implement (confirmed present in `driver.clj`): `initialize!`,
  `display-name`, `contact-info`, `can-connect?`, `validate-db-details!`, `dbms-version`,
  `describe-database`/`describe-database*`, `describe-table`, `describe-fields`, `describe-table-indexes`,
  `describe-fks`, `qualified-name-components`, etc.
- In-tree drivers for the most common OSS databases live directly under `src/metabase/driver/` (`h2.clj`,
  `postgres.clj`, `mysql.clj`, `sqlite.clj`) and share `driver/sql.clj` / `driver/sql_jdbc.clj` base
  implementations.
- All other drivers (BigQuery, Snowflake, Redshift, MongoDB, Oracle, SQL Server, Athena, Databricks,
  Presto/Trino/Starburst, ClickHouse, Vertica, Druid, Spark) live as separate **plugin modules** under
  `modules/drivers/*`, each with its own `deps.edn`/build and a plugin manifest, loaded dynamically at
  startup rather than compiled permanently into the core artifact — confirmed by their physical separation
  from `src/metabase/driver` and Metabase's own driver-authoring docs describing "plugin manifests."
- Per official docs, a basic JDBC-based driver can be implemented in as little as ~50 lines because so much
  is inherited from the `:sql-jdbc` parent.

---

## 13. Plugin System

Beyond the database-driver plugin mechanism (§12), there is **no general-purpose plugin/extension system**
for arbitrary third-party feature modules in this codebase. What might look plugin-like are actually:
- **`defenterprise`** (`src/metabase/premium_features/defenterprise.clj`) — an internal OSS/EE dispatch
  macro, not a public extensibility API; it lets an OSS namespace declare a function with a separate EE
  implementation, resolved at runtime by namespace + feature-token check. This is a *build-time/license-time*
  seam, not something a third party can hook into without forking the enterprise tree.
- **The MCP server** (§4/§11) is the closest thing to a genuine external-extension surface, but it exposes
  Metabase's own functionality to external AI clients — it does not let third parties inject new server-side
  behavior into Metabase itself.
- No manifest-based, hot-loadable "apps" or "extensions" directory was found for non-driver functionality.
  Stated plainly for the record: **Metabase does not have a plugin system beyond database drivers.**

---

## 14. Scalability

Per official docs (`configuring-metabase/caching`) and source:
- **Query result caching**: Community edition includes a basic "Adaptive" cache policy (TTL derived from a
  query's average execution time), stored in the application database by default (Metabase Cloud caches to
  Metabase's own servers). This is implemented in `src/metabase/cache/core.clj` (referenced from
  `queries/models/card.clj`).
- **Pro/Enterprise-only** caching controls (per official docs): fixed **Duration** policy, cron-like
  **Schedule** policy, automatic pre-emptive cache refresh, and granular per-database/per-dashboard/
  per-question cache policy hierarchies. Automatic refresh is explicitly documented as incompatible with
  row/column sandboxing, connection impersonation, or database routing, because those features fan a single
  cached query out into many permission-specific variants.
- **Connection pooling**: each `metabase_database` connection is a JDBC connection pool managed per-driver
  (`driver.connection`/`driver.settings` in `src/metabase/driver`); pool sizing knobs exist as Metabase
  settings (not independently verified at the exact settings-key level this pass — NOT VERIFIED beyond
  confirming the `driver/connection.clj` module exists and is the natural owner of this).
- **Horizontal scaling**: Quartz's clustered JDBC job store (§9/§10) and the `mq` outbox pattern are both
  explicitly designed for multi-node deployments sharing one application database — this is a real,
  source-confirmed multi-node story for background work, distinct from marketing claims.
- No sharding of the application database itself is supported; it is a single relational DB is the
  bottleneck for metadata/permissions at very large scale (consistent with typical BI-tool architecture,
  not separately contradicted by anything read in this pass).

---

## 15. Multi-tenancy

**Not available in Community Edition** as a first-class "multiple isolated customer orgs on one instance"
concept. Verified precisely:
- `src/metabase/tenants/core.clj` is the **OSS shim**: every function is a `defenterprise` stub whose OSS
  body is a no-op or a throw — e.g. `tenant-is-active?` OSS body is `(nil? tenant-id)` ("no tenants are
  active on OSS" per its own docstring), and `create-tenant!` OSS body literally
  `(throw (ex-info "Cannot create tenant in OSS." {}))`.
- The real implementation is `enterprise/backend/src/metabase_enterprise/tenants/{core,models,api,
  auth_provider,permissions}.clj`, gated by `:feature :tenants` (visible on every `defenterprise` call in
  that namespace, e.g. `login-attributes`, `create-tenant!`, `user->tenant`).
- Mechanism (for architectural understanding only — see §18 legal note): a `tenant` table holds
  `name`/`slug`/`attributes`/`is_active`; on insert, a dedicated root `Collection` of type
  `tenant-specific-root-collection` is auto-created and linked via `tenant_collection_id`
  (`tenants/models.clj` `t2/define-before-insert`); tenant users get a `tenant_id` FK, and their login
  attributes are the union of user + tenant + system attributes (`tenants/core.clj` `combine` function,
  read in full) — this is the same "user attributes" mechanism Metabase already uses for row-level
  sandboxing (see §16), extended with a tenant layer.
- Practical implication for Orlixa: since Orlixa is itself a multi-tenant SaaS, if Metabase were used as a
  backing engine for an "AI Analytics Employee" serving many customer companies from one Metabase instance,
  genuine data/collection isolation between Orlixa customers would require **either** (a) a paid Metabase
  Enterprise/Pro license to use the real `tenants` + `sandbox` EE modules, **or** (b) Orlixa engineering its
  own isolation layer outside Metabase (e.g. one `metabase_database` connection + one permission group per
  Orlixa customer, enforced entirely by Orlixa's own orchestration code, never exposing Metabase's UI or API
  directly to customers) — which is exactly the intended architecture per the prompt (customers never see
  Metabase itself). Option (b) sidesteps the licensing question entirely because Orlixa's own backend would
  be the only "user" of the shared Metabase instance from Metabase's point of view.

---

## 16. Security (row-level "sandboxing")

**Confirmed Enterprise-only.** `enterprise/backend/src/metabase_enterprise/sandbox/query_processor/
middleware/sandboxing.clj` line 431 calls
`(premium-features/assert-has-feature :sandboxes (tru "Sandboxing"))` before applying any per-user row
filter, and the `apply-sandboxing`/`merge-sandboxing-metadata` `defenterprise` functions are declared with
`:feature :sandboxes` (the latter) or `:feature :none` with an internal assert (the former — deliberately
always runs so it can throw the "you need the feature" error itself, per its own comment: "run this even
when the `:sandboxes` feature is not enabled, so that we can assert that it *is* enabled").
- Mechanism: a `sandbox` model (`enterprise/.../sandbox/models/sandbox.clj`) maps a permissions-group +
  table to either a restricted "card" (a saved question whose result becomes the visible rows) or an
  attribute-based row filter, keyed off the same user-attribute mechanism used by tenants (§15). This is
  applied as query-processor middleware, i.e. it rewrites the compiled query before it reaches the driver.
- Community Edition permission model, by contrast, is coarse: `permissions_group` +
  `permissions`/`data_permissions` tables (`src/metabase/permissions/models/{permissions,data_permissions,
  permissions_group}.clj`) grant/deny access **per database/schema/table**, not per row or per column value.
  This is a real, useful, free capability — but it cannot restrict *which rows* of a table a given group
  sees.
- Column-level and connection-impersonation controls are similarly EE-gated
  (`enterprise/backend/src/metabase_enterprise/advanced_permissions`, `.../impersonation`), consistent with
  the official Enterprise product page's explicit claim: "Set strict visibility rules across databases,
  tables, rows, and columns" is listed under Pro & Enterprise, not Community.

---

## 17. Limitations

- No native multi-tenancy or row-level security in the free edition (§15/§16) — a hard blocker for any
  design that would let Metabase itself see or scope data per Orlixa end-customer, absent a paid license.
- No general plugin system beyond DB drivers (§13) — anything beyond adding a data source requires forking
  or living entirely at the API/MCP boundary.
- Static (JWT) embedding cannot do row/column security or drill-through, and always shows a "Powered by
  Metabase" badge unless upgraded — irrelevant to Orlixa's plan (Orlixa will never embed a Metabase iframe
  or show its branding), but worth noting as a trap for anyone tempted to reach for iframe embedding instead
  of the API/MCP path.
- Advanced caching (scheduled refresh, per-object cache policy) is Enterprise-only; Community caching is
  a blunt, average-execution-time-based TTL.
- `metabase_database.details` encryption depends on an operator-configured secret key; if unset, this
  clone's transform code does not itself enforce that a key must be present (NOT VERIFIED beyond the
  transform wiring — the actual encryption-utility fallback behavior was not independently traced this
  pass) — worth a dedicated security review before trusting it with real customer warehouse credentials.
- Single relational application database is a scaling ceiling for metadata/permissions at very large
  numbers of tenants/questions, even though background job processing itself is cluster-safe (§9/§10).

---

## 18. Enterprise-only Features

**Legal framing (read this before anything else in this section):** the source code for every feature
below is physically present in this cloned repository, under `enterprise/`. Per the repo's own
`LICENSE.txt` and `LICENSE-MCL.txt` (both read in full):

> "Within the top-level `enterprise` directory, source code in a given file is licensed under the Metabase
> Commercial License, unless otherwise noted."
>
> "Usage of files in the top-level `/enterprise` directory ... is subject to the Metabase Commercial
> License ... and conditional on having a valid license from Metabase. **Access to files in this directory
> and its subdirectories does not constitute permission to use this code or Metabase Enterprise Edition
> features.**"

The code additionally self-enforces this at runtime: every `defenterprise` function gated by a `:feature`
keyword calls through to `metabase.premium-features.token-check/has-feature?`, which validates a signed
token against Metabase's hosted MetaStore (or an offline "airgap" token) before the EE code path executes.
**Running any of the following in production without a paid Metabase license from Metabase, Inc. would
violate the Metabase Commercial License — this is not a "you can flip a flag" situation; there is no
legitimate way to enable these without paying Metabase.** The description below is for architectural
understanding only.

- **Row/column-level data sandboxing** — `enterprise/.../sandbox/*` — **ENTERPRISE ONLY — requires a paid
  license, do not enable without one.** (`:feature :sandboxes`)
- **Multi-tenant `Tenant` model** — `enterprise/.../tenants/*` — **ENTERPRISE ONLY — requires a paid
  license, do not enable without one.** (`:feature :tenants`)
- **SSO: SAML, JWT, OIDC integrations** — `enterprise/.../sso/*` (LDAP itself has some OSS presence via
  `src/metabase/sso`, but the SAML/JWT/OIDC provider integrations and API routes are entirely under
  `enterprise/.../sso`) — **ENTERPRISE ONLY — requires a paid license, do not enable without one.**
- **Audit logging** (`enterprise/.../audit_app`) — **ENTERPRISE ONLY — requires a paid license, do not
  enable without one.** (`:feature :audit-app`)
- **Advanced/application permissions, connection impersonation** (`enterprise/.../advanced_permissions`,
  `.../impersonation`) — **ENTERPRISE ONLY.**
- **Interactive/modular embedding + Embedded Analytics SDK** (`enterprise/.../embedding_hub`,
  `frontend/src/embedding-sdk*`) — per official docs, the SDK/"modular embedding" path (as distinct from
  basic static JWT-iframe embedding, which is OSS) is positioned for "multi-tenant environments" and richer
  interactivity — **ENTERPRISE/Pro ONLY** for the full SDK experience; treat as license-gated.
- **White-labeling / branding removal** — Pro/Enterprise only per the official product page.
- **Advanced caching policies** (Duration/Schedule/auto-refresh) — Pro/Enterprise only per official docs.
- **SCIM user provisioning** (`enterprise/.../scim`) — Enterprise-pattern module; not independently
  confirmed against a specific `:feature` keyword this pass — treat as **ENTERPRISE ONLY** pending
  verification, since it lives entirely under `enterprise/`.

---

## 19. Community Features (confirmed free under AGPL)

- Full query builder + native SQL editor, questions ("Cards"), dashboards, collections/folders.
- Coarse permissions: per-database/schema/table view and query-builder/native access, via
  `permissions_group` + `permissions`/`data_permissions` (source confirmed, §6/§16).
- Ad-hoc and saved-question REST API execution (`/api/dataset`, `/api/card/:id/query`) — no license gate
  found on these endpoints.
- The full **MCP server** (`src/metabase/mcp`) — confirmed to live outside `enterprise/`, i.e. AGPL/free.
  This is the single most consequential fact for Orlixa: the headless agent-tool-calling surface this study
  was specifically asked to investigate is **not** Enterprise-gated.
- Basic API-key auth (`src/metabase/api_keys`), session-cookie auth, LDAP login (basic LDAP auth itself is
  OSS; SAML/JWT/OIDC and LDAP-group-sync niceties are the EE add-ons).
- Static/JWT iframe embedding (with the "Powered by Metabase" badge) — confirmed OSS per official docs.
- Basic adaptive query caching.
- The driver framework and all in-tree drivers (h2/postgres/mysql/sqlite) plus the out-of-tree driver
  plugins under `modules/drivers/*` (bigquery, snowflake, redshift, mongo, oracle, sqlserver, etc.) —
  drivers are not Enterprise-gated.
- Quartz-based scheduling and the `mq` durable queue/outbox system — both live outside `enterprise/`.
- Data serialization/export-import between instances (`installation-and-operation/serialization`) — content
  migration tool, confirmed OSS via docs, explicitly **not** a multi-tenancy feature (it moves content, not
  isolates orgs).

---

## 20. Which parts should Orlixa reuse

1. **The MCP server pattern, and possibly the server itself, as the query execution backend.**
   `src/metabase/mcp` + `agent_api` is a production-grade, OSS, scope-checked, OAuth-authenticated
   tool-calling surface that already does almost exactly what an "AI Analytics Employee" needs: search
   schema, construct a query from natural intent, execute it, get structured JSON rows + column metadata
   back. Orlixa's Analytics Employee chat agent could call this MCP server directly as a tool backend
   instead of re-implementing query construction/execution, with the Orlixa AI employee's own LLM turn
   deciding which MCP tool to call. This reuses years of query-processor and driver maturity for free.
2. **The driver layer** (`src/metabase/driver` + `modules/drivers/*`) — connecting to 15+ warehouse types is
   a large, well-tested surface Orlixa should not rebuild. Point Metabase (running headless, no UI ever
   exposed) at each customer's warehouse using this layer.
3. **The `mq` queue/outbox pattern** (§10) is worth studying as a reusable *design*, independent of using
   Metabase itself — Orlixa's own platform likely needs exactly this shape of "reliable at-least-once
   delivery with a transactional outbox" for its own workflow engine, and this is a clean, documented
   reference implementation to borrow ideas from (not necessarily the code).
4. **Coarse permissions model** (`permissions_group`/`data_permissions`) as the per-Orlixa-customer boundary
   if Orlixa runs one shared Metabase instance internally: give each Orlixa customer's warehouse connection
   its own permission group with no cross-customer grants, entirely orchestrated by Orlixa's backend (never
   exposed to the customer), sidestepping the need for the paid `tenants`/`sandboxes` EE features (§15).

## 21. Which parts should Orlixa replace

1. **All dashboard/collection/question UI and the static/JWT embedding path.** Orlixa customers will never
   see Metabase's UI per the stated design — none of `frontend/src/metabase` (the dashboard SPA) or the
   embedding snippet (`LICENSE-EMBEDDING.txt`-covered `app-embed.js`) is needed; Orlixa's own chat UI is the
   only surface. Building/maintaining this would be pure waste.
2. **Metabase's own session/login UI and user-management screens** — Orlixa already has (per project
   memory) its own multi-tenant auth and per-role scoping; Metabase's user/session system should be reduced
   to a single service-account identity per Orlixa deployment (or per customer, internally), driven only via
   API key/OAuth, never via interactive login.
3. **Native multi-tenancy/sandboxing, if attempted at all, should be replaced by Orlixa-native isolation**
   rather than paying for and operating Metabase's EE `tenants`/`sandbox` modules: since Orlixa's own backend
   is the sole caller of Metabase in this architecture, isolation is more naturally enforced in Orlixa's own
   orchestration layer (one connection + one permission group per customer, provisioned and audited by
   Orlixa) than by adopting Metabase's EE licensing and its own separate `Tenant`/user-attribute model.
4. **Metabase's own scheduled alerts/dashboard-subscription email system** (Pulses) — Orlixa's AI employee
   platform almost certainly has (or will build) its own notification/scheduling layer; there is no reason to
   run two separate "send this on a schedule" subsystems when Metabase is invisible to the end customer.

## 22. Which parts should Orlixa ignore

1. **Enterprise SSO (SAML/JWT/OIDC), SCIM provisioning, audit-app, white-labeling.** These solve "let my
   external users log into Metabase's own UI/branding," which is moot when customers never see Metabase.
   Orlixa's own auth and audit logging (already built, per project memory) cover this need at the Orlixa
   layer instead.
2. **The Embedded Analytics SDK / interactive embedding.** Solves customer-facing dashboard embedding —
   directly contrary to Orlixa's "chat only, no dashboard UI ever" design constraint.
3. **Metabase Cloud-specific hosting features** (e.g. Cloud-hosted cache storage) — irrelevant if Orlixa
   self-hosts Metabase as an internal engine.
4. **Serialization/content migration tooling** — designed for moving dashboards between staging/prod
   Metabase instances maintained by human analysts; not relevant when Metabase content is generated
   on-the-fly by an AI agent rather than curated by humans.
5. **Metabase's own driver-development docs' encouragement to build/contribute new community drivers** —
   Orlixa should only add drivers for warehouses its customers actually use, using the existing in-tree/
   plugin drivers already covering the mainstream cases (Postgres, MySQL, Snowflake, BigQuery, Redshift).

---

*Compiled from direct inspection of the local Metabase source clone and official docs pages cited inline.
Any claim not traceable to an opened file or fetched doc page is explicitly marked NOT VERIFIED above.*
