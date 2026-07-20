import { PrismaClient } from '@prisma/client';

describe('PM engine — schema', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('creates a PlaneWorkspace scoped to a company', async () => {
    const company = await prisma.company.create({
      data: { name: 'PM Test Co', slug: `pm-test-${Date.now()}` },
    });
    const workspace = await prisma.planeWorkspace.create({
      data: {
        companyId: company.id,
        planeWorkspaceSlug: 'pm-test-workspace',
        apiToken: 'encrypted-placeholder',
        webhookSecret: 'encrypted-placeholder',
      },
    });
    expect(workspace.companyId).toBe(company.id);
  });
});
