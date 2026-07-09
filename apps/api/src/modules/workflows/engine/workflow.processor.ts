import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  WORKFLOW_RUN_JOB,
  WORKFLOW_RUN_QUEUE,
  type WorkflowRunJobData,
} from '../workflows.constants';
import { WorkflowEngine } from './workflow-engine.service';

/**
 * In-process BullMQ worker that executes a queued WorkflowRun by delegating to
 * the WorkflowEngine (same WorkerHost style as the knowledge IngestionProcessor).
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
    if (job.name !== WORKFLOW_RUN_JOB) {
      return;
    }
    this.logger.debug(`Executing workflow run ${job.data.runId}`);
    await this.engine.execute(job.data.runId);
  }
}
