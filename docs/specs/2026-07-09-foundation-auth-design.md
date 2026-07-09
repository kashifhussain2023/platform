# V-AEP Platform — Foundation + Auth/Tenant slice (Design Spec)

**Date:** 2026-07-09 · **Status:** Approved · **Scope:** First runnable vertical slice of the V-AEP platform.

## Goal
Stand up a clean, Dockerized monorepo for the Vertical AI Employee Platform and deliver one end-to-end
vertical slice: **company registration + authentication + multi-tenant scoping + dashboard shell**.
Everything else (Knowledge/RAG, AI runtime, skills, workflows, billing, marketplace) builds on this later,
one module per turn.

## Stack (from the proposal)
- **Monorepo:** pnpm workspaces + Turborepo.
- **Web:** Next.js (App Router), TypeScript, Tailwind, TanStack Query, Zustand, react-hook-form + zod.
- **API:** NestJS, TypeScript, Prisma, PostgreSQL (pgvector image), argon2, Passport-JWT.
- **Infra (Docker):** Postgres (pgvector/pgvector:pg16), Redis, MinIO (S3-compatible), Adminer.

## Directory structure (clean, module-mirrored)
```
platform/
├─ apps/web/src/{app,features/{auth,tenant},lib,stores,components/ui}
├─ apps/api/src/{common,config,modules/{auth,tenant}} + prisma/schema.prisma
├─ packages/types   (@vaep/types — shared DTOs, single source of truth)
├─ packages/config  (@vaep/config — tsconfig/eslint/tailwind presets)
├─ infra/docker-compose.yml
└─ pnpm-workspace.yaml · turbo.json · tsconfig.base.json · .env.example
```
Frontend `features/*` mirror backend `modules/*` one-to-one.

## Conventions (non-negotiable)
- **Singletons both sides.** Backend: `PrismaService`, `ConfigService`, and all NestJS providers are
  singleton-scoped; tenant identity flows via a request guard, never per-request providers.
  Frontend: exactly one `apiClient`, one `queryClient`, one Zustand store instance.
- **Optimistic writes.** All mutations use TanStack Query `useMutation` with `onMutate` (optimistic cache
  update) → `onError` rollback → `onSettled` invalidate. Server state = TanStack Query; global client
  state = Zustand; form state = react-hook-form + zod.
- **Minimal `useRef`.** Only where genuinely unavoidable (focus), and commented.

## Data model (Prisma)
- `Company` (tenant): id, name, slug (unique), createdAt.
- `User`: id, companyId (FK), email (unique per company), passwordHash, name, role (OWNER|ADMIN|MEMBER), createdAt.
- Every future table carries `companyId`; tenant guard scopes all queries.

## Auth (self-hosted JWT, swappable)
- `POST /auth/register` — create Company + owner User in a transaction; return tokens.
- `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`.
- argon2 password hashing; short-lived access token + httpOnly refresh cookie.
- `@CurrentUser()` / `@CurrentTenant()` decorators; `JwtAuthGuard`.
- Implemented behind an `AuthProvider` interface so Clerk/Auth0 can replace it later.

## Frontend slice
`/register` and `/login` (rhf + zod), protected `/dashboard` showing company + user from `/auth/me`, logout.

## Docker
Compose runs infra only; apps run on host in dev against it. Prod Dockerfiles for web + api included for parity.

## Testing
API: Jest + Supertest e2e (register → login → me). Web: light Vitest + RTL on the auth hook.

## Explicitly out of scope this pass
Knowledge/RAG + pgvector wiring, AI runtime, skills marketplace, workflow builder, Stripe billing,
marketplace, Temporal, observability, Clerk/Auth0 swap.
