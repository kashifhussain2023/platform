# V-AEP Platform

Monorepo for the **Vertical AI Employee Platform**. This is the first runnable vertical
slice: company registration, authentication, multi-tenant scoping, and a dashboard shell.

See the design spec: [`docs/specs/2026-07-09-foundation-auth-design.md`](docs/specs/2026-07-09-foundation-auth-design.md).

## Stack
- **Monorepo:** pnpm workspaces + Turborepo
- **Web** (`apps/web`): Next.js App Router, TypeScript, Tailwind, TanStack Query, Zustand, react-hook-form + zod
- **API** (`apps/api`): NestJS, Prisma, PostgreSQL (pgvector image), argon2, Passport-JWT
- **Shared** (`packages/*`): `@vaep/types` (DTOs — single source of truth), `@vaep/config` (tsconfig/eslint/tailwind presets)
- **Infra** (`infra/`): Postgres, Redis, MinIO, Adminer via Docker Compose

## Prerequisites
- Node >= 22, pnpm 8.15.0, Docker.

## First-time setup
```bash
pnpm install

# copy env files
cp .env.example .env
cp infra/.env.example infra/.env
cp apps/web/.env.local.example apps/web/.env.local

# start infra (postgres, redis, minio, adminer)
docker compose -f infra/docker-compose.yml up -d

# generate the prisma client + apply schema to the fresh db
pnpm --filter @vaep/api exec prisma generate
pnpm --filter @vaep/api exec prisma migrate dev --name init
```

## Run everything (dev)
```bash
# from the repo root — Turborepo runs web + api together
pnpm dev
```
- Web: http://localhost:3000
- API: http://localhost:4000
- Adminer (db UI): http://localhost:8080
- MinIO console: http://localhost:9001

Or run individually:
```bash
pnpm --filter @vaep/api dev
pnpm --filter @vaep/web dev
```

## Other commands
```bash
pnpm build        # build all packages/apps
pnpm typecheck    # tsc --noEmit across the workspace
pnpm lint         # eslint
pnpm test         # unit + e2e (api e2e is skipped without DATABASE_URL)
```

## Auth flow (this slice)
1. `POST /auth/register` → creates a `Company` + owner `User` in one transaction, returns an
   access token and sets an httpOnly refresh cookie.
2. `POST /auth/login`, `POST /auth/refresh`, `GET /auth/me`.
3. Web: `/register`, `/login`, protected `/dashboard`.
