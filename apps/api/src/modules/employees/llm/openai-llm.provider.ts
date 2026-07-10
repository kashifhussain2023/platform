import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ToolDefinitionDto } from '@vaep/types';
import { SkillCatalog } from '../../skills/catalog';
import type {
  LlmCompletionInput,
  LlmCompletionResult,
  LlmProvider,
} from './llm.provider';

/**
 * Opt-in OpenAI provider (`LLM_PROVIDER=openai`). `openai` is imported lazily
 * (NOT a package.json dependency) and the client is created once. Model from
 * `LLM_MODEL` or `gpt-4o-mini`. Requires OPENAI_API_KEY.
 *
 * Tool calling maps our ToolDefinition[] to OpenAI function tools and reads back
 * `message.tool_calls[0]` (best-effort; not covered by the offline e2e).
 * TODO: the runtime feeds a tool RESULT back as a plain assistant text message
 * (TOOL_RESULT_MARKER), not as an OpenAI `role:'tool'` message keyed by
 * `tool_call_id`. Multi-step native tool use would need that threading; single
 * tool calls work as-is.
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
          tools?: Array<{
            type: 'function';
            function: { name: string; description: string; parameters: unknown };
          }>;
          messages: Array<{ role: string; content: string }>;
        }): Promise<{
          choices: Array<{
            message: {
              content: string | null;
              tool_calls?: Array<{
                function: { name: string; arguments: string };
              }>;
            };
          }>;
        }>;
      };
    };
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  async complete(
    input: LlmCompletionInput,
    tools?: ToolDefinitionDto[],
  ): Promise<LlmCompletionResult> {
    const client = await this.getClient();
    const model = this.config.get<string>('LLM_MODEL') ?? 'gpt-4o-mini';
    const res = await client.chat.completions.create({
      model,
      temperature: input.temperature ?? 0.2,
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              type: 'function' as const,
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          }
        : {}),
      messages: [
        { role: 'system', content: input.system },
        ...input.messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    });

    const message = res.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    if (toolCall?.function?.name) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}') as Record<
          string,
          unknown
        >;
      } catch {
        args = {};
      }
      return {
        toolCall: {
          skillKey: SkillCatalog.skillKeyForTool(toolCall.function.name) ?? '',
          tool: toolCall.function.name,
          args,
        },
      };
    }

    return { content: message?.content ?? '' };
  }

  private async getClient() {
    if (!this.client) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore optional dep — installed only when LLM_PROVIDER=openai
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      }) as unknown as NonNullable<typeof this.client>;
    }
    return this.client;
  }
}
