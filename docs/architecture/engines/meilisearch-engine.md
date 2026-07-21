# Meilisearch — Engine Study

Source verified against local clone: `C:\Users\Admin\AppData\Local\Temp\claude\meilisearch-src`
(tag/version in `Cargo.toml`: `1.50.0`). Official docs verified via `www.meilisearch.com/docs`
where cited. Anything not directly confirmed in source or docs is marked **NOT VERIFIED**.

---

## 1. Executive Summary

Meilisearch is a single-binary, Rust search engine built on an embedded LMDB
(`heed` crate) storage layer. It is **not** a general database — it exists to take
JSON documents, index them (full-text, filters/facets, and now native vector
search), and answer sub-50ms search queries with typo-tolerance and ranking.
The codebase is a Cargo workspace of ~20 crates. Since v1.x it ships an
**open-core split**: the bulk of the engine is MIT-licensed (`LICENSE-MIT`),
while a specific, narrow set of *multi-instance clustering* features
(sharding, network/federated replication, S3-based remote snapshotting) live
in code paths gated behind a Cargo feature flag `enterprise` and are licensed
under a Business Source License 1.1 variant (`LICENSE-EE`) that explicitly
forbids production use without a paid commercial agreement. For Orlixa's
"AI Search Employee" use case (single-node-per-tenant or shared-multi-tenant
document search, not a distributed search cluster), the relevant surface is
almost entirely the free, MIT-licensed core.

Meilisearch is genuinely **complementary**, not redundant, to Orlixa's
existing pgvector RAG pipeline: it is a purpose-built, LMDB-backed inverted
index with sub-50ms typo-tolerant full-text + facet/filter search and its own
embedded vector index (via the `hannoy`/HNSW crate) for hybrid search, whereas
pgvector is a Postgres extension bolted onto a relational database optimized
for `ORDER BY embedding <-> query` similarity, not fielded/faceted/typo-tolerant
lexical search at low latency. Using both means Orlixa could route
"find document/keyword" style employee queries to Meilisearch (fast, ranked,
filterable) and keep pgvector for RAG-chunk semantic retrieval feeding LLM
context — or evaluate replacing pgvector's *retrieval* step with Meilisearch's
built-in hybrid (keyword + vector) search, since milli now performs both in one
engine.

---

## 2. Architecture Diagram

```
                         ┌─────────────────────────────────────────┐
                         │        meilisearch (crates/meilisearch)   │
                         │  Actix-web HTTP server, single binary     │
                         │  - routes/ (REST API)                     │
                         │  - extractors/authentication (key/JWT)    │
                         │  - search/ (query orchestration)          │
                         │  - proxy/ (EE: multi-instance forwarding) │
                         └───────────────┬───────────────────────────┘
                                         │ calls
                         ┌───────────────▼───────────────────────────┐
                         │     index-scheduler (crates/index-scheduler)│
                         │  - queue/ : task + batch LMDB-backed queue │
                         │  - scheduler/ : autobatcher + processor    │
                         │  - scheduler/enterprise_edition/ (EE:      │
                         │      network sharding, S3 snapshot export) │
                         └───────────────┬───────────────────────────┘
                                         │ owns N x
                         ┌───────────────▼───────────────────────────┐
                         │        milli (crates/milli)                │
                         │  the actual search engine library          │
                         │  - index.rs: one `Index` = one heed::Env    │
                         │    (LMDB environment) = one on-disk index   │
                         │  - update/: indexing pipeline (obkv, grenad)│
                         │  - search/: ranking, filters, facets        │
                         │  - vector/: embedders + hannoy (HNSW) store │
                         │  - sharding/ (EE: rendezvous-hash sharding) │
                         └───────────────┬───────────────────────────┘
                                         │
                         ┌───────────────▼───────────────────────────┐
                         │   heed (LMDB bindings) → files on disk      │
                         │   one directory per index under data.ms/    │
                         └─────────────────────────────────────────────┘

Supporting crates: meilisearch-auth (API keys, LMDB-backed key store),
meilisearch-types (shared DTOs, error codes, key/action enum, the EE
`network.rs` type definitions), file-store (temp upload storage for the
`/documents` multipart endpoint), dump (import/export of `.dump` archives),
meilitool (offline maintenance CLI: DB upgrade, snapshot inspection).
```

---

## 3. Component Diagram

```
crates/
├── meilisearch/            HTTP server binary (actix-web). Routes, auth
│                            extractors, search orchestration, analytics,
│                            proxy (EE), OpenAPI generation.
├── meilisearch-types/       Shared types: Key/Action enum (API-key scopes),
│                            error Code enum, task/batch DTOs, the EE
│                            `enterprise_edition/network.rs` (Network type).
├── meilisearch-auth/        API key CRUD + LMDB-backed key store
│                            (crates/meilisearch-auth/src/store.rs),
│                            AuthFilter (index/action authorization).
├── index-scheduler/         Task queue + autobatcher + batch processor;
│                            owns the `IndexMapper` (index_uid -> milli::Index).
├── milli/                   The search engine core library (indexing,
│                            ranking, filtering, facets, vector/hybrid search,
│                            sharding types for EE).
├── file-store/              Temporary storage for uploaded document payloads
│                            before they are queued as a task.
├── dump/                    Export/import full-instance dumps (JSON+metadata).
├── meilitool/                Offline CLI: DB version upgrades, snapshot
│                            compaction, key inspection outside the server.
├── filter-parser/           Parser for the `filter=` query-language grammar.
├── flatten-serde-json/      Flattens nested JSON documents into milli's
│                            internal dot-path attribute model.
├── permissive-json-pointer/ Selects/filters JSON fields (attributesToRetrieve
│                            etc.) tolerant of missing paths.
├── json-depth-checker/      Guards against pathologically nested payloads.
├── routes/, routes-macros/  Macro-generated OpenAPI route registration.
├── http-client/             Shared reqwest wrapper (used by EE proxy/S3 code).
├── build-info/, tracing-trace/, meili-snap/, xtask/  Dev/build tooling.
└── external-crates/async-openai(-macros)/  Vendored OpenAI client used by
    the "AI-powered search" (`chats`) feature — see §11/§20.
```

---

## 4. Request Flow

**A. Indexing a document** (`POST /indexes/{uid}/documents`):
1. `crates/meilisearch/src/routes/indexes/documents.rs` receives the multipart/JSON
   payload; the raw payload is written to disk via `file-store` (not held in RAM).
2. The route creates a `KindWithContent::DocumentAdditionOrUpdate` task and calls
   `index_scheduler.register(...)`. This appends a `Task` row into the
   LMDB-backed `queue` (crates/index-scheduler/src/queue/tasks.rs) and returns a
   `202 Accepted` with a task UID immediately — indexing is always asynchronous.
3. The scheduler's tick loop (`crates/index-scheduler/src/scheduler/mod.rs`,
   function documented as "1. cleanup task queue 2. create next batch 3-5.
   process batch") wakes up (via `wake_up: SignalEvent`), the `autobatcher`
   groups compatible pending tasks for the same index into one `Batch`, and
   `process_batch::process_batch` runs it.
4. Inside milli, `update/` pipeline: JSON is flattened
   (`flatten-serde-json`), converted to `obkv` key/value rows, terms are
   tokenized and written into `word_docids`, `word_pair_proximity_docids`,
   facet DBs (`facet_id_f64_docids`, `facet_id_string_docids`), and if
   embedders are configured, vectors are computed and inserted into the
   `hannoy` (HNSW) `vector_store` database — all inside one LMDB write
   transaction (`heed::RwTxn`) on the index's own `heed::Env`.
5. Task status flips to `succeeded`/`failed` in the queue; clients poll
   `GET /tasks/{uid}`.

**B. Search query** (`POST /indexes/{uid}/search`):
1. `crates/meilisearch/src/routes/indexes/search.rs` authenticates the request
   (see §5), applies `AuthFilter` (allowed indexes / injected filter from a
   tenant token, if present).
2. `crates/milli/src/search/` opens a `heed::RoTxn` (read transactions never
   block writers in LMDB/MVCC) against the index's `Env`, parses the `filter=`
   string via `filter-parser`, and executes: candidate universe restriction by
   filter → term matching / typo-tolerant word lookup → proximity + ranking-rule
   pipeline → (if `hybrid`/`vector` search requested) a query against the
   `hannoy` vector store, merged/re-ranked with the lexical results.
3. Results (documents + `_formatted`/facets) are serialized back through
   `permissive-json-pointer` (attributesToRetrieve) and returned in the same
   HTTP response — no async task involved for reads.

---

## 5. Authentication Flow

Source: `crates/meilisearch-auth/src/lib.rs`,
`crates/meilisearch/src/extractors/authentication/mod.rs`,
`crates/meilisearch-types/src/keys.rs`.

- **Master key**: set via CLI flag/env at startup; must be ≥16 bytes
  (confirmed on the official self-host security docs). Only the master key can
  manage API keys (`keys.*` actions). If no master key is set, the instance
  runs with **no authentication** (open by design for local dev).
- **API keys**: `Key` struct (`meilisearch-types/src/keys.rs`) carries
  `actions: Vec<Action>` (an explicit enum — `search`, `documents.add`,
  `indexes.*`, `tasks.*`, `keys.*`, `network.get/update`, `chatCompletions`,
  etc. — confirmed at lines ~265-360 of `keys.rs`), `indexes: Vec<IndexUidPattern>`
  (supports glob patterns like `"sal*"`), and `expiresAt`. Keys are persisted in
  an LMDB store (`meilisearch-auth/src/store.rs`), not a general RDBMS. Four
  default keys are auto-created on first boot (Search, Admin, Read-Only Admin,
  Chat) per the official docs.
- **Tenant tokens** (confirmed at
  `crates/meilisearch/src/extractors/authentication/mod.rs` ~lines 146-360,
  and exercised by `crates/meilisearch/tests/auth/tenant_token.rs`): a tenant
  token is a **client-generated JWT**, signed with `HS256` using the *parent
  API key's own secret* as the HMAC key (`EncodingKey::from_secret(parent_key)`),
  whose claims are `{ apiKeyUid, searchRules, exp }`. The server does not
  "issue" tenant tokens via an endpoint — it only *verifies* them
  (`jsonwebtoken::decode` with `Validation` checking `exp`, plus an
  `insecure_decode` step first purely to read the header/apiKeyUid before
  looking up the corresponding key to validate the signature). `searchRules`
  restricts which indexes and which implicit filters apply, and access is
  intersected with the parent key's own index/action scope
  (`tenant_token_is_index_authorized`, `get_key_filters`). This mechanism is
  **not gated by the `enterprise` Cargo feature** — it compiles and runs in the
  plain MIT-licensed build. Per official docs, tenant tokens only scope the
  **search** endpoint (embedding a mandatory filter, e.g. `tenant_id = 42`);
  they do not scope indexing/admin routes.
- This is exactly the mechanism meant for the "one search index, isolate rows
  per customer via a filter" multi-tenant pattern — see §15.

---

## 6. Database Design

Meilisearch has no relational schema. Confirmed in
`crates/milli/src/index.rs` (`struct Index`, ~line 129):

- Each **index** (Meilisearch's unit of "a collection of similar documents",
  roughly analogous to a Postgres table or Elasticsearch index) is backed by
  **one `heed::Env`** — i.e., one memory-mapped LMDB environment/directory on
  disk. `heed` is Meilisearch's own maintained Rust binding to LMDB.
- Inside that one `Env`, dozens of named LMDB sub-databases hold different
  inverted-index structures, each confirmed by field name in `index.rs`:
  `main` (misc/settings), `external_documents_ids` (user-provided doc ID ↔
  internal u32 docid), `word_docids` / `exact_word_docids` /
  `word_prefix_docids` (term → roaring-bitmap of docids), `word_pair_proximity_docids`
  (co-occurrence for phrase/proximity ranking), `word_position_docids` /
  `word_fid_docids` (term position/field tracking), `facet_id_f64_docids` /
  `facet_id_string_docids` (facet value → docids, for filters/facet counts),
  `field_id_docid_facet_f64s` / `...strings` (reverse: docid+field → raw facet
  value, used for sorting), `vector_store: hannoy::Database<Unspecified>`
  (the embedded HNSW-like vector index, via the `hannoy` crate, "features =
  ['arroy']" — `hannoy` is the successor to Meilisearch's earlier `arroy` vector
  crate), `shard_docids` (EE-only sharding metadata), and
  `documents: Database<BEU32, ObkvCodec>` (the actual document bodies, stored
  as `obkv` — an ordered key-value binary format — keyed by internal docid).
- Roaring bitmaps (`CboRoaringBitmapCodec`) are the workhorse data structure
  for postings lists — this is why Meilisearch is fast at intersecting large
  filter/term result sets.
- Because it's LMDB, reads are lock-free/MVCC (`RoTxn`) and writes are
  single-writer-at-a-time (`RwTxn`) per index — there is no separate "write vs
  read replica" story inside one instance; that's exactly what the EE network
  feature (§18) exists to add across instances.
- The task **queue** itself (§10) is *also* LMDB-backed — a separate `Env`
  managed by `index-scheduler/src/queue/mod.rs` (`struct Queue`, with
  `batch_to_tasks_mapping: Database<BEU32, CboRoaringBitmapCodec>` etc.), not
  Redis/Postgres. There is no external broker dependency anywhere in the
  Community build.

---

## 7. Folder Structure

```
meilisearch-src/
├── Cargo.toml                 workspace members (verified list, 21 members
│                               incl. 2 vendored external-crates)
├── LICENSE / LICENSE-MIT / LICENSE-EE   dual-license (MIT + BUSL-1.1)
├── Dockerfile                  official container build
├── crates/
│   ├── meilisearch/            HTTP server + routes + auth extractor + proxy
│   ├── meilisearch-types/       shared DTOs incl. Key/Action, EE Network type
│   ├── meilisearch-auth/        API key store (LMDB)
│   ├── index-scheduler/         task queue + autobatcher + batch processor
│   │   └── src/scheduler/enterprise_edition/   EE: network.rs, s3.rs
│   ├── milli/                   core search engine library
│   │   ├── src/index.rs         `Index` struct = one LMDB env
│   │   ├── src/update/          indexing pipeline
│   │   ├── src/search/          query execution / ranking
│   │   ├── src/vector/          embedders + hannoy vector store
│   │   └── src/sharding/        community_edition.rs (no-op) vs
│   │                            enterprise_edition.rs (rendezvous hashing) —
│   │                            selected via `#[cfg(feature = "enterprise")]`
│   ├── file-store/              temp document-upload storage
│   ├── dump/                    instance dump import/export
│   ├── meilitool/                offline maintenance CLI
│   ├── filter-parser/           `filter=` grammar parser
│   ├── flatten-serde-json/      nested JSON → flat attribute paths
│   ├── permissive-json-pointer/ tolerant field selection
│   ├── json-depth-checker/      payload nesting guard
│   ├── routes/, routes-macros/  OpenAPI route macros
│   └── http-client/             shared reqwest wrapper (used by EE proxy)
└── external-crates/
    ├── async-openai/            vendored OpenAI client (used by `chats`
    │                            AI-search-assistant feature, MIT-scoped —
    │                            no EE marker found on these files)
    └── async-openai-macros/
```

---

## 8. Deployment Architecture

Per official self-host docs (`meilisearch.com/docs/learn/self_hosted/...`) and
the repo's `Dockerfile`:

- Ships as a **single statically-linkable Rust binary** (`meilisearch`), no
  external runtime dependencies (no JVM, no separate DB server, no broker).
- Official Docker image (`getmeili/meilisearch`) built from the repo's
  `Dockerfile`; data persisted via a mounted volume to the configured
  `--db-path` (default `./data.ms`).
- Config via CLI flags, environment variables (`MEILI_*`), or a `config.toml`
  (present at repo root as a documented template).
- Minimum resource guidance and detailed capacity planning were **NOT VERIFIED**
  against a docs page in this pass (the fetched self-host getting-started page
  only covered basic single-command install; a dedicated
  sizing/production-deployment page was not located in this session — treat any
  specific RAM/disk numbers as NOT VERIFIED rather than guessed).
- No built-in orchestration for multiple nodes in the Community build; running
  more than one instance for the same dataset (replication/HA/sharding) is the
  EE "network" feature (§9, §18) or, per Meilisearch's own product lines, the
  separately-hosted **Meilisearch Cloud** offering (a distinct hosted product,
  not source in this repo beyond the client-visible network/proxy API).

---

## 9. Worker Architecture

There is exactly one background worker concept, and it is in-process, not a
separate worker pool of OS processes: `index-scheduler`
(`crates/index-scheduler/src/scheduler/mod.rs`). On each wake signal
(`SignalEvent`, triggered by new task registration or a timer) it:
1. Cleans up the task queue (removes/finalizes tasks past retention, etc.).
2. Calls `create_next_batch` — the **autobatcher**
   (`crates/index-scheduler/src/scheduler/autobatcher.rs`) groups
   same-index, compatible pending tasks (e.g. several document-addition tasks)
   into a single `Batch` to amortize the cost of one LMDB write transaction and
   one re-indexing pass.
3. Spawns the batch on a dedicated OS thread named `"batch-operation"`
   (`std::thread::Builder::new().name(...)`, confirmed in `scheduler/mod.rs`)
   and calls `process_batch::process_batch`, which does the actual milli
   indexing work synchronously on that thread while the HTTP server keeps
   serving searches concurrently (LMDB readers aren't blocked by the writer
   thread).
There is **no distributed worker fleet** in Community Edition — one
Meilisearch process = one scheduler = one thread processing one batch at a
time (though CPU-parallel internally via `thread_pool_no_abort` for the actual
indexing computation).

---

## 10. Queue Architecture

Confirmed at `crates/index-scheduler/src/queue/mod.rs` (`struct Queue`) and
`queue/tasks.rs`, `queue/batches.rs`:
- The task queue is **not** Redis/Kafka/RabbitMQ-backed — it is another LMDB
  environment, storing `Task` records and a `batch_to_tasks_mapping: Database<BEU32,
  CboRoaringBitmapCodec>` (batch ID → bitmap of task IDs).
- Tasks have a `Status` (enqueued/processing/succeeded/failed/canceled) and a
  `Kind` (`DocumentAdditionOrUpdate`, `IndexCreation`, `SettingsUpdate`,
  `TaskCancelation`, EE `NetworkTopologyChange`/export tasks, etc. — see
  `meilisearch-types/src/tasks.rs` and `tasks/network.rs`).
- Because the queue lives in the same on-disk LMDB store as the indexes (per
  instance), the queue does not survive/replicate independently — this is a
  single-node embedded queue by design, matching the "one binary, no external
  deps" philosophy. It is durable across process restarts (LMDB is crash-safe)
  but not distributed.
- Cross-instance task propagation (so a write on one node fans out to peer
  shards/replicas) is exactly the EE "network" scheduler code
  (`scheduler/enterprise_edition/network.rs`, `process_export.rs`) — see §18.

---

## 11. API Structure

Confirmed by files under `crates/meilisearch/src/routes/`:
- `indexes/` — `POST/GET/PATCH/DELETE /indexes/{uid}`, `documents.rs`
  (`/indexes/{uid}/documents`, add/get/delete, by batch or by filter),
  `search.rs` (`/indexes/{uid}/search`), `facet_search.rs`, settings
  sub-resources.
- `multi_search.rs` — `POST /multi-search` (federated single-call search
  across several indexes; the *EE* variant of this adds network-wide
  federation across remote instances, see `search/federated/network/`).
- `tasks/`, `tasks.rs` — `GET /tasks`, `GET /tasks/{id}`, cancel/delete.
- `batches.rs` — `GET /batches` (introspect the autobatcher's groupings).
- `api_key.rs` — `GET/POST/PATCH/DELETE /keys` (master-key-only).
- `dump.rs` / `snapshot.rs` / `export.rs` — instance backup/restore endpoints.
- `network/` — EE: `GET/PATCH /network` (cluster topology: remotes, shards,
  leader).
- `webhooks.rs` — task-completion webhooks.
- `chats/` — an AI chat-completions-style endpoint that lets a client ask
  natural-language questions answered by an LLM (via the vendored
  `async-openai` client) grounded in Meilisearch search results — i.e.
  Meilisearch's own (community, non-EE-marked in the files inspected) built-in
  RAG-ish assistant feature. Relevant to compare against Orlixa's own AI
  employee layer — see §20/§22.
- `metrics.rs`, `logs.rs` — Prometheus metrics / log streaming.
- `features.rs` — experimental-feature toggles (`RuntimeTogglableFeatures`).

---

## 12. Extension Points

Meilisearch has **no plugin API, no webhook-script/Lua/WASM extension
mechanism, and no way to load third-party code into the server process**.
The only "extension points" found in source are:
- **Custom embedders**: `crates/milli/src/vector/embedder` supports
  configuring different embedding sources (a REST/HTTP embedder, an
  OpenAI-compatible embedder, HuggingFace, Ollama, user-provided vectors) via
  JSON settings — this is configuration, not code injection.
- **Webhooks** (`routes/webhooks.rs`): fire an HTTP POST on task completion —
  again, integration by config/URL, not a plugin.
- **Experimental feature flags** (`features.rs`) toggle built-in behavior; they
  are not a way to add new behavior.
There is no interpreter, no dynamic module loading, no sandboxed script
execution anywhere in the crates inspected.

---

## 13. Plugin System

**Does not exist.** Confirmed by the absence of any plugin/module-loader
crate in the workspace member list (§/Cargo.toml) and no `dlopen`/WASM
runtime dependency anywhere in the crates read. Meilisearch is explicitly a
monolithic, single-binary engine; this matches its own public positioning as
"radically simple" — there is nothing to verify further here beyond stating
the negative clearly.

---

## 14. Scalability

- **Vertical**: Community Edition scales by giving the one process more CPU
  (indexing pipeline is internally multi-threaded via `thread_pool_no_abort`
  and `rayon`-style parallelism in milli's `update/` code) and more RAM
  (LMDB memory-maps the whole index; more page cache = faster).
- **Horizontal (multi-node) — this is the EE-gated part**: the `sharding`
  module in milli (`community_edition.rs` is effectively a no-op/passthrough,
  `enterprise_edition.rs` implements real rendezvous-hashing shard assignment,
  confirmed at `crates/milli/src/sharding/enterprise_edition.rs` —
  `Shards::hash_rendezvous`, `Shards::reshard`) plus the scheduler's
  `network.rs`/`s3.rs` (cross-instance task propagation and S3-backed remote
  snapshot exchange) together implement a leader/remote cluster topology:
  documents get consistently hashed to a shard/remote instance, and a
  `/network` config declares `leader`, `remotes`, and `shards`. **This entire
  code path only compiles when the crate is built with `--features
  enterprise`** (verified: `enterprise = [...]` feature wiring cascades from
  `meilisearch/Cargo.toml` → `index-scheduler` → `meilisearch-types` →
  `milli/Cargo.toml: enterprise = []`; it is absent from
  `meilisearch/Cargo.toml`'s `default = [...]` feature list). So: **no
  built-in replication, sharding, or HA in the plain Community build** — a
  self-compiled/self-hosted instance without the `enterprise` feature (which
  is how the official binaries/Docker image ship, per the Cargo default
  feature list) is single-node by design.
- Meilisearch Cloud (separately-hosted product) presumably operates its own
  infrastructure-level scaling; this is **NOT VERIFIED** against source since
  Cloud's infra is not in this repo.

---

## 15. Multi-tenancy

Two genuinely different mechanisms exist, at different layers, with different
licensing:

1. **Tenant tokens (Community, confirmed free/MIT)** — the intended mechanism
   for SaaS-style multi-tenant search: your backend holds one Search API key
   per app/tenant grouping, and mints a short-lived JWT (`tenant token`) per
   end-user request embedding a mandatory `searchRules` filter (e.g.
   `companyId = 42`). Verified at
   `crates/meilisearch/src/extractors/authentication/mod.rs` and exercised in
   `crates/meilisearch/tests/auth/tenant_token.rs` — no `enterprise` cfg gate.
   This scopes only the **search** call; it isolates *rows within a shared
   index* by filter, not physically separate storage per tenant.
2. **Per-index / per-key isolation (Community)** — API keys carry an
   `indexes: Vec<IndexUidPattern>` allow-list (supporting glob patterns), so a
   genuinely separate `heed::Env`/index-per-tenant model (one physical LMDB
   env per customer) is also fully supported today without any EE feature —
   you'd create one index per tenant and scope one key (or one tenant token)
   to it.
3. **Network/sharding (Enterprise, BUSL-1.1)** — this is about scaling *one
   logical index* across multiple physical instances/shards for capacity, not
   about isolating tenants from each other; it is unrelated to the
   tenant-isolation question but is the feature that would matter if a single
   shared Orlixa-wide index grew too large for one node.

**Conclusion for Orlixa**: the multi-tenant isolation options Orlixa actually
needs (filter-scoped tenant tokens, and/or one-index-per-tenant with
key-scoped access) are both fully available in the free Community/MIT build.
Nothing about tenant isolation itself requires the Enterprise license.

---

## 16. Security

- **Key scoping**: confirmed enum of ~30 discrete `Action`s
  (`meilisearch-types/src/keys.rs` lines ~265-360) covering per-resource verbs
  (`documents.add/get/delete`, `indexes.*`, `tasks.*`, `settings.*`,
  `keys.*`, `network.get/update`, `chatCompletions`, etc.), each combinable
  with an index allow-list and an expiry — a genuine least-privilege model,
  not just "read vs write."
- **Master key** gates all key management; without one, the instance is
  unauthenticated (documented behavior, confirmed logic in
  `extractors/authentication/mod.rs`: `missing_master_key` check just changes
  the error type, meaning auth is simply not enforced when no master key is
  configured — an operational footgun to flag for Orlixa's deployment
  checklist).
- **Encryption at rest**: **NOT VERIFIED** — no encryption-at-rest code (e.g.
  encrypted LMDB pages, envelope encryption of the data directory) was found
  in the crates inspected, and the fetched security doc page did not mention
  it. Treat Meilisearch's on-disk data as relying entirely on host/volume-level
  disk encryption, not an engine feature.
- **Transport security**: TLS termination is left to the operator (reverse
  proxy) per standard self-host guidance; no in-binary TLS cert management
  code was inspected in this pass (NOT VERIFIED further).

---

## 17. Limitations

- Single-writer-per-index model: only one batch processes at a time per
  instance (the scheduler thread), so extremely high concurrent write
  throughput on one index is serialized — mitigated by autobatching but still
  a real ceiling for very hot indexes.
- No built-in replication/HA/sharding in the Community build (confirmed §14) —
  a self-hosted single instance is a single point of failure for that index's
  data unless the operator handles their own backup/restore or (paid) EE
  network.
- No plugin/extension system (§12/§13) — any custom scoring/business logic
  must live outside Meilisearch (e.g. in Orlixa's own layer) or via the fairly
  limited configuration surface (ranking rules, custom embedders).
- Task queue and index data share the same durability guarantees of LMDB on a
  single disk — no confirmed built-in cross-region or cross-AZ durability in
  Community Edition.
- Encryption-at-rest: NOT VERIFIED as a built-in feature (see §16) — treat as
  absent unless later proven otherwise.

---

## 18. Enterprise-only Features

**Legal framing (must be read before any of the below):** Per `LICENSE-EE`,
the Licensed Work is "Any file explicitly marked as 'Enterprise Edition (EE)'
… residing in enterprise_edition modules/folders," and the license's
"Additional Use Grant" permits use **only for non-production purposes
(testing, development, evaluation)**. It states verbatim: *"Production use of
the Licensed Work requires a commercial license agreement with Meilisearch."*
The fact that this code is physically present in the cloned repository (every
`enterprise_edition.rs`/`enterprise_edition/` file carries a header comment
"This file is part of Meilisearch Enterprise Edition (EE). Use of this source
code is governed by the Business Source License 1.1") does **not** mean it may
be built and run in production without a paid license — doing so would
violate the BUSL-1.1 terms quoted above. The sections below describe these
mechanisms only for architectural understanding; they are not instructions to
deploy them commercially, and any production use requires contacting
Meilisearch per the license (`bonjour@meilisearch.com` / `sales@meilisearch.com`).

Confirmed EE-gated code (all behind Cargo feature `enterprise`, off by
default — `default = ["meilisearch-types/all-tokenizations", "mini-dashboard"]`
in `crates/meilisearch/Cargo.toml`, no `enterprise` in that list):

- **Multi-instance network topology / sharding** — ENTERPRISE ONLY, requires a
  paid license. `crates/milli/src/sharding/enterprise_edition.rs`
  (rendezvous-hash shard assignment, resharding logic),
  `crates/meilisearch-types/src/enterprise_edition/network.rs` (`Network::shards()`,
  `Network::sharding()`), `crates/meilisearch/src/routes/network/enterprise_edition.rs`
  (`PATCH /network` handlers for topology changes), `crates/index-scheduler/src/scheduler/enterprise_edition/network.rs`
  (`process_network_index_batch` — cross-instance task propagation).
- **Federated search across a network of remotes** — ENTERPRISE ONLY.
  `crates/meilisearch/src/search/federated/network/enterprise_edition.rs` and
  the `enterprise`-feature-gated parts of `search/federated/network.rs`.
- **S3-backed remote snapshot export/import for cluster nodes** — ENTERPRISE
  ONLY. `crates/index-scheduler/src/scheduler/enterprise_edition/s3.rs`
  (AWS STS `AssumeRoleWithWebIdentity`, S3 upload of index snapshots for
  onboarding/rebalancing a remote node).
- **Proxying requests between instances in a network** — ENTERPRISE ONLY.
  `crates/meilisearch/src/proxy/enterprise_edition.rs`.

Everything else examined in this repo (search, indexing, ranking, filters,
facets, vector/hybrid search, tenant tokens, API keys, dumps, webhooks, the
`chats` AI-assistant endpoint) carries **no** EE marker/no `enterprise` cfg gate
and is MIT-licensed.

Note the distinction requested: **Meilisearch Cloud** is a separately-hosted,
managed product operated by Meili SAS; its infrastructure is not in this
repository at all, so "Cloud-only" convenience features (managed backups,
one-click scaling, etc.) are a business/product distinction, not the same
thing as this repo's `enterprise` Cargo feature gate. This document only
attests to what is verifiable in the source: the `enterprise` feature flag.

---

## 19. Community Features (confirmed free under MIT)

- Full document indexing pipeline (async task queue, autobatching).
- Full-text search: typo tolerance, ranking rules, proximity/word-position
  ranking, synonyms, stop-words.
- Filtering and faceting (`facet_id_*_docids` DBs), sorting.
- **Native vector/hybrid search** (`milli/src/vector`, `hannoy` HNSW-backed
  store) — embedders (REST/OpenAI-compatible/HuggingFace/Ollama/user-provided),
  hybrid ranking that blends lexical + vector scores. Not EE-gated.
- API key system with per-action, per-index, expiring scoped keys.
- **Tenant tokens** (JWT-based search-time row isolation) — confirmed
  Community, §5/§15.
- Multi-search / federated search **within a single instance** (not the
  cross-network EE variant).
- Dumps (`dump/` crate) and local snapshots (`snapshot.rs`) for backup/restore
  of a single instance.
- Webhooks on task completion.
- The `chats` AI-assistant endpoint (LLM-grounded answers over search
  results, via vendored `async-openai`) — no EE marker found on these files.
- `meilitool` offline maintenance CLI (DB version upgrades, inspection).

---

## 20. Which parts should Orlixa reuse

- **The search/indexing core (milli via the meilisearch binary) as a backing
  store for the AI Search Employee's full-text + facet/filter search over a
  tenant's own documents.** It is purpose-built for exactly "fast, typo-tolerant,
  filterable search over JSON documents," which is a better fit than asking
  Postgres/pgvector to do lexical ranking.
- **Per-tenant isolation via tenant tokens and/or one-index-per-tenant + scoped
  API keys** (§15) — this maps directly onto Orlixa's existing multi-tenant
  model: Orlixa's backend already knows the caller's company/tenant id; it can
  mint a scoped API key or tenant token per tenant/session without needing any
  EE feature.
- **The action-scoped API key model** as a reference design for Orlixa's own
  internal service-to-service auth boundaries (least-privilege verb + resource
  scoping is a good pattern regardless of engine).
- **Native hybrid search (vector store, §6/§19)** as a candidate to evaluate
  for the *retrieval* half of RAG — worth a bake-off against pgvector for
  latency/quality on Orlixa's actual document corpus before committing.

## 21. Which parts should Orlixa replace

- **The `chats` AI-assistant / LLM-grounding endpoint** — Orlixa's own AI
  employee chat layer is the intended single interface for the end customer;
  Meilisearch's users must never see Meilisearch at all, so this endpoint (and
  the vendored `async-openai` client) should not be exposed — Orlixa's
  orchestration layer calls Meilisearch's plain search API and does its own
  LLM composition, not the other way around.
- **Any temptation to use the EE network/sharding for multi-tenancy** — that
  feature solves horizontal capacity for one big index, not tenant isolation,
  and it's BUSL-1.1-gated requiring a paid license; Orlixa should get
  multi-tenancy from tenant tokens / per-tenant indexes (free) instead, and
  only revisit EE network licensing if/when a single tenant's index outgrows
  one node's capacity.
- **Snapshot/dump-based backup as the sole backup story** — for a production
  multi-tenant SaaS, Orlixa should still wrap Meilisearch's dumps/snapshots
  with its own scheduled off-host backup process rather than relying on
  manual dump invocation.

## 22. Which parts should Orlixa ignore

- **The mini-dashboard / any built-in UI** — Orlixa customers never see
  Meilisearch; the admin UI (enabled via the `mini-dashboard` default Cargo
  feature) is irrelevant and should be disabled or left unexposed in
  deployment.
- **`meilitool` offline CLI** — an ops-only tool for Meilisearch's own
  maintainers/operators during version upgrades; only relevant to whoever runs
  the Meilisearch infrastructure inside Orlixa's own ops team, not product
  surface.
- **EE network/federated-search/S3-snapshot code entirely**, unless Orlixa
  later has a proven, licensed, paid need for multi-instance horizontal
  sharding of a single very large tenant index — until then this whole surface
  (§18) is both legally gated and architecturally unnecessary for Orlixa's
  expected per-tenant document volumes.
- **The vendored `async-openai` external crate** — Orlixa already has its own
  LLM integration; there is no reason to route any model calls through
  Meilisearch's vendored client.
