import { Injectable } from '@nestjs/common';
import type {
  ActivityFeedDto,
  ActivityItemDto,
  AnalyticsRange,
  EmployeeKpiDto,
  OverviewDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  HOURLY_RATE_USD,
  hoursSavedFor,
  rangeStart,
} from './analytics.constants';

/** Per-status skill-execution counts. */
interface ToolCounts {
  actions: number;
  success: number;
  errors: number;
}

/**
 * Read-only KPI aggregation over EXISTING data. Every query is scoped by
 * companyId (from the JWT). Activity-style metrics are bounded by `range` on
 * their relevant `createdAt`; current-state counts (employees, pending
 * approvals) are point-in-time. Uses Prisma count/groupBy only — never loads
 * bulk SkillExecution/Message rows. No models are written.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // --- Company overview ----------------------------------------------------

  async overview(companyId: string, range: AnalyticsRange): Promise<OverviewDto> {
    const start = rangeStart(range);
    const createdAt = this.createdAtFilter(start);

    const [
      toolByStatus,
      conversations,
      assistantMessages,
      workflowByStatus,
      pendingApprovals,
      employees,
      activeEmployees,
    ] = await Promise.all([
      this.prisma.skillExecution.groupBy({
        by: ['status'],
        where: { companyId, ...createdAt },
        _count: { _all: true },
      }),
      this.prisma.conversation.count({ where: { companyId, ...createdAt } }),
      this.prisma.message.count({
        where: { companyId, role: 'ASSISTANT', ...createdAt },
      }),
      this.prisma.workflowRun.groupBy({
        by: ['status'],
        where: { companyId, ...createdAt },
        _count: { _all: true },
      }),
      // Current-state counts (point-in-time; not range-bounded).
      this.prisma.approvalRequest.count({
        where: { companyId, status: 'PENDING' },
      }),
      this.prisma.aiEmployee.count({ where: { companyId } }),
      this.prisma.aiEmployee.count({ where: { companyId, status: 'ACTIVE' } }),
    ]);

    const tool = this.toolCounts(toolByStatus);
    const workflowRuns = this.sumCount(workflowByStatus);
    const workflowCompleted = this.countFor(workflowByStatus, 'COMPLETED');
    const workflowFailed = this.countFor(workflowByStatus, 'FAILED');

    // Derived ILLUSTRATIVE estimates.
    const tasksCompleted = tool.success + assistantMessages + workflowCompleted;
    const hoursSaved = hoursSavedFor(tasksCompleted);
    const costSavings = hoursSaved * HOURLY_RATE_USD;
    const successDenominator = tool.actions + workflowRuns;
    const successRate =
      successDenominator > 0
        ? (tool.success + workflowCompleted) / successDenominator
        : null;
    const utilization = employees > 0 ? activeEmployees / employees : 0;

    return {
      range,
      toolActions: tool.actions,
      toolSuccess: tool.success,
      toolErrors: tool.errors,
      conversations,
      assistantMessages,
      workflowRuns,
      workflowCompleted,
      workflowFailed,
      pendingApprovals,
      employees,
      activeEmployees,
      tasksCompleted,
      hoursSaved,
      costSavings,
      successRate,
      utilization,
    };
  }

  // --- Per-employee KPI rows -----------------------------------------------

  async employees(
    companyId: string,
    range: AnalyticsRange,
  ): Promise<EmployeeKpiDto[]> {
    const start = rangeStart(range);
    const createdAt = this.createdAtFilter(start);

    const employees = await this.prisma.aiEmployee.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, role: true, status: true },
    });
    if (employees.length === 0) return [];

    const [toolRows, convRows, assistantByEmployee, approvalRows] =
      await Promise.all([
        this.prisma.skillExecution.groupBy({
          by: ['employeeId', 'status'],
          where: { companyId, employeeId: { not: null }, ...createdAt },
          _count: { _all: true },
        }),
        this.prisma.conversation.groupBy({
          by: ['employeeId'],
          where: { companyId, ...createdAt },
          _count: { _all: true },
        }),
        this.assistantMessagesByEmployee(companyId, createdAt),
        this.prisma.approvalRequest.groupBy({
          by: ['employeeId'],
          where: { companyId, status: 'PENDING', employeeId: { not: null } },
          _count: { _all: true },
        }),
      ]);

    // Fold groupBy results into per-employee lookups.
    const tool = new Map<string, ToolCounts>();
    for (const row of toolRows) {
      if (!row.employeeId) continue;
      const cur = tool.get(row.employeeId) ?? { actions: 0, success: 0, errors: 0 };
      const n = row._count._all;
      cur.actions += n;
      if (row.status === 'SUCCESS') cur.success += n;
      if (row.status === 'ERROR') cur.errors += n;
      tool.set(row.employeeId, cur);
    }
    const conversations = new Map(
      convRows.map((r) => [r.employeeId, r._count._all]),
    );
    const pending = new Map(
      approvalRows
        .filter((r) => r.employeeId)
        .map((r) => [r.employeeId as string, r._count._all]),
    );

    return employees.map((e) => {
      const t = tool.get(e.id) ?? { actions: 0, success: 0, errors: 0 };
      const assistant = assistantByEmployee.get(e.id) ?? 0;
      const tasksCompleted = t.success + assistant;
      return {
        employeeId: e.id,
        name: e.name,
        role: e.role,
        status: e.status,
        toolActions: t.actions,
        toolSuccess: t.success,
        toolErrors: t.errors,
        conversations: conversations.get(e.id) ?? 0,
        assistantMessages: assistant,
        pendingApprovals: pending.get(e.id) ?? 0,
        tasksCompleted,
        hoursSaved: hoursSavedFor(tasksCompleted),
      };
    });
  }

  // --- "Today's AI Activity" feed ------------------------------------------

  async activity(
    companyId: string,
    range: AnalyticsRange,
  ): Promise<ActivityFeedDto[]> {
    const start = rangeStart(range);
    const createdAt = this.createdAtFilter(start);

    const employees = await this.prisma.aiEmployee.findMany({
      where: { companyId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, role: true },
    });
    if (employees.length === 0) return [];

    const [toolRows, assistantByEmployee] = await Promise.all([
      this.prisma.skillExecution.groupBy({
        by: ['employeeId', 'skillKey', 'tool'],
        where: { companyId, employeeId: { not: null }, ...createdAt },
        _count: { _all: true },
      }),
      this.assistantMessagesByEmployee(companyId, createdAt),
    ]);

    // employeeId → [{label, count}] for skill/tool actions.
    const toolItems = new Map<string, ActivityItemDto[]>();
    for (const row of toolRows) {
      if (!row.employeeId) continue;
      const items = toolItems.get(row.employeeId) ?? [];
      items.push({ label: `${row.skillKey} · ${row.tool}`, count: row._count._all });
      toolItems.set(row.employeeId, items);
    }

    const feed: ActivityFeedDto[] = [];
    for (const e of employees) {
      const items = [...(toolItems.get(e.id) ?? [])].sort(
        (a, b) => b.count - a.count,
      );
      const messages = assistantByEmployee.get(e.id) ?? 0;
      if (messages > 0) items.push({ label: 'messages', count: messages });
      if (items.length === 0) continue; // only surface employees with activity
      feed.push({ employeeId: e.id, employee: e.name, role: e.role, items });
    }
    return feed;
  }

  // --- Helpers -------------------------------------------------------------

  private createdAtFilter(start: Date | undefined) {
    return start ? { createdAt: { gte: start } } : {};
  }

  /**
   * Assistant-message counts per employee. Message has no employeeId, so group
   * assistant messages by conversationId then fold via the (id → employeeId)
   * conversation map. Two aggregate queries — no bulk Message rows loaded.
   */
  private async assistantMessagesByEmployee(
    companyId: string,
    createdAt: Record<string, unknown>,
  ): Promise<Map<string, number>> {
    const [byConversation, conversations] = await Promise.all([
      this.prisma.message.groupBy({
        by: ['conversationId'],
        where: { companyId, role: 'ASSISTANT', ...createdAt },
        _count: { _all: true },
      }),
      this.prisma.conversation.findMany({
        where: { companyId },
        select: { id: true, employeeId: true },
      }),
    ]);
    const conversationToEmployee = new Map(
      conversations.map((c) => [c.id, c.employeeId]),
    );
    const result = new Map<string, number>();
    for (const row of byConversation) {
      const employeeId = conversationToEmployee.get(row.conversationId);
      if (!employeeId) continue;
      result.set(employeeId, (result.get(employeeId) ?? 0) + row._count._all);
    }
    return result;
  }

  private toolCounts(
    rows: Array<{ status: string; _count: { _all: number } }>,
  ): ToolCounts {
    const counts: ToolCounts = { actions: 0, success: 0, errors: 0 };
    for (const row of rows) {
      counts.actions += row._count._all;
      if (row.status === 'SUCCESS') counts.success += row._count._all;
      if (row.status === 'ERROR') counts.errors += row._count._all;
    }
    return counts;
  }

  private sumCount(rows: Array<{ _count: { _all: number } }>): number {
    return rows.reduce((acc, r) => acc + r._count._all, 0);
  }

  private countFor(
    rows: Array<{ status: string; _count: { _all: number } }>,
    status: string,
  ): number {
    return rows.find((r) => r.status === status)?._count._all ?? 0;
  }
}
