import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

// Organization (Security Policies / Teams / Departments, P1 #7) e2e: needs a live
// Postgres + Redis. Skipped when DATABASE_URL is unset so it never blocks the
// build. Run with:
//   LLM_PROVIDER=mock EMBEDDINGS_PROVIDER=hash STORAGE_PROVIDER=local \
//   BILLING_PROVIDER=mock \
//   DATABASE_URL=postgresql://vaep:vaep@localhost:5433/vaep?schema=public \
//   REDIS_URL=redis://127.0.0.1:6380 JWT_ACCESS_SECRET=... JWT_REFRESH_SECRET=...
const hasDb = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDb ? describe : describe.skip;

describeIfDb('Organization e2e — departments / teams / security policy (P1 #7)', () => {
  let app: INestApplication;
  const ts = Date.now();
  const ownerEmail = `org_owner_${ts}@example.com`;
  const password = 'password123';

  let ownerToken = '';
  let memberToken = '';

  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

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
      .send({ companyName: 'Org E2E Co', name: 'Org Owner', email: ownerEmail, password })
      .expect(201);
    ownerToken = reg.body.tokens.accessToken;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('department CRUD (create / list / update / delete)', async () => {
    const created = await request(app.getHttpServer())
      .post('/departments')
      .set(bearer(ownerToken))
      .send({ name: 'Engineering', description: 'Builds things' })
      .expect(201);
    expect(created.body.name).toBe('Engineering');
    const id = created.body.id;

    const list = await request(app.getHttpServer())
      .get('/departments')
      .set(bearer(ownerToken))
      .expect(200);
    expect(list.body.some((d: { id: string }) => d.id === id)).toBe(true);

    const patched = await request(app.getHttpServer())
      .patch(`/departments/${id}`)
      .set(bearer(ownerToken))
      .send({ name: 'Eng', description: null })
      .expect(200);
    expect(patched.body.name).toBe('Eng');
    expect(patched.body.description).toBeNull();

    await request(app.getHttpServer())
      .delete(`/departments/${id}`)
      .set(bearer(ownerToken))
      .expect(204);

    const after = await request(app.getHttpServer())
      .get('/departments')
      .set(bearer(ownerToken))
      .expect(200);
    expect(after.body.some((d: { id: string }) => d.id === id)).toBe(false);
  });

  it('team CRUD with optional department (delete department → team unassigned)', async () => {
    const dept = await request(app.getHttpServer())
      .post('/departments')
      .set(bearer(ownerToken))
      .send({ name: 'Support Dept' })
      .expect(201);
    const deptId = dept.body.id;

    const team = await request(app.getHttpServer())
      .post('/teams')
      .set(bearer(ownerToken))
      .send({ name: 'Tier 1', departmentId: deptId })
      .expect(201);
    expect(team.body.departmentId).toBe(deptId);
    const teamId = team.body.id;

    const list = await request(app.getHttpServer())
      .get('/teams')
      .set(bearer(ownerToken))
      .expect(200);
    expect(list.body.some((t: { id: string }) => t.id === teamId)).toBe(true);

    // Rename + unassign the department.
    const patched = await request(app.getHttpServer())
      .patch(`/teams/${teamId}`)
      .set(bearer(ownerToken))
      .send({ name: 'Tier One', departmentId: null })
      .expect(200);
    expect(patched.body.name).toBe('Tier One');
    expect(patched.body.departmentId).toBeNull();

    // Re-attach, then delete the department → team survives with null departmentId.
    await request(app.getHttpServer())
      .patch(`/teams/${teamId}`)
      .set(bearer(ownerToken))
      .send({ departmentId: deptId })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/departments/${deptId}`)
      .set(bearer(ownerToken))
      .expect(204);
    const teamsAfter = await request(app.getHttpServer())
      .get('/teams')
      .set(bearer(ownerToken))
      .expect(200);
    const survivor = teamsAfter.body.find((t: { id: string }) => t.id === teamId);
    expect(survivor).toBeTruthy();
    expect(survivor.departmentId).toBeNull();

    await request(app.getHttpServer())
      .delete(`/teams/${teamId}`)
      .set(bearer(ownerToken))
      .expect(204);
  });

  it('GET /security-policy self-heals defaults (passwordMinLength 8)', async () => {
    const res = await request(app.getHttpServer())
      .get('/security-policy')
      .set(bearer(ownerToken))
      .expect(200);
    expect(res.body.passwordMinLength).toBe(8);
    expect(res.body.mfaRequired).toBe(false);
    expect(res.body.allowedEmailDomains).toEqual([]);
    expect(res.body.dataRetentionDays).toBe(0);
  });

  it('PATCH /security-policy allowedEmailDomains gates POST /users by domain', async () => {
    const patched = await request(app.getHttpServer())
      .patch('/security-policy')
      .set(bearer(ownerToken))
      .send({ allowedEmailDomains: ['acme.com'] })
      .expect(200);
    expect(patched.body.allowedEmailDomains).toEqual(['acme.com']);

    // Wrong domain → 400.
    await request(app.getHttpServer())
      .post('/users')
      .set(bearer(ownerToken))
      .send({ email: `x_${ts}@other.com`, name: 'Wrong Domain', role: 'MEMBER', password })
      .expect(400);

    // Allowed domain → 201.
    const ok = await request(app.getHttpServer())
      .post('/users')
      .set(bearer(ownerToken))
      .send({ email: `x_${ts}@acme.com`, name: 'Right Domain', role: 'MEMBER', password })
      .expect(201);
    expect(ok.body.email).toBe(`x_${ts}@acme.com`);
  });

  it('POST /users rejects a too-short password (400)', async () => {
    await request(app.getHttpServer())
      .post('/users')
      .set(bearer(ownerToken))
      .send({ email: `short_${ts}@acme.com`, name: 'Short Pw', role: 'MEMBER', password: 'abcd' })
      .expect(400);
  });

  it('a MEMBER can read but is 403 on org mutations', async () => {
    // Create + log in a MEMBER (email in the allowed domain).
    const memberEmail = `member_${ts}@acme.com`;
    await request(app.getHttpServer())
      .post('/users')
      .set(bearer(ownerToken))
      .send({ email: memberEmail, name: 'Org Member', role: 'MEMBER', password })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: memberEmail, password })
      .expect(201);
    memberToken = login.body.tokens.accessToken;

    // Reads are open to any authenticated member.
    await request(app.getHttpServer())
      .get('/departments')
      .set(bearer(memberToken))
      .expect(200);

    // Mutations are OWNER/ADMIN only → 403 for a MEMBER.
    await request(app.getHttpServer())
      .post('/departments')
      .set(bearer(memberToken))
      .send({ name: 'Nope' })
      .expect(403);
    await request(app.getHttpServer())
      .patch('/security-policy')
      .set(bearer(memberToken))
      .send({ mfaRequired: true })
      .expect(403);
  });

  it('rejects organization routes without a token (401)', async () => {
    await request(app.getHttpServer()).get('/departments').expect(401);
    await request(app.getHttpServer()).get('/security-policy').expect(401);
  });
});
