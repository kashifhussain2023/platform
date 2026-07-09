import type { AnalyticsRange } from '@vaep/types';

/**
 * ILLUSTRATIVE productivity assumptions used to derive time/cost savings from
 * raw activity counts. These are estimates for the dashboard's "value" tiles —
 * NOT billing figures — and are surfaced with an "est." hint in the UI. Real,
 * customer-supplied inputs (per-task minutes, blended hourly rate) are a TODO.
 */
export const MINUTES_SAVED_PER_TASK = 10;
export const HOURLY_RATE_USD = 25;

/**
 * Lower bound (inclusive) for a range, or `undefined` for `all` (no bound).
 * `today` is the start of the current local day; `7d`/`30d` are rolling windows.
 */
export function rangeStart(range: AnalyticsRange): Date | undefined {
  const now = new Date();
  switch (range) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return start;
    }
    case '7d':
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case '30d':
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return undefined;
  }
}

/** Normalise an untrusted query value to a valid range (default `7d`). */
export function normalizeRange(value: unknown): AnalyticsRange {
  return value === 'today' || value === '7d' || value === '30d' || value === 'all'
    ? value
    : '7d';
}

/** Hours saved for a number of completed tasks (ILLUSTRATIVE). */
export function hoursSavedFor(tasksCompleted: number): number {
  return (tasksCompleted * MINUTES_SAVED_PER_TASK) / 60;
}
