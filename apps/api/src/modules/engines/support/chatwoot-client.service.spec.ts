import { ConfigService } from '@nestjs/config';
import { ChatwootClientService } from './chatwoot-client.service';
import { CryptoService } from '../../../common/crypto/crypto.service';

describe('ChatwootClientService', () => {
  const config = new ConfigService({
    CHATWOOT_BASE_URL: 'https://chatwoot.internal.test',
    CHATWOOT_PLATFORM_API_TOKEN: 'test-platform-token',
  });
  const crypto = new CryptoService(config);
  const service = new ChatwootClientService(config, crypto);

  it('sends a reply using the per-company agent bot token, not the platform token', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 42 }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await service.sendReply('acct-1', 'conv-1', 'bot-token-abc', 'Hello, how can I help?');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/v1/accounts/acct-1/conversations/conv-1/messages');
    expect(init.headers.api_access_token).toBe('bot-token-abc');
  });

  it('verifies a webhook signature correctly', () => {
    const secret = 'shared-secret';
    const body = '{"event":"message_created"}';
    const validSig = require('crypto').createHmac('sha256', secret).update(body).digest('hex');
    expect(service.verifyWebhookSignature(body, validSig, secret)).toBe(true);
    expect(service.verifyWebhookSignature(body, 'wrong-sig', secret)).toBe(false);
  });
});
