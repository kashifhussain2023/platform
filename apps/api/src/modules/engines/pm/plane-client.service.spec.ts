import { ConfigService } from '@nestjs/config';
import { PlaneClientService } from './plane-client.service';
import { createHmac } from 'crypto';

describe('PlaneClientService', () => {
  const config = new ConfigService({ PLANE_BASE_URL: 'https://plane.internal.test' });
  const service = new PlaneClientService(config);

  it('creates an issue against the correct workspace/project URL with X-Api-Key', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'issue-123' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.createIssue('acme-workspace', 'proj-1', 'plane-token-abc', {
      title: 'Fix the bug',
      description: 'Details here',
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://plane.internal.test/api/v1/workspaces/acme-workspace/projects/proj-1/issues/',
    );
    expect(init.headers['X-Api-Key']).toBe('plane-token-abc');
  });

  it('verifies a webhook signature using the RAW HMAC-SHA256 hex digest of the exact payload bytes (no prefix, no timestamp — this is Plane, NOT Chatwoot)', () => {
    const secret = 'shared-secret';
    const rawBody = Buffer.from('{"event":"issue","action":"create"}', 'utf8');
    const validSig = createHmac('sha256', secret).update(rawBody).digest('hex');
    expect(service.verifyWebhookSignature(rawBody, validSig, secret)).toBe(true);
    expect(service.verifyWebhookSignature(rawBody, 'wrong-sig', secret)).toBe(false);
  });
});
