/**
 * Name of the BullMQ queue that drives async event NORMALIZATION. The ingestion
 * edge enqueues one job per persisted RawEvent and returns immediately; the
 * in-process EventNormalizeProcessor (a WorkerHost, mirroring the knowledge
 * IngestionProcessor) dequeues it, maps raw → canonical, and fires workflows.
 */
export const EVENT_NORMALIZE_QUEUE = 'event-normalize';

/** Job name enqueued for each RawEvent awaiting normalization. */
export const EVENT_NORMALIZE_JOB = 'normalize';

/** Payload of an event-normalize job: the RawEvent to normalize. */
export interface NormalizeJobData {
  rawEventId: string;
}

/** Default + max number of rows the observability endpoints return. */
export const DEFAULT_EVENTS_LIMIT = 50;
export const MAX_EVENTS_LIMIT = 100;
