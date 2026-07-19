/** Env vars for the shared self-hosted Postiz instance (one per Orlixa deployment, not per company). */
export const POSTIZ_ENV = {
  BASE_URL: 'POSTIZ_BASE_URL',
  API_KEY: 'POSTIZ_API_KEY',
} as const;

/** BullMQ queue names (Phase 0 §4/§5). */
export const MARKETING_SYNC_QUEUE = 'marketing-sync';
export const MARKETING_SYNC_JOB = 'marketing-sync-sweep';
export const MARKETING_SYNC_SCHEDULER = 'marketing-sync';
export const MARKETING_SYNC_EVERY_MS = 10 * 60_000;
