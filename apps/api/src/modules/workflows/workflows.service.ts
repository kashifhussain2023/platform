import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Workflow } from '@prisma/client';
import type { Queue } from 'bullmq';
import type { WorkflowDto, WorkflowRunDto } from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import {
  WORKFLOW_RUN_JOB,
  WORKFLOW_RUN_QUEUE,
  type WorkflowRunJobData,
} from './workflows.constants';
import {
  STARTER_DEFINITION,
  toWorkflowDto,
  toWorkflowRunDto,
} from './workflows.mapper';

/**
 * Tenant-scoped CRUD for workflows plus run creation. A run is created PENDING
 * and its execution is enqueued on the BullMQ `workflow-run` queue (async, same
 * style as knowledge ingestion); the WorkflowProcessor/WorkflowEngine walk the
 * graph. Every query is scoped by companyId (from the JWT).
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_RUN_QUEUE)
    private readonly queue: Queue<WorkflowRunJobData>,
  ) {}

  // --- CRUD ----------------------------------------------------------------

  async create(
    companyId: string,
    dto: CreateWorkflowDto,
  ): Promise<WorkflowDto> {
    const workflow = await this.prisma.workflow.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        definition: (dto.definition ??
          STARTER_DEFINITION) as unknown as Prisma.InputJsonObject,
      },
    });
    return toWorkflowDto(workflow);
  }

  async list(companyId: string): Promise<WorkflowDto[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
    return workflows.map(toWorkflowDto);
  }

  async get(companyId: string, id: string): Promise<WorkflowDto> {
    return toWorkflowDto(await this.findOwned(companyId, id));
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateWorkflowDto,
  ): Promise<WorkflowDto> {
    await this.findOwned(companyId, id);
    const workflow = await this.prisma.workflow.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        definition:
          dto.definition === undefined
            ? undefined
            : (dto.definition as unknown as Prisma.InputJsonObject),
      },
    });
    return toWorkflowDto(workflow);
  }

  async remove(companyId: string, id: string): Promise<void> {
    await this.findOwned(companyId, id);
    // Cascades to runs and their step runs (onDelete: Cascade).
    await this.prisma.workflow.delete({ where: { id } });
  }

  // --- Runs ----------------------------------------------------------------

  /** Create a PENDING run and enqueue its async execution; returns the run. */
  async createRun(
    companyId: string,
    id: string,
    trigger?: Record<string, unknown>,
  ): Promise<WorkflowRunDto> {
    await this.findOwned(companyId, id);
    const run = await this.prisma.workflowRun.create({
      data: {
        companyId,
        workflowId: id,
        status: 'PENDING',
        trigger:
          trigger === undefined
            ? Prisma.JsonNull
            : (trigger as Prisma.InputJsonObject),
      },
    });

    await this.queue.add(
      WORKFLOW_RUN_JOB,
      { runId: run.id },
      { removeOnComplete: true, removeOnFail: 100 },
    );

    return toWorkflowRunDto(run);
  }

  async listRuns(companyId: string, id: string): Promise<WorkflowRunDto[]> {
    await this.findOwned(companyId, id);
    const runs = await this.prisma.workflowRun.findMany({
      where: { companyId, workflowId: id },
      orderBy: { createdAt: 'desc' },
    });
    return runs.map((r) => toWorkflowRunDto(r));
  }

  /** A single run WITH its step runs (for polling). Tenant-scoped. */
  async getRun(companyId: string, runId: string): Promise<WorkflowRunDto> {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, companyId },
      include: { steps: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) {
      throw new NotFoundException('Workflow run not found');
    }
    return toWorkflowRunDto(run);
  }

  // --- Ownership helper ----------------------------------------------------

  private async findOwned(companyId: string, id: string): Promise<Workflow> {
    const workflow = await this.prisma.workflow.findFirst({
      where: { id, companyId },
    });
    if (!workflow) {
      throw new NotFoundException('Workflow not found');
    }
    return workflow;
  }
}
