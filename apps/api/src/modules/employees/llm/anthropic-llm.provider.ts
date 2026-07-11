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
 * Opt-in Anthropic provider (`LLM_PROVIDER=anthropic`). `@anthropic-ai/sdk` is
 * imported lazily (NOT a package.json dependency) and the client is created
 * once. Default model `claude-sonnet-5`, overridable via `LLM_MODEL`. Requires
 * ANTHROPIC_API_KEY.
 *
 * Tool calling maps our ToolDefinition[] to Anthropic `tools` and reads back a
 * `tool_use` content block (best-effort; not covered by the offline e2e).
 * TODO: the runtime currently feeds a tool RESULT back as a plain assistant text
 * message (TOOL_RESULT_MARKER), not as Anthropic's structured `tool_result`
 * block keyed by `tool_use_id`. Multi-step native tool use would need that
 * threading; single tool calls work as-is.
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
        tools?: Array<{
          name: string;
          description: string;
          input_schema: unknown;
        }>;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }): Promise<{
        content: Array<{
          type: string;
          text?: string;
          name?: string;
          input?: Record<string, unknown>;
        }>;
      }>;
    };
  } | null = null;

  constructor(private readonly config: ConfigService) {}

  async complete(
    input: LlmCompletionInput,
    tools?: ToolDefinitionDto[],
  ): Promise<LlmCompletionResult> {
    const client = await this.getClient();
    const model = this.config.get<string>('LLM_MODEL') ?? 'claude-sonnet-5';
    const res = await client.messages.create({
      model,
      max_tokens: 1024,
      temperature: input.temperature ?? 0.2,
      system: input.system,
      ...(tools && tools.length > 0
        ? {
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          }
        : {}),
      messages: input.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    // Prefer a tool call when the model requested one.
    const toolUse = res.content.find((b) => b.type === 'tool_use');
    if (toolUse?.name) {
      return {
        toolCall: {
          skillKey: SkillCatalog.resolveSkillKey(toolUse.name, tools) ?? '',
          tool: toolUse.name,
          args: toolUse.input ?? {},
        },
      };
    }

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
