import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Workflow AI generator e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `wf_gen_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let companyId = '';

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
      .send({ companyName: 'WF Gen E2E Co', name: 'WF Gen Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
    companyId = res.body.company.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('rejects a STARTER-plan company with 403', async () => {
    await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'automate my hiring' }] })
      .expect(403);
  });

  it('drafts a grounded workflow for a BUSINESS-plan company with an installed skill + hired employee, and creates zero rows', async () => {
    await prisma.subscription.update({ where: { companyId }, data: { plan: 'BUSINESS' } });

    await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'slack' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/employees')
      .set(auth())
      .send({ name: 'RecruitAI', role: 'RECRUITER' })
      .expect(201);

    const before = await prisma.workflow.count({ where: { companyId } });

    const res = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }] })
      .expect(201);

    expect(res.body.type).toBe('draft');
    expect(res.body.unresolvedNodes).toEqual([]);
    const toolAction = res.body.definition.nodes.find(
      (n: { type: string }) => n.type === 'TOOL_ACTION',
    );
    expect(toolAction.config.skillKey).toBe('slack');

    const after = await prisma.workflow.count({ where: { companyId } });
    expect(after).toBe(before);
  });

  it('asks a question then degrades gracefully when no skill is installed, still creating zero rows', async () => {
    const noSkillEmail = `wf_gen_e2e_noskill_${Date.now()}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'WF Gen No Skill Co', name: 'Owner', email: noSkillEmail, password })
      .expect(201);
    const token = reg.body.tokens.accessToken;
    const noSkillCompanyId = reg.body.company.id;
    await prisma.subscription.update({
      where: { companyId: noSkillCompanyId },
      data: { plan: 'BUSINESS' },
    });

    const first = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set({ Authorization: `Bearer ${token}` })
      .send({ messages: [{ role: 'user', content: 'automate my hiring' }] })
      .expect(201);
    expect(first.body.type).toBe('question');

    const second = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set({ Authorization: `Bearer ${token}` })
      .send({
        messages: [
          { role: 'user', content: 'automate my hiring' },
          { role: 'assistant', content: first.body.message },
          { role: 'user', content: 'just do something reasonable' },
        ],
      })
      .expect(201);
    expect(second.body.type).toBe('draft');
    expect(second.body.unresolvedNodes.length).toBeGreaterThan(0);

    const count = await prisma.workflow.count({ where: { companyId: noSkillCompanyId } });
    expect(count).toBe(0);
  });

  it('hands the accepted draft to the existing create endpoint end-to-end', async () => {
    const res = await request(app.getHttpServer())
      .post('/workflows/generate')
      .set(auth())
      .send({ messages: [{ role: 'user', content: 'notify recruiting on Slack for new hires' }] })
      .expect(201);

    await request(app.getHttpServer())
      .post('/workflows')
      .set(auth())
      .send({ name: 'AI-drafted workflow', definition: res.body.definition })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get('/workflows')
      .set(auth())
      .expect(200);
    expect(list.body.some((w: { name: string }) => w.name === 'AI-drafted workflow')).toBe(true);
  });
});
