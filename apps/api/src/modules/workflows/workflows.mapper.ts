import type {
  Workflow,
  WorkflowRun,
  WorkflowStepRun,
} from '@prisma/client';
import type {
  TriggerConfig,
  TriggerType,
  WorkflowDefinition,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowStepRunDto,
} from '@vaep/types';

/** Prisma row → public DTO mappers for the workflows module. */

/** An empty definition, used as the fallback when a stored definition is null. */
export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

/**
 * Definition given to a freshly-created workflow: a single TRIGGER entry node so
 * a new workflow is never empty (the editor also assumes a TRIGGER always leads).
 * Users add real steps in the builder and Save; a trigger-only workflow runs to
 * COMPLETED as a harmless no-op instead of failing with "no nodes to run".
 */
export const STARTER_DEFINITION: WorkflowDefinition = {
  nodes: [{ id: 'trigger', type: 'TRIGGER', config: {} }],
  edges: [],
};

export function toWorkflowDto(w: Workflow): WorkflowDto {
  return {
    id: w.id,
    companyId: w.companyId,
    name: w.name,
    description: w.description,
    status: w.status,
    definition:
      (w.definition as unknown as WorkflowDefinition | null) ??
      EMPTY_DEFINITION,
    triggerType: w.triggerType as TriggerType,
    triggerConfig: (w.triggerConfig as TriggerConfig | null) ?? null,
    webhookToken: w.webhookToken ?? null,
    activatedAt: w.activatedAt?.toISOString() ?? null,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
  };
}

export function toWorkflowStepRunDto(s: WorkflowStepRun): WorkflowStepRunDto {
  return {
    id: s.id,
    companyId: s.companyId,
    runId: s.runId,
    nodeId: s.nodeId,
    type: s.type,
    status: s.status,
    input: s.input ?? null,
    output: s.output ?? null,
    error: s.error,
    startedAt: s.startedAt?.toISOString() ?? null,
    finishedAt: s.finishedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
  };
}

export function toWorkflowRunDto(
  r: WorkflowRun & { steps?: WorkflowStepRun[] },
): WorkflowRunDto {
  return {
    id: r.id,
    companyId: r.companyId,
    workflowId: r.workflowId,
    status: r.status,
    source: r.source,
    trigger: (r.trigger as Record<string, unknown> | null) ?? null,
    context: (r.context as Record<string, unknown> | null) ?? null,
    error: r.error,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    steps: r.steps ? r.steps.map(toWorkflowStepRunDto) : undefined,
  };
}
