import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { estimateCostUsd } from './usage-rates';

export interface RecordUsageParams {
  companyId: string;
  employeeId?: string | null;
  /** e.g. "chat", "workflow_ai_step", "workflow_generator". */
  source: string;
  promptTokens: number;
  completionTokens: number;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

/**
 * Real LLM usage/cost tracking (founder-market-readiness-audit.md §7): before
 * this, the billing usage page's "tasks" number was an activity count, not
 * spend, and nothing anywhere tracked token usage or cost per company or
 * employee. This is the prerequisite for budget-limit enforcement (§8/§4) --
 * you can't enforce a spend cap without first knowing real spend.
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one completion's usage. Never throws -- a metering write failing
   * must not break the real chat/workflow turn it's describing (same
   * best-effort contract as AuditLogService.record).
   */
  async record(params: RecordUsageParams): Promise<void> {
    try {
      await this.prisma.usageEvent.create({
        data: {
          companyId: params.companyId,
          employeeId: params.employeeId ?? null,
          source: params.source,
          promptTokens: params.promptTokens,
          completionTokens: params.completionTokens,
          estimatedCostUsd: estimateCostUsd(
            params.promptTokens,
            params.completionTokens,
          ),
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record usage event (${params.source}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Company-wide totals, optionally since a given date. */
  async totalsForCompany(
    companyId: string,
    sinceDate?: Date,
  ): Promise<UsageTotals> {
    const agg = await this.prisma.usageEvent.aggregate({
      where: { companyId, ...(sinceDate ? { createdAt: { gte: sinceDate } } : {}) },
      _sum: {
        promptTokens: true,
        completionTokens: true,
        estimatedCostUsd: true,
      },
    });
    return {
      promptTokens: agg._sum.promptTokens ?? 0,
      completionTokens: agg._sum.completionTokens ?? 0,
      estimatedCostUsd: agg._sum.estimatedCostUsd ?? 0,
    };
  }

  /** One employee's total estimated cost since a given date. */
  async totalCostForEmployee(
    companyId: string,
    employeeId: string,
    sinceDate: Date,
  ): Promise<number> {
    const agg = await this.prisma.usageEvent.aggregate({
      where: { companyId, employeeId, createdAt: { gte: sinceDate } },
      _sum: { estimatedCostUsd: true },
    });
    return agg._sum.estimatedCostUsd ?? 0;
  }
}
