import type {
  AiEmployee,
  Conversation,
  EmployeeFeedback,
  EmployeeMemory,
  Message,
} from '@prisma/client';
import type {
  AiEmployeeDto,
  ConversationDto,
  EmployeeFeedbackDto,
  EmployeeMemoryDto,
  MemorySource,
  MessageDto,
  MessageMetadataDto,
} from '@vaep/types';

/** Prisma row → public DTO mappers (shared by the service + runtime). */

export function toEmployeeDto(e: AiEmployee): AiEmployeeDto {
  return {
    id: e.id,
    companyId: e.companyId,
    name: e.name,
    role: e.role,
    status: e.status,
    persona: e.persona,
    model: e.model,
    department: e.department,
    managerName: e.managerName,
    workingHoursStart: e.workingHoursStart,
    workingHoursEnd: e.workingHoursEnd,
    timezone: e.timezone,
    language: e.language,
    knowledgeAccess: e.knowledgeAccess,
    budgetLimit: e.budgetLimit,
    permissions: (e.permissions as Record<string, boolean> | null) ?? null,
    approvalRules: (e.approvalRules as Record<string, unknown> | null) ?? null,
    createdAt: e.createdAt.toISOString(),
  };
}

export function toConversationDto(c: Conversation): ConversationDto {
  return {
    id: c.id,
    companyId: c.companyId,
    employeeId: c.employeeId,
    title: c.title,
    createdAt: c.createdAt.toISOString(),
  };
}

export function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    companyId: m.companyId,
    conversationId: m.conversationId,
    role: m.role,
    content: m.content,
    metadata: (m.metadata as unknown as MessageMetadataDto | null) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toFeedbackDto(f: EmployeeFeedback): EmployeeFeedbackDto {
  return {
    id: f.id,
    companyId: f.companyId,
    employeeId: f.employeeId,
    conversationId: f.conversationId,
    messageId: f.messageId,
    rating: f.rating,
    note: f.note,
    correction: f.correction,
    createdAt: f.createdAt.toISOString(),
  };
}

export function toMemoryDto(m: EmployeeMemory): EmployeeMemoryDto {
  return {
    id: m.id,
    companyId: m.companyId,
    employeeId: m.employeeId,
    kind: m.kind,
    content: m.content,
    source: (m.source as MemorySource | null) ?? null,
    createdAt: m.createdAt.toISOString(),
  };
}
