import { TenantAwareThrottlerGuard } from './tenant-throttler.guard';

/** Build a syntactically-valid (unsigned) JWT string carrying `companyId`. */
function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`;
}

describe('TenantAwareThrottlerGuard.getTracker', () => {
  // getTracker is `protected` -- exercise it through a tiny subclass so the
  // test doesn't need a full Nest DI/module bootstrap for something that's
  // pure string-in/string-out logic.
  class TestableGuard extends TenantAwareThrottlerGuard {
    public track(req: Record<string, unknown>): Promise<string> {
      return this.getTracker(req);
    }
  }
  const guard = Object.create(TestableGuard.prototype) as TestableGuard;

  it('keys by companyId when a Bearer JWT with a companyId claim is present', async () => {
    const token = fakeJwt({ sub: 'user1', companyId: 'company-abc' });
    const tracker = await guard.track({
      headers: { authorization: `Bearer ${token}` },
      ip: '1.2.3.4',
    });
    expect(tracker).toBe('company:company-abc');
  });

  it('falls back to IP when there is no Authorization header (pre-auth: login/register)', async () => {
    const tracker = await guard.track({ headers: {}, ip: '5.6.7.8' });
    expect(tracker).toBe('5.6.7.8');
  });

  it('falls back to IP when the Authorization header is malformed', async () => {
    const tracker = await guard.track({
      headers: { authorization: 'Bearer not-a-jwt' },
      ip: '5.6.7.8',
    });
    expect(tracker).toBe('5.6.7.8');
  });

  it('falls back to IP when the JWT has no companyId claim', async () => {
    const token = fakeJwt({ sub: 'user1' });
    const tracker = await guard.track({
      headers: { authorization: `Bearer ${token}` },
      ip: '5.6.7.8',
    });
    expect(tracker).toBe('5.6.7.8');
  });
});
