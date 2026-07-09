import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Skills + tool-execution e2e: needs a live Postgres + Redis. Skipped when
// DATABASE_URL is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Skills e2e (catalog -> install -> assign -> tool-calling run)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `skill_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';
  let installedSkillId = '';
  let employeeId = '';
  let conversationId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'Skill E2E Co', name: 'Skill Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('exposes the built-in catalog with tools', async () => {
    const res = await request(app.getHttpServer())
      .get('/skills/catalog')
      .set(auth())
      .expect(200);

    const keys = res.body.map((s: { key: string }) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['slack', 'email', 'stripe', 'github', 'http']),
    );
    const slack = res.body.find((s: { key: string }) => s.key === 'slack');
    expect(slack.tools[0].name).toBe('send_message');
    expect(slack.tools[0].parameters.required).toEqual(
      expect.arrayContaining(['channel', 'text']),
    );
  });

  it('installs the slack skill (tenant-scoped)', async () => {
    const res = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(201);
    expect(res.body.skillKey).toBe('slack');
    expect(res.body.enabled).toBe(true);
    installedSkillId = res.body.id;

    const list = await request(app.getHttpServer())
      .get('/skills/installed')
      .set(auth())
      .expect(200);
    expect(list.body.some((s: { id: string }) => s.id === installedSkillId)).toBe(
      true,
    );
  });

  it('rejects installing an unknown skill (404) and a duplicate (409)', async () => {
    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'nope' })
      .expect(404);

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(409);
  });

  it('manually executes a tool (mock/sandbox, logged)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/skills/installed/${installedSkillId}/tools/send_message/execute`)
      .set(auth())
      .send({ args: { channel: '#test', text: 'hello' } })
      .expect(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.skillKey).toBe('slack');
    expect(res.body.tool).toBe('send_message');
    expect(String(res.body.result.id)).toMatch(/^mock_send_message_/);
  });

  it('creates an employee and assigns the installed skill', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Sky', role: 'SUPPORT', persona: 'Ops assistant.' })
      .expect(201);
    employeeId = emp.body.id;

    const assign = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/skills`)
      .set(auth())
      .send({ installedSkillId })
      .expect(201);
    expect(assign.body.employeeId).toBe(employeeId);
    expect(assign.body.installedSkillId).toBe(installedSkillId);

    const list = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/skills`)
      .set(auth())
      .expect(200);
    expect(list.body.length).toBe(1);
  });

  it('runs the agent loop with a tool call and a final answer', async () => {
    const conv = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/conversations`)
      .set(auth())
      .send({ title: 'Slack it' })
      .expect(201);
    conversationId = conv.body.id;

    const res = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth())
      .send({
        content: 'Send a slack message to #general about our refund policy',
      })
      .expect(201);

    const result = res.body;

    // At least one tool call: slack / send_message, succeeded.
    expect(Array.isArray(result.toolCalls)).toBe(true);
    expect(result.toolCalls.length).toBeGreaterThanOrEqual(1);
    const call = result.toolCalls.find(
      (c: { skillKey: string; tool: string }) =>
        c.skillKey === 'slack' && c.tool === 'send_message',
    );
    expect(call).toBeTruthy();
    expect(call.ok).toBe(true);

    // A non-empty final assistant answer.
    expect(result.message.role).toBe('ASSISTANT');
    expect(typeof result.message.content).toBe('string');
    expect(result.message.content.length).toBeGreaterThan(0);

    // Metadata mirrors the tool calls.
    expect(result.message.metadata.toolCalls.length).toBeGreaterThanOrEqual(1);

    // A SkillExecution audit row was written for the slack run.
    const rows = await prisma.skillExecution.findMany({
      where: { companyId, employeeId, skillKey: 'slack', status: 'SUCCESS' },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('unassigns the skill from the employee', async () => {
    await request(app.getHttpServer())
      .delete(`/employees/${employeeId}/skills/${installedSkillId}`)
      .set(auth())
      .expect(204);

    const list = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/skills`)
      .set(auth())
      .expect(200);
    expect(list.body.length).toBe(0);
  });

  it('uninstalls the skill', async () => {
    await request(app.getHttpServer())
      .delete(`/skills/installed/${installedSkillId}`)
      .set(auth())
      .expect(204);

    const list = await request(app.getHttpServer())
      .get('/skills/installed')
      .set(auth())
      .expect(200);
    expect(list.body.some((s: { id: string }) => s.id === installedSkillId)).toBe(
      false,
    );
  });

  it('rejects skills routes without a token', async () => {
    await request(app.getHttpServer()).get('/skills/installed').expect(401);
  });
});
