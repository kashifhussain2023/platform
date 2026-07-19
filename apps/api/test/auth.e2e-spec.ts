import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// This e2e spec needs a live Postgres. It is skipped when DATABASE_URL is
// unset so it never blocks the build. The main agent runs it after docker up.
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Auth e2e (register -> login -> me)', () => {
  let app: INestApplication;
  const email = `e2e_${Date.now()}@example.com`;
  const password = 'password123';
  let accessToken = '';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers a company + owner', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ companyName: 'E2E Co', name: 'E2E Owner', email, password })
      .expect(201);

    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role).toBe('OWNER');
    expect(res.body.company.slug).toBeTruthy();
    expect(res.body.tokens.accessToken).toBeTruthy();
    accessToken = res.body.tokens.accessToken;
  });

  it('logs in with the same credentials', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);

    expect(res.body.tokens.accessToken).toBeTruthy();
    accessToken = res.body.tokens.accessToken;
  });

  it('returns the current user from /auth/me', async () => {
    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.user.email).toBe(email);
    expect(res.body.company.name).toBe('E2E Co');
  });

  it('rejects /auth/me without a token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('logout clears the refresh cookie so a later /auth/refresh fails (regression: logout used to be a client-only no-op, letting the still-valid cookie silently re-authenticate the browser)', async () => {
    const agent = request.agent(app.getHttpServer());
    const loginEmail = `e2e_logout_${Date.now()}@example.com`;

    await agent
      .post('/auth/register')
      .send({
        companyName: 'Logout E2E Co',
        name: 'Logout Owner',
        email: loginEmail,
        password,
      })
      .expect(201);

    // The registration response set the refresh cookie on this agent; confirm
    // it's actually usable before logging out.
    await agent.post('/auth/refresh').expect(201);

    await agent.post('/auth/logout').expect(201);

    // Same agent, same (now-cleared) cookie jar -- refresh must fail.
    await agent.post('/auth/refresh').expect(401);
  });
});
