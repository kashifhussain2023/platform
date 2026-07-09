import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type AiEmployee, type Conversation } from '@prisma/client';
import type {
  AiEmployeeDto,
  ConversationDto,
  MessageDto,
  RunResultDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import {
  toConversationDto,
  toEmployeeDto,
  toMessageDto,
} from './employees.mapper';
import { AgentRuntimeService } from './runtime/agent-runtime.service';

/**
 * Tenant-scoped CRUD for AI employees + their conversations, plus the message
 * entrypoint that drives the AgentRuntimeService. Every query is scoped by
 * companyId (from the JWT) so tenants never see each other's data.
 */
@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly runtime: AgentRuntimeService,
  ) {}

  // --- Employees -----------------------------------------------------------

  async create(
    companyId: string,
    dto: CreateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    const employee = await this.prisma.aiEmployee.create({
      data: {
        companyId,
        name: dto.name,
        role: dto.role,
        persona: dto.persona ?? null,
        model: dto.model ?? null,
      },
    });
    return toEmployeeDto(employee);
  }

  async list(companyId: string): Promise<AiEmployeeDto[]> {
    const employees = await this.prisma.aiEmployee.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return employees.map(toEmployeeDto);
  }

  async get(companyId: string, id: string): Promise<AiEmployeeDto> {
    return toEmployeeDto(await this.findOwnedEmployee(companyId, id));
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateEmployeeDto,
  ): Promise<AiEmployeeDto> {
    await this.findOwnedEmployee(companyId, id);
    const employee = await this.prisma.aiEmployee.update({
      where: { id },
      data: {
        name: dto.name,
        status: dto.status,
        persona: dto.persona,
        model: dto.model,
        // Rich configuration (Step 5). TODO: budgetLimit / permissions /
        // approvalRules are persisted here but enforced by a future Approval Center.
        department: dto.department,
        managerName: dto.managerName,
        workingHoursStart: dto.workingHoursStart,
        workingHoursEnd: dto.workingHoursEnd,
        timezone: dto.timezone,
        language: dto.language,
        knowledgeAccess: dto.knowledgeAccess,
        budgetLimit: dto.budgetLimit,
        permissions:
          dto.permissions === undefined
            ? undefined
            : (dto.permissions as Prisma.InputJsonValue),
        approvalRules:
          dto.approvalRules === undefined
            ? undefined
            : (dto.approvalRules as Prisma.InputJsonValue),
      },
    });
    return toEmployeeDto(employee);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.findOwnedEmployee(companyId, id);
    // Cascades to conversations, messages and memories (onDelete: Cascade).
    await this.prisma.aiEmployee.delete({ where: { id } });
  }

  // --- Conversations -------------------------------------------------------

  async startConversation(
    companyId: string,
    employeeId: string,
    title?: string,
  ): Promise<ConversationDto> {
    await this.findOwnedEmployee(companyId, employeeId);
    const conversation = await this.prisma.conversation.create({
      data: { companyId, employeeId, title: title ?? null },
    });
    return toConversationDto(conversation);
  }

  async listConversations(
    companyId: string,
    employeeId: string,
  ): Promise<ConversationDto[]> {
    await this.findOwnedEmployee(companyId, employeeId);
    const conversations = await this.prisma.conversation.findMany({
      where: { companyId, employeeId },
      orderBy: { createdAt: 'desc' },
    });
    return conversations.map(toConversationDto);
  }

  // --- Messages ------------------------------------------------------------

  async listMessages(
    companyId: string,
    conversationId: string,
  ): Promise<MessageDto[]> {
    await this.findOwnedConversation(companyId, conversationId);
    const messages = await this.prisma.message.findMany({
      where: { companyId, conversationId },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map(toMessageDto);
  }

  /** Run one agent turn: persists the user + assistant messages, returns the result. */
  async sendMessage(
    companyId: string,
    conversationId: string,
    content: string,
  ): Promise<RunResultDto> {
    const conversation = await this.findOwnedConversation(
      companyId,
      conversationId,
    );
    const employee = await this.prisma.aiEmployee.findFirst({
      where: { id: conversation.employeeId, companyId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    // Runtime throws 409 (ConflictException) if the employee is PAUSED/DISABLED.
    return this.runtime.run(employee, conversation, content);
  }

  // --- Ownership helpers ---------------------------------------------------

  private async findOwnedEmployee(
    companyId: string,
    id: string,
  ): Promise<AiEmployee> {
    const employee = await this.prisma.aiEmployee.findFirst({
      where: { id, companyId },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }
    return employee;
  }

  private async findOwnedConversation(
    companyId: string,
    id: string,
  ): Promise<Conversation> {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id, companyId },
    });
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }
}
