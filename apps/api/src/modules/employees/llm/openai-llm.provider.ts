import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LlmCompletionInput,
  LlmCompletionResult,
  LlmProvider,
} from './llm.provider';

/**
 * Opt-in OpenAI provider (`LLM_PROVIDER=openai`). `openai` is imported lazily
 * (NOT a package.json dependency) and the client is created once. Model from
 * `LLM_MODEL` or `gpt-4o-mini`. Requires OPENAI_API_KEY.
 */
@Injectable()
export class OpenAiLlmProvider implements LlmProvider {
  readonly name = 'openai';
  private client: {
    chat: {
      completions: {
        create(args: {
          model: string;
          temperature?: number;
          messages: Array<{ role: string; content: string }>;
        }): Promise<{ choices: Array<{ message: { content: string | null } }> }>;
      };
    };
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const client = await this.getClient();
    const model = this.config.get<string>('LLM_MODEL') ?? 'gpt-4o-mini';
    const res = await client.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.2,
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });
    return { content: res.choices[0]?.message?.content ?? '' };
  }

  private async getClient() {
    if (!this.client) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error optional dep — installed only when LLM_PROVIDER=openai
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      }) as unknown as NonNullable<typeof this.client>;
    }
    return this.client;
  }
}
