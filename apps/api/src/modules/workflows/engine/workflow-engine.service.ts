import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, type Workflow, type WorkflowRun } from '@prisma/client';
import type {
  ConditionOp,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from '@vaep/types';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { SkillsService } from '../../skills/skills.service';
import {
  LLM_PROVIDER_TOKEN,
  type LlmProvider,
} from '../../employees/llm/llm.provider';
import { MAX_WAIT_MS, MAX_WORKFLOW_NODES } from '../workflows.constants';
import { resolveArgs, resolveTemplate } from './template';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Prisma Json helper: map JS null → the DB JSON null sentinel. */
function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function toNumber(value: string): number {
  return Number(value);
}

/** Manual (no-eval) comparison used by CONDITION nodes. */
function compare(left: string, op: ConditionOp, right: string): boolean {
  switch (op) {
    case 'eq':
      return left === right;
    case 'neq':
      return left !== right;
    case 'contains':
      return left.includes(right);
    case 'gt':
      return toNumber(left) > toNumber(right);
    case 'lt':
      return toNumber(left) < toNumber(right);
    default:
      return false;
  }
}

/** Outcome of a single node executor. */
interface NodeResult {
  /** Persisted verbatim to WorkflowStepRun.output. */
  output: unknown;
  /** Stored at context[node.config.outputKey] when both are present. */
  contextValue?: unknown;
  /** CONDITION branch selector (true/false). */
  conditionResult?: boolean;
}

/** A WorkflowRun loaded with its parent Workflow (for the definition graph). */
type RunWithWorkflow = WorkflowRun & { workflow: Workflow };

/** Where a walk starts and what context it seeds — used to resume a WAITING run. */
interface RunOptions {
  /** Node id to begin from. Omitted → start at the TRIGGER (a fresh run). */
  startNodeId?: string;
  /** Seed context (a resumed run's persisted context). Omitted → { trigger }. */
  context?: Record<string, unknown>;
}

/**
 * Walks a workflow graph for one WorkflowRun, threading a mutable `context`
 * object and writing a WorkflowStepRun per visited node. Starts at the TRIGGER
 * node and follows edges (for CONDITION, the edge whose `branch` matches the
 * boolean result; otherwise the first outgoing edge). Reuses the Knowledge
 * (RETRIEVE), LLM (AI_STEP) and Skills (TOOL_ACTION) modules. Bounded to
 * MAX_WORKFLOW_NODES visits so a malformed/cyclic graph can never loop forever.
 *
 * A node failure marks that step + the run FAILED and stops (no rethrow: a
 * failed run is a terminal domain outcome the poller reads, not a job crash).
 *
 * APPROVAL node: the walk PAUSES. The engine persists the current context, sets
 * the run WAITING with `resumeNodeId` = the node after the approval, writes a
 * (RUNNING) APPROVAL step marker, and creates a PENDING WORKFLOW-kind
 * ApprovalRequest directly via PrismaService (the engine never imports the
 * Approvals module — that keeps Approvals→Workflows one-directional/acyclic). A
 * manager's decision drives WorkflowsService.resumeRun (→ engine.resume →
 * COMPLETED) or cancelRun (→ FAILED). Workflows without an APPROVAL node behave
 * exactly as before (run → COMPLETED).
 */
@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly skills: SkillsService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProvider,
  ) {}

  /**
   * Scheduled/triggered entry: create a WorkflowRun for a workflow (with the
   * given source) then execute it. Used by the processor for `{workflowId,
   * source}` jobs (SCHEDULE repeatable). A missing/deleted workflow is a no-op.
   */
  async trigger(workflowId: string, source: string): Promise<void> {
    const workflow = await this.prisma.workflow.findUnique({
      where: { id: workflowId },
    });
    if (!workflow) {
      this.logger.warn(`Triggered workflow ${workflowId} not found; skipping`);
      return;
    }
    const run = await this.prisma.workflowRun.create({
      data: {
        companyId: workflow.companyId,
        workflowId,
        status: 'PENDING',
        source,
        trigger: Prisma.JsonNull,
        // A generated correlationId keeps SCHEDULE-triggered runs traceable too.
        correlationId: randomUUID(),
      },
    });
    await this.execute(run.id);
  }

  /**
   * Fresh execution of a PENDING run: guard, flip to RUNNING, then walk from the
   * TRIGGER with a fresh context. Only a PENDING run is eligible (idempotent).
   */
  async execute(runId: string): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: true },
    });
    if (!run) {
      this.logger.warn(`Workflow run ${runId} not found`);
      return;
    }
    // Idempotency: only a PENDING run is eligible to start.
    if (run.status !== 'PENDING') {
      this.logger.warn(`Run ${runId} is ${run.status}, skipping`);
      return;
    }

    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date(), error: null },
    });

    await this.run(run, {});
  }

  /**
   * Resume a WAITING run after its APPROVAL was approved (a `{runId, resume}`
   * job). WorkflowsService.resumeRun has already flipped the run to RUNNING; the
   * engine continues from `resumeNodeId` with the persisted context, closing out
   * the paused APPROVAL step first.
   */
  async resume(runId: string): Promise<void> {
    const run = await this.prisma.workflowRun.findUnique({
      where: { id: runId },
      include: { workflow: true },
    });
    if (!run) {
      this.logger.warn(`Workflow run ${runId} not found (resume)`);
      return;
    }
    // Pass a defined context so `run` knows this is a resume (not a fresh start)
    // even if resumeNodeId is null (the approval was the terminal node).
    await this.run(run, {
      startNodeId: run.resumeNodeId ?? undefined,
      context: (run.context as Record<string, unknown> | null) ?? {},
    });
  }

  /**
   * Core resumable walk. A resume passes a (defined) `context`; a fresh run omits
   * it. Fresh runs start at the TRIGGER with a fresh `{ trigger }`; resumes start
   * at `opts.startNodeId` (or nowhere, if the approval was terminal) with the
   * persisted context, after closing the paused APPROVAL step. Reaching an
   * APPROVAL node PAUSES the run (WAITING) and returns WITHOUT completing; every
   * other terminal path marks the run COMPLETED, and any node failure FAILED.
   */
  async run(run: RunWithWorkflow, opts: RunOptions = {}): Promise<void> {
    const { companyId } = run;
    // A defined context marks a resume; omitting it is a fresh start at TRIGGER.
    const isResume = opts.context !== undefined;
    const context: Record<string, unknown> =
      opts.context ?? {
        trigger: (run.trigger as Record<string, unknown> | null) ?? {},
      };
    // Correlation id (docs §9): ties event→run→steps in the logs below. Falls back
    // to the run id for any legacy run created before the column existed.
    const correlationId = run.correlationId ?? run.id;

    try {
      this.logger.log(
        `workflow.run ${isResume ? 'resume' : 'start'} run=${run.id} corr=${correlationId} wf=${run.workflowId} company=${companyId} source=${run.source}`,
      );
      const definition = this.parseDefinition(run.workflow.definition);
      const nodesById = new Map<string, WorkflowNode>(
        definition.nodes.map((n) => [n.id, n]),
      );

      // A resume closes the paused APPROVAL step (→ COMPLETED) before continuing.
      if (isResume) {
        await this.completePausedApproval(run.id, companyId);
      }

      let current: WorkflowNode | undefined;
      if (opts.startNodeId) {
        current = nodesById.get(opts.startNodeId);
      } else if (isResume) {
        // Resumed past a terminal approval (no outgoing edge): nothing remains,
        // so fall through to COMPLETED — never restart the walk from the TRIGGER.
        current = undefined;
      } else {
        current =
          definition.nodes.find((n) => n.type === 'TRIGGER') ??
          definition.nodes[0];
        if (!current) {
          throw new Error('Workflow definition has no nodes to run');
        }
      }

      let visited = 0;
      while (current) {
        if (visited >= MAX_WORKFLOW_NODES) {
          throw new Error(
            `Exceeded max node count (${MAX_WORKFLOW_NODES}); aborting to avoid a loop`,
          );
        }
        visited += 1;

        // APPROVAL pauses the run: persist state, open an approval, and STOP.
        if (current.type === 'APPROVAL') {
          await this.pauseForApproval(
            run,
            companyId,
            current,
            definition,
            context,
          );
          return;
        }

        const result = await this.runNode(
          run.id,
          companyId,
          current,
          context,
          correlationId,
        );
        current = this.nextNode(current, definition.edges, nodesById, result);
      }

      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          context: context as Prisma.InputJsonObject,
          resumeNodeId: null,
        },
      });
      this.logger.log(
        `workflow.run completed run=${run.id} corr=${correlationId}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `workflow.run failed run=${run.id} corr=${correlationId}: ${message}`,
      );
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: message,
          context: context as Prisma.InputJsonObject,
        },
      });
    }
  }

  // --- APPROVAL pause / resume ---------------------------------------------

  /**
   * Pause a run at an APPROVAL node: write a (RUNNING) APPROVAL step marker,
   * persist the context + set WAITING with `resumeNodeId` (the approval node's
   * outgoing edge target, or null if it is terminal), and create a PENDING
   * WORKFLOW-kind ApprovalRequest DIRECTLY via Prisma (never importing the
   * Approvals module — the dependency stays one-directional Approvals→Workflows).
   */
  private async pauseForApproval(
    run: RunWithWorkflow,
    companyId: string,
    node: WorkflowNode,
    definition: WorkflowDefinition,
    context: Record<string, unknown>,
  ): Promise<void> {
    const outgoing = definition.edges.filter((e) => e.from === node.id);
    const resumeNodeId = outgoing.length > 0 ? outgoing[0].to : null;

    await this.prisma.workflowStepRun.create({
      data: {
        companyId,
        runId: run.id,
        nodeId: node.id,
        type: node.type,
        // Left RUNNING as a paused marker; resume flips it COMPLETED.
        status: 'RUNNING',
        input: (node.config ?? {}) as Prisma.InputJsonObject,
        output: { awaitingApproval: true } as Prisma.InputJsonObject,
        startedAt: new Date(),
      },
    });

    await this.prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: 'WAITING',
        context: context as Prisma.InputJsonObject,
        resumeNodeId,
      },
    });

    const rawMessage =
      typeof node.config?.message === 'string' ? node.config.message.trim() : '';
    await this.prisma.approvalRequest.create({
      data: {
        companyId,
        kind: 'WORKFLOW',
        workflowRunId: run.id,
        description: rawMessage || 'Workflow approval required',
        status: 'PENDING',
        // Non-null Json column; a workflow approval gates no tool args.
        args: {} as Prisma.InputJsonObject,
        // skillKey / tool are null for WORKFLOW-kind requests.
      },
    });

    this.logger.log(
      `workflow.run paused run=${run.id} corr=${run.correlationId ?? run.id} node=${node.id} (WAITING at APPROVAL)`,
    );
  }

  /**
   * On resume, mark the paused (RUNNING) APPROVAL step COMPLETED. Returns true
   * when such a step existed (i.e. this was a resume), false on a fresh run.
   */
  private async completePausedApproval(
    runId: string,
    companyId: string,
  ): Promise<boolean> {
    const step = await this.prisma.workflowStepRun.findFirst({
      where: { runId, companyId, type: 'APPROVAL', status: 'RUNNING' },
      orderBy: { createdAt: 'desc' },
    });
    if (!step) {
      return false;
    }
    await this.prisma.workflowStepRun.update({
      where: { id: step.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        output: { approved: true } as Prisma.InputJsonObject,
      },
    });
    return true;
  }

  // --- Graph walking -------------------------------------------------------

  /** Persist a WorkflowStepRun around one node's execution. */
  private async runNode(
    runId: string,
    companyId: string,
    node: WorkflowNode,
    context: Record<string, unknown>,
    correlationId: string,
  ): Promise<NodeResult> {
    const step = await this.prisma.workflowStepRun.create({
      data: {
        companyId,
        runId,
        nodeId: node.id,
        type: node.type,
        status: 'RUNNING',
        input: (node.config ?? {}) as Prisma.InputJsonObject,
        startedAt: new Date(),
      },
    });
    // Structured step line sharing the run's correlationId (docs §9).
    this.logger.log(
      `workflow.step run=${runId} corr=${correlationId} node=${node.id} type=${node.type}`,
    );

    try {
      const result = await this.executeNode(companyId, node, context);

      const outputKey =
        typeof node.config?.outputKey === 'string'
          ? node.config.outputKey.trim()
          : '';
      if (outputKey && result.contextValue !== undefined) {
        context[outputKey] = result.contextValue;
      }

      await this.prisma.workflowStepRun.update({
        where: { id: step.id },
        data: {
          status: 'COMPLETED',
          finishedAt: new Date(),
          output: toJson(result.output),
        },
      });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.prisma.workflowStepRun.update({
        where: { id: step.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message },
      });
      throw err;
    }
  }

  /** Pick the next node: CONDITION follows its branch edge, else the first edge. */
  private nextNode(
    node: WorkflowNode,
    edges: WorkflowEdge[],
    nodesById: Map<string, WorkflowNode>,
    result: NodeResult,
  ): WorkflowNode | undefined {
    const outgoing = edges.filter((e) => e.from === node.id);
    if (outgoing.length === 0) {
      return undefined;
    }
    let edge: WorkflowEdge;
    if (node.type === 'CONDITION' && result.conditionResult !== undefined) {
      const branch = result.conditionResult ? 'true' : 'false';
      edge =
        outgoing.find((e) => e.branch === branch) ??
        outgoing.find((e) => !e.branch) ??
        outgoing[0];
    } else {
      edge = outgoing[0];
    }
    return nodesById.get(edge.to);
  }

  // --- Node executors (one single-purpose method each) ---------------------

  private executeNode(
    companyId: string,
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): Promise<NodeResult> | NodeResult {
    switch (node.type) {
      case 'TRIGGER':
        return { output: { trigger: context.trigger ?? {} } };
      case 'RETRIEVE':
        return this.execRetrieve(companyId, node, context);
      case 'AI_STEP':
        return this.execAiStep(companyId, node, context);
      case 'TOOL_ACTION':
        return this.execToolAction(companyId, node, context);
      case 'WAIT':
        return this.execWait(node);
      case 'CONDITION':
        return this.execCondition(node, context);
      case 'NOTIFY':
        return this.execNotify(node, context);
      default:
        throw new Error(`Unknown node type: ${String(node.type)}`);
    }
  }

  /** RETRIEVE: knowledge search of a templated query → context[outputKey]. */
  private async execRetrieve(
    companyId: string,
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): Promise<NodeResult> {
    const cfg = node.config ?? {};
    const query = resolveTemplate(cfg.query, context).trim();
    const rawK = Number(cfg.k);
    const k = Number.isFinite(rawK) && rawK > 0 ? Math.min(rawK, 50) : 5;
    const results = query
      ? await this.knowledge.retrieve(companyId, query, k)
      : [];
    return {
      output: { query, k, count: results.length, results },
      contextValue: results,
    };
  }

  /** AI_STEP: LLM completion of a templated prompt → context[outputKey]. */
  private async execAiStep(
    companyId: string,
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): Promise<NodeResult> {
    const cfg = node.config ?? {};
    const prompt = resolveTemplate(cfg.prompt, context);
    const employeeId =
      typeof cfg.employeeId === 'string' ? cfg.employeeId.trim() : '';

    let persona = '';
    let name = 'the workflow assistant';
    if (employeeId) {
      const employee = await this.prisma.aiEmployee.findFirst({
        where: { id: employeeId, companyId },
      });
      if (employee) {
        persona = employee.persona ?? '';
        name = employee.name;
      }
    }

    const systemLines = [
      `You are ${name}, executing a step in an automated workflow.`,
    ];
    if (persona) {
      systemLines.push(`Persona and guidelines: ${persona}`);
    }
    systemLines.push(
      'Follow the instruction below and respond with a concise, useful result.',
    );

    // Reuse the shared LlmProvider singleton (no tools → plain completion).
    const result = await this.llm.complete({
      system: systemLines.join('\n'),
      messages: [{ role: 'user', content: prompt || 'Proceed.' }],
      temperature: 0.2,
    });
    const text = (result.content ?? '').trim();
    return { output: { prompt, text }, contextValue: text };
  }

  /** TOOL_ACTION: run a skill tool with templated args → context[outputKey]. */
  private async execToolAction(
    companyId: string,
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): Promise<NodeResult> {
    const cfg = node.config ?? {};
    const skillKey = typeof cfg.skillKey === 'string' ? cfg.skillKey : '';
    const tool = typeof cfg.tool === 'string' ? cfg.tool : '';
    const argsRaw =
      cfg.args && typeof cfg.args === 'object' && !Array.isArray(cfg.args)
        ? (cfg.args as Record<string, unknown>)
        : undefined;
    const args = resolveArgs(argsRaw, context);

    // Quarantine (docs §5.5): if this skill's connector is DEGRADED/DISCONNECTED,
    // fail the step with a clear, non-retryable "connector unavailable" error
    // rather than hammer a dead provider. Only applies when the skill is installed
    // as a connector AND currently unhealthy — a not-installed or CONNECTED/
    // NOT_CONNECTED skill runs exactly as before (default mock connectors stay
    // CONNECTED, so existing workflow tests are unaffected).
    if (skillKey) {
      const connector = await this.prisma.installedSkill.findUnique({
        where: { companyId_skillKey: { companyId, skillKey } },
        select: { connectionStatus: true },
      });
      if (
        connector &&
        (connector.connectionStatus === 'DEGRADED' ||
          connector.connectionStatus === 'DISCONNECTED')
      ) {
        throw new Error(
          `Connector for "${skillKey}" is ${connector.connectionStatus} — step quarantined (connector unavailable)`,
        );
      }
    }

    // Runs through SkillsService (swappable executor) + writes a SkillExecution.
    const call = await this.skills.runTool({ companyId }, skillKey, tool, args);
    if (!call.ok) {
      throw new Error(`Tool ${skillKey}/${tool} did not succeed`);
    }
    return { output: call, contextValue: call };
  }

  /** WAIT: bounded sleep (durable/resumable waits via delayed jobs = TODO). */
  private async execWait(node: WorkflowNode): Promise<NodeResult> {
    const cfg = node.config ?? {};
    const requested = Number(cfg.durationMs);
    const durationMs = Number.isFinite(requested)
      ? Math.min(Math.max(0, requested), MAX_WAIT_MS)
      : 0;
    if (durationMs > 0) {
      await sleep(durationMs);
    }
    return {
      output: {
        requestedMs: Number.isFinite(requested) ? requested : 0,
        waitedMs: durationMs,
        capMs: MAX_WAIT_MS,
      },
    };
  }

  /** CONDITION: op(leftResolved, right) → boolean used to pick the branch edge. */
  private execCondition(
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): NodeResult {
    const cfg = node.config ?? {};
    const left = resolveTemplate(cfg.left, context);
    const op = (typeof cfg.op === 'string' ? cfg.op : 'eq') as ConditionOp;
    const right = cfg.right == null ? '' : String(cfg.right);
    const result = compare(left, op, right);
    return { output: { left, op, right, result }, conditionResult: result };
  }

  /** NOTIFY: record a templated message in the step output (log-style). */
  private execNotify(
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): NodeResult {
    const cfg = node.config ?? {};
    const message = resolveTemplate(cfg.message, context);
    this.logger.log(`NOTIFY[${node.id}]: ${message}`);
    return { output: { message, notified: true } };
  }

  /** Coerce the persisted Json definition into a safe {nodes, edges} shape. */
  private parseDefinition(raw: Prisma.JsonValue): WorkflowDefinition {
    const def = (raw ?? {}) as Partial<WorkflowDefinition>;
    const nodes = Array.isArray(def.nodes) ? def.nodes : [];
    const edges = Array.isArray(def.edges) ? def.edges : [];
    return { nodes, edges };
  }
}
