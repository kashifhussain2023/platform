/**
 * Default BullMQ worker concurrency for every queue processor in the app.
 * Was hardcoded to 1 (the implicit BullMQ default) everywhere, meaning every
 * queue processed one job at a time platform-wide, across every company —
 * see docs/status/2026-07-19-founder-market-readiness-audit.md §3. Raised to
 * a modest shared value; tune per-queue later if metrics show a specific
 * queue needs a different number (e.g. to respect a provider's own rate
 * limit more tightly than this).
 */
export const DEFAULT_QUEUE_CONCURRENCY = 5;
