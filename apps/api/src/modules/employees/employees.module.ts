import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { SkillsModule } from '../skills/skills.module';
import { ConversationsController } from './conversations.controller';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { AnthropicLlmProvider } from './llm/anthropic-llm.provider';
import { LLM_PROVIDER_TOKEN, type LlmProvider } from './llm/llm.provider';
import { MockLlmProvider } from './llm/mock-llm.provider';
import { OpenAiLlmProvider } from './llm/openai-llm.provider';
import { AgentRuntimeService } from './runtime/agent-runtime.service';
import { LlmRouterService } from './runtime/llm-router.service';
import { MemoryService } from './runtime/memory.service';
import { PlannerService } from './runtime/planner.service';
import { RetrievalService } from './runtime/retrieval.service';
import { ToolExecutorService } from './runtime/tool-executor.service';
import { ValidationService } from './runtime/validation.service';

/** Pick the LLM backend from LLM_PROVIDER (default: mock — offline, zero-dep). */
function llmFactory(config: ConfigService): LlmProvider {
  const kind = (config.get<string>('LLM_PROVIDER') ?? 'mock').toLowerCase();
  switch (kind) {
    case 'anthropic':
      return new AnthropicLlmProvider(config);
    case 'openai':
      return new OpenAiLlmProvider(config);
    case 'mock':
    default:
      return new MockLlmProvider();
  }
}

/**
 * AI Employee runtime module. Imports KnowledgeModule so RetrievalService can
 * reuse its tenant-scoped pgvector search (the "retrieve-knowledge" step).
 */
@Module({
  imports: [KnowledgeModule, SkillsModule],
  controllers: [EmployeesController, ConversationsController],
  providers: [
    EmployeesService,
    AgentRuntimeService,
    LlmRouterService,
    PlannerService,
    RetrievalService,
    MemoryService,
    ToolExecutorService,
    ValidationService,
    // Swap the LLM backend via LLM_PROVIDER (mirrors the embeddings factory).
    {
      provide: LLM_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: llmFactory,
    },
  ],
  exports: [EmployeesService],
})
export class EmployeesModule {}
