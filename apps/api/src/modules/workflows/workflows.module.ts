import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { LlmModule } from '../employees/llm/llm.module';
import { SkillsModule } from '../skills/skills.module';
import { WorkflowEngine } from './engine/workflow-engine.service';
import { WorkflowProcessor } from './engine/workflow.processor';
import { WorkflowsController } from './workflows.controller';
import { WorkflowWebhooksController } from './webhooks.controller';
import { WorkflowsService } from './workflows.service';
import { WORKFLOW_RUN_QUEUE } from './workflows.constants';

/**
 * Workflow builder module: tenant-scoped CRUD, run creation + a BullMQ
 * `workflow-run` queue, and the in-process WorkflowEngine/WorkflowProcessor that
 * walk the graph. The shared BullMQ connection is registered globally by the
 * KnowledgeModule (BullModule.forRootAsync), so only registerQueue is needed.
 *
 * Reuses other modules' singletons: KnowledgeModule (RETRIEVE), SkillsModule
 * (TOOL_ACTION), and LlmModule for the shared LlmProvider (AI_STEP). It imports
 * LlmModule directly rather than EmployeesModule so that ApprovalsModule can
 * import WorkflowsModule (WORKFLOW-kind decisions call WorkflowsService) without
 * closing a cycle: EmployeesModule imports ApprovalsModule, so a Workflows→
 * Employees edge would form Approvals→Workflows→Employees→Approvals. Workflows
 * does NOT import ApprovalsModule (the engine writes ApprovalRequest rows via
 * PrismaService directly) — the dependency stays one-directional Approvals→Workflows.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: WORKFLOW_RUN_QUEUE }),
    KnowledgeModule,
    SkillsModule,
    LlmModule,
  ],
  controllers: [WorkflowsController, WorkflowWebhooksController],
  providers: [WorkflowsService, WorkflowEngine, WorkflowProcessor],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
