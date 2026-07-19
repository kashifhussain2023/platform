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
import { BillingService } from '../../billing/billing.service';
import { UsageService } from '../../usage/usage.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { SkillsService } from '../../skills/skills.service';
import {
  LLM_PROVIDER_TOKEN,
  type LlmProvider,
} from '../../employees/llm/llm.provider';
import {
  MAX_WAIT_MS,
  MAX_WORKFLOW_NODES,
  WORKFLOW_RUN_STUCK_TIMEOUT_MS,
} from '../workflows.constants';
import { resolveArgs, resolveTemplate } from './template';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Prisma Json helper: map JS null → the DB JSON null sentinel. */
function toJson(
  value: unknown,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/**
 * Strict numeric parse for a CONDITION's gt/lt operands. Unlike the EVENT
 * trigger DSL (conditions.ts), where a non-numeric operand safely means
 * "don't fire" (fail-closed, no side effect yet), an in-graph CONDITION node
 * sits mid-run: silently treating a bad operand as `NaN`/`0` would silently
 * route an ALREADY-STARTED run down the wrong branch (e.g. an LLM reply like
 * "around 85" instead of "85" would previously read as `NaN > 79 === false`
 * and silently auto-reject a strong candidate). Throwing here fails the step
 * (and the run) with a clear message instead.
 */
function toNumber(value: string): number {
  const trimmed = value.trim();
  const n = Number(trimmed);
  if (trimmed === '' || Number.isNaN(n)) {
    throw new Error(
      `CONDITION expected a number but got ${JSON.stringify(value)}`,
    );
  }
  return n;
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
 *
 * EXCEPTION: an APPROVAL node configured `config.autoApprove: true` never
 * pauses — it resolves immediately (no ApprovalRequest) and the walk continues,
 * for companies that want criteria-matched runs to act with no human gate.
 */
@Injectable()
export class WorkflowEngine {
  private readonly logger = new Logger(WorkflowEngine.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly knowledge: KnowledgeService,
    private readonly skills: SkillsService,
    private readonly billing: BillingService,
    @Inject(LLM_PROVIDER_TOKEN) private readonly llm: LlmProvider,
    private readonly usage: UsageService,
  ) {}

  /**
   * A cancelled/past-due company shouldn't keep consuming paid LLM/tool calls
   * just because a workflow is already ACTIVE (docs/specs/hiring-and-
   * subscription-linkage.md Part D #4 / test-cases WF-E4). Checked at every
   * fresh-execution and resume entry point so it's watertight regardless of
   * trigger type (MANUAL/EVENT/WEBHOOK/SCHEDULE) or approval timing.
   */
  private async blockedBySubscription(companyId: string): Promise<string | null> {
    const subscription = await this.billing.getSubscription(companyId);
    if (subscription.status === 'ACTIVE') {
      return null;
    }
    return `Subscription is ${subscription.status.toLowerCase().replace('_', ' ')} — workflow execution is paused until billing is resolved.`;
  }

  /** Fail `runId` immediately with `reason`, without running any node. */
  private async failBlockedRun(runId: string, reason: string): Promise<void> {
    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: { status: 'FAILED', finishedAt: new Date(), error: reason },
    });
    this.logger.warn(`Workflow run ${runId} blocked: ${reason}`);
  }

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

    const blocked = await this.blockedBySubscription(run.companyId);
    if (blocked) {
      await this.failBlockedRun(runId, blocked);
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
    const blocked = await this.blockedBySubscription(run.companyId);
    if (blocked) {
      await this.failBlockedRun(runId, blocked);
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
   * Watchdog sweep (fired by the repeatable `watchdog` job — see
   * WorkflowProcessor.onModuleInit): finds runs stuck in PENDING/RUNNING past
   * WORKFLOW_RUN_STUCK_TIMEOUT_MS and fails them. Exists because a BullMQ job
   * lock abandoned by a hard process kill is not always reliably requeued/
   * failed by BullMQ's own stalled-job detection (especially across rapid
   * repeated restarts) — without this, the DB row (and any WorkflowStepRun
   * left RUNNING) would stay stuck forever with no visible error. WAITING
   * runs (paused at an APPROVAL) are untouched — that's an intentional pause,
   * not a stall.
   */
  async sweepStuckRuns(): Promise<{ swept: number }> {
    const cutoff = new Date(Date.now() - WORKFLOW_RUN_STUCK_TIMEOUT_MS);
    const stuck = await this.prisma.workflowRun.findMany({
      where: { status: { in: ['PENDING', 'RUNNING'] }, createdAt: { lt: cutoff } },
      select: { id: true, companyId: true, workflowId: true, createdAt: true },
    });
    if (stuck.length === 0) {
      return { swept: 0 };
    }
    const error =
      'Orphaned: run exceeded the max expected execution time (likely a worker restart mid-execution) — swept by the workflow-run watchdog.';
    for (const run of stuck) {
      await this.prisma.workflowStepRun.updateMany({
        where: { runId: run.id, status: { in: ['PENDING', 'RUNNING'] } },
        data: { status: 'FAILED', error, finishedAt: new Date() },
      });
      await this.prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: 'FAILED', error, finishedAt: new Date() },
      });
      this.logger.warn(
        `workflow-run watchdog: swept orphaned run=${run.id} wf=${run.workflowId} company=${run.companyId} (created ${run.createdAt.toISOString()})`,
      );
    }
    return { swept: stuck.length };
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

        // APPROVAL pauses the run: persist state, open an approval, and STOP —
        // UNLESS this node is configured autoApprove:true, in which case it
        // falls through to runNode() below like any other step (resolves
        // immediately, no PENDING ApprovalRequest, no pause).
        if (current.type === 'APPROVAL' && !this.isAutoApprove(current)) {
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

  /** APPROVAL nodes configured `autoApprove: true` skip the human gate (docs on ApprovalNodeConfig). */
  private isAutoApprove(node: WorkflowNode): boolean {
    return node.config?.autoApprove === true;
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

    const rawMessage = resolveTemplate(node.config?.message, context).trim();
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

  /**
   * Pick the next node: CONDITION follows its branch edge, else the first edge.
   *
   * A CONDITION with NO branch-tagged outgoing edges at all is a deliberate,
   * simple "pass-through" design (the condition result is just logged, not
   * used to route) — that keeps working as before. But if the node has SOME
   * branch-tagged edges and the current result doesn't match any of them
   * (e.g. only a `[true]` edge exists and the result is `false`), silently
   * falling back to an arbitrary edge would run the WRONG downstream steps
   * with no error anywhere. Fail loudly instead.
   */
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
      const matched = outgoing.find((e) => e.branch === branch);
      const anyBranchTagged = outgoing.some((e) => e.branch);
      if (matched) {
        edge = matched;
      } else if (!anyBranchTagged) {
        edge = outgoing[0];
      } else {
        throw new Error(
          `CONDITION node "${node.id}" evaluated to ${branch}, but no outgoing edge has branch="${branch}" (misconfigured workflow)`,
        );
      }
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
      case 'APPROVAL':
        // Only reached when isAutoApprove(node) is true — the run loop pauses
        // (never calling runNode/executeNode) for a regular gated approval.
        return this.execAutoApproval(node, context);
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
    if (result.usage) {
      await this.usage.record({
        companyId,
        employeeId: employeeId || null,
        source: 'workflow_ai_step',
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
      });
    }
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
    // Same convention as execAiStep's cfg.employeeId: run as this employee's
    // own connection when set, so a company that only connected this skill
    // per-employee (no company-wide row) can still be reached from a
    // workflow — without this, resolveInstalledForExecution below would
    // never find the employee-owned row and the step would silently run
    // against whatever mock/sandbox fallback the executor has for
    // "not connected", even though a real connection exists.
    const employeeId =
      typeof cfg.employeeId === 'string' && cfg.employeeId.trim()
        ? cfg.employeeId.trim()
        : undefined;

    // Quarantine (docs §5.5): if this skill's connector is DEGRADED/DISCONNECTED,
    // fail the step with a clear, non-retryable "connector unavailable" error
    // rather than hammer a dead provider. Only applies when the skill is installed
    // as a connector AND currently unhealthy — a not-installed or CONNECTED/
    // NOT_CONNECTED skill runs exactly as before (default mock connectors stay
    // CONNECTED, so existing workflow tests are unaffected).
    if (skillKey) {
      // Same priority as resolveInstalledForExecution: the employee-owned
      // row first (if this step runs as one), else the company-wide row.
      // findFirst (not findUnique + the companyId_skillKey_employeeId
      // compound key): Prisma's compound-unique-index type requires a
      // non-null employeeId, even though the column is nullable — see the
      // note on SkillsService.resolveInstalledForExecution.
      const ownConnector = employeeId
        ? await this.prisma.installedSkill.findFirst({
            where: { companyId, skillKey, employeeId },
            select: { connectionStatus: true },
          })
        : null;
      const connector =
        ownConnector ??
        (await this.prisma.installedSkill.findFirst({
          where: { companyId, skillKey, employeeId: null },
          select: { connectionStatus: true },
        }));
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
    const call = await this.skills.runTool(
      { companyId, employeeId },
      skillKey,
      tool,
      args,
    );
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

  /** Auto-approved APPROVAL (config.autoApprove: true): resolves immediately —
   * no ApprovalRequest, no pause — but still leaves an auditable step in the run log. */
  private execAutoApproval(
    node: WorkflowNode,
    context: Record<string, unknown>,
  ): NodeResult {
    const cfg = node.config ?? {};
    const message = resolveTemplate(cfg.message, context);
    return { output: { approved: true, auto: true, message } };
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
