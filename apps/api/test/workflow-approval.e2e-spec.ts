import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Workflow-level APPROVAL node e2e: needs a live Postgres + Redis (BullMQ).
// Skipped when DATABASE_URL is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface StepRow {
  type: string;
  status: string;
}
interface RunBody {
  id: string;
  status: string;
  error: string | null;
  steps?: StepRow[];
}

describeIfDb('Workflow APPROVAL node e2e (pause → approve/reject)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `wf_approval_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';
  let workflowId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  /** GET a run (with its steps). */
  const getRun = async (runId: string): Promise<RunBody> => {
    const res = await request(app.getHttpServer())
      .get(`/workflows/runs/${runId}`)
      .set(auth())
      .expect(200);
    return res.body as RunBody;
  };

  /** Start a run and poll until it reaches WAITING (or a terminal state). */
  const runToWaiting = async (): Promise<RunBody> => {
    const start = await request(app.getHttpServer())
      .post(`/workflows/${workflowId}/run`)
      .set(auth())
      .send({ trigger: { topic: 'quarterly report' } })
      .expect(201);
    const runId = start.body.id as string;

    const deadline = Date.now() + 20_000;
    let run = start.body as RunBody;
    while (Date.now() < deadline) {
      run = await getRun(runId);
      if (
        run.status === 'WAITING' ||
        run.status === 'COMPLETED' ||
        run.status === 'FAILED'
      ) {
        break;
      }
      await sleep(300);
    }
    return run;
  };

  /** Poll a run until it reaches a terminal state (COMPLETED/FAILED). */
  const pollTerminal = async (runId: string): Promise<RunBody> => {
    const deadline = Date.now() + 20_000;
    let run = await getRun(runId);
    while (Date.now() < deadline) {
      run = await getRun(runId);
      if (run.status === 'COMPLETED' || run.status === 'FAILED') {
        break;
      }
      await sleep(300);
    }
    return run;
  };

  /** The PENDING WORKFLOW-kind ApprovalRequest for a given run. */
  const pendingWorkflowApproval = (runId: string) =>
    prisma.approvalRequest.findFirst({
      where: { companyId, workflowRunId: runId, status: 'PENDING' },
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

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        companyName: 'WF Approval E2E Co',
        name: 'WF Approval Owner',
        email,
        password,
      })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('creates a workflow TRIGGER -> AI_STEP -> APPROVAL -> NOTIFY', async () => {
    const definition = {
      nodes: [
        { id: 'n1', type: 'TRIGGER', config: {} },
        {
          id: 'n2',
          type: 'AI_STEP',
          config: {
            prompt: 'Draft an update about {{trigger.topic}}',
            outputKey: 'aiText',
          },
        },
        {
          id: 'n3',
          type: 'APPROVAL',
          config: { message: 'Approve the drafted update before it is sent.' },
        },
        {
          id: 'n4',
          type: 'NOTIFY',
          config: { message: 'Sent the approved update: {{aiText}}' },
        },
      ],
      edges: [
        { from: 'n1', to: 'n2' },
        { from: 'n2', to: 'n3' },
        { from: 'n3', to: 'n4' },
      ],
    };

    const res = await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({ name: 'Approval-gated update', definition })
      .expect(201);

    expect(res.body.id).toBeTruthy();
    expect(res.body.definition.nodes.length).toBe(4);
    expect(
      res.body.definition.nodes.some(
        (n: { type: string }) => n.type === 'APPROVAL',
      ),
    ).toBe(true);
    workflowId = res.body.id;
  });

  it('pauses at APPROVAL (WAITING) with a PENDING approval; NOTIFY has not run', async () => {
    const run = await runToWaiting();

    // Paused, NOT completed.
    expect(run.status).toBe('WAITING');

    const steps = run.steps ?? [];
    const types = steps.map((s) => s.type);
    // TRIGGER + AI_STEP ran and completed; APPROVAL is the paused marker.
    expect(types).toContain('TRIGGER');
    expect(types).toContain('AI_STEP');
    expect(types).toContain('APPROVAL');
    // Crucially, the step AFTER the approval has NOT run yet.
    expect(types).not.toContain('NOTIFY');
    const aiStep = steps.find((s) => s.type === 'AI_STEP');
    expect(aiStep?.status).toBe('COMPLETED');

    // A PENDING WORKFLOW-kind approval was opened for this run.
    const approval = await pendingWorkflowApproval(run.id);
    expect(approval).toBeTruthy();
    expect(approval?.kind).toBe('WORKFLOW');
    expect(approval?.workflowRunId).toBe(run.id);
    expect(approval?.skillKey).toBeNull();
    expect(approval?.tool).toBeNull();

    // It also surfaces in the Approval Center list.
    const list = await request(app.getHttpServer())
      .get('/approvals?status=PENDING')
      .set(auth())
      .expect(200);
    const listed = list.body.find(
      (r: { id: string }) => r.id === approval!.id,
    );
    expect(listed).toBeTruthy();
    expect(listed.kind).toBe('WORKFLOW');
    expect(listed.workflowRunId).toBe(run.id);
  }, 30_000);

  it('resumes to COMPLETED on approve; NOTIFY then runs', async () => {
    const run = await runToWaiting();
    expect(run.status).toBe('WAITING');
    const approval = await pendingWorkflowApproval(run.id);
    expect(approval).toBeTruthy();

    // Approve → resumes the run (no tool executed).
    const approved = await request(app.getHttpServer())
      .post(`/approvals/${approval!.id}/approve`)
      .set(auth())
      .send({})
      .expect(201);
    expect(approved.body.status).toBe('APPROVED');
    expect(approved.body.result).toBeNull();
    expect(approved.body.decidedById).toBeTruthy();

    const done = await pollTerminal(run.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.error).toBeFalsy();

    const steps = done.steps ?? [];
    // NOTIFY (the step after the approval) ran and completed.
    const notify = steps.find((s) => s.type === 'NOTIFY');
    expect(notify).toBeTruthy();
    expect(notify?.status).toBe('COMPLETED');
    // The APPROVAL step is now completed too.
    const approvalStep = steps.find((s) => s.type === 'APPROVAL');
    expect(approvalStep?.status).toBe('COMPLETED');
  }, 40_000);

  it('fails the run on reject and never runs NOTIFY', async () => {
    const run = await runToWaiting();
    expect(run.status).toBe('WAITING');
    const approval = await pendingWorkflowApproval(run.id);
    expect(approval).toBeTruthy();

    // Reject → the run is cancelled (FAILED) and the post-approval step never runs.
    const rejected = await request(app.getHttpServer())
      .post(`/approvals/${approval!.id}/reject`)
      .set(auth())
      .send({ note: 'Not this time' })
      .expect(201);
    expect(rejected.body.status).toBe('REJECTED');

    const done = await pollTerminal(run.id);
    expect(done.status).toBe('FAILED');
    const steps = done.steps ?? [];
    expect(steps.map((s) => s.type)).not.toContain('NOTIFY');
  }, 40_000);

  it('rejects workflow-approval routes without a token', async () => {
    await request(app.getHttpServer()).get('/approvals').expect(401);
  });
});
