import type { AiEmployee, Conversation, Message } from '@prisma/client';
import type {
  AiEmployeeDto,
  ConversationDto,
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
