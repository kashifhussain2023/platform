import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Employee Goals + configurable KPI targets e2e (P1 #6): needs a live Postgres +
// Redis. Skipped when DATABASE_URL is unset so it never blocks the build. Run:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   BILLING_PROVIDER=mock \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Employee Goals + KPI targets e2e (P1 #6)', () => {
  let app: INestApplication;
  const email = `goals_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let employeeId = '';
  let plainEmployeeId = '';

  const auth = () => ({ Authorization: `Bearer ${accessToken}` });

  const goals = ['Resolve 50 tickets/week', 'Escalate blockers same day'];
  const kpiTargets = { tasksPerWeek: 10, successRatePct: 90, approvalsMax: 3 };

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'Goals E2E Co', name: 'Goals Owner', email, password })
      .expect(201);
    accessToken = reg.body.tokens.accessToken;

    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'Goal Getter', role: 'SUPPORT', persona: 'Support agent.' })
      .expect(201);
    employeeId = emp.body.id;
    // Defaults: goals/kpiTargets are null until set.
    expect(emp.body.goals).toBeNull();
    expect(emp.body.kpiTargets).toBeNull();

    // A second employee left WITHOUT targets (asserts null-safe attainment).
    const plain = await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'No Targets', role: 'SALES' })
      .expect(201);
    plainEmployeeId = plain.body.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('PATCH /employees/:id accepts goals + kpiTargets and returns them', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set(auth())
      .send({ goals, kpiTargets })
      .expect(200);
    expect(res.body.goals).toEqual(goals);
    expect(res.body.kpiTargets).toEqual(kpiTargets);
  });

  it('GET /employees/:id reflects the persisted goals + kpiTargets', async () => {
    const res = await request(app.getHttpServer())
      .get(`/employees/${employeeId}`)
      .set(auth())
      .expect(200);
    expect(res.body.goals).toEqual(goals);
    expect(res.body.kpiTargets).toEqual(kpiTargets);
  });

  it('GET /analytics/employees row includes kpiTargets + computed attainment', async () => {
    const res = await request(app.getHttpServer())
      .get('/analytics/employees?range=all')
      .set(auth())
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);

    const row = res.body.find(
      (r: { employeeId: string }) => r.employeeId === employeeId,
    );
    expect(row).toBeTruthy();
    expect(row.kpiTargets).toEqual(kpiTargets);

    // Attainment is a null-safe object: tasks/approvals are 0% (no activity yet);
    // success rate is null because there are no tool actions to measure.
    expect(row.attainment).toBeTruthy();
    expect(row.attainment.tasksPct).toBe(0);
    expect(row.attainment.approvalsPct).toBe(0);
    expect(row.attainment.successRatePct).toBeNull();
    expect(row.attainment.successRateActual).toBeNull();

    // The employee with no targets has null kpiTargets + null attainment.
    const plainRow = res.body.find(
      (r: { employeeId: string }) => r.employeeId === plainEmployeeId,
    );
    expect(plainRow).toBeTruthy();
    expect(plainRow.kpiTargets).toBeNull();
    expect(plainRow.attainment).toBeNull();
  });

  it('can clear kpiTargets with an explicit null', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/employees/${employeeId}`)
      .set(auth())
      .send({ kpiTargets: null })
      .expect(200);
    expect(res.body.kpiTargets).toBeNull();
    // goals are untouched by a kpiTargets-only patch.
    expect(res.body.goals).toEqual(goals);
  });
});
