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

GOTCHA (monorepo build): `@vaep/types` is a built **CommonJS** package (`main`→`dist/index.js`; run `pnpm --filter @vaep/types build`, or `pnpm build`/turbo `^build` does it). `apps/api/tsconfig.build.json` sets `rootDir:"src"`, `paths:{}`, `incremental:false` so `nest build` emits `dist/main.js` (NOT `dist/apps/api/src/main.js`) and resolves `@vaep/types` from node_modules at runtime. Do NOT add source path-aliases (`../../packages/.../src`) to `tsconfig.build.json` — that hoists rootDir and scatters the entry. Typecheck (`tsconfig.json`) keeps source paths; jest maps `@vaep/types`→source.

## Provider knobs (swappable, self-hosted defaults)
- `EMBEDDINGS_PROVIDER`: `hash` (default, offline/deterministic — also used by tests) · `local` (transformers.js, lazy) · `openai` (lazy, needs `OPENAI_API_KEY`). All 384-dim.
- `STORAGE_PROVIDER`: `local` (default, `STORAGE_DIR`) · `s3` (MinIO/S3, lazy). Auth is behind `AUTH_PROVIDER` (JWT).
- `LLM_PROVIDER`: `mock` (default, deterministic/offline — used by tests) · `anthropic` (lazy, `claude-sonnet-5`, needs `ANTHROPIC_API_KEY`) · `openai` (lazy, `LLM_MODEL`). Used by the AI Employee runtime.

## Module status (one module per turn: backend module + mirrored frontend feature, verify, update memory)
- ✅ Foundation + **auth/tenant**: register/login/refresh/me, JWT, multi-tenant `Company`/`User`.
- ✅ **Knowledge/RAG**: upload → BullMQ ingest (extract/chunk/embed) → pgvector(384, HNSW) tenant-scoped cosine `/search`. Frontend: optimistic upload, polling doc list, search panel, `/knowledge` page.
- ✅ **AI Employee runtime**: `AiEmployee` (roles, status pause/disable), Conversation/Message (memory), `EmployeeMemory`. `AgentRuntimeService` = plan→retrieve(reuses KnowledgeService)→memory→act(bounded tool-calling loop, max 3)→validate(citations+confidence+approval). Swappable `LlmProvider`. Frontend: `/employees` list+create+status, `/employees/[id]` chat with sources/plan/validation/tool-calls. Paused/disabled → 409.
- ✅ **Skills**: code-defined catalog (slack/email/stripe/github/http, each w/ tools) → `InstalledSkill` (company) → `EmployeeSkill` (assigned) → runtime tool-calling; every action logged in `SkillExecution` (audit). Mock/sandbox executors (offline, deterministic; real executors + creds encryption = TODO). Frontend `/skills` (catalog+installed) + employee skill picker + chat "actions taken" panel.
- ✅ **Workflow builder**: `Workflow` (graph JSON nodes+edges), `WorkflowRun`+`WorkflowStepRun` (per-node audit). `WorkflowEngine` on a BullMQ `workflow-run` queue walks the graph threading a context; nodes TRIGGER/RETRIEVE(Knowledge)/AI_STEP(shared LlmProvider)/TOOL_ACTION(Skills)/WAIT/CONDITION/NOTIFY; `{{a.b.c}}` template resolver (no eval). Frontend `/workflows` list + linear step builder + run log (polling). WAIT is a bounded sleep (durable resume = TODO); triggers are manual (scheduled/webhook = TODO).
- ⬜ Next: **Billing (Stripe)** → Marketplace.
- Run all e2e: from `apps/api`, `pnpm test` with `LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local` + `DATABASE_URL`+`REDIS_URL`+JWT secrets (currently 30/30).
