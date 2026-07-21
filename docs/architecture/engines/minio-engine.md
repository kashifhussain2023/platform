# MinIO — Object Storage Engine

**Study scope:** primary sources only — the actual cloned repo at
`C:\Users\Admin\AppData\Local\Temp\claude\minio-src` (minio/minio, Go) and official
docs at min.io/docs. No blog/third-party sources, except MinIO's own README/CHANGELOG/CREDITS,
which are primary statements from the vendor.

**Clone identity (verified):**
- HEAD commit: `7aac2a2c5b7c882e68c1ce017d8256be2feea27f`, dated 2026-02-11, message
  "update README.md format and clarify state of the project" (git log, shallow/grafted clone,
  no earlier history available).
- No `VERSION` file exists in the tree (checked `find . -maxdepth 1 -iname "*version*"` — empty).
  Go module version tracked only via `go.mod`/git; this is effectively a post-archival snapshot
  of `master`.
- License file present at repo root: **GNU AGPLv3** (verified — full FSF AGPLv3 text in `LICENSE`).
- `go.mod` pins `github.com/minio/console v1.7.7-0.20250905210349-2017f33b26e1` as a direct
  dependency — the web Console **is** compiled into this binary (see §18).

## 0. CRITICAL, VERIFIED FINDING — the repository is archived

The top of `README.md` in this exact clone reads (verbatim):

> **THIS REPOSITORY IS NO LONGER MAINTAINED.**
>
> **Alternatives:**
> - **AIStor Free** — Full-featured, standalone edition for community use (free license)
> - **AIStor Enterprise** — Distributed edition with commercial support

WebFetch against `https://github.com/minio/minio` (2026-07-19) confirms this is not just a stale
local checkout: the live GitHub page shows the repo **"was archived by the owner on Apr 25, 2026.
It is now read-only."** The official docs site `docs.min.io` no longer serves community-edition
documentation as a first-class product — `https://min.io/docs/minio/linux/index.html` 301-redirects
to `https://docs.min.io/enterprise/aistor-object-store/`, and that page is branded entirely as
"MinIO AIStor," "licensed under the MinIO Software License" (not AGPLv3), with no visible
Community/Enterprise comparison table. `docs.min.io/community/minio-object-store/index.html`
likewise returns AIStor-only content in practice — MinIO has consolidated its docs site around
the commercial AIStor brand.

README.md also states, verified verbatim in this clone:

> **Important:** The MinIO community edition is now distributed as source code only. We will no
> longer provide pre-compiled binary releases for the community version.
> ... Historical pre-compiled binary releases remain available for reference but are no longer
> maintained.

**Net effect verified from primary sources:** the AGPLv3 open-source line (`minio/minio` as a
maintained, binary-shipping product) has ended. What remains is: (a) this archived source tree,
buildable with `go install github.com/minio/minio@latest`, still AGPLv3-licensed and still
containing the full feature set found in this clone (see §18-19), and (b) the commercial
successor line "AIStor" (Free and Enterprise tiers), licensed under MinIO's own proprietary
"MinIO Software License," which is now the actively maintained and documented product. This is
the single most important fact for Orlixa's build-vs-buy decision (see §21).

---

## 1. Executive Summary

MinIO (this clone) is a single Go binary implementing an S3-compatible object storage server
with erasure-coded, disk-based storage, a built-in IAM/policy engine, bucket event notifications,
site/bucket replication, ILM/tiering, SSE encryption, and an embedded web Console UI — all present
in source, in this exact tree, under AGPLv3. However, as of this clone the upstream project is
archived/unmaintained and MinIO Inc. has redirected all forward development, support, and
documentation to the commercial "AIStor" product line under a different (non-AGPL) license.
For Orlixa, MinIO's code is a technically complete, well-architected S3 engine, but adopting it
today means depending on a frozen, unsupported open-source snapshot rather than an evolving
project — a materially different risk profile than "MinIO" carried a year prior.

## 2. Architecture Diagram

```
                         ┌───────────────────────────────────────────┐
                         │              Client / SDK                  │
                         │   (S3 SDK, mc CLI, browser → Console)       │
                         └───────────────────┬─────────────────────────┘
                                             │ HTTPS :9000 (S3 API + Console UI)
                         ┌───────────────────▼─────────────────────────┐
                         │        cmd/  — minio server process          │
                         │  ┌───────────────┐  ┌───────────────────┐   │
                         │  │  api-router.go │  │ admin-router.go    │  │
                         │  │  (S3 REST API) │  │ (Admin API /minio/ │  │
                         │  │                │  │  admin/v3/...)     │  │
                         │  └───────┬────────┘  └─────────┬──────────┘  │
                         │          │   consoleapi.Server (embedded)     │
                         │          │   newConsoleServerFn()             │
                         │  ┌───────▼────────────────────────────────┐  │
                         │  │   IAM (internal/*, cmd/iam*.go)         │  │
                         │  │   Bucket policy / SigV4 auth            │  │
                         │  └───────┬────────────────────────────────┘  │
                         │  ┌───────▼────────────────────────────────┐  │
                         │  │  erasureObjects (cmd/erasure-*.go)      │  │
                         │  │  erasure-sets → erasure-server-pool     │  │
                         │  └───────┬────────────────────────────────┘  │
                         │  ┌───────▼────────────────────────────────┐  │
                         │  │  storage layer: xl.meta + data shards   │  │
                         │  │  (local disk or remote via storage-rest)│  │
                         │  └──────────────────────────────────────────┘  │
                         │  background: data-scanner, heal-ops,          │
                         │  notify targets, replication workers          │
                         └────────────────────────────────────────────────┘
                                   │                        │
                          disk 1..N (erasure set)     event targets
                          (JBOD, per node)             (webhook/Kafka/AMQP/...)
```

## 3. Component Diagram

- **API layer** (`cmd/api-router.go`, `cmd/object-handlers.go`, `cmd/bucket-handlers.go`) —
  S3 REST verbs.
- **Admin layer** (`cmd/admin-router.go`, `cmd/admin-handlers*.go`) — MinIO-proprietary
  cluster/user/policy/heal management API under `/minio/admin/v3/...`.
- **Console layer** — `consoleapi.Server` from the separate `github.com/minio/console` Go
  module, instantiated by `newConsoleServerFn()` in `cmd/api-router.go:43` and started in
  `cmd/server-main.go:1020` (`logger.FatalIf(newConsoleServerFn().Serve(), ...)`), stopped in
  `cmd/signals.go:85`. It is compiled directly into the `minio` binary — there is no separate
  "console" process to deploy.
- **IAM** (`cmd/iam.go`, `cmd/iam-store.go`, `cmd/iam-object-store.go`, `cmd/iam-etcd-store.go`,
  `cmd/policy_test.go`, `cmd/bucket-policy*.go`) — users/groups/policies, pluggable backend
  (object-store-backed by default, etcd optional).
- **Erasure engine** (`cmd/erasure-*.go`: `erasure-coding.go`, `erasure-encode.go`,
  `erasure-decode.go`, `erasure-object.go`, `erasure-sets.go`, `erasure-server-pool.go`,
  `erasure-server-pool-decom.go`, `erasure-server-pool-rebalance.go`) — Reed-Solomon erasure
  coding, per-disk placement, pool decommission/rebalance.
  - **Reed-Solomon parity library:** MinIO does not implement Reed–Solomon math itself in this
    package; `erasure-encode.go`/`erasure-decode.go` call out to the `klauspost/reedsolomon` Go
    library (referenced in `go.mod`) for the actual GF(2^8) matrix math, while
    `cmd/erasure-coding.go` owns shard-count/placement decisions.
- **Storage backend** — local disk I/O (`cmd/xl-storage*.go`, not printed above but present)
  writing `xl.meta` (erasure/object metadata) + data shard files per disk; remote disks reached
  over an internal HTTP/gRPC-like protocol (`cmd/storage-rest-*.go`, `internal/grid`).
- **Background workers** — `cmd/data-scanner.go`, `cmd/background-heal-ops.go`,
  `cmd/global-heal.go`, `cmd/background-newdisks-heal-ops.go`.
- **Notification/event targets** — `internal/event/target/{webhook,kafka,amqp,mqtt,nats,nsq,
  elasticsearch,redis,mysql,postgresql}.go`.
- **KMS** — `internal/kms/{kms.go,kes.go,stub.go,config.go}` — talks to external MinIO KES
  (Key Encryption Service) or Vault-compatible KMS; `stub.go` shows a no-op/local fallback path.
- **Replication/Tiering/Lifecycle** — `cmd/bucket-replication*.go`, `cmd/site-replication*.go`,
  `cmd/tier*.go`, `cmd/bucket-lifecycle*.go` — all present as real, non-stub implementations in
  this clone (verified by reading file contents, not just names — see §18/19).

## 4. Request Flow — S3 PUT → erasure coding → disk write → response

Traced through real files/functions in this clone:

1. `cmd/api-router.go` registers the S3 router; a `PUT /bucket/object` request matches the
   PutObject route and is wrapped by `s3APIMiddleware` (auth, tracing) before dispatch.
2. `cmd/object-handlers.go:1793 func (api objectAPIHandlers) PutObjectHandler(...)` — parses
   headers (Content-MD5, SSE headers, storage-class), validates bucket/object names, wraps the
   body reader in a hashing/verifying reader (`internal/hash`), and calls into the
   `ObjectLayer` interface.
3. The `ObjectLayer` implementation for erasure mode is `erasureObjects`
   (`cmd/erasure-object.go:1249 func (er erasureObjects) PutObject(ctx, bucket, object,
   data *PutObjReader, opts ObjectOptions) (ObjectInfo, error)`).
4. Inside `PutObject`: the object is split into erasure-coded shards according to the bucket's
   EC parity setting (`cmd/erasure-coding.go` computes data/parity shard counts from the drive
   count, e.g. EC:4 default meaning 4 parity shards in an 8+4-style set); shard encoding itself
   is delegated to the `reedsolomon` library.
5. Each shard is written to a distinct disk in the erasure set via the `StorageAPI` interface
   (`cmd/xl-storage.go` for local disks, `cmd/storage-rest-client.go` for remote disks in
   distributed mode), alongside a per-object `xl.meta` file (versioned object metadata: erasure
   distribution, checksums, timestamps, user metadata, legal-hold/retention state).
6. A bitrot-protected write completes only when a read quorum of shards + metadata succeed
   (`erasure-metadata-utils.go` computes read/write quorum from EC settings).
7. `PutObjectMetadata`/`ObjectInfo` is returned up through the handler; the handler emits an
   `s3:ObjectCreated:Put` bucket notification (if configured — see §10) and writes the S3 XML/etag
   response back to the client.
8. Background: `cmd/data-scanner.go` periodically walks objects for bitrot/heal verification;
   `cmd/global-heal.go`/`background-heal-ops.go` repair any shard that failed quorum
   asynchronously, not on the write's critical path.

## 5. Authentication Flow

- **AWS SigV4 (access key/secret key):** implemented under `cmd/auth-handler.go` /
  `internal/auth`; standard SigV4/SigV4-streaming/SigV2 (legacy) validated against IAM credential
  store before any handler executes non-anonymous operations.
- **IAM / policy-based auth (verified present, not Enterprise-gated):** `cmd/iam.go` + `cmd/iam-
  store.go` implement full users, groups, service accounts, and JSON IAM policies (AWS-IAM-like
  policy language) evaluated per request in `cmd/policy_test.go`/`cmd/bucket-policy.go`. Storage
  backend for IAM state is pluggable: default is the object store itself
  (`cmd/iam-object-store.go`, storing policy/user docs as objects in the internal
  `.minio.sys` bucket), or external etcd (`cmd/iam-etcd-store.go`) for multi-cluster/HA IAM.
- **STS / temporary credentials and external IDP (LDAP/OIDC):** referenced under
  `docs/iam/` in this clone (LDAP and OpenID Connect docs exist in the local `docs/iam` folder),
  confirming this is source-tree functionality, not purely a docs artifact for a different
  product.

## 6. Database Design (metadata storage, no RDBMS)

MinIO has no relational database. Metadata is stored as **files on the erasure-coded storage
itself**:
- **Object metadata:** one `xl.meta` file per object version, colocated with data shards
  (binary MessagePack-ish format defined in `cmd/xl-storage-format*.go`), holding erasure layout,
  checksums, user metadata/tags, retention/legal-hold, and version history for versioned buckets.
- **Bucket configuration** (policies, lifecycle, encryption, quota, notification config): stored
  as objects inside the internal system bucket `.minio.sys` (referenced throughout
  `cmd/bucket-metadata*.go`), i.e. MinIO uses itself (its own erasure-coded object store) as the
  metadata store — there is no separate embedded KV engine like BoltDB/etcd bundled by default.
- **IAM policies/users:** also object-store-backed by default (`cmd/iam-object-store.go`), or
  externalized to **etcd** (`cmd/iam-etcd-store.go`) if configured — etcd is the one place an
  actual external KV store is optionally used, not bundled.
- **Cluster/heal/scanner state:** small JSON/msgpack state files, also stored as system objects
  (`cmd/data-usage-cache.go`, `cmd/background-heal-ops.go`).

## 7. Folder Structure (verified from this clone)

```
minio-src/
  cmd/                — ~454 files, effectively the entire server: S3 API, admin API,
                        erasure engine, IAM, bucket features (replication/lifecycle/tiering/
                        encryption/KMS-handlers/lock), background heal/scanner, console wiring.
                        (No further subpackaging — everything lives in one large `cmd` package,
                        a known MinIO architectural trait, not a stub/removed area.)
  internal/           — shared libraries used by cmd/: kms, event (+ event/target/*),
                        config (+ config/{notify,kms,ilm,identity,policy,browser,heal,
                        scanner,batch,dns,etcd,drive,lambda,storageclass,subnet,callhome,
                        certs...}), auth, hash, http, grid (internal RPC), lock, s3select,
                        crypto, jwt, pubsub, logger.
  docs/               — CC-BY-4.0 licensed docs mirrored/authored alongside source: erasure,
                        iam, kms, replication, site-replication, multi-tenancy, multi-user,
                        federation, bigdata, security, metrics, logging, ftp, lambda, select,
                        auditlog, batch-jobs, extensions, orchestration, resiliency, chroot,
                        compression, distributed, docker, integrations. (Confirms replication/
                        tiering/KMS/multi-tenancy topics are still documented in-repo even
                        though the live docs.min.io site has moved to AIStor branding.)
  buildscripts/, dockerscripts/  — build/release tooling.
  helm/, helm-releases/  — community-maintained Helm chart (README explicitly separates this
                        from the vendor-run "MinIO Operator").
  main.go              — entrypoint, thin wrapper calling into cmd.Main.
  LICENSE (AGPLv3), NOTICE, CREDITS, COMPLIANCE.md — license/attribution.
```
No `pkg/` directory exists in this clone (contrary to some older MinIO forks/tutorials) — all
production code is under `cmd/` and `internal/`.

## 8. Deployment Architecture (per official docs + Dockerfile/README in this clone)

- **Single-node, single-drive:** `minio server /path/to/data` — no erasure coding possible with
  one drive (no parity); intended for dev/test only per official guidance.
- **Single-node, multi-drive (SNMD):** `minio server /data1 /data2 /data3 /data4` — erasure
  coding across local drives on one host.
- **Distributed, multi-node erasure-coded (the production topology):** `minio server
  http://host{1...4}/data{1...4}` style pool syntax — erasure sets span nodes; official docs
  describe minimum 4-node/4-drive-per-node recommendations, tolerating loss of up to half the
  drives in a set depending on parity level.
- **Docker:** `Dockerfile`/`Dockerfile.release`/`Dockerfile.hotfix` in repo root; README's
  documented run command is `docker run -p 9000:9000 -p 9001:9001 myminio:minio server /tmp/minio
  --console-address :9001` — confirms the Console listens on a separate port (9001) from the S3
  API (9000) when both are enabled, in this exact clone.
- **Kubernetes:** two paths per README — the vendor's `minio/operator` project, or the
  community-maintained Helm chart in `helm/minio` in this same repo.
- **Binary distribution has ended per README** (see §0) — only source builds (`go install`) or
  self-built Docker images are the supported install paths going forward for this codebase.

## 9. Worker Architecture

- **Data scanner** (`cmd/data-scanner.go`, `cmd/data-scanner-metric.go`) — continuously walks
  all objects to verify bitrot checksums, usage stats, and detect objects needing heal or
  lifecycle action.
- **Healing** (`cmd/background-heal-ops.go`, `cmd/global-heal.go`,
  `cmd/background-newdisks-heal-ops.go`, `cmd/erasure-healing.go`) — background goroutines that
  reconstruct missing/corrupt shards from parity when quorum is intact, and re-integrate newly
  added/replaced disks.
- **Replication workers** — `cmd/bucket-replication*.go`/`cmd/site-replication*.go` run async
  replication of objects to configured remote MinIO/S3 targets, tracked via
  `bucket-replication-stats.go`/metrics.
- **Tiering sweeper** — `cmd/tier-sweeper.go`, `cmd/tier-last-day-stats.go` — moves cold objects
  to a configured remote tier (S3/Azure/GCS-compatible) per ILM rules, on a background schedule.
- All of the above run in-process inside the single `minio` binary — there is no separate worker
  process/deployment unit; concurrency is goroutine-based within each node.

## 10. Queue Architecture (bucket event notifications)

Not a message broker itself — MinIO is a **producer** of events to external systems via
configurable notification targets, implemented in `internal/event/target/`:
`webhook.go`, `kafka.go` (+ `kafka_scram_client_contrib.go`), `amqp.go`, `mqtt.go`, `nats.go`
(+ TLS/contrib test variants), `nsq.go`, `redis.go`, `elasticsearch.go`, `mysql.go`,
`postgresql.go`. Config for these lives under `internal/config/notify/`. Internally, target
dispatch uses `internal/pubsub` for fan-out to registered targets and local admin-console event
streaming; there is no built-in durable queue broker bundled — durability for, e.g., Kafka relies
on the external Kafka cluster the operator points MinIO at.

## 11. API Structure

- **S3-compatible REST API** (`cmd/api-router.go`, `cmd/object-handlers.go`,
  `cmd/bucket-handlers.go`, `cmd/multipart*.go` etc.) — broad AWS S3 REST compatibility: buckets,
  objects, multipart upload, ACL (documented in code as "dummy"/compat-only, see `PutObjectACLHandler`
  comment "this is a dummy call" at `cmd/api-router.go:341` — verified: MinIO uses IAM/bucket
  policy instead of real S3 ACLs), object tagging, versioning, object lock/retention,
  Select-object-content (`internal/s3select`), presigned URLs (SigV4 query auth), POST policy
  uploads (`cmd/postpolicyform.go`).
- **MinIO Admin API** (`cmd/admin-router.go`, path prefix `/minio/admin/v3/...`) — a
  MinIO-proprietary (non-S3) REST API for server info, storage info, data-usage info, metrics,
  service restart/stop, user/policy/group management, heal operations, site replication admin,
  KMS operations (`cmd/kms-handlers.go`, `cmd/kms-router.go`), tier admin
  (`cmd/tier-handlers.go`). Confirmed real (not stub) via `cmd/admin-router.go` lines 141-169
  registering dozens of live handler functions.

## 12. Extension Points

- **Bucket notification targets** (§10) are the primary extension mechanism — any of the 9
  built-in target types can be pointed at operator-controlled infrastructure (e.g., an Orlixa
  webhook receiver) without touching MinIO code.
- **KMS backend** (`internal/kms`) is pluggable at the protocol level (MinIO KES or a
  Vault-compatible KMS endpoint), letting an operator supply their own key management without
  forking MinIO.
- **IAM identity backend** — object-store-backed vs etcd-backed (§5/§6) is a config-time swap,
  and external OIDC/LDAP identity providers integrate at the auth layer per `docs/iam/`.

## 13. Plugin System

**None found beyond the extension points above.** There is no dynamic plugin loader, no
WASM/Lua/script hook system, and no lambda-style "run my code inside MinIO" execution engine in
this clone — the `internal/config/lambda`/`cmd/*lambda*` files found relate to configuring
**AWS Lambda notification targets** (an event-target type, same family as webhook/Kafka), not an
embedded function-execution plugin system. This should be stated explicitly per the template:
MinIO is not a plugin platform; its only "extend MinIO's behavior" surface is event notification
targets and pluggable identity/KMS backends.

## 14. Scalability

Per official docs (erasure-coding overview) and code (`erasure-server-pool.go`,
`erasure-server-pool-decom.go`, `erasure-server-pool-rebalance.go`): MinIO scales by adding
**server pools** — additional groups of nodes/drives — to an existing deployment; objects are
striped across erasure sets (typically capped around 16 drives/set per long-standing MinIO
design conventions reflected in `erasure-coding.go`'s set-size logic), and multiple sets combine
into a namespace. Decommissioning (`erasure-server-pool-decom.go`) and rebalancing
(`erasure-server-pool-rebalance.go`) let capacity be added/retired without downtime, both
verified present as real (non-stub, substantial) implementations in this clone. Practical ceiling
is operator/hardware-bound (network + drive IOPS), not a hard code limit found in this repo.

## 15. Multi-tenancy

**Verified: MinIO Community's own model is one deployment per tenant, not shared-instance
isolation**, per the `docs/multi-tenancy` folder present in this clone and long-standing official
guidance: the recommended pattern is running **separate MinIO clusters/tenants** (e.g., one
`Tenant` custom resource per tenant when using the MinIO Operator on Kubernetes) rather than
carving one running MinIO server into isolated tenant buckets via IAM alone. IAM policies inside
a single instance *can* restrict a credential to specific buckets/prefixes, which is enough for
coarse isolation, but MinIO's own documented multi-tenancy story is deploy-per-tenant, especially
for hard resource/security isolation — this clone's `docs/multi-tenancy` and `docs/multi-user`
being separate folders underscores that "multiple IAM users in one cluster" (multi-user) and
"multiple isolated tenants" (multi-tenancy) are treated as distinct topics by MinIO itself.

## 16. Security

- **SSE-S3 / SSE-KMS / SSE-C encryption at rest:** **verified present and implemented in this
  AGPLv3 clone** — `cmd/bucket-encryption*.go`, `cmd/encryption-v1.go`, `cmd/kms-handlers.go`,
  `internal/kms/*` are real, substantial files, not stubs (confirmed by content, not just
  filename). This directly contradicts an assumption that encryption is Enterprise-gated in the
  open-source code — in this clone it is community/AGPL code. (It does require an external
  KMS/KES endpoint to use SSE-KMS in practice; SSE-C needs only client-supplied keys and works
  standalone.)
- **IAM policy engine:** full AWS-IAM-style JSON policy evaluation (`cmd/iam-store.go`,
  `cmd/bucket-policy.go`), users/groups/service accounts, verified present.
- **TLS:** `cmd/certs.go`/`certsinfo.go` — standard TLS cert loading for the API/Console.
- **Object Lock / retention / legal hold:** `cmd/bucket-object-lock.go` present.
- **Audit logging:** `docs/auditlog` + logger target wiring present.

## 17. Limitations (real gaps found)

- **Project is archived/unmaintained** (§0) — the single biggest practical limitation: no future
  security patches, no CVE response, no roadmap, from this codebase going forward.
- **No native multi-tenant isolation inside one instance** beyond IAM policy scoping (§15) —
  operators needing hard tenant isolation must run one MinIO deployment per tenant, which is an
  operational/cost burden at scale.
- **No plugin/extensibility system** beyond notification targets and pluggable KMS/IAM backend
  (§13) — cannot embed custom business logic inside MinIO itself.
- **Docs site no longer distinguishes Community capabilities clearly** — `docs.min.io` now
  redirects to AIStor-branded content, making it hard for a new adopter to find authoritative,
  current Community-edition documentation outside this repo's own `docs/` folder and README.
- **No pre-built binaries going forward** — every deployment must build from source or build its
  own Docker image, raising the bar for ops teams versus a simple binary download.

## 18. Enterprise-only Features (meticulously verified against THIS clone)

Per the explicit instruction to verify precisely rather than assume, each feature below was
checked by opening real source files in `C:\Users\Admin\AppData\Local\Temp\claude\minio-src`,
not inferred from names alone:

| Feature | Status in THIS clone | Evidence |
|---|---|---|
| Web Console/UI | **COMMUNITY (verified present in this clone)** | `go.mod` direct dep `github.com/minio/console`; wired via `newConsoleServerFn()` in `cmd/api-router.go:43`, started in `cmd/server-main.go:1020`, README documents `--console-address :9001` and browsing to `127.0.0.1:9000`. **This directly contradicts the "Console removed from open source" narrative for this exact snapshot** — it is still compiled in and documented as the default experience. |
| SSE-S3/SSE-KMS/SSE-C encryption at rest | **COMMUNITY (verified present)** | `cmd/bucket-encryption*.go`, `cmd/encryption-v1.go`, `cmd/kms-handlers.go`, `internal/kms/*` are real non-stub implementations. |
| Bucket/Site replication | **COMMUNITY (verified present)** | `cmd/bucket-replication*.go`, `cmd/site-replication*.go` (multiple substantial files, incl. generated `_gen.go` msgpack marshalers implying real, actively-serialized state, not a stub). |
| ILM / tiering to remote storage class | **COMMUNITY (verified present)** | `cmd/tier*.go`, `cmd/bucket-lifecycle*.go` are real implementations with sweeper/stats logic. |
| IAM policy engine, users/groups/service accounts | **COMMUNITY (verified present)** | `cmd/iam*.go` full implementation. |
| Erasure coding, healing, scanner | **COMMUNITY (verified present)** | `cmd/erasure-*.go`, `cmd/*heal*.go`, `cmd/data-scanner.go`. |
| Multi-drive/multi-node distributed mode | **COMMUNITY (verified present)** | `cmd/erasure-server-pool*.go`, standard `minio server` pool syntax in docs. |
| Prometheus metrics, audit logging | **COMMUNITY (verified present)** | `cmd/metrics-v3-*.go`, `docs/auditlog`, `docs/metrics`. |
| Long-term maintenance, security patching, official support, SLA | **ENTERPRISE ONLY (moved to AIStor)** | README explicitly redirects to "AIStor Enterprise — Distributed edition with commercial support"; repo is archived; no further releases will land in this codebase. |
| Pre-built binary distribution | **ENTERPRISE-ADJACENT change, not a feature gate** | README: community edition no longer gets pre-compiled binaries; only source builds. AIStor Free/Enterprise are the source of ongoing packaged distributions going forward. |
| Current official documentation site coverage | **Moved to AIStor branding** | `docs.min.io` community-edition URLs now redirect to `/enterprise/aistor-object-store/`; the authoritative, current, maintained docs are AIStor docs, not community docs, even though this repo's own `docs/` folder still exists and describes the same features. |

**Bottom line:** at the *code* level, in this exact clone, none of the major "advanced" features
(replication, tiering, KMS/encryption, IAM, Console) were found to be stripped out, stubbed, or
paywalled in-code — they are all real, working, AGPLv3-licensed implementations. What changed is
**maintenance and distribution**, not (yet) code-level feature removal: MinIO Inc. archived this
repo and moved ongoing development, releases, support, and canonical documentation to the
commercial AIStor product line. Any prior belief that "the open-source Console was ripped out of
the code" is **not supported by this clone** — it is still there and still wired in. What *is*
verified is that this open-source line is now a dead end going forward.

## 19. Community Features (confirmed present in this clone)

S3-compatible REST API (broad verb coverage incl. multipart, versioning, object lock, tagging,
Select), embedded web Console, SigV4 + IAM/policy auth (object-store or etcd-backed), erasure
coding with healing/scanner, bucket/site replication, ILM lifecycle + tiering, SSE-S3/KMS/C
encryption, Prometheus metrics, audit logging, 9 notification target types, admin REST API,
Helm chart, Docker support, Kubernetes Operator integration path (operator itself is a separate
repo, not audited here) — all verified present as real source in this clone, all AGPLv3.

## 20. Which parts should Orlixa reuse

- **The S3 REST API surface as a target contract**, not the binary itself: Orlixa's existing
  `STORAGE_PROVIDER` abstraction (used by Knowledge/RAG documents and media libraries) already
  implies an S3-compatible interface — that contract (presigned PUT/GET, multipart, bucket/prefix
  model) is exactly what MinIO (or any S3-compatible engine) implements, so keep coding Orlixa's
  storage layer to the S3 API shape regardless of which engine sits behind it.
- **The architectural pattern of erasure coding for durability** and **event-notification-driven
  post-upload processing** (e.g. triggering an Orlixa ingestion/embedding pipeline off an
  `s3:ObjectCreated:Put` webhook target) are sound patterns worth keeping conceptually, even if
  the engine changes.
- If Orlixa is already running MinIO in dev/staging, it is reasonable to **keep using this exact
  AGPLv3 snapshot for non-production/internal environments** (self-hosted, source-built, no resale
  of MinIO itself) where AGPLv3 obligations are easy to satisfy, given it is a complete, correct,
  well-tested S3 implementation.

## 21. Which parts should Orlixa replace

- **The forward-maintenance dependency on `minio/minio` itself should be replaced/reconsidered**,
  precisely because of the verified finding in §0: the repo is archived, no more releases,
  no more official Community docs — a genuine long-term platform bet should not sit on a frozen,
  unmaintained codebase, especially one whose vendor's stated forward path (AIStor) requires a
  different, non-AGPL commercial license for the maintained product.
- **Recommendation: evaluate SeaweedFS or Garage as the production storage engine**, as the
  instructions anticipated:
  - **SeaweedFS** is actively maintained, Apache-2.0 licensed (no AGPL network-copyleft
    obligations for Orlixa as a SaaS operator), S3-compatible, and supports erasure coding —
    a closer drop-in replacement for MinIO's feature set with a healthier license for a
    commercial SaaS to embed.
  - **Garage** (Deuxfleurs) is AGPLv3 like MinIO but is actively maintained, purpose-built for
    simple, low-ops geo-distributed S3-compatible storage — a lighter-weight alternative if full
    MinIO feature breadth (tiering/KMS/replication) isn't needed.
  - Either choice avoids betting Orlixa's storage plumbing on a codebase the vendor has publicly
    stopped maintaining.
- **AIStor itself (Free or Enterprise) should be evaluated as a paid option** only if Orlixa needs
  vendor support/SLA and is willing to accept the MinIO Software License terms and commercial
  pricing — this is a legitimate alternative but changes the build's cost/licensing profile
  materially from "we self-host free AGPL software."

## 22. Which parts should Orlixa ignore

- **The embedded Console/browser UI** — Orlixa customers never interact with MinIO directly per
  the stated constraint; Orlixa builds its own upload/download UX against S3 APIs, so MinIO's (or
  any successor engine's) built-in web Console is operationally irrelevant to Orlixa's product
  and only useful for internal ops debugging at most.
- **MinIO's own multi-tenancy guidance/tooling** (`docs/multi-tenancy`, the Operator's `Tenant`
  CRD) — Orlixa already has its own tenant model at the application layer (per-company data
  scoping across the platform); adopting MinIO's cluster-per-tenant pattern would be redundant
  infrastructure complexity when Orlixa can achieve tenant isolation via bucket/prefix-per-company
  naming plus its own IAM layer instead.
- **MinIO's admin REST API and native Prometheus/audit-logging stack** — Orlixa already has (per
  project memory) its own audit-log screen and observability plans; duplicating MinIO's
  admin/metrics surface as user-facing Orlixa features would be redundant — treat these as
  internal-ops-only signals at most, not a feature to expose to Orlixa customers.
- **Lambda/Kafka/AMQP/NSQ/MQTT notification targets beyond webhook** — Orlixa's own backend
  already has its own job/notification plumbing (BullMQ per project memory); there is no reason
  to route storage events through Kafka/AMQP/etc. when a single webhook target back into Orlixa's
  own API is sufficient and keeps operational surface area small.
