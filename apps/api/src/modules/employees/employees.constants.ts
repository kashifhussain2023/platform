import type { EmployeeRole } from '@vaep/types';

/**
 * Shared constants for the AI employee runtime. The prompt markers below are the
 * contract between AgentRuntimeService (which builds prompts) and the
 * MockLlmProvider (which produces deterministic output from them) — keeping them
 * here means there is a single source of truth for both sides.
 */

/** Marker placed in a system prompt to ask the LLM for a numbered step plan. */
export const PLAN_PROMPT_MARKER = '[[VAEP:PLAN]]';

/** Delimiters wrapping the retrieved-knowledge block in the ACT system prompt. */
export const CONTEXT_OPEN = '<<<VAEP_CONTEXT';
export const CONTEXT_CLOSE = 'VAEP_CONTEXT>>>';

/**
 * Prefix the runtime uses when it appends a tool RESULT back into the working
 * messages during the act loop. The MockLlmProvider keys off this marker to know
 * a tool has already run (→ produce a final grounded answer instead of another
 * tool call). Shared here so both sides agree on the contract.
 */
export const TOOL_RESULT_MARKER = '[[VAEP:TOOL_RESULT]]';

/** Hard cap on act-loop iterations (tool calls) per turn, to keep runs bounded. */
export const MAX_ACT_ITERATIONS = 3;

/** How many recent conversation messages the MemoryService loads for context. */
export const RECENT_MESSAGE_LIMIT = 10;

/** How many recent employee memories to recall (by recency). */
export const RECENT_MEMORY_LIMIT = 5;

/** Default number of knowledge chunks retrieved per run. */
export const RETRIEVAL_K = 5;

/** Confidence at/above which an answer does not, by itself, need approval. */
export const APPROVAL_CONFIDENCE_THRESHOLD = 0.5;

/**
 * Roles whose actions are sensitive enough that a run is always flagged for
 * human approval (regardless of confidence).
 */
export const HIGH_STAKES_ROLES: readonly EmployeeRole[] = ['ACCOUNTANT', 'HR'];
