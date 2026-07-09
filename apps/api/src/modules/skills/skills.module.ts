import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmployeeSkillsController } from './employee-skills.controller';
import {
  SKILL_EXECUTOR_TOKEN,
  type SkillExecutor,
} from './executors/skill-executor';
import { MockSkillExecutor } from './executors/mock-skill-executor';
import { SkillsController } from './skills.controller';
import { SkillsService } from './skills.service';

/**
 * Pick the skill-execution backend from SKILL_EXECUTOR (default: mock — offline,
 * deterministic, side-effect-free). Real per-skill executors would be selected
 * here later (mirrors the embeddings / llm factories).
 *
 * TODO: real executors (e.g. `real` → a registry of credential-backed per-skill
 * executors) + a 3rd-party marketplace module. Kept mock-only for now.
 */
function skillExecutorFactory(config: ConfigService): SkillExecutor {
  const kind = (config.get<string>('SKILL_EXECUTOR') ?? 'mock').toLowerCase();
  switch (kind) {
    case 'mock':
    default:
      return new MockSkillExecutor();
  }
}

/**
 * Skills module: the built-in catalog (code), tenant-scoped install/assign, and
 * the runtime seam (getToolsForEmployee / runTool). Exports SkillsService so the
 * AI Employee runtime's ToolExecutorService can drive real tool execution.
 */
@Module({
  controllers: [SkillsController, EmployeeSkillsController],
  providers: [
    SkillsService,
    {
      provide: SKILL_EXECUTOR_TOKEN,
      inject: [ConfigService],
      useFactory: skillExecutorFactory,
    },
  ],
  exports: [SkillsService],
})
export class SkillsModule {}
