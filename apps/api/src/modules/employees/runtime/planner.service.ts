import { Injectable } from '@nestjs/common';
import type { EmployeeRole } from '@vaep/types';
import { PLAN_PROMPT_MARKER } from '../employees.constants';
import { LlmRouterService } from './llm-router.service';

/**
 * Produces a short step plan for the user's request given the employee role by
 * asking the LLM (via the router). The MockLlmProvider returns a deterministic
 * numbered plan; real providers are prompted for the same shape. Output is
 * parsed into clean, numbered-prefix-free steps with a sane fallback.
 */
@Injectable()
export class PlannerService {
  constructor(private readonly router: LlmRouterService) {}

  async plan(
    role: EmployeeRole,
    name: string,
    userText: string,
  ): Promise<string[]> {
    const system =
      `${PLAN_PROMPT_MARKER}\n` +
      `You are ${name}, a ${role} AI employee. Produce a short (3-5 step) plan ` +
      'for how you will handle the user request. Respond with a numbered list, ' +
      'one step per line, and nothing else.';

    const { content } = await this.router
      .forTask('plan')
      .complete({ system, messages: [{ role: 'user', content: userText }], temperature: 0 });

    const steps = content
      .split('\n')
      .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
      .filter((line) => line.length > 0);

    return steps.length > 0 ? steps : this.fallbackPlan(userText);
  }

  private fallbackPlan(userText: string): string[] {
    const trimmed = userText.replace(/\s+/g, ' ').trim().slice(0, 120);
    return [
      `Understand the request: ${trimmed}`,
      'Retrieve relevant company knowledge',
      'Draft a grounded, cited answer',
      'Validate confidence before responding',
    ];
  }
}
