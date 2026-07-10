import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { WorkflowsService } from '../src/modules/workflows/workflows.service';

// EVENT condition DSL + event→run correlation/lineage e2e (Unit D). Needs a live
// Postgres + Redis (BullMQ). Skipped when DATABASE_URL is unset so it never blocks
// builds. Run with:
//   SKILL_EXECUTOR=mock LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   ENCRYPTION_KEY=<64hex> \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A runnable linear definition: TRIGGER -> AI_STEP -> NOTIFY (no external deps). */
const RUNNABLE_DEFINITION = {
  nodes: [
    { id: 'n1', type: 'TRIGGER', config: {} },
    {
      id: 'n2',
      type: 'AI_STEP',
      config: { prompt: 'Acknowledge the payload.', outputKey: 'aiText' },
    },
    { id: 'n3', type: 'NOTIFY', config: { message: 'Done: {{aiText}}' } },
  ],
  edges: [
    { from: 'n1', to: 'n2' },
    { from: 'n2', to: 'n3' },
  ],
};

describeIfDb('Workflow EVENT condition DSL + correlation/lineage e2e', () => {
  jest.setTimeout(60_000);

  let app: INestApplication;
  let prisma: PrismaService;
  let workflows: WorkflowsService;
  const email = `wf_cond_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';
  let filteredWorkflowId = '';
  let openWorkflowId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });
  const server = () => app.getHttpServer();

  /** Create a runnable workflow, PATCH its trigger, then activate it. */
  async function createActiveEvent(
    name: string,
    triggerConfig: Record<string, unknown>,
  ): Promise<string> {
    const created = await request(server())
      .post('/workflows')
      .set(auth())
      .send({ name, definition: RUNNABLE_DEFINITION })
      .expect(201);
    const id = created.body.id;
    await request(server())
      .patch(`/workflows/${id}`)
      .set(auth())
      .send({ triggerType: 'EVENT', triggerConfig })
      .expect(200);
    const activated = await request(server())
      .post(`/workflows/${id}/activate`)
      .set(auth())
      .expect(200);
    expect(activated.body.status).toBe('ACTIVE');
    return id;
  }

  /** Poll a run to a terminal state; returns the final run body. */
  async function pollRun(runId: string, timeoutMs = 25_000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    let run: any = {};
    while (Date.now() < deadline) {
      const res = await request(server())
        .get(`/workflows/runs/${runId}`)
        .set(auth())
        .expect(200);
      run = res.body;
      if (run.status === 'COMPLETED' || run.status === 'FAILED') break;
      await sleep(300);
    }
    return run;
  }

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = app.get(PrismaService);
    workflows = app.get(WorkflowsService);

    const reg = await request(server())
      .post('/auth/register')
      .send({ companyName: 'WF Cond Co', name: 'Cond Owner', email, password })
      .expect(201);
    accessToken = reg.body.tokens.accessToken;
    companyId = reg.body.company.id;

    // A NEW_PAYMENT workflow that fires only when data.amount > 1000.
    filteredWorkflowId = await createActiveEvent('Big payments only', {
      eventType: 'NEW_PAYMENT',
      conditions: [{ path: 'data.amount', op: 'gt', value: 1000 }],
    });
    // A NEW_SIGNUP workflow with NO conditions (back-compat: always fires).
    openWorkflowId = await createActiveEvent('Every signup', {
      eventType: 'NEW_SIGNUP',
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects an unknown condition operator with 400', async () => {
    await request(server())
      .patch(`/workflows/${filteredWorkflowId}`)
      .set(auth())
      .send({
        triggerType: 'EVENT',
        triggerConfig: {
          eventType: 'NEW_PAYMENT',
          conditions: [{ path: 'data.amount', op: 'bogus', value: 1 }],
        },
      })
      .expect(400);
  });

  it('a failing condition (amount 500) fires 0 runs', async () => {
    const fired = await request(server())
      .post('/workflows/events')
      .set(auth())
      .send({ eventType: 'NEW_PAYMENT', payload: { data: { amount: 500 } } })
      .expect(200);
    expect(fired.body.count).toBe(0);
    expect(fired.body.runIds).toEqual([]);

    // Give any (erroneous) enqueue a moment, then confirm no EVENT run exists.
    await sleep(500);
    const runs = await request(server())
      .get(`/workflows/${filteredWorkflowId}/runs`)
      .set(auth())
      .expect(200);
    expect(
      (runs.body ?? []).filter((r: { source: string }) => r.source === 'EVENT')
        .length,
    ).toBe(0);
  });

  it('a passing condition (amount 2000) fires exactly 1 run with a correlationId', async () => {
    const fired = await request(server())
      .post('/workflows/events')
      .set(auth())
      .send({ eventType: 'NEW_PAYMENT', payload: { data: { amount: 2000 } } })
      .expect(200);
    expect(fired.body.count).toBe(1);
    expect(fired.body.runIds.length).toBe(1);

    const run = await pollRun(fired.body.runIds[0]);
    expect(run.status).toBe('COMPLETED');
    expect(run.source).toBe('EVENT');
    // Manual fire (no eventId in payload) → generated correlationId, null triggerEventId.
    expect(typeof run.correlationId).toBe('string');
    expect(run.correlationId.length).toBeGreaterThan(0);
    expect(run.triggerEventId).toBeNull();
  });

  it('an EVENT workflow with NO conditions still fires (back-compat)', async () => {
    const fired = await request(server())
      .post('/workflows/events')
      .set(auth())
      .send({ eventType: 'NEW_SIGNUP', payload: { plan: 'PRO' } })
      .expect(200);
    expect(fired.body.count).toBe(1);
    expect(fired.body.runIds.length).toBe(1);

    const run = await pollRun(fired.body.runIds[0]);
    expect(run.status).toBe('COMPLETED');
    void openWorkflowId; // referenced for clarity; matched by eventType above.
  });

  it('a canonical-event fire sets triggerEventId/correlationId and lineage returns the run', async () => {
    // A real CanonicalEvent row (as the normalization pipeline would produce) so
    // the lineage endpoint can resolve it. Its id becomes the correlation key.
    const canonical = await prisma.canonicalEvent.create({
      data: {
        companyId,
        connectorId: 'con_lineage_test',
        provider: 'stripe',
        type: 'NEW_PAYMENT',
        dedupeKey: `test:lineage:${Date.now()}`,
        subject: { type: 'payment' },
        data: { amount: 2000, currency: 'USD' },
      },
    });

    // Drive fireEvent exactly as the EventNormalizeProcessor does.
    const result = await workflows.fireEvent(companyId, 'NEW_PAYMENT', {
      eventId: canonical.id,
      subject: canonical.subject,
      data: canonical.data,
    });
    expect(result.count).toBe(1);
    const runId = result.runIds[0];

    const run = await pollRun(runId);
    expect(run.status).toBe('COMPLETED');
    expect(run.triggerEventId).toBe(canonical.id);
    expect(run.correlationId).toBe(canonical.id);

    // Lineage endpoint: the canonical event + the run(s) it triggered.
    const lineage = await request(server())
      .get(`/events/canonical/${canonical.id}/lineage`)
      .set(auth())
      .expect(200);
    expect(lineage.body.event.id).toBe(canonical.id);
    expect(lineage.body.event.type).toBe('NEW_PAYMENT');
    expect(Array.isArray(lineage.body.runs)).toBe(true);
    const linked = lineage.body.runs.find(
      (r: { id: string }) => r.id === runId,
    );
    expect(linked).toBeTruthy();
    expect(linked.triggerEventId).toBe(canonical.id);
    expect(linked.correlationId).toBe(canonical.id);
    // Step summary is included on lineage runs.
    expect(Array.isArray(linked.steps)).toBe(true);
    expect(linked.steps.length).toBeGreaterThan(0);
  });

  it('lineage for an unknown canonical id returns 404', async () => {
    await request(server())
      .get('/events/canonical/does-not-exist/lineage')
      .set(auth())
      .expect(404);
  });

  it('lineage requires auth (401 without a token)', async () => {
    await request(server())
      .get('/events/canonical/whatever/lineage')
      .expect(401);
  });
});
