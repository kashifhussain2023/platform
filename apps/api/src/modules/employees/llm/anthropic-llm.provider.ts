import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LlmCompletionInput,
  LlmCompletionResult,
  LlmProvider,
} from './llm.provider';

/**
 * Opt-in Anthropic provider (`LLM_PROVIDER=anthropic`). `@anthropic-ai/sdk` is
 * imported lazily (NOT a package.json dependency) and the client is created
 * once. Default model `claude-sonnet-5`, overridable via `LLM_MODEL`. Requires
 * ANTHROPIC_API_KEY.
 */
@Injectable()
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private client: {
    messages: {
      create(args: {
        model: string;
        max_tokens: number;
        temperature?: number;
        system?: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const client = await this.getClient();
    const model = this.config.get<string>('LLM_MODEL') ?? 'claude-sonnet-5';
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: input.temperature ?? 0.2,
      system: input.system,
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });
    const content = res.content
      .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
      .join('');
    return { content };
  }

  private async getClient() {
    if (!this.client) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error optional dep — installed only when LLM_PROVIDER=anthropic
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      this.client = new Anthropic({
        apiKey: this.config.getOrThrow<string>('ANTHROPIC_API_KEY'),
      }) as unknown as NonNullable<typeof this.client>;
    }
    return this.client;
  }
}
