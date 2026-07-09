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
 * reject / modify). Approve + modify EXECUTE the tool via SkillsService.runTool
 * (which writes the SkillExecution audit row); reject never executes. Every query
 * is scoped by companyId (from the JWT) so tenants never see each other's data.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly skills: SkillsService,
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

  /** Approve → execute the stored tool call now, record the result. */
  async approve(
    companyId: string,
    id: string,
    userId: string,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    const req = await this.findPending(companyId, id);
    const call = await this.execute(req);
    return this.finalize(id, call, userId, note);
  }

  /** Reject → mark REJECTED without executing. */
  async reject(
    companyId: string,
    id: string,
    userId: string,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    await this.findPending(companyId, id);
    const row = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'REJECTED',
        decidedById: userId,
        decidedAt: new Date(),
        note: note ?? null,
      },
    });
    return toApprovalRequestDto(row);
  }

  /** Modify → execute with the NEW args, record them, mark APPROVED. */
  async modify(
    companyId: string,
    id: string,
    userId: string,
    args: Record<string, unknown>,
    note?: string,
  ): Promise<ApprovalRequestDto> {
    const req = await this.findPending(companyId, id);
    const call = await this.execute({ ...req, args: args as Prisma.JsonValue });
    return this.finalize(id, call, userId, note ?? 'Modified before approval', {
      ...args,
    });
  }

  // --- Internals -----------------------------------------------------------

  /** Run the stored tool call via the Skills module (logs a SkillExecution). */
  private execute(req: ApprovalRequest): Promise<ToolCallDto> {
    return this.skills.runTool(
      {
        companyId: req.companyId,
        employeeId: req.employeeId,
        conversationId: req.conversationId,
      },
      req.skillKey,
      req.tool,
      (req.args as Record<string, unknown>) ?? {},
    );
  }

  /** Persist an APPROVED decision with the tool result (and optionally new args). */
  private async finalize(
    id: string,
    call: ToolCallDto,
    userId: string,
    note?: string,
    args?: Record<string, unknown>,
  ): Promise<ApprovalRequestDto> {
    const row = await this.prisma.approvalRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        result:
          call.result == null
            ? Prisma.JsonNull
            : (call.result as Prisma.InputJsonValue),
        decidedById: userId,
        decidedAt: new Date(),
        note: note ?? null,
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

  private async findPending(
    companyId: string,
    id: string,
  ): Promise<ApprovalRequest> {
    const row = await this.findOwned(companyId, id);
    if (row.status !== 'PENDING') {
      throw new ConflictException(
        `Approval request is already ${row.status.toLowerCase()}`,
      );
    }
    return row;
  }
}
