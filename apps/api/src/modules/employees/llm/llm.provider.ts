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

/** Output of a completion. */
export interface LlmCompletionResult {
  content: string;
}

export interface LlmProvider {
  /** Stable id of the backend (e.g. `mock`, `anthropic`, `openai`). */
  readonly name: string;
  complete(input: LlmCompletionInput): Promise<LlmCompletionResult>;
}

/** DI token for the active LlmProvider implementation. */
export const LLM_PROVIDER_TOKEN = Symbol('LLM_PROVIDER_TOKEN');
