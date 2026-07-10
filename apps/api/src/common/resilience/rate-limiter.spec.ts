import type { ConfigService } from '@nestjs/config';
import { RateLimiter } from './rate-limiter';

// No Redis client (null) → the limiter uses its deterministic in-memory bucket.
// A config stub returning undefined leaves the connector defaults in place.
const configStub = { get: () => undefined } as unknown as ConfigService;

describe('RateLimiter (in-memory fallback, no Redis)', () => {
  it('allows exactly N acquisitions per fixed window, then blocks the excess', async () => {
    const rl = new RateLimiter(null, configStub);
    const key = 'k';
    const limit = 3;
    const windowMs = 1_000;

    // now=0 → first window: 3 allowed, 4th blocked.
    expect(await rl.tryAcquire(key, limit, windowMs, 0)).toBe(true);
    expect(await rl.tryAcquire(key, limit, windowMs, 10)).toBe(true);
    expect(await rl.tryAcquire(key, limit, windowMs, 20)).toBe(true);
    expect(await rl.tryAcquire(key, limit, windowMs, 30)).toBe(false);
    expect(await rl.tryAcquire(key, limit, windowMs, 999)).toBe(false);

    // now=1000 → the window rolled over: budget is fresh again.
    expect(await rl.tryAcquire(key, limit, windowMs, 1_000)).toBe(true);
    expect(await rl.tryAcquire(key, limit, windowMs, 1_500)).toBe(true);
  });

  it('treats limit <= 0 as unlimited', async () => {
    const rl = new RateLimiter(null, configStub);
    for (let i = 0; i < 100; i += 1) {
      expect(await rl.tryAcquire('unbounded', 0, 1_000, i)).toBe(true);
    }
  });

  it('acquire() with no wait budget denies immediately when over the limit', async () => {
    const rl = new RateLimiter(null, configStub);
    expect(await rl.acquire('a', 1, 1_000, { maxWaitMs: 0 })).toBe(true);
    expect(await rl.acquire('a', 1, 1_000, { maxWaitMs: 0 })).toBe(false);
  });

  it('acquire() DELAYS excess and succeeds once the window rolls over', async () => {
    const rl = new RateLimiter(null, configStub);
    const key = 'delayed';
    const windowMs = 60;

    // Exhaust the current window (limit 1).
    expect(await rl.acquire(key, 1, windowMs, { maxWaitMs: 0 })).toBe(true);
    expect(await rl.acquire(key, 1, windowMs, { maxWaitMs: 0 })).toBe(false);

    // With a wait budget it blocks into the next window and then succeeds.
    const started = Date.now();
    const ok = await rl.acquire(key, 1, windowMs, { maxWaitMs: 500 });
    expect(ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(1);
  });

  it('exposes the configured connector defaults (60 / 60s)', () => {
    const rl = new RateLimiter(null, configStub);
    expect(rl.connectorLimit).toBe(60);
    expect(rl.connectorWindowMs).toBe(60_000);
  });
});
