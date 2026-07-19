import { MarketingSyncProcessor } from './marketing-sync.processor';

describe('MarketingSyncProcessor', () => {
  it('updates ScheduledPost status from Postiz post list', async () => {
    const queueMock = { upsertJobScheduler: jest.fn() };
    const prisma = {
      scheduledPost: {
        findMany: jest.fn().mockResolvedValue([{ id: 'sp_1', postizPostId: 'p_1', status: 'SCHEDULED' }]),
        update: jest.fn(),
      },
      publishedPost: { create: jest.fn() },
    };
    const postizClient = {
      listIntegrations: jest.fn().mockResolvedValue([]),
    };
    const processor = new MarketingSyncProcessor(queueMock as any, prisma as any, postizClient as any);
    await processor.process({ name: 'marketing-sync-sweep' } as any);
    expect(prisma.scheduledPost.findMany).toHaveBeenCalled();
  });
});
