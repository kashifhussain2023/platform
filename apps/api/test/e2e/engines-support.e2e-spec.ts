// The "full tool-calling loop" describe block below needs a live Postgres +
// Redis AND a deterministic LLM. This repo's own .env may set LLM_PROVIDER=openai
// for live-testing other features (see employees.e2e-spec.ts's same note) — that
// makes tool-selection a real, non-deterministic model call instead of the mock
// scorer, which will intermittently fail this test for reasons that have nothing
// to do with this feature. Also note: apps/api/.env sets SKILL_EXECUTOR=auto, and
// the chatwoot skill's catalog entry has connection:{type:'none'} (provisioned
// once per company, not per-employee OAuth) — AutoSkillExecutor treats
// connection.type==='none' as always-eligible for the REAL executor, so leaving
// SKILL_EXECUTOR unset here would NOT get you the mock executor for this skill.
// Always run with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   SKILL_EXECUTOR=mock \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SkillCatalog } from '../../src/modules/skills/catalog';

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

describe('Support engine — catalog', () => {
  it('registers the chatwoot skill with a reply_to_conversation tool', () => {
    expect(SkillCatalog.has('chatwoot')).toBe(true);
    const tool = SkillCatalog.getTool('chatwoot', 'reply_to_conversation');
    expect(tool).toBeDefined();
  });
});

// --- DB-gated: full tool-calling loop (SKILL_EXECUTOR=mock, no network) ------
// Same describeIfDb + Test.createTestingModule({imports:[AppModule]}) + supertest
// convention as engines-marketing.e2e-spec.ts / integrations.e2e-spec.ts (this
// suite's own harness.mjs script-style client is for standalone scripts against
// an already-running server, not for jest e2e specs in this directory).
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Support engine — full tool-calling loop', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const email = `engines_support_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  const auth: Record<string, string> = {};

  jest.setTimeout(60_000);

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'Support Engine Test Co', name: 'Test Owner', email, password })
      .expect(201);
    auth.Authorization = `Bearer ${res.body.tokens.accessToken}`;

    // chatwootReplyToConversation (Task 4) requires a ChatwootAccount AND a
    // SupportConversation to already exist for the company — provisionAccount
    // is an intentional stub (Task 2), not callable here — so create both rows
    // directly via Prisma, same as engines-marketing.e2e-spec.ts's SocialAccount.
    const companyId = res.body.company.id as string;
    const chatwootAccount = await prisma.chatwootAccount.create({
      data: {
        companyId,
        chatwootAccountId: '1',
        agentBotId: '1',
        agentBotToken: 'encrypted-placeholder',
        webhookSecret: 'encrypted-placeholder',
      },
    });
    await prisma.supportConversation.create({
      data: {
        companyId,
        chatwootAccountId: chatwootAccount.id,
        chatwootConversationId: 'cw_conv_1',
        contactEmail: 'customer@example.com',
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
  });

  it('an employee can call chatwoot.reply_to_conversation through the normal chat loop', async () => {
    const employee = await request(app.getHttpServer())
      .post('/employees')
      .set(auth)
      .send({ name: 'Support Bot', role: 'CUSTOM', persona: 'Customer support agent' })
      .expect(201);
    const employeeId = employee.body.id;

    const installed = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth)
      .send({ skillKey: 'chatwoot' })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/employees/${employeeId}/skills`)
      .set(auth)
      .send({ installedSkillId: installed.body.id })
      .expect(201);

    const conversation = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/conversations`)
      .set(auth)
      .send({})
      .expect(201);

    const result = await request(app.getHttpServer())
      .post(`/conversations/${conversation.body.id}/messages`)
      .set(auth)
      .send({ content: "Reply to this conversation saying we'll look into it" })
      .expect(201);

    expect(
      result.body.toolCalls.some(
        (c: { skillKey: string; tool: string }) =>
          c.skillKey === 'chatwoot' && c.tool === 'reply_to_conversation',
      ),
    ).toBe(true);
  });
});
