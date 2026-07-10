import { UnrecoverableError } from 'bullmq';
import type { QueueOptions } from 'bullmq';
import { classify } from './error-classifier';

/**
 * Shared BullMQ default job options for every queue (docs §4.4). Applied once at
 * the BullMQ root (`BullModule.forRootAsync`), so all queues inherit:
 *   • bounded `attempts` (no infinite retry),
 *   • exponential backoff WITH jitter (spreads retries, avoids thundering herds),
 *   • keep completed jobs briefly, and KEEP FAILED jobs (bounded) — the failed
 *     set IS our dead-letter queue (see DlqService).
 *
 * Per-`add()` options still merge over these (per-job wins), so existing call
 * sites that set `removeOnComplete/removeOnFail` keep their bounded behavior.
 */
export const RESILIENT_JOB_OPTIONS: NonNullable<
  QueueOptions['defaultJobOptions']
> = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000, jitter: 0.5 },
  // Keep recent completed jobs for a short window (observability), bounded.
  removeOnComplete: { age: 3_600, count: 1_000 },
  // Keep FAILED jobs (the DLQ): up to 7 days / 5k, whichever hits first.
  removeOnFail: { age: 60 * 60 * 24 * 7, count: 5_000 },
};

/**
 * Map a processor error to a queue error that RESPECTS the retryable/terminal
 * split (docs §4.4): a TERMINAL error (4xx/validation/auth) is wrapped in a
 * BullMQ `UnrecoverableError` so the job goes STRAIGHT to the DLQ (no retry
 * storm); a RETRYABLE error is returned as-is so the queue's bounded backoff
 * retries it. Use in a processor's catch: `throw toQueueError(err)`.
 */
export function toQueueError(err: unknown): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  if (classify(error) === 'TERMINAL') {
    return new UnrecoverableError(error.message);
  }
  return error;
}
