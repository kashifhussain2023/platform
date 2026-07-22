/**
 * Whether this process should run BullMQ workers (the `@Processor` classes).
 * Default true — unset in every existing deployment, so behavior there is
 * unchanged. Set `QUEUE_WORKERS_ENABLED=false` only on the Vercel HTTP-only
 * deployment: its serverless functions are short-lived and must not run
 * queue consumers (the persistent worker keeps running on its current host).
 * Producers (`BullModule.registerQueue` + `@InjectQueue`) are unaffected —
 * only the consumer providers are excluded.
 */
export function queueWorkersEnabled(): boolean {
  return process.env.QUEUE_WORKERS_ENABLED !== 'false';
}
