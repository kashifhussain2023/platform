import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Approval Center e2e: needs a live Postgres + Redis. Skipped when DATABASE_URL
// is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Approvals e2e (high-risk tool → approve / reject / modify)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `approval_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';
  let installedSkillId = '';
  let employeeId = '';
  let conversationId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  /** Send a message that triggers the slack tool; return the pending approvalId. */
  const triggerPending = async (text: string): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth())
      .send({ content: text })
      .expect(201);
    const call = res.body.toolCalls.find(
      (c: { skillKey: string; tool: string }) =>
        c.skillKey === 'slack' && c.tool === 'send_message',
    );
    expect(call).toBeTruthy();
    expect(call.pendingApproval).toBe(true);
    expect(typeof call.approvalId).toBe('string');
    expect(call.ok).toBe(false);
    return call.approvalId as string;
  };

  const slackExecCount = () =>
    prisma.skillExecution.count({
      where: { companyId, employeeId, skillKey: 'slack' },
    });

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);

    // register → login (use the login token, per spec).
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: 'Approval E2E Co',
        name: 'Approval Owner',
        email,
        password,
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    accessToken = login.body.tokens.accessToken;
    companyId = login.body.company.id;

    // install slack → create employee → assign the skill.
    const installed = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(201);
    installedSkillId = installed.body.id;

    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Sky', role: 'SUPPORT', persona: 'Ops assistant.' })
      .expect(201);
    employeeId = emp.body.id;

    await request(app.getHttpServer())
      .post(`/employees/${employeeId}/skills`)
      .set(auth())
      .send({ installedSkillId })
      .expect(201);

    // Require approval for slack:send_message.
    await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set(auth())
      .send({ approvalRules: { requireApprovalForTools: ['slack:send_message'] } })
      .expect(200);

    const conv = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/conversations`)
      .set(auth())
      .send({ title: 'Approvals' })
      .expect(201);
    conversationId = conv.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('routes a high-risk tool call to a PENDING approval WITHOUT executing', async () => {
    const before = await slackExecCount();
    const approvalId = await triggerPending(
      'Send a slack message to #general about our refund policy',
    );

    // No slack SkillExecution written yet (nothing was executed).
    expect(await slackExecCount()).toBe(before);

    // An ApprovalRequest PENDING exists for the proposed call.
    const req = await prisma.approvalRequest.findFirst({
      where: { id: approvalId, companyId },
    });
    expect(req).toBeTruthy();
    expect(req?.status).toBe('PENDING');
    expect(req?.skillKey).toBe('slack');
    expect(req?.tool).toBe('send_message');

    // GET /approvals?status=PENDING surfaces it.
    const list = await request(app.getHttpServer())
      .get('/approvals?status=PENDING')
      .set(auth())
      .expect(200);
    expect(list.body.some((r: { id: string }) => r.id === approvalId)).toBe(
      true,
    );

    // Approve → executes now: status APPROVED, result present, execution logged.
    const approved = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/approve`)
      .set(auth())
      .send({})
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.result).toBeTruthy();
    expect(approved.body.decidedById).toBeTruthy();

    expect(await slackExecCount()).toBe(before + 1);
    const exec = await prisma.skillExecution.findFirst({
      where: { companyId, employeeId, skillKey: 'slack', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    expect(exec).toBeTruthy();
  });

  it('rejects a request and it stays un-executed', async () => {
    const before = await slackExecCount();
    const approvalId = await triggerPending(
      'Send a slack message to #general about the launch',
    );
    expect(await slackExecCount()).toBe(before); // still nothing executed

    const rejected = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/reject`)
      .set(auth())
      .send({ note: 'Not now' })
      .expect(201);
    expect(rejected.body.status).toBe('REJECTED');
    expect(rejected.body.result).toBeNull();

    // No new execution was written by the rejection.
    expect(await slackExecCount()).toBe(before);
  });

  it('modifies a request and executes with the NEW args', async () => {
    const before = await slackExecCount();
    const approvalId = await triggerPending(
      'Send a slack message to #general with a status update',
    );

    const modified = await request(app.getHttpServer())
      .post(`/approvals/${approvalId}/modify`)
      .set(auth())
      .send({ args: { channel: '#modified', text: 'edited by manager' } })
      .expect(201);
    expect(modified.body.status).toBe('APPROVED');
    expect(modified.body.result).toBeTruthy();
    expect(modified.body.args.channel).toBe('#modified');

    // A new execution was logged with the modified args.
    expect(await slackExecCount()).toBe(before + 1);
    const exec = await prisma.skillExecution.findFirst({
      where: { companyId, employeeId, skillKey: 'slack', status: 'SUCCESS' },
      orderBy: { createdAt: 'desc' },
    });
    expect((exec?.args as { channel?: string })?.channel).toBe('#modified');
  });

  it('cannot decide an already-decided request (409)', async () => {
    const list = await request(app.getHttpServer())
      .get('/approvals?status=APPROVED')
      .set(auth())
      .expect(200);
    const decidedId = list.body[0]?.id as string;
    expect(decidedId).toBeTruthy();
    await request(app.getHttpServer())
      .post(`/approvals/${decidedId}/approve`)
      .set(auth())
      .send({})
      .expect(409);
  });

  it('rejects approvals routes without a token', async () => {
    await request(app.getHttpServer()).get('/approvals').expect(401);
  });
});
