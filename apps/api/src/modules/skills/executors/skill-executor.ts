/**
 * Swappable skill-execution backend (mirrors the knowledge EmbeddingProvider and
 * employees LlmProvider patterns). The active implementation is provided as a
 * singleton under SKILL_EXECUTOR_TOKEN. The default (`mock`) is deterministic,
 * offline and side-effect-free so tools are safe to run with no credentials.
 */

/** Who/what a tool is executed for — carried into the audit log. */
export interface ExecutorContext {
  companyId: string;
  employeeId?: string | null;
  conversationId?: string | null;
}

/** Outcome of executing a single tool. */
export interface SkillExecutionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface SkillExecutor {
  /** Stable id of the backend (e.g. `mock`). */
  readonly name: string;
  /** Execute `tool` of `skillKey` with `args`. Must not throw for tool-level failures. */
  execute(
    skillKey: string,
    tool: string,
    args: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<SkillExecutionResult>;
}

/** DI token for the active SkillExecutor implementation. */
export const SKILL_EXECUTOR_TOKEN = Symbol('SKILL_EXECUTOR_TOKEN');
