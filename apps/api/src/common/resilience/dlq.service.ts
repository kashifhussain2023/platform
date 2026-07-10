import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type Job } from 'bullmq';
import type { DlqJobDto, DlqSummaryEntryDto } from '@vaep/types';
import {
  DLQ_ALLOWED_QUEUES,
  DLQ_DEFAULT_LIMIT,
  DLQ_KNOWN_QUEUES,
  DLQ_MAX_LIMIT,
} from './dlq.constants';
import { redisConnectionFromUrl } from './redis-connection';

/**
 * Dead-letter queue admin surface (docs §4.4). A job that exhausts its bounded
 * retries stays in BullMQ's FAILED set (queues keep failed jobs — see
 * RESILIENT_JOB_OPTIONS) — that failed set IS our DLQ. This service lists,
 * replays (`job.retry()`), and discards (`job.remove()`) those jobs across the
 * known queues by name.
 *
 * TENANT SCOPING: results are restricted to jobs whose payload `companyId`
 * matches the caller. Jobs without a `companyId` in their payload are NOT
 * surfaced to a company admin (no platform-super-admin concept exists yet — a
 * global DLQ view is a TODO). The tenant-scoped enqueues (workflow-run,
 * knowledge-ingest, event-normalize) carry `companyId` for exactly this reason.
 *
 * Queue instances are created lazily (own connection) and closed on shutdown.
 */
@Injectable()
export class DlqService implements OnModuleDestroy {
  private readonly logger = new Logger(DlqService.name);
  private readonly connection: ReturnType<typeof redisConnectionFromUrl> & {
    maxRetriesPerRequest: null;
  };
  private readonly queues = new Map<string, Queue>();

  constructor(config: ConfigService) {
    this.connection = {
      ...redisConnectionFromUrl(config.getOrThrow<string>('REDIS_URL')),
      maxRetriesPerRequest: null,
    };
  }

  /**
   * Failed (dead-lettered) jobs for the caller's company. `queueName` narrows to
   * one queue; omitted → aggregate across all KNOWN queues. Only jobs whose
   * payload `companyId` matches are returned.
   */
  async list(
    companyId: string,
    queueName: string | undefined,
    limit?: number,
  ): Promise<DlqJobDto[]> {
    const take = this.clampLimit(limit);
    const names = queueName
      ? [this.assertKnown(queueName)]
      : [...DLQ_KNOWN_QUEUES];

    const out: DlqJobDto[] = [];
    for (const name of names) {
      const queue = this.queueFor(name);
      let jobs: Job[] = [];
      try {
        jobs = await queue.getFailed(0, take - 1);
      } catch (err) {
        this.logger.warn(
          `Could not read failed jobs for queue ${name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }
      for (const job of jobs) {
        const jobCompanyId = this.companyIdOf(job);
        if (jobCompanyId !== companyId) {
          continue; // strict tenant scope (and drop no-companyId jobs)
        }
        out.push(this.toDto(name, job, jobCompanyId));
      }
    }
    return out;
  }

  /**
   * Per-queue failed-job counts for the caller's company (docs §9 monitoring —
   * alert on growth). Scans each KNOWN queue's failed set (bounded by
   * DLQ_MAX_LIMIT) and counts jobs whose payload companyId matches; BullMQ's own
   * `getFailedCount` is not tenant-aware, so we filter the same way `list` does.
   * The e2e-only test queue is excluded (it's not in DLQ_KNOWN_QUEUES).
   */
  async summary(companyId: string): Promise<DlqSummaryEntryDto[]> {
    const out: DlqSummaryEntryDto[] = [];
    for (const name of DLQ_KNOWN_QUEUES) {
      const queue = this.queueFor(name);
      let failed = 0;
      try {
        const jobs = await queue.getFailed(0, DLQ_MAX_LIMIT - 1);
        for (const job of jobs) {
          if (this.companyIdOf(job) === companyId) {
            failed += 1;
          }
        }
      } catch (err) {
        this.logger.warn(
          `Could not count failed jobs for queue ${name}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      out.push({ queue: name, failed });
    }
    return out;
  }

  /** Re-enqueue a failed job (retries it). 404 when not found or not the tenant's. */
  async replay(
    companyId: string,
    queueName: string,
    jobId: string,
  ): Promise<{ replayed: true; queue: string; jobId: string }> {
    const job = await this.ownedJob(companyId, queueName, jobId);
    await job.retry(); // moves it from the failed set back to waiting
    return { replayed: true, queue: queueName, jobId };
  }

  /** Permanently remove a failed job. 404 when not found or not the tenant's. */
  async discard(
    companyId: string,
    queueName: string,
    jobId: string,
  ): Promise<{ discarded: true; queue: string; jobId: string }> {
    const job = await this.ownedJob(companyId, queueName, jobId);
    await job.remove();
    return { discarded: true, queue: queueName, jobId };
  }

  async onModuleDestroy(): Promise<void> {
    for (const queue of this.queues.values()) {
      try {
        await queue.close();
      } catch {
        // best-effort teardown
      }
    }
    this.queues.clear();
  }

  // --- Internals -----------------------------------------------------------

  /** Fetch a failed job that belongs to the caller, or throw 404 (no leak). */
  private async ownedJob(
    companyId: string,
    queueName: string,
    jobId: string,
  ): Promise<Job> {
    const queue = this.queueFor(this.assertKnown(queueName));
    const job = await queue.getJob(jobId);
    if (!job || this.companyIdOf(job) !== companyId) {
      // Same 404 whether the job is missing or another tenant's (no enumeration).
      throw new NotFoundException('DLQ job not found');
    }
    return job;
  }

  private assertKnown(queueName: string): string {
    if (!DLQ_ALLOWED_QUEUES.includes(queueName)) {
      throw new BadRequestException(`Unknown queue: ${queueName}`);
    }
    return queueName;
  }

  private queueFor(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: { ...this.connection } });
      this.queues.set(name, queue);
    }
    return queue;
  }

  /** Read `companyId` from a job's payload (null when absent/typed wrong). */
  private companyIdOf(job: Job): string | null {
    const data = job.data as { companyId?: unknown } | null | undefined;
    return data && typeof data.companyId === 'string' ? data.companyId : null;
  }

  private toDto(queue: string, job: Job, companyId: string | null): DlqJobDto {
    return {
      id: String(job.id),
      queue,
      name: job.name,
      companyId,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason ?? null,
      timestamp: job.timestamp ?? null,
      finishedOn: job.finishedOn ?? null,
      data: (job.data as Record<string, unknown> | null) ?? null,
    };
  }

  private clampLimit(limit?: number): number {
    if (limit == null || !Number.isFinite(limit) || limit <= 0) {
      return DLQ_DEFAULT_LIMIT;
    }
    return Math.min(Math.floor(limit), DLQ_MAX_LIMIT);
  }
}
