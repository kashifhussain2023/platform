import { Injectable } from '@nestjs/common';

/** Outcome of attempting to run a tool/skill during the ACT step. */
export interface ToolResult {
  /** Whether a tool actually handled the step. */
  handled: boolean;
  /** Human-readable status/output. */
  output: string;
}

/**
 * Contract for executing installed skills/tools. The real implementation arrives
 * with the Skills module; this interface is defined now so the runtime's "act"
 * step is wired against a stable seam.
 */
export interface ToolExecutor {
  readonly name: string;
  /** Names of the tools currently available to this tenant/employee. */
  listTools(companyId: string): Promise<string[]>;
  /** Execute a named tool with arbitrary args. */
  execute(
    companyId: string,
    tool: string,
    args: unknown,
  ): Promise<ToolResult>;
}

/**
 * STUB executor: no skills are installed yet, so it advertises no tools and any
 * execution is a no-op. It is wired into the agent loop's ACT step so swapping
 * in the real Skills module later requires no runtime changes.
 */
@Injectable()
export class ToolExecutorService implements ToolExecutor {
  readonly name = 'stub';

  async listTools(_companyId: string): Promise<string[]> {
    return [];
  }

  async execute(
    _companyId: string,
    _tool: string,
    _args: unknown,
  ): Promise<ToolResult> {
    return { handled: false, output: 'no skills installed yet' };
  }
}
