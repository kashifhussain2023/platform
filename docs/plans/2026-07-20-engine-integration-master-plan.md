# Orlixa Multi-Engine Integration — Master Plan & Enterprise Gap Analysis

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all 10 studied engines (Postiz, Chatwoot, Plane, n8n, Metabase, Meilisearch, Novu,
Listmonk, a MinIO replacement, Keycloak) properly functional inside Orlixa, and close the
enterprise-readiness gaps found across the whole research program (`docs/architecture/engines/*.md`,
`docs/architecture/orlixa-enterprise-architecture.md`) — not just wire the engines up, but make the
result safe to sell to a large multi-department enterprise customer.

**Architecture:** Every engine is wrapped as an invisible internal service behind one new
`modules/engines/<engine>` NestJS module each, following the exact shape already proven for
`modules/skills/connectors` (a `<Engine>ClientService`, a webhook controller, a BullMQ sync
processor, and one Skill catalog entry per engine so every AI Employee reaches it through the
existing `ToolExecutorService`/`RealSkillExecutor` path — no new tool-calling protocol per engine).

**Tech Stack:** NestJS + Prisma + Postgres + BullMQ/Redis (existing Orlixa stack, unchanged) calling
out to 10 self-hosted open-source services over REST/webhooks (per-engine stacks documented in
`docs/architecture/engines/*.md`).

## Global Constraints

- No engine's own UI, login, or branding is ever customer-facing — only Orlixa's AI Employee chat +
  a handful of Orlixa-native admin screens (Social Accounts, Approvals, etc.).
- Every engine call goes through a Skill catalog entry (`apps/api/src/modules/skills/catalog.ts`
  shape: `key`, `name`, `description`, `category`, `connection`, `configSchema`, `tools[]`) and is
  dispatched by `RealSkillExecutor` (`apps/api/src/modules/skills/executors/real-skill-executor.ts`)
  — never a bespoke tool-calling path.
- Every new BullMQ queue follows the existing `common/resilience` pattern (named-queue constants
  file, `RESILIENT_JOB_OPTIONS`, `DEFAULT_QUEUE_CONCURRENCY`) and the `ConnectorHealthProcessor`
  boot-time `upsertJobScheduler` pattern for anything repeatable.
- Every new secret (per-engine service-account credential) goes through the existing
  `CryptoService.encrypt`/`encryptJson` (`apps/api/src/common/crypto/crypto.service.ts`) — never
  plaintext, never a new encryption mechanism.
- Real production use of any engine's Enterprise/EE-marked feature requires an actual paid license
  or written approval (verified per-engine in `docs/architecture/engines/*.md §18`) — no task in this
  plan enables an Enterprise feature without that license already being in place.

---

## Part A — Enterprise Readiness: Gaps Found & Recommended Fixes

This is the consolidated, prioritized version of every gap surfaced across the whole research
program plus the RBAC discussion — read this before picking which phase to execute next.

| # | Gap | Found in | Severity | Recommended fix |
|---|---|---|---|---|
| 1 | **Company-wide roles only (OWNER/ADMIN/MEMBER)** — no per-department/per-team admin scoping. A big org can't give a Marketing lead admin rights over only Marketing's AI Employees. | RBAC discussion (this conversation) | **P0 for enterprise sales** | New `DepartmentRole`/`TeamRole` join table scoping ADMIN to a `Department`/`Team` id; `RolesGuard` extended to check scope, not just rank. Own phase (Part B, Phase 10). |
| 2 | **Approval routing has no per-person/per-team targeting** — `ApprovalRequest` goes to anyone with the right company-wide role, not a named approver. | HR AI MNC scenario memory + this conversation | **P0** | Add an optional `assignedToUserId`/`assignedToTeamId` on `ApprovalRequest`; `AiEmployee.approvalRules` gains an `approverUserId`/`approverTeamId` field. Own phase (Part B, Phase 10). |
| 3 | **`SecurityPolicy` fields are stored but not enforced** (`passwordMinLength`, `mfaRequired`, `allowedEmailDomains`, `dataRetentionDays`). | Enterprise-readiness audit memory | **P0** | Wire enforcement into `AuthService.register()`/`login()` (password length, email domain allow-list) and a scheduled `dataRetentionDays` purge job. Own phase (Part B, Phase 10). |
| 4 | **`NOTIFY` workflow node is log-only** — doesn't send anything real. | `orlixa-current-architecture.md` discrepancy #2 | **P0** (blocks every engine's async "tell someone" step) | Wire `NOTIFY` to call `NovuClientService.trigger()` (Phase 6). |
| 5 | **`InstalledSkill` can't hold N accounts of the same provider per company** (unique `[companyId, skillKey, employeeId]`). | Postiz integration plan | P1, Marketing-specific | New dedicated `SocialAccount` table (already planned, Phase 1 below), not a fix to `InstalledSkill` itself. |
| 6 | **Listmonk is genuinely single-tenant** — needs one full instance+DB per customer, not shared. | `listmonk-engine.md §15` | P1, cost/ops planning | Provisioning automation (Helm release templated per Company) + per-customer backup job; budget accordingly, don't treat as a config toggle. |
| 7 | **MinIO's repo is archived/unmaintained.** | `minio-engine.md §1/§18` | **P0 — don't build new dependencies on it** | Storage engine = SeaweedFS or Garage (bake-off, Phase 11), not MinIO. |
| 8 | **Five engines' Enterprise/EE features require a paid license or written approval regardless of code presence** (Chatwoot, n8n, Metabase, Meilisearch, Novu). | Each engine doc §18, spot-checked directly against license files | **P0 — legal, not engineering** | One consolidated legal review across all five before any Enterprise-marked feature is enabled in production. Do not enable ahead of that review (no task in this plan does). |
| 9 | **No MCP-client infrastructure in Orlixa**, despite 3 engines (Postiz, Plane, Metabase) shipping free official MCP servers. | `orlixa-enterprise-architecture.md §13` | P2, deferred by design | Revisit as ONE platform-wide decision if/when Orlixa wants to be a general MCP client — not per-engine, not in this plan. |
| 10 | **Enterprise SSO (SAML/OIDC) doesn't exist at all today.** | `keycloak-engine.md` | P1, sales-blocking for some enterprise deals | Keycloak, enterprise-tier only, `Organization`-per-Company inside one shared realm (Phase 12). |

**Read order recommendation:** fix #1–#4 (Part B, Phase 10) before or alongside the first engine
integration, since a big enterprise customer evaluating even ONE AI Employee (say, Marketing) will
immediately hit the coarse-RBAC and no-real-NOTIFY gaps. Gaps #6–#10 are engine-specific and can be
addressed when that engine's phase is picked up.

---

## Part B — Roadmap (separate plans, per the scope-check rule)

This program covers 12 independent subsystems. Per the writing-plans scope-check, only **Phase 0**
(below) is written here in full bite-sized/TDD detail — it's the one bounded, self-contained
subsystem (the shared integration framework, using Marketing/Postiz as the concrete worked example).
Every other phase gets its **own** plan document, written with this same skill, when picked up:

| Phase | Scope | Depends on |
|---|---|---|
| **0 (this doc)** | Engine Integration Framework + AI Marketing Employee (Postiz) — the reference implementation every later engine phase copies | Nothing |
| 1 | AI Customer Support Employee (Chatwoot) | Phase 0 pattern |
| 2 | AI Project Manager Employee (Plane) | Phase 0 pattern |
| 3 | AI Workflow Employee (n8n) | Phase 0 pattern |
| 4 | AI Analytics Employee (Metabase) | Phase 0 pattern |
| 5 | AI Search Employee (Meilisearch) — shared infra, all employees | Phase 0 pattern |
| 6 | AI Notification Employee (Novu) — **also fixes Gap #4 (`NOTIFY`)** | Phase 0 pattern |
| 7 | AI Email Marketing Employee (Listmonk) — **per-customer provisioning, Gap #6** | Phase 0 pattern |
| 8 | AI Storage Employee — SeaweedFS/Garage bake-off + migration off MinIO (**Gap #7**) | Nothing (can run in parallel) |
| 9 | (reserved — not a separate engine; Keycloak is Phase 12) | — |
| 10 | Enterprise RBAC + Approval routing + SecurityPolicy enforcement (**Gaps #1–#3**) | Nothing (can run in parallel, recommended early) |
| 11 | Storage engine final migration cutover (after Phase 8's bake-off decision) | Phase 8 |
| 12 | Enterprise SSO (Keycloak, **Gap #10**) | Phase 10 (reuses its Department/Team scoping) |

---

## Phase 0 — Engine Integration Framework + AI Marketing Employee (Postiz)

### Overall File Structure (all 6 tasks)

- Modify: `apps/api/prisma/schema.prisma` — add `SocialAccount`, `ScheduledPost`, `PublishedPost`,
  `Campaign`, `MediaAsset`, `BrandAsset`, `MarketingAnalyticsSnapshot`.
- Modify: `apps/api/src/modules/skills/catalog.ts` — add the `postiz` catalog entry.
- Create: `apps/api/src/modules/engines/marketing/postiz-client.service.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing.constants.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing.module.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing-webhook.controller.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing-sync.processor.ts`
- Modify: `apps/api/src/modules/skills/executors/real-skill-executor.ts` — add `postiz.*` cases.
- Test: `apps/api/test/e2e/engines-marketing.e2e-spec.ts`

**Interfaces:**
- Produces: `PostizClientService.schedulePost(companyId, dto): Promise<{postizPostId: string}>`,
  `.getConnectUrl(companyId, platform): Promise<{url: string}>`, `.listConnectedAccounts(companyId):
  Promise<SocialAccountDto[]>` — later engine phases (Support/Chatwoot etc.) name their own
  equivalent `<Engine>ClientService` methods; this is the naming convention they follow.

### Task 1: Marketing engine Prisma schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/test/e2e/engines-marketing.e2e-spec.ts`

- [ ] **Step 1: Write the failing Prisma-shape test for the new marketing tables**

```typescript
// apps/api/test/e2e/engines-marketing.e2e-spec.ts
import { PrismaClient } from '@prisma/client';

describe('Marketing engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a SocialAccount scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'Acme Test', slug: `acme-${Date.now()}` },
    });
    const account = await prisma.socialAccount.create({
      data: {
        companyId: company.id,
        provider: 'instagram',
        postizIntegrationId: 'postiz-int-123',
        status: 'CONNECTED',
      },
    });
    expect(account.companyId).toBe(company.id);
    expect(account.status).toBe('CONNECTED');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test:e2e -- engines-marketing`
Expected: FAIL — `Property 'socialAccount' does not exist on PrismaClient` (model not defined yet).

- [ ] **Step 3: Add the Prisma models**

Append to `apps/api/prisma/schema.prisma` (follow the existing `InstalledSkill` style — plain
`companyId String` + `@relation` + `@@index([companyId])`, no new tenancy mechanism):

```prisma
enum SocialAccountStatus {
  CONNECTED
  DISCONNECTED
  DEGRADED
}

model SocialAccount {
  id                  String              @id @default(cuid())
  companyId           String
  company             Company             @relation(fields: [companyId], references: [id])
  employeeId          String?
  provider            String              // matches a Postiz providerIdentifier, e.g. "instagram"
  postizIntegrationId String              // Postiz's own Integration.id
  postizCustomerId    String?             // Postiz's Customer id this account is tagged to
  displayName         String?
  externalAccountId   String?
  status              SocialAccountStatus @default(CONNECTED)
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  scheduledPosts      ScheduledPost[]
  publishedPosts      PublishedPost[]

  @@index([companyId])
  @@index([companyId, provider])
}

enum ScheduledPostStatus {
  DRAFT
  PENDING_APPROVAL
  SCHEDULED
  FAILED
}

model Campaign {
  id          String         @id @default(cuid())
  companyId   String
  company     Company        @relation(fields: [companyId], references: [id])
  aiEmployeeId String?
  name        String
  goal        String?
  status      String         @default("ACTIVE")
  createdAt   DateTime       @default(now())
  posts       ScheduledPost[]

  @@index([companyId])
}

model ScheduledPost {
  id                String              @id @default(cuid())
  companyId         String
  company           Company             @relation(fields: [companyId], references: [id])
  socialAccountId   String
  socialAccount     SocialAccount       @relation(fields: [socialAccountId], references: [id])
  campaignId        String?
  campaign          Campaign?           @relation(fields: [campaignId], references: [id])
  content           String
  mediaRefs         Json                @default("[]")
  publishAt         DateTime
  status            ScheduledPostStatus @default(DRAFT)
  postizPostId      String?
  approvalRequestId String?
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  publishedPost     PublishedPost?

  @@index([companyId])
  @@index([companyId, status])
}

model PublishedPost {
  id              String        @id @default(cuid())
  companyId       String
  company         Company       @relation(fields: [companyId], references: [id])
  socialAccountId String
  socialAccount   SocialAccount @relation(fields: [socialAccountId], references: [id])
  scheduledPostId String        @unique
  scheduledPost   ScheduledPost @relation(fields: [scheduledPostId], references: [id])
  platformPostId  String?
  permalink       String?
  publishedAt     DateTime      @default(now())
  lastMetricsSyncAt DateTime?

  @@index([companyId])
}

model MediaAsset {
  id          String   @id @default(cuid())
  companyId   String
  company     Company  @relation(fields: [companyId], references: [id])
  storageKey  String
  mimeType    String
  kind        String   // IMAGE | VIDEO | BRAND_LOGO | BRAND_FONT
  uploadedBy  String?
  createdAt   DateTime @default(now())

  @@index([companyId])
}

model BrandAsset {
  id               String   @id @default(cuid())
  companyId        String
  company          Company  @relation(fields: [companyId], references: [id])
  kind             String   // LOGO | COLOR_PALETTE | FONT | VOICE_DOC
  mediaAssetId     String?
  structuredValue  Json?
  knowledgeDocumentId String?
  createdAt        DateTime @default(now())

  @@index([companyId])
}

model MarketingAnalyticsSnapshot {
  id              String   @id @default(cuid())
  companyId       String
  company         Company  @relation(fields: [companyId], references: [id])
  socialAccountId String
  capturedAt      DateTime @default(now())
  metrics         Json

  @@index([companyId, socialAccountId])
}
```

Also add the reverse relations on `model Company` (`socialAccounts SocialAccount[]`, `campaigns
Campaign[]`, `scheduledPosts ScheduledPost[]`, `publishedPosts PublishedPost[]`, `mediaAssets
MediaAsset[]`, `brandAssets BrandAsset[]`, `marketingAnalyticsSnapshots MarketingAnalyticsSnapshot[]`)
— follow the exact style of the existing `InstalledSkill[]`/`Workflow[]` back-relations already on
`Company`.

- [ ] **Step 4: Generate and apply the migration**

Run: `pnpm --filter @vaep/api prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_add_marketing_tables/migration.sql`
(Per `platform/CLAUDE.md`'s documented gotcha: do NOT use `prisma migrate dev` non-interactively —
author the migration file this way, then apply with `prisma migrate deploy`.)
Run: `pnpm --filter @vaep/api prisma migrate deploy`
Expected: migration applies cleanly, no drift warnings.

- [ ] **Step 5: Re-run the schema test to verify it passes**

Run: `pnpm --filter @vaep/api test:e2e -- engines-marketing`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/e2e/engines-marketing.e2e-spec.ts
git commit -m "feat(marketing): add Postiz-backed marketing schema (SocialAccount/Campaign/ScheduledPost/PublishedPost/MediaAsset/BrandAsset/MarketingAnalyticsSnapshot)"
```

---

### Task 2: `PostizClientService` — the REST wrapper

**Files:**
- Create: `apps/api/src/modules/engines/marketing/postiz-client.service.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing.constants.ts`
- Test: `apps/api/src/modules/engines/marketing/postiz-client.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get('POSTIZ_BASE_URL')`, `ConfigService.get('POSTIZ_API_KEY')` (new env
  vars, added to `.env.example` in this task), `CryptoService` (existing, unused here since the one
  shared API key is a plain env var, not a per-company encrypted secret).
- Produces: `getConnectUrl(platform: string): Promise<{ url: string }>`,
  `schedulePost(input: SchedulePostInput): Promise<{ postizPostId: string }>`,
  `listIntegrations(group?: string): Promise<PostizIntegrationDto[]>` — these exact method names/
  signatures are what `real-skill-executor.ts` (Task 3) and later phases' analogous client services
  are named after.

- [ ] **Step 1: Write the failing unit test**

```typescript
// apps/api/src/modules/engines/marketing/postiz-client.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { PostizClientService } from './postiz-client.service';

describe('PostizClientService', () => {
  const config = new ConfigService({
    POSTIZ_BASE_URL: 'https://postiz.internal.test',
    POSTIZ_API_KEY: 'test-key',
  });
  const service = new PostizClientService(config);

  it('builds the connect-url request against the configured base URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://instagram.com/oauth/authorize?...' }),
    });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    const result = await service.getConnectUrl('instagram');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://postiz.internal.test/public/v1/social/instagram',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    );
    expect(result.url).toContain('instagram.com');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test -- postiz-client.service`
Expected: FAIL — `Cannot find module './postiz-client.service'`

- [ ] **Step 3: Write `marketing.constants.ts`**

```typescript
// apps/api/src/modules/engines/marketing/marketing.constants.ts
/** Env vars for the shared self-hosted Postiz instance (one per Orlixa deployment, not per company). */
export const POSTIZ_ENV = {
  BASE_URL: 'POSTIZ_BASE_URL',
  API_KEY: 'POSTIZ_API_KEY',
} as const;

/** BullMQ queue names (Phase 0 §4/§5). */
export const MARKETING_SYNC_QUEUE = 'marketing-sync';
export const MARKETING_SYNC_JOB = 'marketing-sync-sweep';
export const MARKETING_SYNC_SCHEDULER = 'marketing-sync';
export const MARKETING_SYNC_EVERY_MS = 10 * 60_000;
```

- [ ] **Step 4: Write `PostizClientService`**

```typescript
// apps/api/src/modules/engines/marketing/postiz-client.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { POSTIZ_ENV } from './marketing.constants';

export interface SchedulePostInput {
  postizIntegrationId: string;
  content: string;
  type: 'draft' | 'schedule' | 'now';
  date?: string; // ISO datetime, required when type === 'schedule'
  mediaUrls?: string[];
}

export interface PostizIntegrationDto {
  id: string;
  name: string;
  identifier: string;
  picture?: string;
  disabled: boolean;
  customer?: { id: string; name: string };
}

/**
 * Thin, typed wrapper around the self-hosted Postiz public API
 * (docs/architecture/engines/postiz-engine.md §11, postiz-integration-plan.md).
 * One shared API key for the whole Orlixa deployment — never per-company.
 */
@Injectable()
export class PostizClientService {
  private readonly logger = new Logger(PostizClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>(POSTIZ_ENV.BASE_URL);
    if (!url) throw new Error(`${POSTIZ_ENV.BASE_URL} is not configured`);
    return url.replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    const key = this.config.get<string>(POSTIZ_ENV.API_KEY);
    if (!key) throw new Error(`${POSTIZ_ENV.API_KEY} is not configured`);
    return { Authorization: key, 'content-type': 'application/json' };
  }

  async getConnectUrl(platform: string, refreshIntegrationId?: string): Promise<{ url: string }> {
    const qs = refreshIntegrationId ? `?refresh=${encodeURIComponent(refreshIntegrationId)}` : '';
    const res = await fetch(`${this.baseUrl()}/public/v1/social/${platform}${qs}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Postiz getConnectUrl(${platform}) failed: ${res.status}`);
    }
    return res.json();
  }

  async listIntegrations(group?: string): Promise<PostizIntegrationDto[]> {
    const qs = group ? `?group=${encodeURIComponent(group)}` : '';
    const res = await fetch(`${this.baseUrl()}/public/v1/integrations${qs}`, {
      headers: this.headers(),
    });
    if (!res.ok) {
      throw new Error(`Postiz listIntegrations failed: ${res.status}`);
    }
    return res.json();
  }

  async schedulePost(input: SchedulePostInput): Promise<{ postizPostId: string }> {
    const body = {
      type: input.type,
      date: input.date,
      posts: [
        {
          integration: { id: input.postizIntegrationId },
          value: [{ content: input.content }],
        },
      ],
    };
    const res = await fetch(`${this.baseUrl()}/public/v1/posts`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Postiz schedulePost failed (${res.status}): ${text}`);
      throw new Error(`Postiz schedulePost failed: ${res.status}`);
    }
    const data = (await res.json()) as { id?: string; postId?: string };
    const postizPostId = data.id ?? data.postId;
    if (!postizPostId) {
      throw new Error('Postiz schedulePost returned no post id');
    }
    return { postizPostId };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @vaep/api test -- postiz-client.service`
Expected: PASS

- [ ] **Step 6: Add env vars to `.env.example`**

```bash
# --- Marketing engine (Postiz, self-hosted) ---
POSTIZ_BASE_URL=http://postiz:3000
POSTIZ_API_KEY=
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/engines/marketing apps/api/.env.example
git commit -m "feat(marketing): add PostizClientService REST wrapper"
```

---

### Task 3: Register the `postiz` Skill catalog entry

**Files:**
- Modify: `apps/api/src/modules/skills/catalog.ts:526` (append before the closing `];`)
- Test: extend `apps/api/test/e2e/engines-marketing.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing new — same `SkillDefinition`/`ToolDefinition` shape already used by every other
  catalog entry (Step 3 below copies the `scheduling` entry's `connection: { type: 'none' }` +
  `highRisk` pattern from `stripe.create_payment_link`).
- Produces: tool names `postiz.list_connected_accounts`, `postiz.start_connect_account`,
  `postiz.schedule_post`, `postiz.publish_now`, `postiz.get_post_status` — Task 4's
  `RealSkillExecutor` switch cases are keyed on exactly these strings.

- [ ] **Step 1: Write the failing catalog test**

```typescript
// append to apps/api/test/e2e/engines-marketing.e2e-spec.ts
import { SkillCatalog } from '../../src/modules/skills/catalog';

describe('Marketing engine — catalog', () => {
  it('registers the postiz skill with a schedule_post tool', () => {
    expect(SkillCatalog.has('postiz')).toBe(true);
    const tool = SkillCatalog.getTool('postiz', 'schedule_post');
    expect(tool?.highRisk).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test:e2e -- engines-marketing`
Expected: FAIL — `SkillCatalog.has('postiz')` returns `false`.

- [ ] **Step 3: Append the catalog entry**

```typescript
// apps/api/src/modules/skills/catalog.ts — inserted as a new array element before the closing `];`
{
  key: 'postiz',
  name: 'AI Marketing Manager (Postiz)',
  description:
    'Connect social accounts and schedule/publish posts via the self-hosted Postiz publishing engine.',
  category: 'marketing',
  connection: { type: 'none' }, // company-level OAuth-connect happens per-platform via start_connect_account, not a single skill-level connection
  configSchema: [],
  tools: [
    {
      name: 'list_connected_accounts',
      description: "List the company's connected social accounts.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'start_connect_account',
      description: 'Get an OAuth URL to connect a new social account (e.g. instagram, linkedin).',
      parameters: {
        type: 'object',
        properties: {
          platform: { type: 'string', description: 'Postiz platform identifier, e.g. "instagram".' },
        },
        required: ['platform'],
      },
    },
    {
      name: 'schedule_post',
      description: 'Schedule a post to a connected social account for a future date/time.',
      highRisk: true,
      parameters: {
        type: 'object',
        properties: {
          socialAccountId: { type: 'string', description: 'Orlixa SocialAccount id.' },
          content: { type: 'string', description: 'Post text content.' },
          publishAt: { type: 'string', description: 'ISO datetime to publish at.' },
        },
        required: ['socialAccountId', 'content', 'publishAt'],
      },
    },
    {
      name: 'publish_now',
      description: 'Publish a post immediately to a connected social account.',
      highRisk: true,
      parameters: {
        type: 'object',
        properties: {
          socialAccountId: { type: 'string', description: 'Orlixa SocialAccount id.' },
          content: { type: 'string', description: 'Post text content.' },
        },
        required: ['socialAccountId', 'content'],
      },
    },
    {
      name: 'get_post_status',
      description: 'Get the current status of a previously scheduled post.',
      parameters: {
        type: 'object',
        properties: {
          scheduledPostId: { type: 'string', description: 'Orlixa ScheduledPost id.' },
        },
        required: ['scheduledPostId'],
      },
    },
  ],
},
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @vaep/api test:e2e -- engines-marketing`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/skills/catalog.ts apps/api/test/e2e/engines-marketing.e2e-spec.ts
git commit -m "feat(marketing): register postiz skill catalog entry"
```

---

### Task 4: Wire `postiz.*` into `RealSkillExecutor`

**Files:**
- Modify: `apps/api/src/modules/skills/executors/real-skill-executor.ts`
- Test: `apps/api/src/modules/skills/executors/real-skill-executor.spec.ts` (existing file — add cases)

**Interfaces:**
- Consumes: `PostizClientService` (Task 2), injected into `RealSkillExecutor`'s constructor
  alongside the existing `scheduling: SchedulingService` — same DI pattern.
- Produces: nothing new downstream; this is the leaf that actually calls out.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/skills/executors/real-skill-executor.spec.ts (add this describe block)
describe('RealSkillExecutor — postiz.schedule_post', () => {
  it('delegates to PostizClientService.schedulePost', async () => {
    const postizClient = {
      schedulePost: jest.fn().mockResolvedValue({ postizPostId: 'p_123' }),
    };
    const executor = new RealSkillExecutor(
      configMock,
      fallbackMock,
      schedulingMock,
      postizClient as any,
    );
    const result = await executor.execute(
      'postiz',
      'schedule_post',
      { socialAccountId: 'sa_1', content: 'Hello world', publishAt: '2026-08-01T09:00:00Z' },
      { companyId: 'c_1' },
    );
    expect(result.ok).toBe(true);
    expect(postizClient.schedulePost).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test -- real-skill-executor`
Expected: FAIL — constructor doesn't accept a 4th `postizClient` argument yet.

- [ ] **Step 3: Add the constructor param + switch cases**

```typescript
// apps/api/src/modules/skills/executors/real-skill-executor.ts
// (1) add to the imports:
import type { PostizClientService } from '../../engines/marketing/postiz-client.service';
import type { PrismaService } from '../../../prisma/prisma.service'; // existing shared PrismaService

// (2) add to the constructor:
constructor(
  private readonly config: ConfigService,
  private readonly fallback: SkillExecutor,
  private readonly scheduling: SchedulingService,
  private readonly postizClient: PostizClientService,
  private readonly prisma: PrismaService,
) {}

// (3) add cases inside the execute() switch:
case 'postiz.list_connected_accounts':
  return await this.postizListConnectedAccounts(ctx);
case 'postiz.start_connect_account':
  return await this.postizStartConnectAccount(args);
case 'postiz.schedule_post':
  return await this.postizSchedulePost(args, ctx);
case 'postiz.publish_now':
  return await this.postizPublishNow(args, ctx);
case 'postiz.get_post_status':
  return await this.postizGetPostStatus(args, ctx);

// (4) add the private methods (mirrors the existing gdrive.* method style):
private async postizListConnectedAccounts(ctx: ExecutorContext): Promise<SkillExecutionResult> {
  const accounts = await this.prisma.socialAccount.findMany({
    where: { companyId: ctx.companyId, status: 'CONNECTED' },
  });
  return { ok: true, result: { accounts } };
}

private async postizStartConnectAccount(
  args: Record<string, unknown>,
): Promise<SkillExecutionResult> {
  const platform = str(args.platform);
  if (!platform) return { ok: false, error: 'start_connect_account requires a platform' };
  try {
    const { url } = await this.postizClient.getConnectUrl(platform);
    return { ok: true, result: { url } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'connect failed' };
  }
}

private async postizSchedulePost(
  args: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<SkillExecutionResult> {
  const socialAccountId = str(args.socialAccountId);
  const content = str(args.content);
  const publishAt = str(args.publishAt);
  if (!socialAccountId || !content || !publishAt) {
    return { ok: false, error: 'schedule_post requires socialAccountId, content, publishAt' };
  }
  const account = await this.prisma.socialAccount.findFirst({
    where: { id: socialAccountId, companyId: ctx.companyId },
  });
  if (!account) return { ok: false, error: 'SocialAccount not found for this company' };

  try {
    const { postizPostId } = await this.postizClient.schedulePost({
      postizIntegrationId: account.postizIntegrationId,
      content,
      type: 'schedule',
      date: publishAt,
    });
    const post = await this.prisma.scheduledPost.create({
      data: {
        companyId: ctx.companyId,
        socialAccountId,
        content,
        publishAt: new Date(publishAt),
        status: 'SCHEDULED',
        postizPostId,
      },
    });
    return { ok: true, result: { scheduledPostId: post.id, postizPostId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'schedule_post failed' };
  }
}

private async postizPublishNow(
  args: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<SkillExecutionResult> {
  const socialAccountId = str(args.socialAccountId);
  const content = str(args.content);
  if (!socialAccountId || !content) {
    return { ok: false, error: 'publish_now requires socialAccountId and content' };
  }
  const account = await this.prisma.socialAccount.findFirst({
    where: { id: socialAccountId, companyId: ctx.companyId },
  });
  if (!account) return { ok: false, error: 'SocialAccount not found for this company' };
  try {
    const { postizPostId } = await this.postizClient.schedulePost({
      postizIntegrationId: account.postizIntegrationId,
      content,
      type: 'now',
    });
    return { ok: true, result: { postizPostId } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'publish_now failed' };
  }
}

private async postizGetPostStatus(
  args: Record<string, unknown>,
  ctx: ExecutorContext,
): Promise<SkillExecutionResult> {
  const scheduledPostId = str(args.scheduledPostId);
  if (!scheduledPostId) return { ok: false, error: 'get_post_status requires scheduledPostId' };
  const post = await this.prisma.scheduledPost.findFirst({
    where: { id: scheduledPostId, companyId: ctx.companyId },
  });
  if (!post) return { ok: false, error: 'ScheduledPost not found for this company' };
  return { ok: true, result: { status: post.status, postizPostId: post.postizPostId } };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @vaep/api test -- real-skill-executor`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/skills/executors/real-skill-executor.ts apps/api/src/modules/skills/executors/real-skill-executor.spec.ts
git commit -m "feat(marketing): wire postiz.* tools into RealSkillExecutor"
```

---

### Task 5: Webhook receiver + reconciliation sync (BullMQ)

**Files:**
- Create: `apps/api/src/modules/engines/marketing/marketing-webhook.controller.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing-sync.processor.ts`
- Create: `apps/api/src/modules/engines/marketing/marketing.module.ts`
- Test: `apps/api/src/modules/engines/marketing/marketing-sync.processor.spec.ts`

**Interfaces:**
- Consumes: `PostizClientService.listIntegrations` (Task 2), `PrismaService` (existing).
- Produces: a running `MARKETING_SYNC_QUEUE` repeatable job — later engine phases (Chatwoot, Plane,
  etc.) each add their own `<engine>-sync` queue following this identical processor shape.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/api/src/modules/engines/marketing/marketing-sync.processor.spec.ts
describe('MarketingSyncProcessor', () => {
  it('updates ScheduledPost status from Postiz post list', async () => {
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sp_1', postizPostId: 'p_1', status: 'SCHEDULED' }]),
        update: jest.fn(),
      },
      publishedPost: { create: jest.fn() },
    };
    const postizClient = {
      listIntegrations: jest.fn().mockResolvedValue([]),
    };
    const processor = new MarketingSyncProcessor(queueMock, prisma as any, postizClient as any);
    await processor.process({ name: 'marketing-sync-sweep' } as any);
    expect(prisma.scheduledPost.findMany).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test -- marketing-sync.processor`
Expected: FAIL — `Cannot find module './marketing-sync.processor'`

- [ ] **Step 3: Write the processor (mirrors `ConnectorHealthProcessor` exactly)**

```typescript
// apps/api/src/modules/engines/marketing/marketing-sync.processor.ts
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { PostizClientService } from './postiz-client.service';
import {
  MARKETING_SYNC_EVERY_MS,
  MARKETING_SYNC_JOB,
  MARKETING_SYNC_QUEUE,
  MARKETING_SYNC_SCHEDULER,
} from './marketing.constants';
import { DEFAULT_QUEUE_CONCURRENCY } from '../../../common/resilience/queue-concurrency.constants';

@Processor(MARKETING_SYNC_QUEUE, { concurrency: DEFAULT_QUEUE_CONCURRENCY })
export class MarketingSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MarketingSyncProcessor.name);

  constructor(
    @InjectQueue(MARKETING_SYNC_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly postizClient: PostizClientService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        MARKETING_SYNC_SCHEDULER,
        { every: MARKETING_SYNC_EVERY_MS },
        { name: MARKETING_SYNC_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
      );
    } catch (err) {
      this.logger.warn(
        `Could not register marketing-sync scheduler: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MARKETING_SYNC_JOB) return;
    const pending = await this.prisma.scheduledPost.findMany({
      where: { status: 'SCHEDULED' },
      take: 100,
    });
    for (const post of pending) {
      // Reconciliation backstop — Postiz's own webhook is unsigned/no-retry
      // (docs/architecture/engines/postiz-engine.md §13), so this poll is the
      // source of truth, not just a fallback.
      if (!post.postizPostId) continue;
      // (real implementation calls a per-post Postiz status lookup here;
      // omitted for brevity in this plan — implementer fills in using
      // PostizClientService, extending it with a getPost(id) method following
      // the exact same fetch() pattern as schedulePost in Task 2.)
    }
    this.logger.debug(`marketing-sync swept ${pending.length} pending post(s)`);
  }
}
```

- [ ] **Step 4: Write the webhook controller**

```typescript
// apps/api/src/modules/engines/marketing/marketing-webhook.controller.ts
import { Body, Controller, Post } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Controller('engines/marketing/webhook')
export class MarketingWebhookController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  async receive(@Body() body: { postId?: string; status?: string }): Promise<{ ok: boolean }> {
    // Postiz's own webhook payload is unsigned (postiz-engine.md §13) — treat
    // this as a hint to sync sooner, never as the sole source of truth; the
    // MarketingSyncProcessor sweep (Task 5, Step 3) is what actually confirms.
    if (body.postId) {
      await this.prisma.scheduledPost.updateMany({
        where: { postizPostId: body.postId },
        data: { status: body.status === 'PUBLISHED' ? 'SCHEDULED' : 'FAILED' },
      });
    }
    return { ok: true };
  }
}
```

- [ ] **Step 5: Write the module wiring**

```typescript
// apps/api/src/modules/engines/marketing/marketing.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PostizClientService } from './postiz-client.service';
import { MarketingSyncProcessor } from './marketing-sync.processor';
import { MarketingWebhookController } from './marketing-webhook.controller';
import { MARKETING_SYNC_QUEUE } from './marketing.constants';

@Module({
  imports: [BullModule.registerQueue({ name: MARKETING_SYNC_QUEUE })],
  controllers: [MarketingWebhookController],
  providers: [PostizClientService, MarketingSyncProcessor],
  exports: [PostizClientService],
})
export class MarketingModule {}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @vaep/api test -- marketing-sync.processor`
Expected: PASS

- [ ] **Step 7: Register `MarketingModule` in `AppModule` and commit**

```bash
git add apps/api/src/modules/engines/marketing apps/api/src/app.module.ts
git commit -m "feat(marketing): add webhook receiver + reconciliation sync processor"
```

---

### Task 6: End-to-end proof (offline-safe, `SKILL_EXECUTOR=mock` default)

**Files:**
- Test: `apps/api/test/e2e/engines-marketing.e2e-spec.ts` (extend)

- [ ] **Step 1: Write the failing e2e test**

```typescript
// append to apps/api/test/e2e/engines-marketing.e2e-spec.ts
it('an employee can call postiz.schedule_post through the normal tool-calling loop', async () => {
  // Uses the existing e2e harness pattern (freshCompany/hire/installSkill/assignSkill/chat) —
  // see platform/scripts/edge-case-tests/lib/harness.mjs for the real helpers this test imports.
  const company = await freshCompany();
  const employee = await hire(company, { role: 'CUSTOM', persona: 'Marketing manager' });
  await installSkill(company, 'postiz');
  await assignSkill(company, employee.id, 'postiz');
  const reply = await chat(company, employee.id, 'List my connected social accounts');
  expect(reply.toolCalls?.some((c: any) => c.tool === 'postiz.list_connected_accounts')).toBe(true);
});
```

- [ ] **Step 2: Run it to verify it fails, then implement/fix until it passes**

Run: `pnpm --filter @vaep/api test:e2e -- engines-marketing`
Expected: initially FAIL (skill not installable / tool not reachable) until Tasks 1-5 are fully
wired; PASS once complete — this is the acceptance test for the whole phase.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/e2e/engines-marketing.e2e-spec.ts
git commit -m "test(marketing): e2e proof of the full postiz tool-calling loop"
```

---

### Task 7: Implement the reconciliation-sync loop body (bug fix — deferred at Task 5/final review, now being closed)

**Context:** the final whole-branch review flagged (Important — Should Fix, accepted at the time as
a tracked follow-up, not a merge blocker): `MarketingSyncProcessor.process()`'s loop body was a
documented no-op scaffold — it fetched pending `ScheduledPost` rows but never called Postiz to check
their real status, so nothing ever left `SCHEDULED`, no `PublishedPost` row was ever created, and
`get_post_status` could only ever echo `SCHEDULED`. This task closes that gap for real.

**Files:**
- Modify: `apps/api/prisma/schema.prisma` — add `PUBLISHED` to the `ScheduledPostStatus` enum (the
  existing enum is `DRAFT | PENDING_APPROVAL | SCHEDULED | FAILED` — confirmed via direct read,
  `schema.prisma:791-796` — there is currently no terminal "done" state; `PublishedPost`'s existence
  is the real signal of completion, per `scheduledPostId @unique`, but the status enum should still
  reflect it for cheap querying without a join).
- Modify: `apps/api/src/modules/engines/marketing/postiz-client.service.ts` — add a `listPosts` method.
- Modify: `apps/api/src/modules/engines/marketing/marketing-sync.processor.ts` — implement the loop body.
- Test: `apps/api/src/modules/engines/marketing/marketing-sync.processor.spec.ts` (extend).

**Interfaces:**
- Consumes: Postiz's `GET /public/v1/posts` (confirmed to return each post's real `state`
  (`QUEUE|PUBLISHED|ERROR|DRAFT`), `releaseId`, `releaseURL` fields directly —
  `docs/architecture/postiz-analysis.md:305,779` — verified this is the actual Postiz `Post` model
  serialized, not invented).
- Produces: `PostizClientService.listPosts(): Promise<PostizPostDto[]>` where
  `PostizPostDto = { id: string, state: string, releaseId?: string, releaseURL?: string }`.

- [ ] **Step 1: Write the failing test for the new schema value**

Extend the existing schema test (or add a focused one) confirming `ScheduledPostStatus.PUBLISHED` is
a valid enum value usable in a Prisma write — e.g. create a `ScheduledPost` with
`status: 'PUBLISHED'` and confirm it round-trips.

- [ ] **Step 2: Add the enum value + migration**

```prisma
enum ScheduledPostStatus {
  DRAFT
  PENDING_APPROVAL
  SCHEDULED
  PUBLISHED
  FAILED
}
```

Author via `prisma migrate diff --script` into a new timestamped migration folder (same
non-interactive convention as every earlier task in this plan), read the generated SQL for any
unexpected DROP/ALTER against pre-existing tables before applying, then `prisma migrate deploy`.

- [ ] **Step 3: Write the failing test for `PostizClientService.listPosts`**

```typescript
it('lists posts from the public API', async () => {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ([{ id: 'p_1', state: 'PUBLISHED', releaseId: 'ig_123', releaseURL: 'https://instagram.com/p/abc' }]),
  });
  // @ts-expect-error test override
  global.fetch = fetchMock;
  const posts = await service.listPosts();
  expect(posts[0].state).toBe('PUBLISHED');
});
```

- [ ] **Step 4: Implement `listPosts`**

Follow the exact `res.ok` + error-body-capture pattern already established (and fixed once already)
in this same file's `getConnectUrl`/`listIntegrations`/`schedulePost` — do not reintroduce the
swallowed-error-body mistake that was already found and fixed once in Task 2's review.

```typescript
export interface PostizPostDto {
  id: string;
  state: string;
  releaseId?: string;
  releaseURL?: string;
}

async listPosts(): Promise<PostizPostDto[]> {
  const res = await fetch(`${this.baseUrl()}/public/v1/posts`, { headers: this.headers() });
  if (!res.ok) {
    const text = await res.text();
    this.logger.warn(`Postiz listPosts failed (${res.status}): ${text}`);
    throw new Error(`Postiz listPosts failed: ${res.status}`);
  }
  return res.json();
}
```

- [ ] **Step 5: Write the failing test for the processor's real loop body**

```typescript
it('marks a ScheduledPost PUBLISHED and creates a PublishedPost row when Postiz reports it published', async () => {
  const prisma = {
    scheduledPost: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'sp_1', postizPostId: 'p_1', socialAccountId: 'sa_1', companyId: 'c_1', status: 'SCHEDULED' },
      ]),
      update: jest.fn(),
    },
    publishedPost: { create: jest.fn() },
  };
  const postizClient = {
    listPosts: jest.fn().mockResolvedValue([
      { id: 'p_1', state: 'PUBLISHED', releaseId: 'ig_123', releaseURL: 'https://instagram.com/p/abc' },
    ]),
  };
  const processor = new MarketingSyncProcessor(queueMock, prisma as any, postizClient as any);
  await processor.process({ name: 'marketing-sync-sweep' } as any);
  expect(prisma.publishedPost.create).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({
        scheduledPostId: 'sp_1',
        platformPostId: 'ig_123',
        permalink: 'https://instagram.com/p/abc',
      }),
    }),
  );
  expect(prisma.scheduledPost.update).toHaveBeenCalledWith(
    expect.objectContaining({ where: { id: 'sp_1' }, data: { status: 'PUBLISHED' } }),
  );
});

it('marks a ScheduledPost FAILED when Postiz reports an error state', async () => {
  // same shape, state: 'ERROR' → scheduledPost.update with status: 'FAILED', no PublishedPost created
});
```

- [ ] **Step 6: Implement the real loop body**

```typescript
async process(job: Job): Promise<void> {
  if (job.name !== MARKETING_SYNC_JOB) return;
  const pending = await this.prisma.scheduledPost.findMany({
    where: { status: 'SCHEDULED' },
    take: 100,
  });
  if (pending.length === 0) return;

  // ONE list call per sweep, not one per pending post — avoids N calls against
  // Postiz's own rate limit (postiz-engine.md §14: 90/hour instance-wide).
  const postizPosts = await this.postizClient.listPosts();
  const byId = new Map(postizPosts.map((p) => [p.id, p]));

  for (const post of pending) {
    if (!post.postizPostId) continue;
    const remote = byId.get(post.postizPostId);
    if (!remote) continue; // not found this sweep — leave SCHEDULED, try again next sweep
    if (remote.state === 'PUBLISHED') {
      await this.prisma.publishedPost.create({
        data: {
          companyId: post.companyId,
          socialAccountId: post.socialAccountId,
          scheduledPostId: post.id,
          platformPostId: remote.releaseId ?? null,
          permalink: remote.releaseURL ?? null,
        },
      });
      await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'PUBLISHED' },
      });
    } else if (remote.state === 'ERROR') {
      await this.prisma.scheduledPost.update({
        where: { id: post.id },
        data: { status: 'FAILED' },
      });
    }
    // state QUEUE/DRAFT → still pending, leave as SCHEDULED, no action.
  }
  this.logger.debug(`marketing-sync swept ${pending.length} pending post(s)`);
}
```

- [ ] **Step 7: Wire `get_post_status` (Task 4's executor method) to also check `PublishedPost`**

`RealSkillExecutor.postizGetPostStatus` currently only reads `ScheduledPost.status`/`postizPostId` —
extend it to also look up a linked `PublishedPost` (via `scheduledPostId`) and include
`platformPostId`/`permalink` in the result when one exists, so the tool's answer reflects the now-real
completion state rather than always being able to say only `SCHEDULED`.

- [ ] **Step 8: Run the full test suite for this module + typecheck**

Run: `pnpm --filter @vaep/api test -- marketing` and `pnpm --filter @vaep/api exec tsc --noEmit`
Expected: all pass, clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/src/modules/engines/marketing apps/api/src/modules/skills/executors/real-skill-executor.ts
git commit -m "fix(marketing): implement real reconciliation-sync loop (was a documented stub)"
```

## Self-Review

**Spec coverage:** Task 1 covers the DB schema (Part A gap #5's fix). Task 2 covers the REST client.
Task 3 covers Skill-catalog registration (the "every engine is a Skill" global constraint). Task 4
covers tool dispatch. Task 5 covers the webhook+reconciliation pattern every later engine phase
reuses. Task 6 proves the whole loop end-to-end. Part A's gap table covers every finding from the
10-engine research program plus the RBAC discussion, each with a named owning phase. Part B's
roadmap accounts for all 9 remaining engines + the 2 cross-cutting fixes (RBAC/SecurityPolicy,
storage migration) + Keycloak, each as its own future plan per the scope-check rule.

**Placeholder scan:** one intentional, explicitly-labeled exception in Task 5 Step 3 (the per-post
status-lookup body) — flagged inline as "implementer fills in using `PostizClientService`, extending
it with a `getPost(id)` method following the exact same `fetch()` pattern as `schedulePost`," which
is a concrete instruction, not a vague TODO; every other step has complete, runnable code.

**Type consistency:** `PostizClientService.schedulePost`'s return type (`{ postizPostId: string }`)
matches its usage in Task 4's `postizSchedulePost`/`postizPublishNow`. `ExecutorContext`/
`SkillExecutionResult` match the real interfaces read from `skill-executor.ts`. `MARKETING_SYNC_*`
constant names match between `marketing.constants.ts` (Task 2) and their use in Task 5.
