import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Workflow builder e2e: needs a live Postgres + Redis (BullMQ). Skipped when
// DATABASE_URL is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const DOC_TEXT = [
  'Our refund policy lets customers request a full refund within 30 days of',
  'purchase. Refunds are processed to the original payment method within five',
  'business days. Digital goods are refundable only if unused.',
].join(' ');

describeIfDb('Workflows e2e (create -> run -> poll linear chain)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `wf_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';
  let documentId = '';
  let workflowId = '';
  let runId = '';

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
      .send({ companyName: 'WF E2E Co', name: 'WF Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads knowledge and ingests it to READY', async () => {
    const upload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth())
      .attach('file', Buffer.from(DOC_TEXT, 'utf8'), {
        filename: 'refunds.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    documentId = upload.body.id;

    const deadline = Date.now() + 20_000;
    let status = 'PENDING';
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/knowledge/documents/${documentId}`)
        .set(auth())
        .expect(200);
      status = res.body.status;
      if (status === 'READY' || status === 'FAILED') {
        break;
      }
      await sleep(500);
    }
    expect(status).toBe('READY');
  }, 30_000);

  it('installs the slack skill (tenant-scoped)', async () => {
    const res = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(201);
    expect(res.body.skillKey).toBe('slack');
  });

  it('creates a linear workflow (TRIGGER -> RETRIEVE -> AI_STEP -> TOOL_ACTION -> NOTIFY)', async () => {
    const definition = {
      nodes: [
        { id: 'n1', type: 'TRIGGER', config: {} },
        {
          id: 'n2',
          type: 'RETRIEVE',
          config: { query: '{{trigger.query}}', k: 5, outputKey: 'retrieved' },
        },
        {
          id: 'n3',
          type: 'AI_STEP',
          config: {
            prompt: 'Summarise our policy using this context: {{retrieved}}',
            outputKey: 'aiText',
          },
        },
        {
          id: 'n4',
          type: 'TOOL_ACTION',
          config: {
            skillKey: 'slack',
            tool: 'send_message',
            args: { channel: '#general', text: '{{aiText}}' },
            outputKey: 'slackResult',
          },
        },
        {
          id: 'n5',
          type: 'NOTIFY',
          config: { message: 'Posted to slack: {{aiText}}' },
        },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
        { from: 'n4', to: 'n5' },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({ name: 'Refund policy broadcast', definition })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.definition.nodes.length).toBe(5);
    workflowId = res.body.id;
  });

  it('runs the workflow with a trigger payload and reaches COMPLETED', async () => {
    const start = await request(app.getHttpServer())
      .post(`/workflows/${workflowId}/run`)
      .set(auth())
      .send({ trigger: { query: 'refund policy' } })
      .expect(201);

    expect(start.body.status).toBe('PENDING');
    runId = start.body.id;

    const deadline = Date.now() + 20_000;
    let run: any = start.body;
    while (Date.now() < deadline) {
      const res = await request(app.getHttpServer())
        .get(`/workflows/runs/${runId}`)
        .set(auth())
        .expect(200);
      run = res.body;
      if (run.status === 'COMPLETED' || run.status === 'FAILED') {
        break;
      }
      await sleep(500);
    }

    // Run completed successfully.
    expect(run.status).toBe('COMPLETED');

    // One WorkflowStepRun per node, all COMPLETED.
    expect(Array.isArray(run.steps)).toBe(true);
    expect(run.steps.length).toBe(5);
    const types = run.steps.map((s: { type: string }) => s.type);
    expect(types).toEqual([
      'TRIGGER',
      'RETRIEVE',
      'AI_STEP',
      'TOOL_ACTION',
      'NOTIFY',
    ]);
    expect(
      run.steps.every((s: { status: string }) => s.status === 'COMPLETED'),
    ).toBe(true);

    // The AI_STEP produced non-empty output.
    const aiStep = run.steps.find((s: { type: string }) => s.type === 'AI_STEP');
    expect(typeof aiStep.output.text).toBe('string');
    expect(aiStep.output.text.length).toBeGreaterThan(0);

    // The TOOL_ACTION output shows the mock slack result.
    const toolStep = run.steps.find(
      (s: { type: string }) => s.type === 'TOOL_ACTION',
    );
    expect(toolStep.output.ok).toBe(true);
    expect(toolStep.output.skillKey).toBe('slack');
    expect(String(toolStep.output.result.id)).toMatch(/^mock_send_message_/);

    // Final context carries the outputKeys threaded through the run.
    expect(run.context).toBeTruthy();
    expect(run.context).toHaveProperty('retrieved');
    expect(run.context).toHaveProperty('aiText');
    expect(run.context).toHaveProperty('slackResult');
    expect(run.context.trigger.query).toBe('refund policy');
  }, 30_000);

  it('wrote a SkillExecution audit row for the slack tool action', async () => {
    const rows = await prisma.skillExecution.findMany({
      where: {
        companyId,
        skillKey: 'slack',
        tool: 'send_message',
        status: 'SUCCESS',
      },
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('lists runs for the workflow', async () => {
    const res = await request(app.getHttpServer())
      .get(`/workflows/${workflowId}/runs`)
      .set(auth())
      .expect(200);
    expect(res.body.some((r: { id: string }) => r.id === runId)).toBe(true);
  });

  it('rejects workflow routes without a token', async () => {
    await request(app.getHttpServer()).get('/workflows').expect(401);
  });
});
