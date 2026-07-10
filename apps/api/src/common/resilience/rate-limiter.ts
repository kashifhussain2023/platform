import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { RESILIENCE_REDIS } from './redis.provider';

/** Surfaced as a retryable tool error when egress is throttled (docs §9). */
export class RateLimitedError extends Error {
  constructor(public readonly key: string) {
    super(`Rate limit exceeded for ${key}`);
    this.name = 'RateLimitedError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Per-connector egress rate limiter (docs §9): a Redis fixed-window token bucket
 * shared across workers/instances, with an in-memory fallback when Redis is
 * unavailable. `tryAcquire` is non-blocking (deny → caller surfaces a retryable
 * error); `acquire` optionally awaits up to `maxWaitMs` (preferred for queue
 * jobs, which can afford to smooth bursts rather than fail).
 *
 * The default per-connector budget (`CONNECTOR_RATE_LIMIT` per
 * `CONNECTOR_RATE_WINDOW_MS`) protects providers' own limits; a `limit <= 0`
 * means "unlimited" (used to disable throttling). The mock egress path is never
 * routed through here, so the offline test-suite is unaffected.
 *
 * NOTE: BullMQ's built-in rate-limiter groups (keyed by connector) are an
 * alternative for queue-scheduled egress; this token bucket also covers the
 * synchronous runtime tool-call path that does not go through a queue.
 */
@Injectable()
export class RateLimiter {
  private readonly logger = new Logger(RateLimiter.name);
  /** In-memory fallback buckets (per-process) when Redis is down. */
  private readonly memory = new Map<string, { count: number; resetAt: number }>();
  private lastGc = 0;

  readonly connectorLimit: number;
  readonly connectorWindowMs: number;

  constructor(
    @Optional() @Inject(RESILIENCE_REDIS) private readonly redis: Redis | null,
    config: ConfigService,
  ) {
    this.connectorLimit = this.num(config, 'CONNECTOR_RATE_LIMIT', 60);
    this.connectorWindowMs = this.num(config, 'CONNECTOR_RATE_WINDOW_MS', 60_000);
  }

  /**
   * Try to consume one token for `key` within the current window. Returns true
   * when allowed, false when the window's `limit` is already exhausted. Never
   * throws (a Redis error falls back to the in-memory bucket). `now` is injectable
   * for deterministic tests.
   */
  async tryAcquire(
    key: string,
    limit: number,
    windowMs: number,
    now: number = Date.now(),
  ): Promise<boolean> {
    if (limit <= 0) {
      return true; // unlimited
    }
    const windowIndex = Math.floor(now / windowMs);
    const bucketKey = `vaep:rl:${key}:${windowMs}:${windowIndex}`;

    if (this.redis) {
      try {
        const count = await this.redis.incr(bucketKey);
        if (count === 1) {
          // Expire slightly after the window closes; cheap self-cleanup.
          await this.redis.pexpire(bucketKey, windowMs + 1_000);
        }
        return count <= limit;
      } catch (err) {
        this.logger.debug(
          `redis rate-limit failed, using memory: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return this.memTryAcquire(bucketKey, limit, windowMs, now);
  }

  /**
   * Acquire a token, optionally WAITING up to `maxWaitMs` for the window to roll
   * over (preferred for queue jobs). Returns false if still throttled after the
   * wait budget. With `maxWaitMs = 0` this is equivalent to {@link tryAcquire}.
   */
  async acquire(
    key: string,
    limit: number,
    windowMs: number,
    opts?: { maxWaitMs?: number },
  ): Promise<boolean> {
    if (await this.tryAcquire(key, limit, windowMs)) {
      return true;
    }
    const deadline = Date.now() + Math.max(0, opts?.maxWaitMs ?? 0);
    while (Date.now() < deadline) {
      const now = Date.now();
      const msIntoWindow = now % windowMs;
      // Wake shortly after the current window closes (bounded by the deadline).
      const wait = Math.min(windowMs - msIntoWindow + 5, deadline - now, 250);
      await sleep(Math.max(wait, 5));
      if (await this.tryAcquire(key, limit, windowMs)) {
        return true;
      }
    }
    return false;
  }

  /** Non-blocking per-connector acquire using the configured default budget. */
  async acquireForConnector(connectorId: string): Promise<boolean> {
    return this.tryAcquire(
      `connector:${connectorId}`,
      this.connectorLimit,
      this.connectorWindowMs,
    );
  }

  // --- In-memory fallback ---------------------------------------------------

  private memTryAcquire(
    bucketKey: string,
    limit: number,
    windowMs: number,
    now: number,
  ): boolean {
    this.gc(now);
    const resetAt = (Math.floor(now / windowMs) + 1) * windowMs;
    const cur = this.memory.get(bucketKey);
    if (!cur || cur.resetAt <= now) {
      this.memory.set(bucketKey, { count: 1, resetAt });
      return 1 <= limit;
    }
    cur.count += 1;
    return cur.count <= limit;
  }

  /** Drop expired in-memory buckets occasionally so the map can't grow forever. */
  private gc(now: number): void {
    if (now - this.lastGc < 60_000) {
      return;
    }
    this.lastGc = now;
    for (const [key, bucket] of this.memory) {
      if (bucket.resetAt <= now) {
        this.memory.delete(key);
      }
    }
  }

  private num(config: ConfigService, key: string, fallback: number): number {
    const raw = config.get<string>(key);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }
}
