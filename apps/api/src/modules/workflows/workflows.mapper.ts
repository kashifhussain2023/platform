import type {
  Workflow,
  WorkflowRun,
  WorkflowStepRun,
} from '@prisma/client';
import type {
  WorkflowDefinition,
  WorkflowDto,
  WorkflowRunDto,
  WorkflowStepRunDto,
} from '@vaep/types';

/** Prisma row → public DTO mappers for the workflows module. */

/** An empty definition, used when a workflow is created without one. */
export const EMPTY_DEFINITION: WorkflowDefinition = { nodes: [], edges: [] };

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
    trigger: (r.trigger as Record<string, unknown> | null) ?? null,
    context: (r.context as Record<string, unknown> | null) ?? null,
    error: r.error,
    startedAt: r.startedAt?.toISOString() ?? null,
    finishedAt: r.finishedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    steps: r.steps ? r.steps.map(toWorkflowStepRunDto) : undefined,
  };
}
