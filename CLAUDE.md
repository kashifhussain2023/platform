# V-AEP Platform — codebase guide

Monorepo for the Vertical AI Employee Platform. Design spec: `docs/specs/2026-07-09-foundation-auth-design.md`.
The business context lives in the parent proposal (see `../CLAUDE.md`). Keep answers concise (token-minimizing setup).

## Stack
pnpm + Turborepo · `apps/web` (Next.js App Router, Tailwind, TanStack Query, Zustand, rhf+zod) ·
`apps/api` (NestJS, Prisma, Postgres) · `packages/types` (@vaep/types, shared DTOs) ·
`packages/config` · `infra/docker-compose.yml` (postgres+pgvector, redis, minio, adminer).

## Conventions (enforce these)
- **Singletons both sides.** Backend: `PrismaService` + all NestJS providers are singletons; tenant flows via a request guard. Frontend: one `apiClient`, one `queryClient`, one Zustand store.
- **Optimistic writes.** Mutations use TanStack Query `onMutate`→`onError` rollback→`onSettled` invalidate.
- **Minimal `useRef`** — only for focus, commented.
- Frontend `features/*` mirror backend `modules/*` one-to-one.

## Run locally
```
cd platform && pnpm install
docker compose -f infra/docker-compose.yml up -d              # infra
pnpm --filter @vaep/api run prisma:migrate                    # = prisma migrate deploy (apply committed migrations)
pnpm dev                                                      # web :3000, api :4000
```

GOTCHA (pgvector + Prisma): do NOT run `prisma migrate dev` to *apply* migrations. Prisma's schema can't
represent the HNSW index on the `Unsupported("vector")` column, so `migrate dev` sees it as drift and will
prompt to DROP `KnowledgeChunk_embedding_idx` (destructive). Use `prisma:migrate` (=`migrate deploy`) for
applying. To AUTHOR a new migration use `prisma:migrate:new` (=`migrate dev`), then before applying, delete any
`DROP INDEX ..._embedding_idx` line from the generated SQL (and keep the `CREATE ... USING hnsw` if the table
was recreated). If a `migrate dev` is Ctrl+C'd it can orphan the advisory lock (P1002 next run) — terminate the
idle backend holding `pg_advisory_lock` in Postgres, then retry.
GOTCHA (local port conflicts): a local Postgres holds `127.0.0.1:5432` and a local Redis holds `[::1]:6379`,
so Docker publishes Postgres on **5433** (`POSTGRES_PORT`) and Redis on **6380** (`REDIS_PORT`). The `.env`
files already use `localhost:5433` / `redis://127.0.0.1:6380`. Adminer :8080.

## Provider knobs (swappable, self-hosted defaults)
- `EMBEDDINGS_PROVIDER`: `hash` (default, offline/deterministic — also used by tests) · `local` (transformers.js, lazy) · `openai` (lazy, needs `OPENAI_API_KEY`). All 384-dim.
- `STORAGE_PROVIDER`: `local` (default, `STORAGE_DIR`) · `s3` (MinIO/S3, lazy). Auth is behind `AUTH_PROVIDER` (JWT).

## Module status (one module per turn: backend module + mirrored frontend feature, verify, update memory)
- ✅ Foundation + **auth/tenant**: register/login/refresh/me, JWT, multi-tenant `Company`/`User`.
- ✅ **Knowledge/RAG**: upload → BullMQ ingest (extract/chunk/embed) → pgvector(384, HNSW) tenant-scoped cosine `/search`. Frontend: optimistic upload, polling doc list, search panel, `/knowledge` page.
- ⬜ Next: **AI Employee runtime** → Skills → Workflow builder → Billing (Stripe) → Marketplace.
- Run all e2e: from `apps/api`, `pnpm test` with `DATABASE_URL`+`REDIS_URL`+JWT secrets set (currently 8/8).
