/**
 * Parse a `REDIS_URL` into ioredis/BullMQ connection options. Mirrors the helper
 * the KnowledgeModule uses for the BullMQ root connection, kept here so the
 * resilience infra (circuit-breaker store, rate limiter, DLQ queues) shares one
 * definition without importing a feature module.
 */
export interface RedisConnectionOptions {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export function redisConnectionFromUrl(url: string): RedisConnectionOptions {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    username: parsed.username || undefined,
    password: parsed.password || undefined,
  };
}
