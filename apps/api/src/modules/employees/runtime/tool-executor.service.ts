import { Injectable } from '@nestjs/common';
import type { ToolCallDto, ToolDefinitionDto } from '@vaep/types';
import type { ExecutorContext } from '../../skills/executors/skill-executor';
import { SkillsService } from '../../skills/skills.service';

/** Minimal shape the executor needs to resolve an employee's tools. */
export interface ToolExecutorEmployee {
  id: string;
  companyId: string;
}

/**
 * Bridges the AI Employee runtime's ACT step to the Skills module. `listTools`
 * returns the tools available to an employee (assigned + enabled installed
 * skills); `call` runs one tool via SkillsService (which executes it through the
 * swappable SkillExecutor and writes a SkillExecution audit row), returning a
 * ToolCallDto the runtime records in the message metadata.
 */
@Injectable()
export class ToolExecutorService {
  readonly name = 'skills';

  constructor(private readonly skills: SkillsService) {}

  /** Tools this employee may call this turn. Empty → the runtime skips tool use. */
  listTools(employee: ToolExecutorEmployee): Promise<ToolDefinitionDto[]> {
    return this.skills.getToolsForEmployee(employee.companyId, employee.id);
  }

  /** Execute one tool and return its outcome (logged as a SkillExecution). */
  call(
    ctx: ExecutorContext,
    skillKey: string,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallDto> {
    return this.skills.runTool(ctx, skillKey, tool, args);
  }
}
