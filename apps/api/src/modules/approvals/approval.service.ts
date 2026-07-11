import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type ApprovalRequest } from '@prisma/client';
import type {
  ApprovalRequestDto,
  ApprovalRules,
  ApprovalStatus,
  ToolCallDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SkillCatalog } from '../skills/catalog';
import { SkillsService } from '../skills/skills.service';
import { WorkflowsService } from '../workflows/workflows.service';
import { toApprovalRequestDto } from './approvals.mapper';

/** Minimal shape needed to evaluate an employee's approval policy. */
export interface ApprovalPolicyEmployee {
  approvalRules?: Prisma.JsonValue | null;
}

/** Input to create a PENDING approval request for a proposed tool call. */
export interface CreateApprovalInput {
  companyId: string;
  employeeId?: string | null;
  conversationId?: string | null;
  skillKey: string;
  tool: string;
  args: Record<string, unknown>;
  description?: string;
}

/**
 * Approval Center: decides whether a proposed tool call must pause for human
 * review, captures PENDING requests, and applies a manager's decision (approve /
 * reject / modify). Two kinds of request are decided here:
 * - TOOL (default): a high-risk AI-employee tool call. Approve/modify EXECUTE the
 *   tool via SkillsService.runTool (which writes the SkillExecution audit row);
 *   reject never executes.
 * - WORKFLOW: a workflow run paused at an APPROVAL node. No tool is executed —
 *   approve RESUMES the run (WorkflowsService.resumeRun) and reject FAILS it
 *   (WorkflowsService.cancelRun); modify is treated as approve.
 *
 * Every query is scoped by companyId (from the JWT) so tenants never see each
 * other's data.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
    private readonly workflows: WorkflowsService,
  ) {}

  /**
   * True when this tool call must pause for approval: the catalog tool is
   * `highRisk`, OR the employee's approvalRules require all tools, OR its
   * `requireApprovalForTools` includes `skillKey` or `skillKey:tool`.
   */
  requiresApproval(
    employee: ApprovalPolicyEmployee,
    skillKey: string,
    tool: string,
  ): boolean {
    if (SkillCatalog.getTool(skillKey, tool)?.highRisk) {
      return true;
    }
    const rules = this.parseRules(employee.approvalRules);
    if (rules.requireApprovalForAllTools) {
      return true;
    }
    const list = rules.requireApprovalForTools ?? [];
    return list.includes(skillKey) || list.includes(`${skillKey}:${tool}`);
  }

  /** Create a PENDING approval request capturing a proposed tool call. */
  async createRequest(
    input: CreateApprovalInput,
  ): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.create({
      data: {
        companyId: input.companyId,
        employeeId: input.employeeId ?? null,
        conversationId: input.conversationId ?? null,
        skillKey: input.skillKey,
        tool: input.tool,
        args: (input.args ?? {}) as Prisma.InputJsonObject,
        description: input.description ?? null,
        status: 'PENDING',
      },
    });
    return toApprovalRequestDto(row);
  }

  async list(
    companyId: string,
    status?: ApprovalStatus,
  ): Promise<ApprovalRequestDto[]> {
    const rows = await this.prisma.approvalRequest.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toApprovalRequestDto);
  }

  async get(companyId: string, id: string): Promise<ApprovalRequestDto> {
    return toApprovalRequestDto(await this.findOwned(companyId, id));
  }

  /**
   * Approve. WORKFLOW → mark APPROVED and resume the paused run (no tool runs).
   * TOOL → execute the stored tool call now and record the result.
   */
  async approve(
    companyId: string,
    id: string,
    userId: string,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    const req = await this.findOwned(companyId, id);
    await this.claim(companyId, id, 'APPROVED', userId, note);
    if (req.kind === 'WORKFLOW') {
      return this.decideWorkflow(req, true, note);
    }
    const call = await this.execute(req);
    return this.finalize(id, call);
  }

  /**
   * Reject → mark REJECTED without executing. WORKFLOW → also FAIL the paused run
   * (WorkflowsService.cancelRun) so it never reaches the steps after the approval.
   */
  async reject(
    companyId: string,
    id: string,
    userId: string,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    const req = await this.findOwned(companyId, id);
    const row = await this.claim(companyId, id, 'REJECTED', userId, note);
    if (req.kind === 'WORKFLOW') {
      return this.decideWorkflow(req, false, note);
    }
    return toApprovalRequestDto(row);
  }

  /**
   * Modify. TOOL → execute with the NEW args, record them, mark APPROVED.
   * WORKFLOW → modifying args is meaningless (no tool is gated), so treat it as a
   * plain approve (resume the run).
   */
  async modify(
    companyId: string,
    id: string,
    userId: string,
    args: Record<string, unknown>,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    const req = await this.findOwned(companyId, id);
    await this.claim(
      companyId,
      id,
      'APPROVED',
      userId,
      note ?? 'Modified before approval',
    );
    if (req.kind === 'WORKFLOW') {
      return this.decideWorkflow(req, true, note);
    }
    const call = await this.execute({ ...req, args: args as Prisma.JsonValue });
    return this.finalize(id, call, { ...args });
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Atomically claim a PENDING request by flipping its status — race-safe via a
   * conditional UPDATE (`WHERE status = 'PENDING'`): Postgres row-locks the first
   * writer, and a concurrent second writer's WHERE re-evaluates against the
   * now-committed row and matches zero rows. This is what actually prevents two
   * managers approving+rejecting (or double-approving) the SAME request at once —
   * the previous code only checked status with a separate SELECT (`findPending`)
   * BEFORE executing a tool/resuming a run, which both concurrent calls could
   * pass, leading to a tool executing twice or a run being both resumed and
   * cancelled. Throws ConflictException (same message as before) if the claim
   * is lost.
   */
  private async claim(
    companyId: string,
    id: string,
    status: 'APPROVED' | 'REJECTED',
    userId: string,
    note?: string,
  ): Promise<ApprovalRequest> {
    const result = await this.prisma.approvalRequest.updateMany({
      where: { id, companyId, status: 'PENDING' },
      data: {
        status,
        decidedById: userId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });
    if (result.count === 0) {
      const existing = await this.findOwned(companyId, id);
      throw new ConflictException(
        `Approval request is already ${existing.status.toLowerCase()}`,
      );
    }
    return this.prisma.approvalRequest.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Apply a decision to an ALREADY-CLAIMED WORKFLOW-kind request: resume
   * (approve) or cancel (reject) the paused run via WorkflowsService. No tool is
   * executed and no SkillExecution is written.
   */
  private async decideWorkflow(
    req: ApprovalRequest,
    approved: boolean,
    note: string | undefined,
  ): Promise<ApprovalRequestDto> {
    if (req.workflowRunId) {
      if (approved) {
        await this.workflows.resumeRun(req.workflowRunId);
      } else {
        await this.workflows.cancelRun(
          req.workflowRunId,
          note ?? 'Rejected by approver',
        );
      }
    }
    const row = await this.prisma.approvalRequest.findUniqueOrThrow({
      where: { id: req.id },
    });
    return toApprovalRequestDto(row);
  }

  /**
   * Run the stored tool call via the Skills module (logs a SkillExecution). Only
   * called for TOOL-kind requests, whose skillKey/tool are always set (they are
   * nullable in the schema only so WORKFLOW-kind rows can omit them).
   */
  private execute(req: ApprovalRequest): Promise<ToolCallDto> {
    return this.skills.runTool(
      {
        companyId: req.companyId,
        employeeId: req.employeeId,
        conversationId: req.conversationId,
      },
      req.skillKey ?? '',
      req.tool ?? '',
      (req.args as Record<string, unknown>) ?? {},
    );
  }

  /**
   * Record the tool result (and optionally new args) on an ALREADY-CLAIMED
   * (status:APPROVED, decidedBy/At/note already set by `claim`) request.
   */
  private async finalize(
    id: string,
    call: ToolCallDto,
    args?: Record<string, unknown>,
  ): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        result:
          call.result == null
            ? Prisma.JsonNull
            : (call.result as Prisma.InputJsonValue),
        ...(args ? { args: args as Prisma.InputJsonObject } : {}),
      },
    });
    return toApprovalRequestDto(row);
  }

  private parseRules(rules: Prisma.JsonValue | null | undefined): ApprovalRules {
    if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
      return rules as ApprovalRules;
    }
    return {};
  }

  private async findOwned(
    companyId: string,
    id: string,
  ): Promise<ApprovalRequest> {
    const row = await this.prisma.approvalRequest.findFirst({
      where: { id, companyId },
    });
    if (!row) {
      throw new NotFoundException('Approval request not found');
    }
    return row;
  }

}
