import { RetrievalService } from './retrieval.service';

function fakeKnowledge() {
  return { retrieve: jest.fn().mockResolvedValue([]) };
}

describe('RetrievalService category threading', () => {
  it('passes the given category through to KnowledgeService.retrieve', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    await service.retrieve('co_1', 'what is the refund policy', 'ALL', 5, 'SALES');

    expect(knowledge.retrieve).toHaveBeenCalledWith('co_1', 'what is the refund policy', 5, 'SALES');
  });

  it('still skips retrieval entirely when knowledgeAccess is NONE, regardless of category', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    const result = await service.retrieve('co_1', 'anything', 'NONE', 5, 'SALES');

    expect(result).toEqual([]);
    expect(knowledge.retrieve).not.toHaveBeenCalled();
  });

  it('omitting the category preserves the original unfiltered call shape', async () => {
    const knowledge = fakeKnowledge();
    const service = new RetrievalService(knowledge as never);

    await service.retrieve('co_1', 'anything', 'ALL', 5);

    expect(knowledge.retrieve).toHaveBeenCalledWith('co_1', 'anything', 5, undefined);
  });
});
