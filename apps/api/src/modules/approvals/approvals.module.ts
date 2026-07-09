import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { ApprovalService } from './approval.service';
import { ApprovalsController } from './approvals.controller';

/**
 * Approval Center module. Imports SkillsModule so approve/modify can execute the
 * stored tool call via SkillsService.runTool (which writes the SkillExecution
 * audit row). Exports ApprovalService so the AI Employee runtime's
 * ToolExecutorService can intercept high-risk tool calls (EmployeesModule imports
 * this module). SkillsModule must NOT import ApprovalsModule (avoids a cycle).
 */
@Module({
  imports: [SkillsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalsModule {}
