import { randomBytes, randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type Workflow } from '@prisma/client';
import type { Queue } from 'bullmq';
import type {
  Condition,
  FireEventResultDto,
  TriggerConfig,
  TriggerType,
  WorkflowDefinition,
  WorkflowDto,
  WorkflowRunDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clampLimit } from '../../common/pagination';
import { AuditLogService } from '../audit/audit-log.service';
import { evaluateConditions } from './engine/conditions';
import { validateDefinitionStructure } from './engine/definition-validator';
import { CreateWorkflowDto } from './dto/create-workflow.dto';
import { UpdateWorkflowDto } from './dto/update-workflow.dto';
import {
  MIN_SCHEDULE_MS,
  WORKFLOW_RUN_JOB,
  WORKFLOW_RUN_QUEUE,
  WORKFLOW_TRIGGER_JOB,
  type WorkflowRunJobData,
} from './workflows.constants';
import {
  STARTER_DEFINITION,
  toWorkflowDto,
  toWorkflowRunDto,
} from './workflows.mapper';

/** BullMQ job-scheduler id for a workflow's SCHEDULE repeatable job. */
function schedulerId(workflowId: string): string {
  return `wf:${workflowId}`;
}

/**
 * Tenant-scoped CRUD for workflows plus run creation and trigger/activation.
 *
 * A run is created PENDING and its execution is enqueued on the BullMQ
 * `workflow-run` queue (async); the WorkflowProcessor/WorkflowEngine walk the
 * graph. Every tenant query is scoped by companyId (from the JWT).
 *
 * Triggers (Steps 8/9/11): MANUAL keeps the existing POST /:id/run path.
 * ACTIVE workflows can also fire via a SCHEDULE (repeatable BullMQ job), a
 * public WEBHOOK (token URL), or an internal EVENT.
 */
@Injectable()
export class WorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(WORKFLOW_RUN_QUEUE)
    private readonly queue: Queue<WorkflowRunJobData>,
    private readonly auditLog: AuditLogService,
  ) {}

  // --- CRUD ----------------------------------------------------------------

  async create(
    companyId: string,
    dto: CreateWorkflowDto,
    actorUserId?: string,
  ): Promise<WorkflowDto> {
    this.validateDefinition(dto.definition);
    const workflow = await this.prisma.workflow.create({
      data: {
        companyId,
        name: dto.name,
        description: dto.description ?? null,
        definition: (dto.definition ??
          STARTER_DEFINITION) as unknown as Prisma.InputJsonObject,
      },
    });
    await this.auditLog.record({
      companyId,
      actorUserId,
      action: 'workflow.create',
      entityType: 'Workflow',
      entityId: workflow.id,
      metadata: { name: workflow.name },
    });
    return toWorkflowDto(workflow);
  }

  async list(companyId: string, limitRaw?: unknown): Promise<WorkflowDto[]> {
    const workflows = await this.prisma.workflow.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limitRaw),
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
    actorUserId?: string,
  ): Promise<WorkflowDto> {
    const existing = await this.findOwned(companyId, id);

    // Optimistic concurrency (opt-in): if the caller tells us what `updatedAt`
    // they last read and it doesn't match, someone else saved in between —
    // 409 instead of silently overwriting their change (two tabs/people
    // editing the same workflow previously had zero conflict signal).
    if (
      dto.expectedUpdatedAt !== undefined &&
      dto.expectedUpdatedAt !== existing.updatedAt.toISOString()
    ) {
      throw new ConflictException(
        'This workflow was changed by someone else since you loaded it. Reload and re-apply your edit.',
      );
    }

    // Validate the trigger shape when either trigger field is being changed.
    if (dto.triggerType !== undefined || dto.triggerConfig !== undefined) {
      const type = (dto.triggerType ?? existing.triggerType) as TriggerType;
      const config =
        dto.triggerConfig ?? (existing.triggerConfig as TriggerConfig | null);
      this.validateTrigger(type, config);
    }
    this.validateDefinition(dto.definition);

    const workflow = await this.prisma.workflow.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        status: dto.status,
        triggerType: dto.triggerType,
        triggerConfig:
          dto.triggerConfig === undefined
            ? undefined
            : (dto.triggerConfig as Prisma.InputJsonObject),
        definition:
          dto.definition === undefined
            ? undefined
            : (dto.definition as unknown as Prisma.InputJsonObject),
      },
    });
    await this.auditLog.record({
      companyId,
      actorUserId,
      action: 'workflow.update',
      entityType: 'Workflow',
      entityId: workflow.id,
      metadata: { changedFields: Object.keys(dto) },
    });
    return toWorkflowDto(workflow);
  }

  async remove(
    companyId: string,
    id: string,
    actorUserId?: string,
  ): Promise<void> {
    const existing = await this.findOwned(companyId, id);
    // Best-effort: drop any repeatable schedule so it doesn't fire post-delete.
    if (existing.triggerType === 'SCHEDULE') {
      await this.removeSchedule(id);
    }
    // Cascades to runs and their step runs (onDelete: Cascade).
    await this.prisma.workflow.delete({ where: { id } });
    await this.auditLog.record({
      companyId,
      actorUserId,
      action: 'workflow.delete',
      entityType: 'Workflow',
      entityId: id,
      metadata: { name: existing.name },
    });
  }

  // --- Activation (Steps 8/9) ---------------------------------------------

  /**
   * Activate a workflow: require ≥1 runnable (non-TRIGGER) node, set ACTIVE +
   * activatedAt. SCHEDULE → add a repeatable job; WEBHOOK → ensure a token.
   */
  async activate(companyId: string, id: string): Promise<WorkflowDto> {
    const existing = await this.findOwned(companyId, id);

    if (!this.hasRunnableSteps(existing.definition)) {
      throw new BadRequestException(
        'Add at least one step (beyond the trigger) before activating',
      );
    }

    const type = existing.triggerType as TriggerType;
    const config = existing.triggerConfig as TriggerConfig | null;
    this.validateTrigger(type, config);

    // Generate a webhook token on first WEBHOOK activation (crypto-random).
    const webhookToken =
      type === 'WEBHOOK' && !existing.webhookToken
        ? randomBytes(24).toString('hex')
        : undefined;

    const workflow = await this.prisma.workflow.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        activatedAt: new Date(),
        ...(webhookToken ? { webhookToken } : {}),
      },
    });

    if (type === 'SCHEDULE') {
      await this.addSchedule(companyId, id, config);
    }

    return toWorkflowDto(workflow);
  }

  /** Deactivate: set PAUSED and remove any SCHEDULE repeatable job. */
  async deactivate(companyId: string, id: string): Promise<WorkflowDto> {
    const existing = await this.findOwned(companyId, id);
    if (existing.triggerType === 'SCHEDULE') {
      await this.removeSchedule(id);
    }
    const workflow = await this.prisma.workflow.update({
      where: { id },
      data: { status: 'PAUSED' },
    });
    return toWorkflowDto(workflow);
  }

  // --- Event / webhook firing (Step 11) -----------------------------------

  /**
   * Fire an internal event: enqueue a run for every ACTIVE EVENT workflow whose
   * triggerConfig.eventType matches AND whose optional condition DSL (docs §5.2)
   * passes against the fired payload. Returns the matched count + created runIds.
   *
   * Correlation/lineage (docs §9): when the payload carries an `eventId` (the
   * CanonicalEvent id, set by the normalization pipeline), each created run gets
   * `triggerEventId` = that id and `correlationId` = that id, so a single
   * correlationId ties event→run→steps. A manual fire (no eventId) still gets a
   * generated correlationId so every run is traceable.
   */
  async fireEvent(
    companyId: string,
    eventType: string,
    payload?: Record<string, unknown>,
    connectorId?: string,
  ): Promise<FireEventResultDto> {
    const workflows = await this.prisma.workflow.findMany({
      where: {
        companyId,
        status: 'ACTIVE',
        triggerType: 'EVENT',
        triggerConfig: { path: ['eventType'], equals: eventType },
      },
    });

    const safePayload = payload ?? {};
    const eventId =
      typeof safePayload.eventId === 'string' ? safePayload.eventId : null;

    const runIds: string[] = [];
    for (const wf of workflows) {
      // Connector-scoped triggers (per-employee skill connections) only fire for
      // events from THEIR OWN connector; a trigger with no connectorId keeps
      // matching every connector of this eventType — today's exact behavior.
      const cfg = (wf.triggerConfig ?? null) as TriggerConfig | null;
      if (cfg?.connectorId && cfg.connectorId !== connectorId) {
        continue;
      }
      // Richer EVENT filtering: a workflow fires only if ALL its conditions pass
      // (empty/absent → always fire, so existing EVENT workflows are unaffected).
      const conditions = this.extractConditions(wf.triggerConfig);
      if (!evaluateConditions(conditions, safePayload)) {
        continue;
      }
      const run = await this.enqueueRun(wf.companyId, wf.id, 'EVENT', payload, {
        triggerEventId: eventId,
        // undefined → enqueueRun generates one (manual fire with no eventId).
        correlationId: eventId ?? undefined,
      });
      runIds.push(run.id);
    }
    return { eventType, count: runIds.length, runIds };
  }

  /** Read a workflow's EVENT condition list from its persisted triggerConfig. */
  private extractConditions(config: Prisma.JsonValue): Condition[] {
    const cfg = (config ?? null) as TriggerConfig | null;
    return Array.isArray(cfg?.conditions) ? (cfg.conditions as Condition[]) : [];
  }

  /**
   * Fire a public webhook by token (no JWT; tenant = the workflow's company).
   * 404 unless the token maps to an ACTIVE WEBHOOK workflow.
   */
  async fireWebhook(
    token: string,
    payload?: Record<string, unknown>,
  ): Promise<WorkflowRunDto> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { webhookToken: token },
    });
    if (
      !workflow ||
      workflow.status !== 'ACTIVE' ||
      workflow.triggerType !== 'WEBHOOK'
    ) {
      throw new NotFoundException('Webhook not found');
    }
    return this.enqueueRun(workflow.companyId, workflow.id, 'WEBHOOK', payload);
  }

  // --- Runs ----------------------------------------------------------------

  /** Create a PENDING run and enqueue its async execution; returns the run. */
  async createRun(
    companyId: string,
    id: string,
    trigger?: Record<string, unknown>,
    dryRun?: boolean,
  ): Promise<WorkflowRunDto> {
    await this.findOwned(companyId, id);
    return this.enqueueRun(companyId, id, 'MANUAL', trigger, { dryRun });
  }

  async listRuns(
    companyId: string,
    id: string,
    limitRaw?: unknown,
  ): Promise<WorkflowRunDto[]> {
    await this.findOwned(companyId, id);
    const runs = await this.prisma.workflowRun.findMany({
      where: { companyId, workflowId: id },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limitRaw),
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

  /**
   * Resume a WAITING run whose APPROVAL was approved. Flip it to RUNNING and
   * enqueue a `{runId, resume:true}` job so the engine continues from
   * `resumeNodeId` with the persisted context. Idempotent: a run that is not
   * WAITING is ignored (a double-approve cannot double-run). Called by
   * ApprovalService when a WORKFLOW-kind request is approved.
   */
  async resumeRun(runId: string): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.status !== 'WAITING') {
      return;
    }
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', error: null },
    });
    await this.queue.add(
      WORKFLOW_RUN_JOB,
      { runId, resume: true, companyId: run.companyId },
      { removeOnComplete: true, removeOnFail: 100 },
    );
  }

  /**
   * Cancel a non-terminal run (used when a WORKFLOW-kind approval is rejected):
   * mark it FAILED with the reason and clear its resume pointer. A run already
   * COMPLETED/FAILED is left untouched. Called by ApprovalService on reject.
   */
  async cancelRun(runId: string, reason: string): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
    });
    if (!run || run.status === 'COMPLETED' || run.status === 'FAILED') {
      return;
    }
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: reason,
        resumeNodeId: null,
      },
    });
  }

  /** Test/introspection hook: the queue's registered job schedulers. */
  listSchedulers() {
    return this.queue.getJobSchedulers();
  }

  // --- Internals -----------------------------------------------------------

  /**
   * Create a run with the given source + enqueue a `{runId}` job. Every run gets
   * a `correlationId` (docs §9): the caller supplies the triggering eventId for
   * EVENT runs; otherwise a crypto-random id is generated so manual/schedule/
   * webhook runs are equally traceable. `triggerEventId` is the CanonicalEvent id
   * for EVENT runs (the lineage join key) and null for the rest.
   */
  private async enqueueRun(
    companyId: string,
    workflowId: string,
    source: string,
    trigger?: Record<string, unknown>,
    opts?: {
      triggerEventId?: string | null;
      correlationId?: string;
      dryRun?: boolean;
    },
  ): Promise<WorkflowRunDto> {
    const run = await this.prisma.workflowRun.create({
      data: {
        companyId,
        workflowId,
        status: 'PENDING',
        source,
        dryRun: opts?.dryRun ?? false,
        trigger:
          trigger === undefined
            ? Prisma.JsonNull
            : (trigger as Prisma.InputJsonObject),
        triggerEventId: opts?.triggerEventId ?? null,
        correlationId: opts?.correlationId ?? randomUUID(),
      },
    });

    await this.queue.add(
      WORKFLOW_RUN_JOB,
      { runId: run.id, companyId },
      { removeOnComplete: true, removeOnFail: 100 },
    );

    return toWorkflowRunDto(run);
  }

  /** True when the definition has ≥1 node that is not a TRIGGER. */
  private hasRunnableSteps(definition: Prisma.JsonValue): boolean {
    const def = (definition ?? {}) as Partial<WorkflowDefinition>;
    const nodes = Array.isArray(def.nodes) ? def.nodes : [];
    return nodes.some((n) => n?.type && n.type !== 'TRIGGER');
  }

  /**
   * Structural sanity checks beyond the DTO's per-field shape validation.
   * A duplicate node id would let the LAST one silently win at run time
   * (`nodesById` is built as a Map, keyed by id) — the other becomes
   * unreachable dead code with no error anywhere. An edge referencing an
   * unknown node id makes a run silently stop early (`nodesById.get(...)`
   * resolves to `undefined`, and the engine's walk just ends) instead of
   * failing loudly. Both are rejected at SAVE time, where a clear 400 is far
   * more useful than a silently wrong run later.
   */
  private validateDefinition(definition: WorkflowDefinition | undefined): void {
    if (!definition) {
      return;
    }
    validateDefinitionStructure(definition);
  }

  /** Validate a trigger's config shape (SCHEDULE/EVENT); 400 otherwise. */
  private validateTrigger(
    type: TriggerType,
    config: TriggerConfig | null,
  ): void {
    if (type === 'SCHEDULE') {
      const everyMs = Number(config?.everyMs);
      const hasEvery = Number.isFinite(everyMs) && everyMs >= MIN_SCHEDULE_MS;
      const hasCron =
        typeof config?.cron === 'string' && config.cron.trim().length > 0;
      if (!hasEvery && !hasCron) {
        throw new BadRequestException(
          `SCHEDULE trigger needs everyMs >= ${MIN_SCHEDULE_MS} or a cron expression`,
        );
      }
    }
    if (type === 'EVENT') {
      const eventType =
        typeof config?.eventType === 'string' ? config.eventType.trim() : '';
      if (!eventType) {
        throw new BadRequestException('EVENT trigger needs a non-empty eventType');
      }
    }
  }

  /** Add/refresh the repeatable SCHEDULE job for a workflow. */
  private async addSchedule(
    companyId: string,
    workflowId: string,
    config: TriggerConfig | null,
  ): Promise<void> {
    const repeat =
      typeof config?.cron === 'string' && config.cron.trim().length > 0
        ? { pattern: config.cron.trim() }
        : { every: Number(config?.everyMs) };
    await this.queue.upsertJobScheduler(schedulerId(workflowId), repeat, {
      name: WORKFLOW_TRIGGER_JOB,
      // companyId scopes the DLQ view (Unit C) if a scheduled fire ever fails.
      data: { workflowId, source: 'SCHEDULE', companyId },
      opts: { removeOnComplete: true, removeOnFail: 100 },
    });
  }

  /** Best-effort removal of a workflow's repeatable SCHEDULE job. */
  private async removeSchedule(workflowId: string): Promise<void> {
    try {
      await this.queue.removeJobScheduler(schedulerId(workflowId));
    } catch {
      // No scheduler registered (e.g. never activated) — nothing to remove.
    }
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
