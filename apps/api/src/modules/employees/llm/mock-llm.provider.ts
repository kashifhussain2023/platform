import { Injectable } from '@nestjs/common';
import {
  CONTEXT_CLOSE,
  CONTEXT_OPEN,
  PLAN_PROMPT_MARKER,
} from '../employees.constants';
import type {
  LlmCompletionInput,
  LlmCompletionResult,
  LlmProvider,
} from './llm.provider';

/** Truncate to `n` chars with an ellipsis, collapsing surrounding whitespace. */
function clip(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : `${clean.slice(0, n).trimEnd()}…`;
}

/** Return the text between the first `open` and the next `close`, or ''. */
function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  if (start === -1) {
    return '';
  }
  const from = start + open.length;
  const end = text.indexOf(close, from);
  return text.slice(from, end === -1 ? undefined : end);
}

/**
 * DEFAULT provider: fully offline, zero-dependency and DETERMINISTIC so tests
 * can assert on the output. It derives its answer entirely from the input:
 *  - PLAN prompts (containing PLAN_PROMPT_MARKER) → a numbered step plan.
 *  - ACT prompts → a grounded answer that quotes the retrieved knowledge block
 *    (between the CONTEXT markers), guaranteeing the ValidationService can see
 *    the answer is backed by the sources.
 */
@Injectable()
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const { system, messages } = input;
    const userText =
      [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

    // PLAN mode — deterministic numbered plan.
    if (system.includes(PLAN_PROMPT_MARKER)) {
      const steps = [
        `Interpret the request: ${clip(userText, 120)}`,
        'Retrieve relevant company knowledge',
        'Draft a grounded answer that cites the retrieved knowledge',
        'Validate confidence and flag for human approval if needed',
      ];
      return {
        content: steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      };
    }

    // ACT mode — quote the retrieved context so the answer is grounded.
    const context = between(system, CONTEXT_OPEN, CONTEXT_CLOSE).trim();
    if (!context) {
      return {
        content:
          `I don't have any company knowledge to answer "${clip(userText, 200)}" ` +
          'yet. Please add relevant documents to my knowledge base.',
      };
    }
    return {
      content:
        `Based on the company knowledge base, here is what I found regarding ` +
        `"${clip(userText, 200)}":\n\n${clip(context, 600)}`,
    };
  }
}
