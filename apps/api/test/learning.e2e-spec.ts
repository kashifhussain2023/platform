import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Continuous Learning (Step 15) e2e: needs a live Postgres + Redis. Skipped when
// DATABASE_URL is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const CORRECTION = 'Always address candidates formally';
const TAUGHT_FACT = 'HQ is in Delhi';

describeIfDb('Learning e2e (feedback -> memory -> curate -> summary)', () => {
  let app: INestApplication;
  const email = `learn_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let employeeId = '';
  let conversationId = '';
  let messageId = '';
  let taughtMemoryId = '';

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
      .send({ companyName: 'Learn E2E Co', name: 'Learn Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a RECRUITER employee, a conversation and an assistant message', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Rhea', role: 'RECRUITER', persona: 'Recruiting assistant.' })
      .expect(201);
    employeeId = emp.body.id;

    const conv = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/conversations`)
      .set(auth())
      .send({ title: 'Screening' })
      .expect(201);
    conversationId = conv.body.id;

    const run = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth())
      .send({ content: 'Draft an outreach note to a candidate.' })
      .expect(201);
    expect(run.body.message.role).toBe('ASSISTANT');
    messageId = run.body.message.id;
    expect(messageId).toBeTruthy();
  });

  it('submits 👎 feedback with a correction that becomes a FACT memory', async () => {
    const fb = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/feedback`)
      .set(auth())
      .send({
        conversationId,
        messageId,
        rating: 'DOWN',
        correction: CORRECTION,
        teach: true,
      })
      .expect(201);
    expect(fb.body.id).toBeTruthy();
    expect(fb.body.rating).toBe('DOWN');
    expect(fb.body.correction).toBe(CORRECTION);

    // The correction is promoted to a durable FACT memory (source FEEDBACK).
    const mems = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/memories`)
      .set(auth())
      .expect(200);
    const learned = mems.body.find(
      (m: { content: string }) => m.content === CORRECTION,
    );
    expect(learned).toBeTruthy();
    expect(learned.kind).toBe('FACT');
    expect(learned.source).toBe('FEEDBACK');
  });

  it('lists feedback (newest first) including the submitted 👎', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/feedback`)
      .set(auth())
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0].rating).toBe('DOWN');
    expect(res.body[0].correction).toBe(CORRECTION);
  });

  it('manually teaches a FACT memory and finds it in the list', async () => {
    const created = await request(app.getHttpServer())
      .post(`/employees/${employeeId}/memories`)
      .set(auth())
      .send({ kind: 'FACT', content: TAUGHT_FACT })
      .expect(201);
    expect(created.body.source).toBe('MANUAL');
    taughtMemoryId = created.body.id;

    const mems = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/memories`)
      .set(auth())
      .expect(200);
    expect(
      mems.body.some((m: { id: string }) => m.id === taughtMemoryId),
    ).toBe(true);
  });

  it('forgets the taught memory (tenant-checked) and it is gone', async () => {
    await request(app.getHttpServer())
      .delete(`/employees/${employeeId}/memories/${taughtMemoryId}`)
      .set(auth())
      .expect(204);

    const mems = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/memories`)
      .set(auth())
      .expect(200);
    expect(
      mems.body.some((m: { id: string }) => m.id === taughtMemoryId),
    ).toBe(false);
  });

  it('reports a learning summary (down >= 1, memories total >= 1)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees/${employeeId}/learning`)
      .set(auth())
      .expect(200);
    expect(res.body.feedback.down).toBeGreaterThanOrEqual(1);
    expect(res.body.feedback.total).toBeGreaterThanOrEqual(1);
    // The FEEDBACK-derived FACT memory (and any run SUMMARYs) remain.
    expect(res.body.memories.total).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.recentFeedback)).toBe(true);
    expect(res.body.recentFeedback.length).toBeGreaterThanOrEqual(1);
  });

  it('rejects learning routes without a token (401)', async () => {
    await request(app.getHttpServer())
      .get(`/employees/${employeeId}/learning`)
      .expect(401);
  });
});
