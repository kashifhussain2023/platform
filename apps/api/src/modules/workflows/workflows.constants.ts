/** Name of the BullMQ queue that drives async workflow execution. */
export const WORKFLOW_RUN_QUEUE = 'workflow-run';

/** Job name enqueued when a run is created. */
export const WORKFLOW_RUN_JOB = 'run';

/** Payload of a workflow-run job. */
export interface WorkflowRunJobData {
  runId: string;
}

/**
 * Hard cap on how many nodes a single run may visit, so a cyclic or malformed
 * graph can never loop forever. The engine stops (FAILED) once exceeded.
 */
export const MAX_WORKFLOW_NODES = 50;

/**
 * Upper bound (ms) a WAIT node may block the in-process worker. Durable /
 * resumable waits via delayed jobs are a TODO; for now WAIT is a bounded sleep.
 */
export const MAX_WAIT_MS = 10_000;
