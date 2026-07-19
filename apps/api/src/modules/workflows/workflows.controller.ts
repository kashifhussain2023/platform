import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type {
  FireEventResultDto,
  GenerateWorkflowResultDto,
  WorkflowDto,
  WorkflowRunDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RequirePlan } from '../billing/decorators/plan.decorator';
import { PlanGuard } from '../billing/plan.guard';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { FireEventDto } from './dto/fire-event.dto';
import { GenerateWorkflowDto } from './dto/generate-workflow.dto';
import { RunWorkflowDto } from './dto/run-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowGeneratorService } from './engine/workflow-generator.service';
import { WorkflowsService } from './workflows.service';

/**
 * All routes are tenant-scoped by companyId from the JWT and JWT-guarded.
 * Authoring workflows (create/update/delete/activate/deactivate) is
 * @Roles('OWNER','ADMIN'); reads + running/firing stay open to any member.
 */
@Controller('workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly generator: WorkflowGeneratorService,
  ) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateWorkflowDto,
  ): Promise<WorkflowDto> {
    return this.workflows.create(companyId, dto);
  }

  @Get()
  list(
    @CurrentTenant() companyId: string,
    @Query('limit') limit?: string,
  ): Promise<WorkflowDto[]> {
    return this.workflows.list(companyId, limit);
  }

  /**
   * Fire an internal event to every ACTIVE EVENT-triggered workflow whose
   * eventType matches. Declared before `:id` so the fixed `events` segment is
   * never shadowed by a parametric route.
   */
  @Post('events')
  @HttpCode(200)
  fireEvent(
    @CurrentTenant() companyId: string,
    @Body() dto: FireEventDto,
  ): Promise<FireEventResultDto> {
    return this.workflows.fireEvent(companyId, dto.eventType, dto.payload, dto.connectorId);
  }

  /**
   * A single run + its steps (for polling). Declared before `:id` so the fixed
   * `runs` segment is never shadowed by the parametric workflow route.
   */
  @Get('runs/:runId')
  getRun(
    @CurrentTenant() companyId: string,
    @Param('runId') runId: string,
  ): Promise<WorkflowRunDto> {
    return this.workflows.getRun(companyId, runId);
  }

  /**
   * AI-assisted draft generation (BUSINESS/ENTERPRISE only). Never persists —
   * hand the returned `definition` to POST / (create) once the user accepts it.
   * Tighter than the app-wide default (docs status audit §3): each call runs
   * up to GENERATION_MAX_ATTEMPTS real LLM completions, so this is one of the
   * endpoints that actually costs real money per request.
   */
  @Post('generate')
  @UseGuards(PlanGuard)
  @RequirePlan('BUSINESS', 'ENTERPRISE')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  generateDraft(
    @CurrentTenant() companyId: string,
    @Body() dto: GenerateWorkflowDto,
  ): Promise<GenerateWorkflowResultDto> {
    return this.generator.generate(companyId, dto.messages);
  }

  @Get(':id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.get(companyId, id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ): Promise<WorkflowDto> {
    return this.workflows.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(204)
  remove(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.workflows.remove(companyId, id);
  }

  /** Create a run (PENDING) + enqueue async execution; returns the run. */
  @Post(':id/run')
  run(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: RunWorkflowDto,
  ): Promise<WorkflowRunDto> {
    return this.workflows.createRun(companyId, id, dto.trigger);
  }

  @Get(':id/runs')
  listRuns(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ): Promise<WorkflowRunDto[]> {
    return this.workflows.listRuns(companyId, id, limit);
  }

  /** Activate a workflow (requires runnable steps); arms its trigger. */
  @Post(':id/activate')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  activate(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.activate(companyId, id);
  }

  /** Deactivate a workflow (PAUSED); disarms any SCHEDULE job. */
  @Post(':id/deactivate')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  deactivate(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.deactivate(companyId, id);
  }
}
