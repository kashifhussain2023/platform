import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, type OnModuleInit } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PostizClientService } from './postiz-client.service';
import {
  MARKETING_SYNC_EVERY_MS,
  MARKETING_SYNC_JOB,
  MARKETING_SYNC_QUEUE,
  MARKETING_SYNC_SCHEDULER,
} from './marketing.constants';
import { DEFAULT_QUEUE_CONCURRENCY } from '../../../common/resilience/queue-concurrency.constants';

/**
 * Reconciliation backstop for the Postiz webhook (docs/architecture/engines/
 * postiz-engine.md §13): Postiz's own webhook is unsigned and has no retry, so
 * this scheduled sweep — not the webhook — is the source of truth for
 * ScheduledPost status. Mirrors ConnectorHealthProcessor's boot-time repeatable
 * job registration exactly.
 */
@Processor(MARKETING_SYNC_QUEUE, { concurrency: DEFAULT_QUEUE_CONCURRENCY })
export class MarketingSyncProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(MarketingSyncProcessor.name);

  constructor(
    @InjectQueue(MARKETING_SYNC_QUEUE) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly postizClient: PostizClientService,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.queue.upsertJobScheduler(
        MARKETING_SYNC_SCHEDULER,
        { every: MARKETING_SYNC_EVERY_MS },
        { name: MARKETING_SYNC_JOB, opts: { removeOnComplete: true, removeOnFail: 100 } },
      );
    } catch (err) {
      this.logger.warn(
        `Could not register marketing-sync scheduler: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async process(job: Job): Promise<void> {
    if (job.name !== MARKETING_SYNC_JOB) return;
    const pending = await this.prisma.scheduledPost.findMany({
      where: { status: 'SCHEDULED' },
      take: 100,
    });
    for (const post of pending) {
      // Reconciliation backstop — Postiz's own webhook is unsigned/no-retry
      // (docs/architecture/engines/postiz-engine.md §13), so this poll is the
      // source of truth, not just a fallback.
      if (!post.postizPostId) continue;
      // (real implementation calls a per-post Postiz status lookup here;
      // deferred to a later engine phase — extending PostizClientService with a
      // getPost(id) method following the exact same fetch() pattern as
      // schedulePost in Task 2 — so this sweep stays a safe no-op scaffold
      // until that lookup lands.)
    }
    this.logger.debug(`marketing-sync swept ${pending.length} pending post(s)`);
  }
}
