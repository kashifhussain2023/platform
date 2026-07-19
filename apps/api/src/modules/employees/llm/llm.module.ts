import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { requireRealProviderInProduction } from '../../../common/config/require-real-provider';
import { AnthropicLlmProvider } from './anthropic-llm.provider';
import { LLM_PROVIDER_TOKEN, type LlmProvider } from './llm.provider';
import { MockLlmProvider } from './mock-llm.provider';
import { OpenAiLlmProvider } from './openai-llm.provider';

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
      requireRealProviderInProduction('LLM_PROVIDER', 'mock');
      return new MockLlmProvider();
  }
}

/**
 * Standalone module that provides the shared LlmProvider singleton under
 * LLM_PROVIDER_TOKEN. Extracted from EmployeesModule so BOTH the AI Employee
 * runtime AND the WorkflowsModule (AI_STEP node) can inject the SAME instance
 * WITHOUT WorkflowsModule importing EmployeesModule. That decoupling is what
 * keeps the Approvals→Workflows dependency acyclic: EmployeesModule imports
 * ApprovalsModule, so if Workflows imported Employees the new
 * Approvals→Workflows edge would close a cycle
 * (Approvals→Workflows→Employees→Approvals). ConfigService is global.
 */
@Module({
  providers: [
    {
      provide: LLM_PROVIDER_TOKEN,
      inject: [ConfigService],
      useFactory: llmFactory,
    },
  ],
  exports: [LLM_PROVIDER_TOKEN],
})
export class LlmModule {}
