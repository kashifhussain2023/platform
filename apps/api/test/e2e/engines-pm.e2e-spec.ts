import { PrismaClient } from '@prisma/client';
import { SkillCatalog } from '../../src/modules/skills/catalog';

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

describe('PM engine — catalog', () => {
  it('registers the plane skill with list_issues/create_issue/update_issue_status tools', () => {
    expect(SkillCatalog.has('plane')).toBe(true);
    expect(SkillCatalog.getTool('plane', 'list_issues')).toBeDefined();
    expect(SkillCatalog.getTool('plane', 'create_issue')).toBeDefined();
    expect(SkillCatalog.getTool('plane', 'update_issue_status')).toBeDefined();
  });
});
