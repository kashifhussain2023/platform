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
});
