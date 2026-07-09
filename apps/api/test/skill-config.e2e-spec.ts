import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

// Skill configuration + connection e2e: needs a live Postgres + Redis. Skipped
// when DATABASE_URL is unset so it never blocks the build. Run it with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Skill config + connection e2e', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const email = `skill_cfg_e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';
  let installedSkillId = '';

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
      .send({ companyName: 'Skill Cfg Co', name: 'Cfg Owner', email, password })
      .expect(201);
    accessToken = res.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('catalog exposes connection + configSchema (incl. new oauth skills)', async () => {
    const res = await request(app.getHttpServer())
      .get('/skills/catalog')
      .set(auth())
      .expect(200);

    const stripe = res.body.find((s: { key: string }) => s.key === 'stripe');
    expect(stripe.connection.type).toBe('api_key');
    expect(Array.isArray(stripe.configSchema)).toBe(true);
    const currency = stripe.configSchema.find(
      (f: { key: string }) => f.key === 'currency',
    );
    expect(currency.type).toBe('select');
    expect(currency.options).toEqual(
      expect.arrayContaining(['usd', 'eur', 'gbp', 'inr']),
    );

    const keys = res.body.map((s: { key: string }) => s.key);
    expect(keys).toEqual(
      expect.arrayContaining(['gmail', 'hubspot', 'jira', 'calendar', 'gdrive']),
    );
    const gmail = res.body.find((s: { key: string }) => s.key === 'gmail');
    expect(gmail.connection.type).toBe('oauth');
  });

  it('installs stripe → NOT_CONNECTED, no credentials leaked', async () => {
    const install = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'stripe' })
      .expect(201);
    installedSkillId = install.body.id;
    expect(install.body.connectionStatus).toBe('NOT_CONNECTED');
    expect(install.body.connectionType).toBe('api_key');
    expect(install.body.credentialsSet).toBe(false);

    const list = await request(app.getHttpServer())
      .get('/skills/installed')
      .set(auth())
      .expect(200);
    const row = list.body.find((s: { id: string }) => s.id === installedSkillId);
    expect(row.connectionStatus).toBe('NOT_CONNECTED');
    expect(row).not.toHaveProperty('credentials');
  });

  it('connects with an API key → CONNECTED, raw key never returned', async () => {
    const res = await request(app.getHttpServer())
      .post(`/skills/installed/${installedSkillId}/connect`)
      .set(auth())
      .send({ credentials: { apiKey: 'sk_test_x' } })
      .expect(201);
    expect(res.body.connectionStatus).toBe('CONNECTED');
    expect(res.body.credentialsSet).toBe(true);
    // The raw secret must never appear in the response body.
    expect(JSON.stringify(res.body)).not.toContain('sk_test_x');
    expect(res.body).not.toHaveProperty('credentials');

    const list = await request(app.getHttpServer())
      .get('/skills/installed')
      .set(auth())
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain('sk_test_x');

    // But the secret IS persisted (just not exposed).
    const dbRow = await prisma.installedSkill.findUnique({
      where: { id: installedSkillId },
    });
    expect((dbRow?.credentials as Record<string, unknown>).apiKey).toBe(
      'sk_test_x',
    );
  });

  it('accepts a valid config value (currency:usd) and persists it', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/skills/installed/${installedSkillId}/config`)
      .set(auth())
      .send({ config: { currency: 'usd' } })
      .expect(200);
    expect(res.body.config.currency).toBe('usd');
  });

  it('rejects an invalid select value (400)', async () => {
    await request(app.getHttpServer())
      .patch(`/skills/installed/${installedSkillId}/config`)
      .set(auth())
      .send({ config: { currency: 'xxx' } })
      .expect(400);
  });

  it('rejects a non-number for a number field (gmail dailyEmailLimit) (400)', async () => {
    const install = await request(app.getHttpServer())
      .post('/skills/install')
      .set(auth())
      .send({ skillKey: 'gmail' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/skills/installed/${install.body.id}/config`)
      .set(auth())
      .send({ config: { dailyEmailLimit: 'lots' } })
      .expect(400);
  });

  it('disconnects → NOT_CONNECTED and clears credentials', async () => {
    const res = await request(app.getHttpServer())
      .post(`/skills/installed/${installedSkillId}/disconnect`)
      .set(auth())
      .expect(201);
    expect(res.body.connectionStatus).toBe('NOT_CONNECTED');
    expect(res.body.credentialsSet).toBe(false);

    const dbRow = await prisma.installedSkill.findUnique({
      where: { id: installedSkillId },
    });
    expect(dbRow?.credentials).toBeNull();
  });
});
