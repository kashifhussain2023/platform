import { PrismaClient } from '@prisma/client';

describe('Support engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a ChatwootAccount scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'Support Test Co', slug: `support-test-${Date.now()}` },
    });
    const account = await prisma.chatwootAccount.create({
      data: {
        companyId: company.id,
        chatwootAccountId: '1',
        agentBotId: '1',
        agentBotToken: 'encrypted-placeholder',
        webhookSecret: 'encrypted-placeholder',
      },
    });
    expect(account.companyId).toBe(company.id);
  });
});
