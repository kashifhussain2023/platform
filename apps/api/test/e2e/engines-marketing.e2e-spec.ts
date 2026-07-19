import { PrismaClient } from '@prisma/client';

describe('Marketing engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a SocialAccount scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'Acme Test', slug: `acme-${Date.now()}` },
    });
    const account = await prisma.socialAccount.create({
      data: {
        companyId: company.id,
        provider: 'instagram',
        postizIntegrationId: 'postiz-int-123',
        status: 'CONNECTED',
      },
    });
    expect(account.companyId).toBe(company.id);
    expect(account.status).toBe('CONNECTED');
  });
});
