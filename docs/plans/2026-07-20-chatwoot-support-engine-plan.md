# AI Customer Support Employee (Chatwoot) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire a self-hosted Chatwoot instance behind a new "AI Customer Support Employee," following the exact same framework Phase 0 (Marketing/Postiz) established — one new engine module, one Skill catalog entry, `RealSkillExecutor` dispatch, a webhook receiver + reconciliation, an e2e acceptance proof.

**Architecture:** Chatwoot's `AgentBot` model (Community, not Enterprise — verified `docs/architecture/engines/chatwoot-engine.md §18`) is the black-box seam: assign a bot to an inbox/conversation, Chatwoot HMAC-signs and POSTs every `message_created`/`conversation_*` event to `outgoing_url`, the bot replies via the normal Messages API. The Platform API (`platform/api/v1/accounts|users|agent_bots`) provisions one Chatwoot account per Orlixa company at onboarding time.

**Tech Stack:** Same as Phase 0 — NestJS + Prisma + Postgres + BullMQ/Redis calling a self-hosted Chatwoot instance over REST + webhook.

## Global Constraints

- Same as `2026-07-20-engine-integration-master-plan.md`'s Global Constraints — copy verbatim, they bind this plan too (every engine is a Skill catalog entry dispatched by `RealSkillExecutor`; new queues follow `common/resilience` + `ConnectorHealthProcessor` pattern; new secrets via `CryptoService`/`ConfigService`; no Enterprise-gated feature enabled).
- **New for this plan:** unlike Postiz (one shared instance/API key for the whole deployment), Chatwoot needs **one Account per Orlixa Company** (`chatwoot-engine.md §15/§20`) — so `CompanySettings`/a new `ChatwootAccount` mirror table must store a **per-company** `chatwootAccountId` + `agentBotToken`, encrypted via `CryptoService` (this is genuinely different from Phase 0's single-shared-key model — do not copy that part of the pattern).
- **Webhook must be signature-verified before any DB write** — this is a hard requirement, not a stub, learned directly from Phase 0's final review catching exactly this class of bug (`marketing-webhook.controller.ts`'s original unauthenticated write). Chatwoot signs `AgentBot` webhooks with the bot's own `secret` (HMAC) — verify this signature before trusting `req.body`, using the same `CryptoService.sign`/`verify` (constant-time compare) already used for Orlixa's own OAuth state signing (`apps/api/src/common/crypto/crypto.service.ts`).
- **Any e2e test exercising the employee chat/tool-calling loop MUST be run with `LLM_PROVIDER=mock` explicitly on the command line** (`EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local` too) — this dev environment's `.env` defaults to a real OpenAI key for other live-testing, which makes tool-selection non-deterministic otherwise. See `engines-marketing.e2e-spec.ts`'s header comment for the exact required command; copy that same comment into this plan's new test file.

## Pre-work (do this before Task 1)

Provision (or confirm access to) a self-hosted Chatwoot instance for development — this plan assumes one exists at a reachable URL with a Platform API "super admin" token available; if none exists yet, that provisioning is out of scope for this plan (infra, not application code) and should be flagged back rather than blocked on silently.

---

### Task 1: Chatwoot engine Prisma schema

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Test: `apps/api/test/e2e/engines-support.e2e-spec.ts` (new file)

**Interfaces:**
- Produces: `ChatwootAccount` (per-company: `chatwootAccountId`, encrypted `agentBotToken`, `agentBotId`, `webhookSecret`), `SupportConversation` (mirror: `companyId`, `chatwootConversationId`, `contactEmail`, `status`, `lastMessageAt`), `SupportMessage` (mirror: `conversationId`→`SupportConversation`, `chatwootMessageId`, `direction` IN/OUT, `content`, `createdAt`).

- [ ] **Step 1: Write the failing Prisma-shape test**

```typescript
// apps/api/test/e2e/engines-support.e2e-spec.ts
import { PrismaClient } from '@prisma/client';

describe('Support engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a ChatwootAccount scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'Support Test Co', slug: `support-test-${Date.now()}` },
    });
    const account = await prisma.chatwootAccount.create({
      data: {
        companyId: company.id,
        chatwootAccountId: '1',
        agentBotId: '1',
        agentBotToken: 'encrypted-placeholder',
        webhookSecret: 'encrypted-placeholder',
      },
    });
    expect(account.companyId).toBe(company.id);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test:e2e -- engines-support`
Expected: FAIL — `Property 'chatwootAccount' does not exist on PrismaClient`.

- [ ] **Step 3: Add the Prisma models**

Follow the exact `companyId` + `@relation` + `@@index([companyId])` convention already used by every model in this schema (confirmed again in Phase 0's Task 1 review — this is the one, unchanged tenancy pattern):

```prisma
model ChatwootAccount {
  id                String   @id @default(cuid())
  companyId         String   @unique
  company           Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  chatwootAccountId String
  agentBotId        String
  agentBotToken     String   // CryptoService-encrypted at rest
  webhookSecret     String   // CryptoService-encrypted at rest
  createdAt         DateTime @default(now())
  conversations     SupportConversation[]

  @@index([companyId])
}

enum SupportConversationStatus {
  OPEN
  RESOLVED
  PENDING
}

model SupportConversation {
  id                     String   @id @default(cuid())
  companyId              String
  company                Company  @relation(fields: [companyId], references: [id], onDelete: Cascade)
  chatwootAccountId      String
  chatwootAccount        ChatwootAccount @relation(fields: [chatwootAccountId], references: [id], onDelete: Cascade)
  chatwootConversationId String
  contactEmail           String?
  status                 SupportConversationStatus @default(OPEN)
  lastMessageAt          DateTime @default(now())
  messages               SupportMessage[]

  @@index([companyId])
  @@index([companyId, chatwootConversationId])
}

enum SupportMessageDirection {
  IN
  OUT
}

model SupportMessage {
  id                 String   @id @default(cuid())
  companyId          String
  company             Company @relation(fields: [companyId], references: [id], onDelete: Cascade)
  conversationId      String
  conversation        SupportConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  chatwootMessageId   String?
  direction           SupportMessageDirection
  content             String
  createdAt           DateTime @default(now())

  @@index([companyId])
  @@index([conversationId])
}
```

Add the reverse relations on `model Company` (`chatwootAccount ChatwootAccount?`, `supportConversations SupportConversation[]`, `supportMessages SupportMessage[]`), matching the exact style of the existing back-relations (look at Phase 0's Task 1 commit for the precedent — Company's back-relation block was extended there too).

- [ ] **Step 4: Author and apply the migration**

Same convention as Phase 0's Task 1 (documented gotcha in `platform/CLAUDE.md`): do NOT use `prisma migrate dev` non-interactively. Author via:
`pnpm --filter @vaep/api prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/$(date +%Y%m%d%H%M%S)_add_support_tables/migration.sql`
then `pnpm --filter @vaep/api prisma migrate deploy`.
**Before applying, read the generated SQL and check for any unrelated `DROP INDEX`/`ALTER` against pre-existing tables** (Phase 0's Task 1 found and stripped a hazardous auto-generated `DROP INDEX` against the pgvector `KnowledgeChunk` index — check for the same class of drift here too, don't assume it won't recur).

- [ ] **Step 5: Re-run the test to verify it passes**

Run: `pnpm --filter @vaep/api test:e2e -- engines-support`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api/prisma/schema.prisma apps/api/prisma/migrations apps/api/test/e2e/engines-support.e2e-spec.ts
git commit -m "feat(support): add Chatwoot-backed support schema (ChatwootAccount/SupportConversation/SupportMessage)"
```

---

### Task 2: `ChatwootClientService` — the REST wrapper

**Files:**
- Create: `apps/api/src/modules/engines/support/chatwoot-client.service.ts`
- Create: `apps/api/src/modules/engines/support/support.constants.ts`
- Test: `apps/api/src/modules/engines/support/chatwoot-client.service.spec.ts`

**Interfaces:**
- Consumes: `ConfigService.get('CHATWOOT_BASE_URL')`, `ConfigService.get('CHATWOOT_PLATFORM_API_TOKEN')` (new env vars — ONE shared Platform-API super-admin token for provisioning; per-company `agentBotToken` comes from the DB, decrypted via `CryptoService`, not env).
- Produces: `provisionAccount(companyName): Promise<{chatwootAccountId, agentBotId, agentBotToken, webhookSecret}>` (Platform API: create account + create agent bot + assign bot to a default inbox), `sendReply(chatwootConversationId, agentBotToken, content): Promise<{chatwootMessageId}>` (Messages API, using the per-company bot token, NOT the platform token), `verifyWebhookSignature(rawBody, signatureHeader, webhookSecret): boolean`.

- [ ] **Step 1: Write the failing unit test**

```typescript
// apps/api/src/modules/engines/support/chatwoot-client.service.spec.ts
import { ConfigService } from '@nestjs/config';
import { ChatwootClientService } from './chatwoot-client.service';
import { CryptoService } from '../../../common/crypto/crypto.service';

describe('ChatwootClientService', () => {
  const config = new ConfigService({
    CHATWOOT_BASE_URL: 'https://chatwoot.internal.test',
    CHATWOOT_PLATFORM_API_TOKEN: 'test-platform-token',
  });
  const crypto = new CryptoService(config);
  const service = new ChatwootClientService(config, crypto);

  it('sends a reply using the per-company agent bot token, not the platform token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 42 }),
    });
    // @ts-expect-error test override
    global.fetch = fetchMock;

    await service.sendReply('acct-1', 'conv-1', 'bot-token-abc', 'Hello, how can I help?');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/accounts/acct-1/conversations/conv-1/messages');
    expect(init.headers.api_access_token).toBe('bot-token-abc');
  });

  it('verifies a webhook signature correctly', () => {
    const secret = 'shared-secret';
    const body = '{"event":"message_created"}';
    const validSig = require('crypto').createHmac('sha256', secret).update(body).digest('hex');
    expect(service.verifyWebhookSignature(body, validSig, secret)).toBe(true);
    expect(service.verifyWebhookSignature(body, 'wrong-sig', secret)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @vaep/api test -- chatwoot-client.service`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write `support.constants.ts`**

```typescript
// apps/api/src/modules/engines/support/support.constants.ts
export const CHATWOOT_ENV = {
  BASE_URL: 'CHATWOOT_BASE_URL',
  PLATFORM_API_TOKEN: 'CHATWOOT_PLATFORM_API_TOKEN',
} as const;

export const SUPPORT_SYNC_QUEUE = 'support-sync';
export const SUPPORT_SYNC_JOB = 'support-sync-sweep';
export const SUPPORT_SYNC_SCHEDULER = 'support-sync';
export const SUPPORT_SYNC_EVERY_MS = 10 * 60_000;
```

- [ ] **Step 4: Write `ChatwootClientService`**

Verify the exact Chatwoot API request/response shapes against `docs/architecture/engines/chatwoot-engine.md §11` before writing (the Platform API's exact provisioning call sequence — create account, then create agent bot, then attach it to an inbox — is documented there; don't invent the sequence, look it up). Use the same `res.ok` check + error-body capture pattern established (and fixed) in Phase 0's `PostizClientService` (`apps/api/src/modules/engines/marketing/postiz-client.service.ts`) — every failure path must log/throw with the response body, not just the HTTP status, learned directly from that earlier review finding.

```typescript
// apps/api/src/modules/engines/support/chatwoot-client.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import { CHATWOOT_ENV } from './support.constants';

export interface ProvisionedAccount {
  chatwootAccountId: string;
  agentBotId: string;
  agentBotToken: string;
  webhookSecret: string;
}

@Injectable()
export class ChatwootClientService {
  private readonly logger = new Logger(ChatwootClientService.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    const url = this.config.get<string>(CHATWOOT_ENV.BASE_URL);
    if (!url) throw new Error(`${CHATWOOT_ENV.BASE_URL} is not configured`);
    return url.replace(/\/$/, '');
  }

  private platformHeaders(): Record<string, string> {
    const token = this.config.get<string>(CHATWOOT_ENV.PLATFORM_API_TOKEN);
    if (!token) throw new Error(`${CHATWOOT_ENV.PLATFORM_API_TOKEN} is not configured`);
    return { api_access_token: token, 'content-type': 'application/json' };
  }

  async provisionAccount(companyName: string): Promise<ProvisionedAccount> {
    // NOT LIVE-VERIFIED — no self-hosted Chatwoot instance exists in this dev
    // environment to run this against. The sequence below IS grounded in a
    // direct read of the real Chatwoot source (not guessed):
    //   app/controllers/platform/api/v1/{accounts,users,account_users,agent_bots}_controller.rb
    //   app/controllers/api/v1/accounts/{inboxes,agent_bots}_controller.rb
    //   app/models/agent_bot.rb (+ AccessTokenable/WebhookSecretable concerns)
    // 1. POST platform/api/v1/accounts {name} -> Account {id}
    // 2. POST platform/api/v1/users {name, email, password} -> User {id}
    // 3. POST platform/api/v1/account_users {account_id, user_id, role: 'administrator'}
    // 4. POST platform/api/v1/users/:id/login -> a real session token for THIS user
    //    (the Platform API's own token, not an admin session, per the doc's
    //    "users (create/show/update/destroy + login/token)" list)
    // 5. POST platform/api/v1/agent_bots {name, account_id, outgoing_url}
    //    -> AgentBot {id, access_token} -- IMPORTANT, verified directly in
    //    app/views/platform/api/v1/models/_agent_bot.json.jbuilder: the platform
    //    API's create/show response NEVER includes `secret` (the HMAC signing
    //    key) -- only api/v1/accounts/:id/agent_bots/:id's jbuilder exposes it,
    //    and ONLY when `Current.account_user&.administrator?` is true (see
    //    app/views/api/v1/models/_agent_bot.json.jbuilder). This is a real
    //    platform limitation, not an oversight in this plan.
    // 6. POST api/v1/accounts/:account_id/inboxes {channel: {type: 'api'}}
    //    (using step 4's user session token, NOT the platform token) -> Inbox {id}
    //    -- creates a headless Channel::Api inbox (no widget/UI), per
    //    chatwoot-engine.md's recommended integration seam.
    // 7. POST api/v1/accounts/:account_id/inboxes/:inbox_id/agent_bot
    //    {agent_bot: agentBotId} (user session token) -> attaches the bot.
    // 8. GET api/v1/accounts/:account_id/agent_bots/:id (user session token,
    //    as the administrator created in step 2) -> NOW `secret` is present
    //    in the response -- this is the ONLY way to retrieve it.
    // Implement this as 8 sequential fetch() calls; if any step's real response
    // shape doesn't match what's documented here once tested against a live
    // instance, that's new information -- update this comment, don't silently
    // patch around a mismatch.
    throw new Error('NOT YET IMPLEMENTED — sequence documented above from source, but requires a live Chatwoot instance to verify before implementing for real; do not fabricate a "working" implementation that has never been run');
  }

  async sendReply(
    chatwootAccountId: string,
    chatwootConversationId: string,
    agentBotToken: string,
    content: string,
  ): Promise<{ chatwootMessageId: string }> {
    const res = await fetch(
      `${this.baseUrl()}/api/v1/accounts/${chatwootAccountId}/conversations/${chatwootConversationId}/messages`,
      {
        method: 'POST',
        headers: { api_access_token: agentBotToken, 'content-type': 'application/json' },
        body: JSON.stringify({ content, message_type: 'outgoing' }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      this.logger.warn(`Chatwoot sendReply failed (${res.status}): ${text}`);
      throw new Error(`Chatwoot sendReply failed: ${res.status}`);
    }
    const data = (await res.json()) as { id: number };
    return { chatwootMessageId: String(data.id) };
  }

  verifyWebhookSignature(rawBody: string, signatureHeader: string, webhookSecret: string): boolean {
    const expected = createHmac('sha256', webhookSecret).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signatureHeader, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
```

**IMPORTANT: `provisionAccount` is deliberately left as a stub that throws in this snippet** — the exact Chatwoot Platform API call sequence (endpoints, field names, order of operations: create account → create agent bot → create inbox → attach bot to inbox) needs to be verified against `docs/architecture/engines/chatwoot-engine.md §11` (or a real instance) before writing real code, not guessed. **Do this verification as your first sub-step before writing the rest of Step 4** — read that doc section, and only then replace the stub with real, correct code. If the doc section doesn't have enough detail to write this with confidence, say so in your report rather than inventing field names.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @vaep/api test -- chatwoot-client.service`
Expected: PASS (both tests — `sendReply` and `verifyWebhookSignature`)

- [ ] **Step 6: Add env vars to `.env.example`**

```bash
# --- Support engine (Chatwoot, self-hosted) ---
CHATWOOT_BASE_URL=http://chatwoot:3000
CHATWOOT_PLATFORM_API_TOKEN=
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/engines/support apps/api/.env.example
git commit -m "feat(support): add ChatwootClientService REST wrapper (sendReply + webhook signature verification; provisionAccount stubbed pending Platform API sequence verification)"
```

---

### Task 3: Register the `chatwoot` Skill catalog entry

**Files:**
- Modify: `apps/api/src/modules/skills/catalog.ts`
- Test: `apps/api/test/e2e/engines-support.e2e-spec.ts`

Follow the exact pattern established in Phase 0's Task 3 (the `postiz` entry) — read that entry in `catalog.ts` first to match style/shape exactly (including the `'marketing'`-style `SkillCategory` addition precedent: this task will likely need a new `'support'` category value in `packages/types/src/index.ts`'s `SkillCategory` union too, following that exact precedent, plus a `labels.ts` badge — don't be surprised by this, it's expected, not a deviation).

- [ ] **Step 1: Write the failing catalog test**

```typescript
// append to apps/api/test/e2e/engines-support.e2e-spec.ts
import { SkillCatalog } from '../../src/modules/skills/catalog';

describe('Support engine — catalog', () => {
  it('registers the chatwoot skill with a reply_to_conversation tool', () => {
    expect(SkillCatalog.has('chatwoot')).toBe(true);
    const tool = SkillCatalog.getTool('chatwoot', 'reply_to_conversation');
    expect(tool).toBeDefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails.**

- [ ] **Step 3: Append the catalog entry**

```typescript
{
  key: 'chatwoot',
  name: 'AI Customer Support Manager (Chatwoot)',
  description: 'Reply to customer support conversations via the self-hosted Chatwoot Agent Bot.',
  category: 'support',
  connection: { type: 'none' }, // provisioned once per company at onboarding, not per-employee OAuth
  configSchema: [],
  tools: [
    {
      name: 'list_open_conversations',
      description: "List the company's currently open support conversations.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_conversation',
      description: 'Get the full message history of one conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Orlixa SupportConversation id.' },
        },
        required: ['conversationId'],
      },
    },
    {
      name: 'reply_to_conversation',
      description: 'Send a reply into a customer support conversation.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Orlixa SupportConversation id.' },
          content: { type: 'string', description: 'Reply text to send to the customer.' },
        },
        required: ['conversationId', 'content'],
      },
    },
    {
      name: 'resolve_conversation',
      description: 'Mark a conversation as resolved.',
      parameters: {
        type: 'object',
        properties: {
          conversationId: { type: 'string', description: 'Orlixa SupportConversation id.' },
        },
        required: ['conversationId'],
      },
    },
  ],
},
```

Note `reply_to_conversation` is deliberately NOT `highRisk` here (unlike Postiz's `schedule_post`/`publish_now`) — a support reply is real-time, low-stakes-per-message communication, not a public broadcast; if this needs revisiting (e.g. requiring approval for a first-N-messages trial period per the earlier conversation about Support's "how many conversations handled automatically" question), that's a product decision for a later task, not this one — flag it in your report rather than silently deciding it yourself.

- [ ] **Step 4: Run the test to verify it passes.**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/skills/catalog.ts apps/api/test/e2e/engines-support.e2e-spec.ts
# (plus packages/types/src/index.ts and apps/web/src/features/skills/labels.ts if SkillCategory needed a 'support' addition)
git commit -m "feat(support): register chatwoot skill catalog entry"
```

---

### Task 4: Wire `chatwoot.*` into `RealSkillExecutor`

**Files:**
- Modify: `apps/api/src/modules/skills/executors/real-skill-executor.ts`
- Modify: `apps/api/src/modules/skills/skills.module.ts` (temporary direct provider for `ChatwootClientService`, exactly like Phase 0's Task 4 did for `PostizClientService` — same reasoning: `SupportModule` doesn't exist until Task 5)
- Test: `apps/api/src/modules/skills/executors/real-skill-executor.spec.ts`

Follow Phase 0's Task 4 exactly (constructor param addition, `skillExecutorFactory` signature + both call sites + `inject` array all updated together, `PrismaService`'s real path is `../../../common/prisma/prisma.service`). **Also check `apps/api/test/integrations.e2e-spec.ts` for a second direct `RealSkillExecutor` construction site that needs the same arity update** — Phase 0's Task 4 found exactly this; don't assume it won't recur, grep for `new RealSkillExecutor(` across the whole repo before considering this task done.

Implement `chatwootListOpenConversations`, `chatwootGetConversation`, `chatwootReplyToConversation`, `chatwootResolveConversation` — every Prisma query must filter by `ctx.companyId` (tenant isolation — this was the #1 thing Phase 0's Task 4 review specifically checked and confirmed; do the same self-check here before calling this task done).

- [ ] **Step 1-6:** same TDD shape as Phase 0's Task 4 (write failing test per method → implement → verify pass → commit). Full test/implementation code is not spelled out here since it depends on Task 2's finalized `provisionAccount` verification — write it once that's confirmed, following the exact structural precedent already proven in `real-skill-executor.ts`'s existing `postiz.*`/`gdrive.*` cases.

---

### Task 5: Webhook receiver (signature-verified) + reconciliation sync

**Files:**
- Create: `apps/api/src/modules/engines/support/support-webhook.controller.ts`
- Create: `apps/api/src/modules/engines/support/support-sync.processor.ts`
- Create: `apps/api/src/modules/engines/support/support.module.ts`

**Critical, non-negotiable requirement (this is the whole point of writing this plan carefully rather than repeating Phase 0's mistake):** the webhook handler MUST call `ChatwootClientService.verifyWebhookSignature(rawBody, req.headers['x-chatwoot-signature'], account.webhookSecret)` (look up `account` by whatever company-identifying info the payload/route carries — Chatwoot's `AgentBot` webhook payload includes the account context; confirm the exact field from `docs/architecture/engines/chatwoot-engine.md`) **before touching the database at all**, and reject with 401 if verification fails. Do not ship the unauthenticated-write mistake Phase 0 had to fix at final review — this plan exists specifically so that mistake isn't repeated.

Getting the raw request body for HMAC verification requires NestJS's raw-body option (`rawBody: true` on the specific route or globally, matching how `apps/api/src/api/routes/stripe.controller.ts`-equivalent Stripe webhook handling in this codebase already does it, if such a precedent exists in this repo — check for one via `grep -rn "rawBody" apps/api/src` before implementing, since signature verification against a re-serialized/parsed body will not match Chatwoot's HMAC).

Module wiring follows Phase 0's Task 5 exactly: `ChatwootClientService` provided in `SupportModule`, exported; `SkillsModule` updated to `import: [SupportModule]` instead of directly providing `ChatwootClientService`; `SupportModule` registered in root `AppModule`.

- [ ] **Steps 1-7:** same TDD shape as Phase 0's Task 5, adapted for signature verification instead of a no-op. Write the failing test first (a request with a WRONG signature must be rejected without any DB write — this is the test that proves the security fix Phase 0 needed is built in from the start here), then implement, verify, commit.

---

### Task 6: End-to-end proof

**Files:**
- Test: `apps/api/test/e2e/engines-support.e2e-spec.ts` (extend)

Follow Phase 0's Task 6 exactly: investigate the real e2e bootstrap convention (`Test.createTestingModule({imports:[AppModule]}) + supertest`, confirmed in Phase 0 to be the actual pattern, not the imagined harness API) rather than assuming. **Copy the exact `LLM_PROVIDER=mock` header-comment convention from `engines-marketing.e2e-spec.ts`** — this is now a proven, required step for every engine's acceptance test in this repo, not optional.

Prove: an employee, via the real chat/tool-calling loop, can call `chatwoot.reply_to_conversation` — register → hire → install `chatwoot` → assign → chat "Reply to this conversation saying we'll look into it" → assert `toolCalls` contains `{skillKey:'chatwoot', tool:'reply_to_conversation'}`. Run the test **with `LLM_PROVIDER=mock` explicitly on the command line** and confirm it passes BEFORE reporting done — do not trust a single run without the explicit override, per the exact failure mode documented in Phase 0's final review.

---

## Self-Review

**Spec coverage:** Task 1 covers schema, Task 2 the REST client (with an explicit, honest stub for the one piece — `provisionAccount` — that genuinely needs doc verification before real code, rather than a guessed implementation), Task 3 catalog registration, Task 4 executor dispatch, Task 5 the webhook (signature-verified from the start, directly addressing Phase 0's real finding), Task 6 the acceptance proof (with the `LLM_PROVIDER=mock` requirement baked in from the start, directly addressing Phase 0's other real finding).

**Placeholder scan:** Task 2's `provisionAccount` stub is an intentional, explicitly-flagged exception (not a silent TODO) — it requires verifying real Chatwoot Platform API field names before writing, which this document cannot respons ibly guess without either reading the doc section carefully or having a live instance to check against; the task instructions require the implementer to do that verification as a first step, not skip it.

**Type consistency:** `ChatwootClientService.sendReply`'s signature (`chatwootAccountId, chatwootConversationId, agentBotToken, content`) matches its intended call sites in Task 4. `verifyWebhookSignature`'s signature matches Task 5's stated usage.
