import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module';
import { WorkflowsModule } from '../workflows/workflows.module';
import { ApprovalService } from './approval.service';
import { ApprovalsController } from './approvals.controller';

/**
 * Approval Center module. Imports SkillsModule so approve/modify can execute the
 * stored tool call via SkillsService.runTool (which writes the SkillExecution
 * audit row), and WorkflowsModule so a WORKFLOW-kind decision can resume/cancel
 * the paused run via WorkflowsService. Exports ApprovalService so the AI Employee
 * runtime's ToolExecutorService can intercept high-risk tool calls
 * (EmployeesModule imports this module).
 *
 * DI: the Approvals→Workflows edge is one-directional — WorkflowsModule does NOT
 * import ApprovalsModule (its engine writes ApprovalRequest rows via Prisma), and
 * it imports LlmModule (not EmployeesModule) for AI_STEP, so there is no cycle.
 * SkillsModule must NOT import ApprovalsModule either.
 */
@Module({
  imports: [SkillsModule, WorkflowsModule],
  controllers: [ApprovalsController],
  providers: [ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalsModule {}
