import type { ApprovalRequest } from '@prisma/client';
import type { ApprovalRequestDto } from '@vaep/types';

/** Prisma row → public DTO mapper for the approvals module. */
export function toApprovalRequestDto(a: ApprovalRequest): ApprovalRequestDto {
  return {
    id: a.id,
    companyId: a.companyId,
    employeeId: a.employeeId,
    conversationId: a.conversationId,
    skillKey: a.skillKey,
    tool: a.tool,
    args: (a.args as Record<string, unknown>) ?? {},
    result: a.result ?? null,
    description: a.description,
    status: a.status,
    decidedById: a.decidedById,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    note: a.note,
    createdAt: a.createdAt.toISOString(),
  };
}
