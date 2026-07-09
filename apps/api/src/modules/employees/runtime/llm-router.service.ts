import { Inject, Injectable } from '@nestjs/common';
import {
  LLM_PROVIDER_TOKEN,
  type LlmProvider,
} from '../llm/llm.provider';

/**
 * Chooses the LLM provider/model for a given task. For now it always returns the
 * single configured provider, but the `forTask` seam is in place so later work
 * can route (e.g.) planning to a cheap model and drafting to a stronger one
 * without touching the runtime services that depend on it.
 */
@Injectable()
export class LlmRouterService {
  constructor(
    @Inject(LLM_PROVIDER_TOKEN) private readonly provider: LlmProvider,
  ) {}

  /** Resolve the provider for a task kind (currently task-agnostic). */
  forTask(_task: 'plan' | 'act'): LlmProvider {
    return this.provider;
  }

  /** Name of the active provider (for logging / metadata). */
  get providerName(): string {
    return this.provider.name;
  }
}
