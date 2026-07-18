import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Needs a live Postgres + Redis, same convention as knowledge.e2e-spec.ts / employees.e2e-spec.ts.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SALES_TEXT = [
  'Acme Sales playbook: our enterprise discount is 15 percent for annual contracts',
  'over fifty seats. Sales reps should always mention the onboarding concierge.',
].join(' ');
const HR_TEXT = [
  'Acme HR payroll policy: salaries are reviewed every March and paid on the last',
  'business day of each month via direct deposit.',
].join(' ');

describeIfDb('Knowledge role scoping e2e (Sales employee never sees HR docs)', () => {
  let app: INestApplication;
  const email = `kb_scope_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  const auth: Record<string, string> = {};
  let salesEmployeeId = '';
  let conversationId = '';
  let salesDocId = '';
  let hrDocId = '';

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
      .send({ companyName: 'KB Scope E2E Co', name: 'Owner', email, password })
      .expect(201);
    auth.Authorization = `Bearer ${res.body.tokens.accessToken}`;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uploads and ingests a SALES document and an HR document', async () => {
    const salesUpload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth)
      .field('category', 'SALES')
      .attach('file', Buffer.from(SALES_TEXT, 'utf8'), {
        filename: 'sales-playbook.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    salesDocId = salesUpload.body.id;

    const hrUpload = await request(app.getHttpServer())
      .post('/knowledge/documents')
      .set(auth)
      .field('category', 'HR')
      .attach('file', Buffer.from(HR_TEXT, 'utf8'), {
        filename: 'payroll-policy.txt',
        contentType: 'text/plain',
      })
      .expect(201);
    hrDocId = hrUpload.body.id;

    const deadline = Date.now() + 30_000;
    let salesReady = false;
    let hrReady = false;
    while (Date.now() < deadline && !(salesReady && hrReady)) {
      const [salesRes, hrRes] = await Promise.all([
        request(app.getHttpServer()).get(`/knowledge/documents/${salesDocId}`).set(auth),
        request(app.getHttpServer()).get(`/knowledge/documents/${hrDocId}`).set(auth),
      ]);
      salesReady = salesRes.body.status === 'READY';
      hrReady = hrRes.body.status === 'READY';
      if (!salesReady || !hrReady) await sleep(500);
    }
    expect(salesReady).toBe(true);
    expect(hrReady).toBe(true);
  }, 35_000);

  it('creates a SALES employee and asks about the payroll policy', async () => {
    const emp = await request(app.getHttpServer())
      .post('/employees')
      .set(auth)
      .send({ name: 'Sasha', role: 'SALES', persona: 'Enterprise sales rep.' })
      .expect(201);
    salesEmployeeId = emp.body.id;

    const conv = await request(app.getHttpServer())
      .post(`/employees/${salesEmployeeId}/conversations`)
      .set(auth)
      .send({ title: 'Payroll question' })
      .expect(201);
    conversationId = conv.body.id;

    const res = await request(app.getHttpServer())
      .post(`/conversations/${conversationId}/messages`)
      .set(auth)
      .send({ content: 'When are salaries reviewed and how are they paid out?' })
      .expect(201);

    // The SALES employee must never surface the HR-only document as a source.
    const sourceDocIds = (res.body.sources as { documentId: string }[]).map((s) => s.documentId);
    expect(sourceDocIds).not.toContain(hrDocId);
  });

  it('the same SALES employee CAN surface the SALES document', async () => {
    const conv = await request(app.getHttpServer())
      .post(`/employees/${salesEmployeeId}/conversations`)
      .set(auth)
      .send({ title: 'Discount question' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post(`/conversations/${conv.body.id}/messages`)
      .set(auth)
      .send({ content: 'What is our enterprise discount for annual contracts over fifty seats?' })
      .expect(201);

    const sourceDocIds = (res.body.sources as { documentId: string }[]).map((s) => s.documentId);
    expect(sourceDocIds).toContain(salesDocId);
  });
});
