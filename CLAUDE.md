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
docker compose -f infra/docker-compose.yml up -d          # infra
pnpm --filter @vaep/api exec prisma migrate dev            # apply migrations
pnpm dev                                                   # web :3000, api :4000
```
GOTCHA: a local Postgres occupies host 127.0.0.1:5432, so Docker Postgres is published on **5433**
(`POSTGRES_PORT` overridable). `DATABASE_URL` in the `.env` files already points at 5433. Adminer :8080.

## Module status
- ✅ Foundation + **auth/tenant** slice: register/login/refresh/me, JWT, multi-tenant `Company`/`User`. e2e passing.
- ⬜ Next (one module per turn): Knowledge/RAG (pgvector), AI Employee runtime, Skills, Workflow builder, Billing (Stripe), Marketplace. Build backend module + mirrored frontend feature together; update memory after each.
