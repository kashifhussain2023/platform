import { ConfigService } from '@nestjs/config';
import { PostizClientService } from './postiz-client.service';

describe('PostizClientService', () => {
  const config = new ConfigService({
    POSTIZ_BASE_URL: 'https://postiz.internal.test',
    POSTIZ_API_KEY: 'test-key',
  });
  const service = new PostizClientService(config);

  it('builds the connect-url request against the configured base URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://instagram.com/oauth/authorize?...' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.getConnectUrl('instagram');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://postiz.internal.test/public/v1/social/instagram',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    );
    expect(result.url).toContain('instagram.com');
  });

  it('lists posts from the public API', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'p_1', state: 'PUBLISHED', releaseId: 'ig_123', releaseURL: 'https://instagram.com/p/abc' },
      ],
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const posts = await service.listPosts();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://postiz.internal.test/public/v1/posts',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'test-key' }),
      }),
    );
    expect(posts[0].state).toBe('PUBLISHED');
  });

  it('throws with the response body when listPosts fails', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(service.listPosts()).rejects.toThrow('Postiz listPosts failed: 500');
  });
});
