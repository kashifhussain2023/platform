import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Full agent-loop e2e: needs a live Postgres + Redis. Skipped when DATABASE_URL
// is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// A distinctive company fact so the hash-embedding retrieval clearly matches.
const DOC_TEXT = [
  'Acme Corp refund policy: customers may request a full refund within 30 days',
  'of purchase. To start a refund, customers contact the support team and',
  'provide their order number. Refunds are processed within five business days.',
].join(' ');

describeIfDb('Employees e2e (upload -> employee -> chat -> pause 409)', () => {
  let app: INestApplication;
  const email = `emp_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let documentId = '';
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

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'Emp E2E Co', name: 'Emp Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads and ingests a knowledge document to READY', async () => {
    const upload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth())
      .attach('file', Buffer.from(DOC_TEXT, 'utf8'), {
        filename: 'refund-policy.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    documentId = upload.body.id;

    const deadline = Date.now() + 25_000;
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
  }, 35_000);

  it('creates a SUPPORT employee and starts a conversation', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Ada', role: 'SUPPORT', persona: 'Friendly support agent.' })
      .expect(201);
    expect(emp.body.id).toBeTruthy();
    expect(emp.body.role).toBe('SUPPORT');
    expect(emp.body.status).toBe('ACTIVE');
    employeeId = emp.body.id;

    const conv = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/conversations`)
      .set(auth())
      .send({ title: 'Refund question' })
      .expect(201);
    expect(conv.body.id).toBeTruthy();
    expect(conv.body.employeeId).toBe(employeeId);
    conversationId = conv.body.id;
  });

  it('runs the agent loop and returns a grounded RunResultDto', async () => {
    const res = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth())
      .send({
        content:
          'What is the refund policy and how many days do customers have to request a refund?',
      })
      .expect(201);

    const result = res.body;

    // Non-empty assistant message.
    expect(result.message).toBeTruthy();
    expect(result.message.role).toBe('ASSISTANT');
    expect(typeof result.message.content).toBe('string');
    expect(result.message.content.length).toBeGreaterThan(0);

    // At least one source, citing the uploaded document.
    expect(Array.isArray(result.sources)).toBe(true);
    expect(result.sources.length).toBeGreaterThanOrEqual(1);
    expect(result.sources.some((s: { documentId: string }) => s.documentId === documentId)).toBe(true);

    // A non-empty plan.
    expect(Array.isArray(result.plan)).toBe(true);
    expect(result.plan.length).toBeGreaterThan(0);

    // A validation verdict object.
    expect(result.validation).toBeTruthy();
    expect(typeof result.validation.grounded).toBe('boolean');
    expect(typeof result.validation.confidence).toBe('number');
    expect(typeof result.validation.needsApproval).toBe('boolean');

    // Metadata persisted on the assistant message mirrors the run result.
    expect(result.message.metadata).toBeTruthy();
    expect(result.message.metadata.sources.length).toBeGreaterThanOrEqual(1);
  });

  it('persists the conversation history (user + assistant turns)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/conversations/${conversationId}/messages`)
      .set(auth())
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    expect(res.body[0].role).toBe('USER');
    expect(res.body[res.body.length - 1].role).toBe('ASSISTANT');
  });

  it('rejects messages once the employee is PAUSED (409)', async () => {
    await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set(auth())
      .send({ status: 'PAUSED' })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth())
      .send({ content: 'Are you still there?' })
      .expect(409);
  });

  it('rejects employee routes without a token', async () => {
    await request(app.getHttpServer()).get('/employees').expect(401);
  });
});
