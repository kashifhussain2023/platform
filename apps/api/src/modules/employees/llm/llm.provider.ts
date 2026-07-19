import type { ToolDefinitionDto } from '@vaep/types';

/**
 * Swappable chat-completion backend (mirrors the knowledge EmbeddingProvider and
 * auth AuthProvider patterns). The active implementation is chosen by the
 * `LLM_PROVIDER` env var and provided as a singleton under the
 * LLM_PROVIDER_TOKEN DI token. The default (`mock`) is deterministic, offline
 * and zero-dependency so the whole runtime is runnable with no API key.
 */

/** A single chat turn. The system prompt is passed separately (see input). */
export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Input to a completion: a system prompt, the turns, and an optional temperature. */
export interface LlmCompletionInput {
  system: string;
  messages: LlmMessage[];
  temperature?: number;
}

/** A tool the model chose to invoke (resolved back to its owning skill). */
export interface LlmToolCall {
  skillKey: string;
  tool: string;
  args: Record<string, unknown>;
}

/** Token counts for one completion, when the backend reports them. */
export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
}

/**
 * Output of a completion: EITHER a final text `content` OR a `toolCall` the
 * runtime should execute before continuing the loop. `usage` is optional
 * because a provider that can't report it (or a hand-rolled test double)
 * simply omits it -- callers must treat it as best-effort, not guaranteed.
 */
export interface LlmCompletionResult {
  content?: string;
  toolCall?: LlmToolCall;
  usage?: LlmUsage;
}

export interface LlmProvider {
  /** Stable id of the backend (e.g. `mock`, `anthropic`, `openai`). */
  readonly name: string;
  /**
   * Complete a turn. When `tools` is non-empty the model MAY return a `toolCall`
   * instead of `content`; when it is empty/undefined the provider behaves as a
   * plain chat completion (returns `content`).
   */
  complete(
    input: LlmCompletionInput,
    tools?: ToolDefinitionDto[],
  ): Promise<LlmCompletionResult>;
}

/** DI token for the active LlmProvider implementation. */
export const LLM_PROVIDER_TOKEN = Symbol('LLM_PROVIDER_TOKEN');
