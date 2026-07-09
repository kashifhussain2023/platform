import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma, type AiEmployee, type Conversation } from '@prisma/client';
import type { MessageMetadataDto, RunResultDto } from '@vaep/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CONTEXT_CLOSE, CONTEXT_OPEN } from '../employees.constants';
import type { LlmMessage } from '../llm/llm.provider';
import { toMessageDto } from '../employees.mapper';
import { LlmRouterService } from './llm-router.service';
import { MemoryService, type LoadedMemory } from './memory.service';
import { PlannerService } from './planner.service';
import { RetrievalService } from './retrieval.service';
import { ToolExecutorService } from './tool-executor.service';
import { ValidationService } from './validation.service';

function clip(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n).trimEnd()}…`;
}

/**
 * The core agent loop. Orchestrates the single-purpose runtime services:
 *   guard status → persist user turn → PLAN → RETRIEVE (knowledge) → load MEMORY
 *   → ACT (LLM draft; tool-executor stub) → VALIDATE (grounding/confidence) →
 *   persist assistant Message (with {plan, sources, validation} metadata) →
 *   write a SUMMARY memory → return RunResultDto.
 */
@Injectable()
export class AgentRuntimeService {
  private readonly logger = new Logger(AgentRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: LlmRouterService,
    private readonly planner: PlannerService,
    private readonly retrieval: RetrievalService,
    private readonly memory: MemoryService,
    private readonly toolExecutor: ToolExecutorService,
    private readonly validation: ValidationService,
  ) {}

  async run(
    employee: AiEmployee,
    conversation: Conversation,
    userText: string,
  ): Promise<RunResultDto> {
    // Guard: only ACTIVE employees accept new work.
    if (employee.status !== 'ACTIVE') {
      throw new ConflictException(
        `Employee is ${employee.status.toLowerCase()} and cannot accept messages`,
      );
    }

    const { companyId } = employee;

    // Persist the user turn first so it is part of the loaded memory/history.
    await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        role: 'USER',
        content: userText,
      },
    });

    // PLAN → RETRIEVE (knowledge) → load MEMORY.
    const plan = await this.planner.plan(employee.role, employee.name, userText);
    const sources = await this.retrieval.retrieve(companyId, userText);
    const memory = await this.memory.load(
      companyId,
      conversation.id,
      employee.id,
    );

    // ACT: consult the tool executor (stub — no skills yet), then draft with the
    // LLM using a system prompt built from persona + plan + retrieved knowledge.
    const tools = await this.toolExecutor.listTools(companyId);
    this.logger.debug(
      `run: employee=${employee.id} tools=${tools.length} sources=${sources.length}`,
    );

    const system = this.buildSystemPrompt(employee, plan, sources, memory);
    const messages = this.buildMessages(memory, userText);
    const draft = await this.router
      .forTask('act')
      .complete({ system, messages, temperature: 0.2 });
    const answer = draft.content.trim();

    // VALIDATE grounding + confidence.
    const validation = this.validation.validate(employee.role, answer, sources);

    // Persist the assistant turn with structured runtime metadata.
    const metadata: MessageMetadataDto = { plan, sources, validation };
    const assistant = await this.prisma.message.create({
      data: {
        companyId,
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: answer,
        metadata: metadata as unknown as Prisma.InputJsonObject,
      },
    });

    // Write a rolling SUMMARY memory (recalled later by recency).
    await this.memory.appendSummary(
      companyId,
      employee.id,
      `User asked: "${clip(userText, 160)}". Answered ${
        validation.grounded ? 'with grounded knowledge' : 'without strong grounding'
      } (confidence ${validation.confidence}).`,
    );

    return {
      message: toMessageDto(assistant),
      plan,
      sources,
      validation,
    };
  }

  /** System prompt: persona + role + plan + retrieved knowledge (delimited) + memory. */
  private buildSystemPrompt(
    employee: AiEmployee,
    plan: string[],
    sources: RunResultDto['sources'],
    memory: LoadedMemory,
  ): string {
    const lines: string[] = [
      `You are ${employee.name}, a ${employee.role} AI employee working for this company.`,
    ];
    if (employee.persona) {
      lines.push(`Persona and guidelines: ${employee.persona}`);
    }
    lines.push('', 'Plan you are following:');
    plan.forEach((step, i) => lines.push(`${i + 1}. ${step}`));

    if (memory.memories.length > 0) {
      lines.push('', 'What you remember from earlier:');
      memory.memories.forEach((m) => lines.push(`- ${m.content}`));
    }

    lines.push('', 'Relevant company knowledge (cite by number):', CONTEXT_OPEN);
    if (sources.length > 0) {
      sources.forEach((s, i) => lines.push(`[${i + 1}] ${s.content}`));
    } else {
      lines.push('(no relevant company knowledge was found)');
    }
    lines.push(
      CONTEXT_CLOSE,
      '',
      'Answer the user grounded in the company knowledge above, citing sources by ' +
        'their [number]. If the knowledge does not cover the question, say so plainly.',
    );
    return lines.join('\n');
  }

  /** Map persisted turns to the LLM message shape (USER/ASSISTANT only). */
  private buildMessages(memory: LoadedMemory, userText: string): LlmMessage[] {
    const mapped: LlmMessage[] = memory.messages
      .filter((m) => m.role === 'USER' || m.role === 'ASSISTANT')
      .map((m) => ({
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.content,
      }));
    return mapped.length > 0 ? mapped : [{ role: 'user', content: userText }];
  }
}
