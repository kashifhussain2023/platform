# AI Project Manager Employee (Plane) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a self-hosted Plane instance behind a new "AI Project Manager Employee," following the exact framework Phase 0 (Postiz) and Phase 1 (Chatwoot) established.

**Architecture:** Plane's stable public `api/v1` (API-key or OAuth Bearer auth, documented at developers.plane.so — verified `docs/architecture/engines/plane-engine.md §11`) is the black-box seam — call it directly, never embed Plane's own 3 frontends. One Plane **Workspace** per Orlixa Company (`plane-engine.md §15`'s recommendation). Real, HMAC-signed, retried webhooks (`X-Plane-Signature`, Celery-backed, 5 retries) push issue-change events back.

**Tech Stack:** Same as Phases 0/1 — NestJS + Prisma + Postgres + BullMQ/Redis calling a self-hosted Plane instance over REST + webhook.

## Global Constraints

Same as the master plan's Global Constraints (copy verbatim — every engine is a Skill catalog entry dispatched by `RealSkillExecutor`; new queues follow `common/resilience`; new secrets via `CryptoService`/`ConfigService`; no Enterprise-gated feature enabled — moot here, Plane has **zero** Enterprise/Community split at all, verified `plane-engine.md §18`).

**Carried forward, non-negotiable, learned the hard way across Phases 0 and 1:**
- Webhook signature verification BEFORE any DB write, from the start — no exceptions, no "fix it at final review."
- **Plane's HMAC scheme is DIFFERENT from Chatwoot's — verified directly against Plane's real source (`plane/bgtasks/webhook_task.py`), do not reuse Chatwoot's scheme:** `X-Plane-Signature` is a **raw hex HMAC-SHA256 digest** (no `sha256=` prefix) computed over the **exact JSON-serialized payload bytes** (`json.dumps(payload)` in Python) — **no timestamp is included at all**, unlike Chatwoot. This means: (a) verification must hash the literal raw request body bytes as received (`req.rawBody`), never a re-parsed-and-re-stringified version, since JSON serialization isn't guaranteed byte-identical across implementations; (b) there is no replay-window concept to add here (Plane's own scheme has none) — do not invent one Plane doesn't have.
- Plane's workspace/API-token provisioning, like Chatwoot's account provisioning, requires a session-authenticated flow (`plane/app/views/workspace/base.py:WorkSpaceViewSet.create`, `plane/app/views/api.py:ApiTokenEndpoint` — both under the session-cookie `app/` namespace, not the API-key `api/v1` namespace, confirmed by reading the actual Django view classes). **Leave `provisionWorkspace` as an honest, documented stub** — do not fabricate an implementation never run against a live instance.
- Any e2e test exercising the employee chat/tool-calling loop **MUST** be run with `LLM_PROVIDER=mock` explicitly on the command line (`EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local` too).
- This dev environment's `.env` sets `SKILL_EXECUTOR=auto`, not `mock` — any catalog tool with `connection.type === 'none'` (which this plan's `plane` entry will use) is routed to the REAL executor by `AutoSkillExecutor` regardless of credentials. Every new executor method must genuinely fail closed (`{ok:false, error}`) when required config (e.g. `PLANE_BASE_URL`, a missing `PlaneWorkspace` row) is absent — verify this explicitly, don't assume it holds by coincidence.

---

### Task 1: Plane engine Prisma schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/test/e2e/engines-pm.e2e-spec.ts` (new file)

**Interfaces:**
- Produces: `PlaneWorkspace` (per-company, `@unique` on `companyId`: `planeWorkspaceSlug`, encrypted `apiToken`, encrypted `webhookSecret`), `PlaneProject` (`companyId`, `planeProjectId`, `planeWorkspaceId`→`PlaneWorkspace`, `name`), `TrackedIssue` (`companyId`, `planeIssueId`, `planeProjectId`→`PlaneProject`, `title`, `status`, `assignee`, `lastSyncedAt`).

- [ ] **Step 1: Write the failing Prisma-shape test**

```typescript
// apps/api/test/e2e/engines-pm.e2e-spec.ts
import { PrismaClient } from '@prisma/client';

describe('PM engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a PlaneWorkspace scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'PM Test Co', slug: `pm-test-${Date.now()}` },
    });
    const workspace = await prisma.planeWorkspace.create({
      data: {
        companyId: company.id,
        planeWorkspaceSlug: 'pm-test-workspace',
        apiToken: 'encrypted-placeholder',
        webhookSecret: 'encrypted-placeholder',
      },
    });
    expect(workspace.companyId).toBe(company.id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Add the Prisma models**

Same `companyId` + `@relation` + `@@index([companyId])` convention as every existing model (confirmed unchanged across Phases 0 and 1):

```prisma
model PlaneWorkspace {
  id                 String   @id @default(cuid())
  companyId          String   @unique
  company            Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  planeWorkspaceSlug String
  apiToken           String   // CryptoService-encrypted at rest
  webhookSecret      String   // CryptoService-encrypted at rest
  createdAt          DateTime @default(now())
  projects           PlaneProject[]

  @@index([companyId])
}

model PlaneProject {
  id               String         @id @default(cuid())
  companyId        String
  company          Company        @relation(fields: [companyId], references: [id], onDelete: Cascade)
  planeWorkspaceId String
  planeWorkspace   PlaneWorkspace @relation(fields: [planeWorkspaceId], references: [id], onDelete: Cascade)
  planeProjectId   String
  name             String
  createdAt        DateTime       @default(now())
  issues           TrackedIssue[]

  @@index([companyId])
}

model TrackedIssue {
  id             String       @id @default(cuid())
  companyId      String
  company        Company      @relation(fields: [companyId], references: [id], onDelete: Cascade)
  planeProjectId String
  planeProject   PlaneProject @relation(fields: [planeProjectId], references: [id], onDelete: Cascade)
  planeIssueId   String
  title          String
  status         String
  assignee       String?
  lastSyncedAt   DateTime     @default(now())

  @@index([companyId])
  @@index([companyId, planeIssueId])
}
```

Add reverse relations on `model Company` matching the exact style of the existing back-relations from the Marketing/Support engines.

- [ ] **Step 4: Author and apply the migration**

Same convention as every earlier task: `prisma migrate diff --script`, not `migrate dev`. **Read the generated SQL for the recurring `DROP INDEX "KnowledgeChunk_embedding_idx"` hazard** — this false-positive drift has now appeared on EVERY migration touching this schema so far (2 confirmed occurrences); expect a 3rd and check explicitly, do not skip this.

- [ ] **Step 5: Re-run the test, verify pass.**

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/e2e/engines-pm.e2e-spec.ts
git commit -m "feat(pm): add Plane-backed PM schema (PlaneWorkspace/PlaneProject/TrackedIssue)"
```

---

### Task 2: `PlaneClientService` — the REST wrapper

**Files:**
- Create: `apps/api/src/modules/engines/pm/plane-client.service.ts`
- Create: `apps/api/src/modules/engines/pm/pm.constants.ts`
- Test: `apps/api/src/modules/engines/pm/plane-client.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get('PLANE_BASE_URL')` (self-hosted instance base URL — no shared platform token needed here, since Plane's API auth is per-workspace, `X-Api-Key`, stored per-company in `PlaneWorkspace.apiToken`, decrypted by the caller, not a single shared deployment-wide secret like Postiz's).
- Produces: `createIssue(workspaceSlug, projectId, apiToken, {title, description}): Promise<{planeIssueId: string}>`, `listIssues(workspaceSlug, projectId, apiToken): Promise<PlaneIssueDto[]>`, `updateIssueStatus(workspaceSlug, projectId, apiToken, issueId, status): Promise<void>`, `verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, webhookSecret: string): boolean`.

- [ ] **Step 1: Write the failing unit tests**

```typescript
// apps/api/src/modules/engines/pm/plane-client.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { PlaneClientService } from './plane-client.service';
import { createHmac } from 'crypto';

describe('PlaneClientService', () => {
  const config = new ConfigService({ PLANE_BASE_URL: 'https://plane.internal.test' });
  const service = new PlaneClientService(config);

  it('creates an issue against the correct workspace/project URL with X-Api-Key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'issue-123' }),
    });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    await service.createIssue('acme-workspace', 'proj-1', 'plane-token-abc', {
      title: 'Fix the bug',
      description: 'Details here',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://plane.internal.test/api/v1/workspaces/acme-workspace/projects/proj-1/issues/',
    );
    expect(init.headers['X-Api-Key']).toBe('plane-token-abc');
  });

  it('verifies a webhook signature using the RAW HMAC-SHA256 hex digest of the exact payload bytes (no prefix, no timestamp — this is Plane, NOT Chatwoot)', () => {
    const secret = 'shared-secret';
    const rawBody = Buffer.from('{"event":"issue","action":"create"}', 'utf8');
    const validSig = createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(service.verifyWebhookSignature(rawBody, validSig, secret)).toBe(true);
    expect(service.verifyWebhookSignature(rawBody, 'wrong-sig', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Write `pm.constants.ts`**

```typescript
export const PLANE_ENV = { BASE_URL: 'PLANE_BASE_URL' } as const;
```

- [ ] **Step 4: Write `PlaneClientService`**

Follow the exact `res.ok` + read-and-log-response-body-on-failure pattern already established in both `postiz-client.service.ts` and `chatwoot-client.service.ts` (the two direct sibling precedents — do not reintroduce the swallowed-error-body bug that was found and fixed once already).

```typescript
// apps/api/src/modules/engines/pm/plane-client.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { PLANE_ENV } from './pm.constants';

export interface PlaneIssueDto {
  id: string;
  name: string;
  state: string;
  assignees?: string[];
}

@Injectable()
export class PlaneClientService {
  private readonly logger = new Logger(PlaneClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>(PLANE_ENV.BASE_URL);
    if (!url) throw new Error(`${PLANE_ENV.BASE_URL} is not configured`);
    return url.replace(/\/$/, '');
  }

  async createIssue(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
    input: { title: string; description?: string },
  ): Promise<{ planeIssueId: string }> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
      {
        method: 'POST',
        headers: { 'X-Api-Key': apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ name: input.title, description_html: input.description ?? '' }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane createIssue failed (${res.status}): ${text}`);
      throw new Error(`Plane createIssue failed: ${res.status}`);
    }
    const data = (await res.json()) as { id: string };
    return { planeIssueId: data.id };
  }

  async listIssues(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
  ): Promise<PlaneIssueDto[]> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/`,
      { headers: { 'X-Api-Key': apiToken } },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane listIssues failed (${res.status}): ${text}`);
      throw new Error(`Plane listIssues failed: ${res.status}`);
    }
    return res.json();
  }

  async updateIssueStatus(
    workspaceSlug: string,
    projectId: string,
    apiToken: string,
    issueId: string,
    status: string,
  ): Promise<void> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/workspaces/${workspaceSlug}/projects/${projectId}/issues/${issueId}/`,
      {
        method: 'PATCH',
        headers: { 'X-Api-Key': apiToken, 'content-type': 'application/json' },
        body: JSON.stringify({ state: status }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Plane updateIssueStatus failed (${res.status}): ${text}`);
      throw new Error(`Plane updateIssueStatus failed: ${res.status}`);
    }
  }

  /**
   * Plane's webhook scheme (verified directly against plane/bgtasks/webhook_task.py) is a
   * RAW hex HMAC-SHA256 digest of the exact JSON payload bytes -- no "sha256=" prefix, no
   * timestamp component (unlike Chatwoot's scheme in the sibling Support engine). Verification
   * MUST hash the literal raw request body bytes, never a re-serialized version.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, webhookSecret: string): boolean {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    let a: Buffer;
    let b: Buffer;
    try {
      a = Buffer.from(expected, 'hex');
      b = Buffer.from(signatureHeader, 'hex');
    } catch {
      return false;
    }
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async provisionWorkspace(): Promise<never> {
    // NOT LIVE-VERIFIED -- no self-hosted Plane instance exists in this dev
    // environment to run this against. Grounded directly in Plane's real
    // Django source (not guessed):
    //   apps/api/plane/app/views/workspace/base.py: WorkSpaceViewSet.create
    //   apps/api/plane/app/views/api.py: ApiTokenEndpoint
    // Both live under the session-cookie `app/` namespace, NOT the API-key
    // `api/v1` namespace -- confirmed by reading the actual view classes'
    // permission_classes. This means provisioning a new workspace + API
    // token requires an authenticated Plane user session (login via
    // apps/api/plane/authentication/, obtain a session cookie, THEN call
    // the workspace-create + api-token-create endpoints as that session),
    // not a pure API-key call the way Postiz's public API allows. Do not
    // fabricate a "working" implementation that has never been run against
    // a live instance -- verify this sequence against real docs/a live
    // instance before implementing for real.
    throw new Error('NOT YET IMPLEMENTED — requires a live Plane instance to verify the session-based provisioning sequence');
  }
}
```

- [ ] **Step 5: Run the tests, verify pass.**

- [ ] **Step 6: Add env vars to `.env.example`**

```bash
# --- PM engine (Plane, self-hosted) ---
PLANE_BASE_URL=http://plane:8000
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/engines/pm apps/api/.env.example
git commit -m "feat(pm): add PlaneClientService REST wrapper (createIssue/listIssues/updateIssueStatus/verifyWebhookSignature; provisionWorkspace stubbed pending live-instance verification)"
```

---

### Task 3: Register the `plane` Skill catalog entry

**Files:**
- Modify: `apps/api/src/modules/skills/catalog.ts`
- Test: `apps/api/test/e2e/engines-pm.e2e-spec.ts`

Follow the exact precedent of the `postiz`/`chatwoot` entries — read both before writing this one. Will very likely need a new `'project_management'` (or similarly named) value added to `packages/types/src/index.ts`'s `SkillCategory` union + a `labels.ts` badge, following the exact `'marketing'`/`'support'` precedent — expected, not a deviation.

- [ ] **Step 1: Write the failing catalog test.**

- [ ] **Step 2: Append the catalog entry**

```typescript
{
  key: 'plane',
  name: 'AI Project Manager (Plane)',
  description: 'Create, track, and update project issues via the self-hosted Plane instance.',
  category: 'project_management',
  connection: { type: 'none' }, // provisioned once per company at onboarding, not per-employee OAuth
  configSchema: [],
  tools: [
    {
      name: 'list_issues',
      description: "List a project's tracked issues.",
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Orlixa PlaneProject id.' },
        },
        required: ['projectId'],
      },
    },
    {
      name: 'create_issue',
      description: 'Create a new issue in a project.',
      parameters: {
        type: 'object',
        properties: {
          projectId: { type: 'string', description: 'Orlixa PlaneProject id.' },
          title: { type: 'string', description: 'Issue title.' },
          description: { type: 'string', description: 'Issue description.' },
        },
        required: ['projectId', 'title'],
      },
    },
    {
      name: 'update_issue_status',
      description: 'Update the status/state of an existing issue.',
      parameters: {
        type: 'object',
        properties: {
          issueId: { type: 'string', description: 'Orlixa TrackedIssue id.' },
          status: { type: 'string', description: 'New status (e.g. "In Progress", "Done").' },
        },
        required: ['issueId', 'status'],
      },
    },
  ],
},
```

- [ ] **Step 3: Run the test, verify pass.**

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/skills/catalog.ts apps/api/test/e2e/engines-pm.e2e-spec.ts
git commit -m "feat(pm): register plane skill catalog entry"
```

---

### Task 4: Wire `plane.*` into `RealSkillExecutor`

**Files:**
- Modify: `apps/api/src/modules/skills/executors/real-skill-executor.ts`
- Modify: `apps/api/src/modules/skills/skills.module.ts` (temporary direct provider for `PlaneClientService`, exactly like the two sibling engines did — `PmModule` doesn't exist until Task 5)
- Test: `apps/api/src/modules/skills/executors/real-skill-executor.spec.ts`

Follow the exact precedent of the sibling engines' Task 4s (both already on this branch — read both, especially the Chatwoot one for the per-company-encrypted-credential pattern, since Plane's `apiToken` is also per-company-encrypted like Chatwoot's `agentBotToken`, unlike Postiz's single shared key).

- Look up `PlaneWorkspace` by `ctx.companyId` (at most one per company, `@unique`); missing → `{ok:false, error:'Plane not connected for this company'}`.
- `planeListIssues`: reads `TrackedIssue` rows from Prisma (companyId-scoped), no live Plane call — matches the `postizListConnectedAccounts`/no-network-read pattern.
- `planeCreateIssue`: looks up `PlaneProject` (companyId-scoped) + its `PlaneWorkspace` (companyId-scoped), decrypts `apiToken`, calls `planeClient.createIssue(...)`, writes a new `TrackedIssue` row.
- `planeUpdateIssueStatus`: looks up `TrackedIssue` (companyId-scoped) + its `PlaneProject`/`PlaneWorkspace` (companyId-scoped), decrypts `apiToken`, calls `planeClient.updateIssueStatus(...)`, updates the local `TrackedIssue.status`.
- Every Prisma query MUST filter by `ctx.companyId` — no exceptions, this is checked specifically at review every time.
- **Check for `new RealSkillExecutor(` construction sites across the WHOLE repo** — this has now recurred at every single prior engine's Task 4 (`integrations.e2e-spec.ts`); update every site found, not just the module factory.

Full step-by-step TDD detail is not spelled out here (matches the sibling Chatwoot Task 4's approach) since the pattern is now well-established across 2 prior engines — the implementer should follow that exact structural precedent.

---

### Task 5: Signature-verified webhook + module

**Files:**
- Create: `apps/api/src/modules/engines/pm/pm-webhook.controller.ts`
- Create: `apps/api/src/modules/engines/pm/pm.module.ts`

**Non-negotiable, verified against real Plane source:** signature verification BEFORE any DB write. Use `req.rawBody` (already globally enabled, `apps/api/src/main.ts:12`) — same `RawBodyRequest<Request>` pattern as `billing-webhook.controller.ts`/the Chatwoot webhook. **Resolve which company sent the webhook via `body.workspace_slug` or `body.workspace_id`** (both present in Plane's real payload, confirmed directly in `plane/bgtasks/webhook_task.py:286-294`) — look up `PlaneWorkspace` by `planeWorkspaceSlug`, decrypt its `webhookSecret`, verify via `PlaneClientService.verifyWebhookSignature(req.rawBody, req.headers['x-plane-signature'], decryptedSecret)` — **remember Plane's scheme has no timestamp and no prefix, do not copy Chatwoot's verification code verbatim, it's a different algorithm.**

After verification passes: parse `body.event`/`body.action`/`body.data` (the `data` field carries the actual issue payload per the confirmed shape) and upsert the relevant `TrackedIssue` row (companyId-scoped via the resolved workspace).

Module wiring: `PlaneClientService` moved from `SkillsModule`'s temporary direct provider (Task 4) into `PmModule`'s `providers`+`exports`; `SkillsModule` updated to `import: [PmModule]` instead; `PmModule` registered in root `AppModule` — exact same consolidation pattern already done twice (Marketing, Support).

No BullMQ sync processor needed — Plane's webhook delivers live with its own retry (5x, Celery-backed on Plane's own side), same reasoning as the Chatwoot engine.

---

### Task 6: End-to-end proof

**Files:**
- Test: `apps/api/test/e2e/engines-pm.e2e-spec.ts` (extend)

Follow the exact, twice-proven convention: `Test.createTestingModule({imports:[AppModule]}) + supertest`, `LLM_PROVIDER=mock` explicit in the header comment, **do not** force `SKILL_EXECUTOR=mock` (learned the hard way in the Chatwoot phase — it would prevent the real executor path from being exercised at all, defeating the point of this acceptance test, since `plane`'s catalog entry is also `connection.type:'none'`).

Prove: an employee, via the real chat/tool-calling loop, can call `plane.create_issue`. Create the necessary `PlaneWorkspace`/`PlaneProject` fixture rows directly via Prisma in test setup (mirrors the Chatwoot test's `ChatwootAccount`/`SupportConversation` fixture pattern) — **learn from the Chatwoot Task 6 lesson**: check `MockLlmProvider.deriveArg`'s actual argument-derivation behavior for the `projectId`/`title` parameter names BEFORE assuming the test's chat message will produce usable tool-call arguments; if a parameter falls through to the generic `clip(userText, 500)` fallback (as `conversationId` did for Chatwoot), verify whether that's a problem for THIS tool's Prisma lookups before writing the assertion, and pin the assertion to whatever the TRUE resulting behavior actually is (verified by really running it), not an assumed one.

---

## Self-Review

**Spec coverage:** all 6 tasks match the master framework; Task 1 schema, Task 2 REST client (with `verifyWebhookSignature` using the CORRECT, source-verified Plane-specific HMAC scheme — deliberately NOT copy-pasted from Chatwoot's), Task 3 catalog, Task 4 executor dispatch, Task 5 signed webhook (signature-first from day one), Task 6 acceptance proof (with the `SKILL_EXECUTOR` and mock-arg-derivation lessons from Chatwoot's Task 6 explicitly called forward rather than rediscovered).

**Placeholder scan:** `provisionWorkspace`'s stub is the one intentional, explicitly-labeled exception, following the same justified pattern as Chatwoot's `provisionAccount` — not a silent TODO.

**Type consistency:** `PlaneClientService`'s method signatures match their intended call sites described in Task 4; `verifyWebhookSignature`'s 3-arg signature (rawBody, signatureHeader, webhookSecret) is deliberately DIFFERENT from Chatwoot's 4-arg version (which includes a timestamp) — this is correct and intentional, not an inconsistency to reconcile, since the two platforms' real schemes genuinely differ.
