import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  WORKFLOW_RUN_QUEUE,
  type WorkflowRunJobData,
} from '../workflows.constants';
import { WorkflowEngine } from './workflow-engine.service';

/**
 * In-process BullMQ worker that executes queued workflow jobs by delegating to
 * the WorkflowEngine (same WorkerHost style as the knowledge IngestionProcessor).
 *
 * Job shapes that flow through the same queue:
 * - `{ runId }`     — an already-created run (MANUAL/EVENT/WEBHOOK). Existing path.
 * - `{ runId, resume: true }` — resume a WAITING run whose APPROVAL was approved.
 * - `{ workflowId, source }` — a SCHEDULE/repeatable fire: create a run (with
 *   that source) then execute it.
 *
 * The engine owns all status transitions and error handling, so this handler
 * stays thin — a node failure is recorded as a FAILED run (a terminal domain
 * outcome the poller reads), not a thrown job error.
 */
@Processor(WORKFLOW_RUN_QUEUE)
export class WorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowProcessor.name);

  constructor(private readonly engine: WorkflowEngine) {
    super();
  }

  async process(job: Job<WorkflowRunJobData>): Promise<void> {
    const data = job.data;
    if ('runId' in data && data.runId) {
      if (data.resume) {
        this.logger.debug(`Resuming workflow run ${data.runId}`);
        await this.engine.resume(data.runId);
        return;
      }
      this.logger.debug(`Executing workflow run ${data.runId}`);
      await this.engine.execute(data.runId);
      return;
    }
    if ('workflowId' in data && data.workflowId) {
      const source = data.source ?? 'SCHEDULE';
      this.logger.debug(
        `Triggered workflow ${data.workflowId} (source=${source})`,
      );
      await this.engine.trigger(data.workflowId, source);
      return;
    }
    this.logger.warn(`Ignoring workflow job with unrecognised data shape`);
  }
}
