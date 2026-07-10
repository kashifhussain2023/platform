/**
 * Connector health / token constants (Unit B, docs §1.6–1.8).
 */

/**
 * N — the number of CONSECUTIVE egress/probe failures that trips a CONNECTED
 * connector to DEGRADED (docs §1.7). A single success resets the counter.
 */
export const CONNECTOR_FAILURE_THRESHOLD = 3;

/**
 * Refresh an OAuth access token when it expires within this window (ms) — a skew
 * margin so a token is renewed just before, not after, it lapses.
 */
export const TOKEN_REFRESH_SKEW_MS = 60_000;

/** Max chars persisted to `lastHealthError`/`disabledReason` (keep rows tidy). */
export const CONNECTOR_ERROR_MAX_LEN = 500;

// --- Scheduled active health sweep (BullMQ repeatable, docs §1.8) ------------

/** Queue that drives the periodic active health sweep. */
export const CONNECTOR_HEALTH_QUEUE = 'connector-health';

/** Repeatable job name for the sweep (all iterations share one handler branch). */
export const CONNECTOR_HEALTH_JOB = 'connector-health-sweep';

/** Job-scheduler id (idempotent upsert, like the workflow SCHEDULE repeatables). */
export const CONNECTOR_HEALTH_SCHEDULER = 'connector-health';

/** ~10 min between scheduled health sweeps. */
export const CONNECTOR_HEALTH_EVERY_MS = 10 * 60 * 1000;

/** Max connectors probed per sweep (batching / rate-limit guard). */
export const CONNECTOR_HEALTH_BATCH = 100;
