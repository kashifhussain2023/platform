# Separate API & Web (Dev, CI, Deployment) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/api` and `apps/web` genuinely independent to run, test, and deploy — separate dev commands, separate CI jobs, separate production hosting — while keeping the existing monorepo (one repo, shared `packages/types`) intact.

**Architecture:** Nothing about the monorepo's *code* structure changes. This is entirely about the three layers *around* the code: (1) dev-time process management (Turbo currently bundles both apps' `dev` scripts into one `pnpm dev`), (2) CI (currently one job builds+tests both apps sequentially), (3) production (no deploy pipeline exists yet at all — both apps already have correct, isolated multi-stage Dockerfiles, just never wired to a real host). Each layer is fixed independently and can be adopted one at a time.

**Tech Stack:** Turbo (already in use) for task filtering; GitHub Actions (already in use) for CI, split via path filters; **Vercel** for Web hosting (Next.js-native, zero-config); **Railway** for API hosting (persistent container + managed Postgres/Redis — required because the API runs BullMQ background workers, which cannot run on serverless/edge functions).

## Global Constraints

- No change to any application code, business logic, or the Prisma schema — this plan touches only `package.json` scripts, `.github/workflows/*.yml`, and net-new deployment config/docs.
- Both apps already have working, correct multi-stage Dockerfiles (`apps/api/Dockerfile`, `apps/web/Dockerfile`, confirmed by direct read) — reuse them as-is, do not rewrite.
- `apps/api` needs a **persistent, long-running process** in production, not a serverless function — it runs BullMQ workers (`workflow-run`, `knowledge-ingest`, `connector-health`, `event-normalize`, `marketing-sync`, etc.) that must stay alive between requests. This rules out Vercel/Netlify-style serverless hosting for the API specifically.
- The existing local dev stack (`infra/docker-compose.yml`: Postgres/Redis/MinIO) is untouched by this plan — it remains how you run infra locally. This plan is about **where things run once deployed**, and how they're **started independently in dev**.
- **Storage recommendation for production explicitly avoids MinIO**: the `minio/minio` open-source repository is archived and no longer maintained (confirmed directly in its own README during this project's separate 10-engine research program) — do not stand up new production infrastructure on it. Recommend **Cloudflare R2** instead (S3-compatible, so it's a drop-in for the existing `STORAGE_PROVIDER` abstraction with no code change — just new env vars).
- Any step that requires creating a real external account, entering billing info, or clicking through a hosting provider's dashboard is marked **[USER ACTION]** — an agent cannot do these on your behalf. CLI-scriptable steps (once an account/token exists) are marked **[CLI]** and can be executed directly.

---

### Task 1: Independent dev-workflow scripts

**Files:**
- Modify: `package.json` (root)

**Interfaces:**
- Produces: `pnpm dev:api` / `pnpm dev:web` (start only that app) and `pnpm build:api` / `pnpm build:web` (build only that app) — four new scripts total, matching the same `--filter` pattern. `pnpm dev`/`pnpm build` (both apps together) are kept unchanged for convenience; nothing existing breaks.

- [ ] **Step 1: Add the four filtered scripts**

Edit `package.json`'s `scripts` block:

```json
{
  "scripts": {
    "dev": "turbo run dev",
    "dev:api": "turbo run dev --filter=@vaep/api",
    "dev:web": "turbo run dev --filter=@vaep/web",
    "build": "turbo run build",
    "build:api": "turbo run build --filter=@vaep/api",
    "build:web": "turbo run build --filter=@vaep/web",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test"
  }
}
```

(`--filter=@vaep/api` matches Turbo's own package-name filter syntax — `@vaep/api` and `@vaep/web` are the exact `name` fields already in `apps/api/package.json`/`apps/web/package.json`, confirmed by direct read.)

- [ ] **Step 2: Verify each starts independently**

Run: `pnpm dev:api`
Expected: only the NestJS API starts (`nest start --watch`, no Next.js output), listening on its configured port (default 4000).

Stop it (Ctrl+C), then run: `pnpm dev:web`
Expected: only Next.js starts (`next dev`), listening on port 3000, with no API process running alongside it.

- [ ] **Step 3: Verify the combined command still works unchanged**

Run: `pnpm dev`
Expected: both start together exactly as before (no regression to the existing convenience command).

- [ ] **Step 4: Verify the two new build scripts**

Run: `pnpm build:api`
Expected: only `@vaep/api` (and its dependency `@vaep/types`) builds — no Next.js build output.

Run: `pnpm build:web`
Expected: only `@vaep/web` (and its dependency `@vaep/types`) builds — no NestJS build output.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(dev): add pnpm dev:api/dev:web/build:api/build:web for running or building each app independently"
```

---

### Task 2: Split CI into independent API and Web workflows

**Files:**
- Create: `.github/workflows/api-ci.yml`
- Create: `.github/workflows/web-ci.yml`
- Delete: `.github/workflows/ci.yml` (replaced by the two above — its content is fully absorbed, not lost)

**Interfaces:**
- Produces: two independent GitHub Actions workflows, each triggered only by changes relevant to it (via `paths:` filters), so an API-only PR no longer runs (or blocks on) Web tests and vice versa. Both still run on any change to shared `packages/**` (since both apps depend on `@vaep/types`).

- [ ] **Step 1: Read the current combined workflow in full**

`.github/workflows/ci.yml` (already read in full during planning — it has a `typecheck` job running `turbo run typecheck` across everything, and one `test` job that runs API unit tests, API e2e tests, then Web unit tests, sequentially, sharing one Postgres+Redis service pair).

- [ ] **Step 2: Create `api-ci.yml`**

```yaml
name: API CI

on:
  push:
    branches: [main, master]
    paths:
      - 'apps/api/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/api-ci.yml'
  pull_request:
    branches: [main, master]
    paths:
      - 'apps/api/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/api-ci.yml'

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '8.15.0'

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run typecheck --filter=@vaep/api

  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: vaep
          POSTGRES_PASSWORD: vaep
          POSTGRES_DB: vaep
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U vaep -d vaep"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
      redis:
        image: redis:7-alpine
        ports: ['6380:6379']
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      DATABASE_URL: postgresql://vaep:vaep@localhost:5433/vaep?schema=public
      REDIS_URL: redis://127.0.0.1:6380
      JWT_ACCESS_SECRET: ci-access-secret
      JWT_REFRESH_SECRET: ci-refresh-secret
      LLM_PROVIDER: mock
      EMBEDDINGS_PROVIDER: hash
      STORAGE_PROVIDER: local
      SKILL_EXECUTOR: mock
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Prisma generate + migrate
        working-directory: apps/api
        run: |
          pnpm exec prisma generate
          pnpm exec prisma migrate deploy
      - name: API unit tests
        working-directory: apps/api
        run: pnpm run test:unit
      - name: API e2e tests
        working-directory: apps/api
        run: pnpm run test
```

- [ ] **Step 3: Create `web-ci.yml`**

```yaml
name: Web CI

on:
  push:
    branches: [main, master]
    paths:
      - 'apps/web/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/web-ci.yml'
  pull_request:
    branches: [main, master]
    paths:
      - 'apps/web/**'
      - 'packages/**'
      - 'pnpm-lock.yaml'
      - '.github/workflows/web-ci.yml'

env:
  NODE_VERSION: '22'
  PNPM_VERSION: '8.15.0'

jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run typecheck --filter=@vaep/web

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}
      - uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Web unit tests
        working-directory: apps/web
        run: pnpm run test
```

- [ ] **Step 4: Delete the old combined workflow**

```bash
git rm .github/workflows/ci.yml
```

- [ ] **Step 5: Verify by pushing to a branch and checking the Actions tab**

Push this change on a branch (not yet to main) and open a PR. Expected: **both** `API CI` and `Web CI` show up as required checks on this PR (since the PR touches `.github/workflows/**`, which both path-filters match) — this is expected for THIS specific PR only; a future PR touching only `apps/web/**` will show only `Web CI` running.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/api-ci.yml .github/workflows/web-ci.yml
git commit -m "ci: split combined CI into independent api-ci/web-ci workflows with path filters"
```

---

### Task 3: Deploy Web to Vercel

**Files:**
- Create: `apps/web/vercel.json` (optional, only if defaults need overriding)

**Interfaces:**
- Produces: a live, auto-deploying Web instance at `https://<project>.vercel.app` (or a custom domain), rebuilding on every push to `main`, with preview URLs on every PR.

- [ ] **Step 1: [USER ACTION] Create a Vercel account and import the repo**

Go to vercel.com, sign up (GitHub login is simplest — it auto-grants repo access), click "Add New Project," select this repository.

- [ ] **Step 2: [USER ACTION] Configure the project's root directory and build settings**

In the Vercel project's Settings → General:
- **Root Directory**: `apps/web` (tells Vercel this is a monorepo and only this subfolder is the deployable app — Vercel auto-detects Next.js from there and needs no `vercel.json` for the standard case).
- **Build Command**: leave as Vercel's auto-detected `next build` (Vercel's monorepo support runs this with the correct working directory once Root Directory is set).
- **Install Command**: override to `cd ../.. && pnpm install --filter @vaep/web...` (so pnpm workspace deps, including `@vaep/types`, install correctly from the repo root — Vercel's default install command assumes a single-package repo and will fail on this monorepo otherwise).

- [ ] **Step 3: [USER ACTION] Set the one required environment variable**

In Vercel project Settings → Environment Variables, add:
- `NEXT_PUBLIC_API_URL` = (leave as `http://localhost:4000` for now — this gets updated to the real API URL once Task 4 gives you one; Vercel lets you edit env vars and redeploy at any time)

- [ ] **Step 4: [USER ACTION] Trigger the first deploy**

Click "Deploy." Expected: build succeeds, Vercel gives you a live URL like `https://vaep-web.vercel.app`.

- [ ] **Step 5: Verify**

Visit the Vercel URL in a browser. Expected: the marketing/login page loads (API calls will fail until Task 4/5 wire up the real API URL — that's expected at this point, not a bug).

No commit needed for this task (all changes are in Vercel's dashboard, not the repo) — unless Step 2 required an actual `apps/web/vercel.json` override, in which case:
```bash
git add apps/web/vercel.json
git commit -m "chore(web): add vercel.json for monorepo build config"
```

---

### Task 4: Deploy API + Postgres + Redis to Railway

**Files:**
- None (all configuration is in Railway's dashboard/CLI, not the repo — the existing `apps/api/Dockerfile` is reused as-is)

**Interfaces:**
- Produces: a live API instance at `https://<project>.up.railway.app` (or a custom domain), with managed Postgres and Redis add-ons, auto-deploying on push to `main`.

- [ ] **Step 1: [USER ACTION] Create a Railway account and new project**

Go to railway.app, sign up (GitHub login recommended), click "New Project" → "Deploy from GitHub repo," select this repository.

- [ ] **Step 2: [USER ACTION] Configure the service to use the API's Dockerfile**

In the new service's Settings → Build:
- **Root Directory**: leave as `/` (repo root) — **not** `apps/api`, because the Dockerfile's own header comment (confirmed by direct read) requires the build context to be the repo root: `docker build -f apps/api/Dockerfile -t vaep-api .`
- **Dockerfile Path**: `apps/api/Dockerfile`
- Railway will build using this Dockerfile directly (multi-stage, already correct) rather than its default Nixpacks auto-detection.

- [ ] **Step 3: [USER ACTION] Add managed Postgres and Redis**

In the same Railway project, click "New" → "Database" → "Add PostgreSQL", then again → "Add Redis". Railway provisions both and exposes connection strings as `DATABASE_URL`/`REDIS_URL`-shaped variables you can reference in the API service's env vars (Railway's "Variable Reference" feature, e.g. `${{Postgres.DATABASE_URL}}`) — you do not need pgvector configured separately; Railway's Postgres template does not include the `pgvector` extension by default, so:

- [ ] **Step 4: [USER ACTION] Enable the pgvector extension on Railway's Postgres**

Railway's Postgres plugin runs plain Postgres, not the `pgvector/pgvector` image this project's local dev/CI use. Either (a) connect via Railway's provided `psql` command and run `CREATE EXTENSION IF NOT EXISTS vector;` once (works if the underlying Postgres version supports the extension being installed, which standard Railway Postgres images do since they include a common extension set — verify by attempting the command), or (b) if that fails, use a Railway "template" specifically for `pgvector` from Railway's template marketplace instead of the generic Postgres plugin. Confirm which path worked before proceeding, since the Knowledge/RAG module's vector search will fail silently-to-error without this extension.

- [ ] **Step 5: [USER ACTION] Set the API's environment variables**

In the API service's Variables tab, set (matching `apps/api/.env.example`'s real keys, confirmed by direct read):
```
DATABASE_URL=${{Postgres.DATABASE_URL}}
REDIS_URL=${{Redis.REDIS_URL}}
JWT_ACCESS_SECRET=<generate a real random secret, e.g. `openssl rand -hex 32`>
JWT_REFRESH_SECRET=<a different random secret>
ENCRYPTION_KEY=<generate via `openssl rand -hex 32` — required in production, the app refuses to boot without one, confirmed by direct read of CryptoService>
WEB_ORIGIN=https://<your-vercel-url-from-task-3>
NODE_ENV=production
LLM_PROVIDER=openai
OPENAI_API_KEY=<your real key>
EMBEDDINGS_PROVIDER=openai
STORAGE_PROVIDER=s3
SKILL_EXECUTOR=auto
```
(Storage: use `s3`-compatible config pointed at Cloudflare R2 per this plan's Global Constraints, not MinIO — see Task 5.)

- [ ] **Step 6: [USER ACTION] Generate a public domain and deploy**

In the service's Settings → Networking, click "Generate Domain" to get a public `https://<name>.up.railway.app` URL. Trigger a deploy (Railway auto-deploys on the first setup, and on every push to `main` thereafter).

- [ ] **Step 7: Verify**

Run: `curl https://<your-railway-url>.up.railway.app/health` (or whatever this project's actual health-check route is — confirm the exact path from `apps/api/src/main.ts`/a health controller before running this)
Expected: a 200 response confirming the API booted successfully with its real production env vars (including `ENCRYPTION_KEY` — if this is missing, the app will refuse to start at all per its own boot-time guard, so a failure here likely means Step 5 was incomplete).

No repo commit needed for this task (all config is in Railway's dashboard).

---

### Task 5: Point storage at Cloudflare R2 instead of MinIO

**Files:**
- None (env-var only change — the existing `STORAGE_PROVIDER` abstraction already supports an S3-compatible backend, confirmed by earlier research into this codebase's Knowledge/media upload pattern)

**Interfaces:**
- Consumes: whatever S3-compatible env vars this project's `STORAGE_PROVIDER=s3` mode already expects (confirm the exact variable names by reading `apps/api/.env.example` and the storage-provider factory before filling these in — do not guess the names).

- [ ] **Step 1: [USER ACTION] Create a Cloudflare account and R2 bucket**

Cloudflare dashboard → R2 → Create bucket (e.g. `vaep-prod-storage`). Note the bucket name and your Cloudflare Account ID.

- [ ] **Step 2: [USER ACTION] Generate R2 API credentials**

R2 → Manage R2 API Tokens → Create API Token (Object Read & Write scope, scoped to the one bucket). Note the Access Key ID and Secret Access Key — R2's S3-compatible endpoint is `https://<account-id>.r2.cloudflarestorage.com`.

- [ ] **Step 3: Read the actual storage-provider factory to confirm exact env var names before setting them**

Read `apps/api/src/modules/knowledge/**` (or wherever the storage factory lives — confirm the exact file, do not assume) to get the precise env var names this codebase's S3-compatible mode expects (likely something like `S3_ENDPOINT`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_BUCKET` — verify against the real code, these are illustrative not confirmed).

- [ ] **Step 4: [USER ACTION] Set the confirmed env vars in Railway**

Add the confirmed variable names (from Step 3) to the Railway API service's Variables tab, pointing at the R2 bucket/credentials from Steps 1-2.

- [ ] **Step 5: Verify**

Upload a test document via the deployed API's Knowledge upload endpoint (or a small ad-hoc script) and confirm it lands in the R2 bucket (visible in Cloudflare's dashboard) rather than local disk.

---

### Task 6: Wire the two deployed services together and verify end-to-end

**Files:**
- None (env var updates only, in Vercel's and Railway's dashboards)

- [ ] **Step 1: [USER ACTION] Update Vercel's `NEXT_PUBLIC_API_URL`**

Back in the Vercel project (Task 3), update `NEXT_PUBLIC_API_URL` to the real Railway API URL from Task 4, Step 6. Redeploy (Vercel → Deployments → Redeploy, or push any commit to trigger it).

- [ ] **Step 2: Verify CORS is correctly configured**

Confirm `WEB_ORIGIN` on Railway (Task 4, Step 5) exactly matches the Vercel URL (including `https://`, no trailing slash) — a mismatch here is the single most common cause of "API calls fail silently in the browser but work via curl" in a split-deployment setup like this.

- [ ] **Step 3: End-to-end verification**

Open the live Vercel URL in a browser, attempt to register a new company/login. Expected: the request reaches the Railway-hosted API (visible in Railway's logs), a real JWT comes back, and the dashboard loads — proving the two independently-deployed services talk to each other correctly over the public internet, not just on localhost.

- [ ] **Step 4: Document the final URLs**

Add a short note to `platform/CLAUDE.md` (or wherever deployment info belongs in this project's docs) recording the production Vercel and Railway URLs, so this isn't only known via dashboard access.

```bash
git add platform/CLAUDE.md  # or wherever this ends up living
git commit -m "docs: record production Web (Vercel) and API (Railway) deployment URLs"
```

---

## Self-Review

**Spec coverage:** Task 1 covers dev-workflow separation, Task 2 covers CI separation, Tasks 3-4 cover independent production deployment (Web/Vercel, API+Postgres+Redis/Railway), Task 5 covers the storage-backend correction (R2 instead of MinIO, consistent with this project's own prior finding that MinIO is now unmaintained), Task 6 wires the two independently-deployed services together and proves it end-to-end. All three requested layers (dev, CI, deployment) are addressed, plus the requested hosting recommendation with justification (Vercel for Next.js; Railway for the API specifically because it runs persistent BullMQ workers that serverless hosting can't support).

**Placeholder scan:** Task 5, Step 3 intentionally does NOT guess the exact S3 env var names — it explicitly instructs reading the real code first rather than fabricating names, which is a real verification step, not a placeholder. Task 4, Step 7's health-check path is similarly flagged to confirm against real source rather than assumed. Everything else has concrete, complete commands/config.

**Type consistency:** `@vaep/api`/`@vaep/web` package names (Task 1) match the real `package.json` `name` fields confirmed by direct read. Env var names in Task 4, Step 5 match `apps/api/.env.example`'s real keys where already confirmed (`WEB_ORIGIN`, `DATABASE_URL`, `REDIS_URL`) and are explicitly flagged as needing confirmation where not yet verified (storage vars in Task 5).
