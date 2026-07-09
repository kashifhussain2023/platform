import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
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
 * Reuses the other modules' singletons: KnowledgeModule (RETRIEVE),
 * SkillsModule (TOOL_ACTION), and EmployeesModule — imported so the engine can
 * inject the SAME LlmProvider singleton (LLM_PROVIDER_TOKEN, re-exported by
 * EmployeesModule) for AI_STEP. workflows → employees is acyclic (employees does
 * not import workflows), so there is no import cycle.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: WORKFLOW_RUN_QUEUE }),
    KnowledgeModule,
    SkillsModule,
    EmployeesModule,
  ],
  controllers: [WorkflowsController, WorkflowWebhooksController],
  providers: [WorkflowsService, WorkflowEngine, WorkflowProcessor],
  exports: [WorkflowsService],
})
export class WorkflowsModule {}
