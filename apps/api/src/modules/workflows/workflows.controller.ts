import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import type {
  FireEventResultDto,
  WorkflowDto,
  WorkflowRunDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { FireEventDto } from './dto/fire-event.dto';
import { RunWorkflowDto } from './dto/run-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import { WorkflowsService } from './workflows.service';

/** All routes are tenant-scoped by companyId from the JWT and JWT-guarded. */
@Controller('workflows')
@UseGuards(JwtAuthGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post()
  create(
    @CurrentTenant() companyId: string,
    @Body() dto: CreateWorkflowDto,
  ): Promise<WorkflowDto> {
    return this.workflows.create(companyId, dto);
  }

  @Get()
  list(@CurrentTenant() companyId: string): Promise<WorkflowDto[]> {
    return this.workflows.list(companyId);
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
    return this.workflows.fireEvent(companyId, dto.eventType, dto.payload);
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

  @Get(':id')
  get(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.get(companyId, id);
  }

  @Patch(':id')
  update(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
    @Body() dto: UpdateWorkflowDto,
  ): Promise<WorkflowDto> {
    return this.workflows.update(companyId, id, dto);
  }

  @Delete(':id')
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
  ): Promise<WorkflowRunDto[]> {
    return this.workflows.listRuns(companyId, id);
  }

  /** Activate a workflow (requires runnable steps); arms its trigger. */
  @Post(':id/activate')
  @HttpCode(200)
  activate(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.activate(companyId, id);
  }

  /** Deactivate a workflow (PAUSED); disarms any SCHEDULE job. */
  @Post(':id/deactivate')
  @HttpCode(200)
  deactivate(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<WorkflowDto> {
    return this.workflows.deactivate(companyId, id);
  }
}
