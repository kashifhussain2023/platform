// The "full tool-calling loop" describe block below needs a live Postgres +
// Redis AND a deterministic LLM. This repo's own .env may set LLM_PROVIDER=openai
// for live-testing other features (see employees.e2e-spec.ts's same note) — that
// makes tool-selection a real, non-deterministic model call instead of the mock
// scorer, which will intermittently fail this test for reasons that have nothing
// to do with this feature. Always run with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { SkillCatalog } from '../../src/modules/skills/catalog';

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

  it('accepts ScheduledPostStatus.PUBLISHED as a valid write and reads it back', async () => {
    const company = await prisma.company.create({
      data: { name: 'Acme Published Test', slug: `acme-published-${Date.now()}` },
    });
    const account = await prisma.socialAccount.create({
      data: {
        companyId: company.id,
        provider: 'instagram',
        postizIntegrationId: 'postiz-int-456',
        status: 'CONNECTED',
      },
    });
    const scheduledPost = await prisma.scheduledPost.create({
      data: {
        companyId: company.id,
        socialAccountId: account.id,
        content: 'hello world',
        publishAt: new Date(),
        status: 'PUBLISHED',
        postizPostId: 'p_1',
      },
    });
    expect(scheduledPost.status).toBe('PUBLISHED');

    const reloaded = await prisma.scheduledPost.findUniqueOrThrow({
      where: { id: scheduledPost.id },
    });
    expect(reloaded.status).toBe('PUBLISHED');
  });
});

describe('Marketing engine — catalog', () => {
  it('registers the postiz skill with a schedule_post tool', () => {
    expect(SkillCatalog.has('postiz')).toBe(true);
    const tool = SkillCatalog.getTool('postiz', 'schedule_post');
    expect(tool?.highRisk).toBe(true);
  });
});

// --- DB-gated: full tool-calling loop (SKILL_EXECUTOR=mock, no network) ------
// Same describeIfDb + Test.createTestingModule({imports:[AppModule]}) + supertest
// convention as integrations.e2e-spec.ts / per-employee-skill-connections.e2e-spec.ts
// (this suite's own harness.mjs script-style client is for standalone scripts against
// an already-running server, not for jest e2e specs in this directory).
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Marketing engine — full tool-calling loop', () => {
  let app: INestApplication;
  const email = `engines_marketing_e2e_${Date.now()}@example.com`;
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
      .send({ companyName: 'Engine Test Co', name: 'Test Owner', email, password })
      .expect(201);
    auth.Authorization = `Bearer ${res.body.tokens.accessToken}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('an employee can call postiz.list_connected_accounts through the normal chat loop', async () => {
    const employee = await request(app.getHttpServer())
      .post('/employees')
      .set(auth)
      .send({ name: 'Marketing Bot', role: 'CUSTOM', persona: 'Marketing manager' })
      .expect(201);
    const employeeId = employee.body.id;

    const installed = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth)
      .send({ skillKey: 'postiz' })
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
      .send({ content: 'List my connected social accounts' })
      .expect(201);

    expect(
      result.body.toolCalls.some(
        (c: { skillKey: string; tool: string }) =>
          c.skillKey === 'postiz' && c.tool === 'list_connected_accounts',
      ),
    ).toBe(true);
  });
});
