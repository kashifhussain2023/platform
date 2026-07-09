/** Name of the BullMQ queue that drives document ingestion. */
export const KNOWLEDGE_INGEST_QUEUE = 'knowledge-ingest';

/** Job name enqueued on upload. */
export const INGEST_JOB = 'ingest';

/** Payload of a knowledge-ingest job. */
export interface IngestJobData {
  documentId: string;
}
