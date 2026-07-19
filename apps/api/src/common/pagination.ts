/**
 * Shared list-endpoint cap, mirroring the pattern already used by
 * EventsService.clampLimit (events.constants.ts DEFAULT/MAX_EVENTS_LIMIT) --
 * see docs/status/2026-07-19-founder-market-readiness-audit.md §3: several
 * list endpoints (employees, workflows, knowledge documents, skills) had no
 * limit at all and would load every row for a company in one query.
 */
export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 200;

/** Parse/clamp a requested limit to [1, max] (default when absent/invalid). */
export function clampLimit(
  raw: unknown,
  opts?: { default?: number; max?: number },
): number {
  const fallback = opts?.default ?? DEFAULT_LIST_LIMIT;
  const max = opts?.max ?? MAX_LIST_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(n), max);
}
