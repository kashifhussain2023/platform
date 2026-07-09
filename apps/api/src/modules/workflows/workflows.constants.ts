/** Name of the BullMQ queue that drives async workflow execution. */
export const WORKFLOW_RUN_QUEUE = 'workflow-run';

/** Job name enqueued when a run is created (existing path). */
export const WORKFLOW_RUN_JOB = 'run';

/**
 * Job name for a scheduled (repeatable) trigger. The job carries a workflowId
 * (not a runId) — the processor creates the WorkflowRun then executes it. Used
 * as the repeatable job name so all SCHEDULE jobs share one handler branch.
 */
export const WORKFLOW_TRIGGER_JOB = 'trigger';

/**
 * Payload of a workflow-run job. Two shapes flow through the SAME queue:
 * - `{ runId }` — an already-created run (MANUAL/EVENT/WEBHOOK enqueue this).
 * - `{ workflowId, source }` — a scheduled/triggered fire; the processor
 *   creates a run (with that source) then executes it.
 */
export type WorkflowRunJobData =
  | { runId: string; workflowId?: never; source?: never }
  | { workflowId: string; source: string; runId?: never };

/** Minimum SCHEDULE interval (ms) — guards against runaway repeatable jobs. */
export const MIN_SCHEDULE_MS = 15_000;

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
