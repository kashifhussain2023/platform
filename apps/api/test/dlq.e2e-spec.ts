import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { Queue, Worker } from 'bullmq';
import type { DlqJobDto } from '@vaep/types';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { DLQ_TEST_QUEUE } from '../src/common/resilience/dlq.constants';
import { redisConnectionFromUrl } from '../src/common/resilience/redis-connection';

// Dead-letter queue (Unit C, docs §4.4) e2e: enqueue a deliberately-failing,
// company-scoped job on a dedicated test queue so it lands in BullMQ's failed
// set (= our DLQ), then exercise the admin endpoints (list/replay/discard) with
// tenant scoping + RBAC. Needs Postgres + Redis; skipped when DATABASE_URL is
// unset. Run the whole suite with:
//   SKILL_EXECUTOR=mock BILLING_PROVIDER=mock EMBEDDINGS_PROVIDER=hash \
//   LLM_PROVIDER=mock STORAGE_PROVIDER=local ENCRYPTION_KEY=<64hex> \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
  stepMs = 150,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(stepMs);
  }
  return false;
}

describeIfDb('DLQ admin e2e (list / replay / discard, company-scoped + RBAC)', () => {
  let app: INestApplication;
  const ts = Date.now();
  const ownerEmail = `dlq_owner_${ts}@example.com`;
  const memberEmail = `dlq_member_${ts}@example.com`;
  const password = 'password123';
  const memberPassword = 'memberpass123';

  let ownerToken = '';
  let memberToken = '';
  let companyId = '';

  const marker = `dlq-e2e-${ts}`;
  const otherMarker = `dlq-e2e-other-${ts}`;
  let ourJobId = '';
  let otherJobId = '';

  // A test-owned queue + worker that ALWAYS fails, so jobs land in the DLQ. The
  // worker also counts processings so we can prove a replay re-attempts the job.
  type TestJob = { companyId: string; marker: string };
  let queue: Queue<TestJob>;
  let worker: Worker<TestJob, void>;
  let processedCount = 0;

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    expect(app.get(PrismaService)).toBeTruthy();

    // OWNER + a MEMBER (for the 403 check).
    const reg = await request(server())
      .post('/auth/register')
      .send({ companyName: 'DLQ E2E Co', name: 'DLQ Owner', email: ownerEmail, password })
      .expect(201);
    ownerToken = reg.body.tokens.accessToken;
    companyId = reg.body.company.id;

    await request(server())
      .post('/users')
      .set(bearer(ownerToken))
      .send({ email: memberEmail, name: 'DLQ Member', role: 'MEMBER', password: memberPassword })
      .expect(201);
    const login = await request(server())
      .post('/auth/login')
      .send({ email: memberEmail, password: memberPassword })
      .expect(201);
    memberToken = login.body.tokens.accessToken;

    // Stand up the deliberately-failing test queue + worker.
    const connection = {
      ...redisConnectionFromUrl(process.env.REDIS_URL as string),
      maxRetriesPerRequest: null,
    };
    queue = new Queue<TestJob>(DLQ_TEST_QUEUE, { connection });
    worker = new Worker<TestJob, void>(
      DLQ_TEST_QUEUE,
      async (): Promise<void> => {
        processedCount += 1;
        throw new Error('deliberate DLQ failure');
      },
      { connection },
    );

    // Enqueue one company-scoped job (attempts:1 → straight to the failed set)
    // and one belonging to a DIFFERENT company (must be filtered out).
    const jobOpts = {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: { count: 100 },
    };
    const ourJob = await queue.add('boom', { companyId, marker }, jobOpts);
    ourJobId = String(ourJob.id);
    const otherJob = await queue.add(
      'boom',
      { companyId: `other_${ts}`, marker: otherMarker },
      jobOpts,
    );
    otherJobId = String(otherJob.id);

    // Wait until both jobs have failed (are in the DLQ).
    const failed = await waitFor(async () => (await queue.getFailedCount()) >= 2);
    expect(failed).toBe(true);
  }, 30_000);

  afterAll(async () => {
    await worker?.close();
    await queue?.close();
    await app?.close();
  });

  it('unauthenticated → 401; MEMBER → 403 (OWNER/ADMIN only)', async () => {
    await request(server()).get('/admin/dlq').expect(401);
    await request(server())
      .get('/admin/dlq')
      .set(bearer(memberToken))
      .expect(403);
    await request(server())
      .post(`/admin/dlq/${DLQ_TEST_QUEUE}/${ourJobId}/replay`)
      .set(bearer(memberToken))
      .expect(403);
  });

  it('GET /admin/dlq?queue= lists the failed job, company-scoped (other tenant hidden)', async () => {
    const res = await request(server())
      .get(`/admin/dlq?queue=${DLQ_TEST_QUEUE}`)
      .set(bearer(ownerToken))
      .expect(200);

    const jobs = res.body as DlqJobDto[];
    expect(Array.isArray(jobs)).toBe(true);

    const ours = jobs.find((j) => j.id === ourJobId);
    expect(ours).toBeDefined();
    expect(ours?.queue).toBe(DLQ_TEST_QUEUE);
    expect(ours?.companyId).toBe(companyId);
    expect(ours?.attemptsMade).toBeGreaterThanOrEqual(1);
    expect(ours?.failedReason).toContain('deliberate DLQ failure');
    expect((ours?.data as { marker?: string })?.marker).toBe(marker);

    // The other company's failed job must NOT be visible to this tenant.
    expect(jobs.some((j) => j.id === otherJobId)).toBe(false);
  });

  it('rejects an unknown queue name with 400', async () => {
    await request(server())
      .get('/admin/dlq?queue=not-a-real-queue')
      .set(bearer(ownerToken))
      .expect(400);
  });

  it('POST replay re-attempts the job; cross-tenant replay → 404', async () => {
    // Replaying another tenant's job is indistinguishable from "not found".
    await request(server())
      .post(`/admin/dlq/${DLQ_TEST_QUEUE}/${otherJobId}/replay`)
      .set(bearer(ownerToken))
      .expect(404);

    const before = processedCount;
    const res = await request(server())
      .post(`/admin/dlq/${DLQ_TEST_QUEUE}/${ourJobId}/replay`)
      .set(bearer(ownerToken))
      .expect(200);
    expect(res.body.replayed).toBe(true);

    // The worker processes the job again (it fails again → back in the DLQ).
    const reattempted = await waitFor(async () => processedCount > before);
    expect(reattempted).toBe(true);
    const backInDlq = await waitFor(async () => {
      const job = await queue.getJob(ourJobId);
      return (await job?.getState()) === 'failed';
    });
    expect(backInDlq).toBe(true);
  }, 30_000);

  it('DELETE discards the job (cross-tenant discard → 404)', async () => {
    await request(server())
      .delete(`/admin/dlq/${DLQ_TEST_QUEUE}/${otherJobId}`)
      .set(bearer(ownerToken))
      .expect(404);

    await request(server())
      .delete(`/admin/dlq/${DLQ_TEST_QUEUE}/${ourJobId}`)
      .set(bearer(ownerToken))
      .expect(200);

    const gone = await waitFor(async () => (await queue.getJob(ourJobId)) === undefined);
    expect(gone).toBe(true);

    const res = await request(server())
      .get(`/admin/dlq?queue=${DLQ_TEST_QUEUE}`)
      .set(bearer(ownerToken))
      .expect(200);
    expect((res.body as DlqJobDto[]).some((j) => j.id === ourJobId)).toBe(false);
  }, 30_000);

  it('GET /admin/circuit is reachable for OWNER (empty is fine)', async () => {
    const res = await request(server())
      .get('/admin/circuit')
      .set(bearer(ownerToken))
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /admin/dlq/summary returns per-queue company-scoped counts (OWNER); MEMBER 403', async () => {
    await request(server())
      .get('/admin/dlq/summary')
      .set(bearer(memberToken))
      .expect(403);

    const res = await request(server())
      .get('/admin/dlq/summary')
      .set(bearer(ownerToken))
      .expect(200);

    const summary = res.body as { queue: string; failed: number }[];
    expect(Array.isArray(summary)).toBe(true);
    // Known queues are reported with numeric (bounded, company-scoped) counts.
    expect(summary.length).toBeGreaterThan(0);
    for (const entry of summary) {
      expect(typeof entry.queue).toBe('string');
      expect(typeof entry.failed).toBe('number');
      expect(entry.failed).toBeGreaterThanOrEqual(0);
    }
  });
});
