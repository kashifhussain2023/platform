'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateWorkflowDto,
  GenerateWorkflowMessageDto,
  GenerateWorkflowResultDto,
  UpdateWorkflowDto,
  WorkflowDto,
  WorkflowRunDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  activateWorkflow,
  createWorkflow,
  deactivateWorkflow,
  deleteWorkflow,
  generateWorkflowDraft,
  getWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  listWorkflows,
  runWorkflow,
  updateWorkflow,
} from './api';

export const workflowKeys = {
  all: ['workflows'] as const,
  list: ['workflows', 'list'] as const,
  detail: (id: string) => ['workflows', 'detail', id] as const,
  runs: (id: string) => ['workflows', id, 'runs'] as const,
  run: (runId: string) => ['workflows', 'run', runId] as const,
};

// --- Workflows -------------------------------------------------------------

export function useWorkflows() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<WorkflowDto[], NormalizedApiError>({
    queryKey: workflowKeys.list,
    queryFn: listWorkflows,
    enabled: Boolean(accessToken),
  });
}

export function useWorkflow(id: string) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<WorkflowDto, NormalizedApiError>({
    queryKey: workflowKeys.detail(id),
    queryFn: () => getWorkflow(id),
    enabled: Boolean(accessToken && id),
  });
}

interface WorkflowsContext {
  previous?: WorkflowDto[];
}

/** Create (optimistic): prepend a temp workflow, roll back on error. */
export function useCreateWorkflow() {
  const qc = useQueryClient();
  return useMutation<
    WorkflowDto,
    NormalizedApiError,
    CreateWorkflowDto,
    WorkflowsContext
  >({
    mutationFn: createWorkflow,
    onMutate: async (payload) => {
      await qc.cancelQueries({ queryKey: workflowKeys.list });
      const previous = qc.getQueryData<WorkflowDto[]>(workflowKeys.list);
      const now = new Date().toISOString();
      const optimistic: WorkflowDto = {
        id: `temp_${Date.now()}`,
        companyId: '',
        name: payload.name,
        description: payload.description ?? null,
        status: 'DRAFT',
        definition: payload.definition ?? { nodes: [], edges: [] },
        triggerType: 'MANUAL',
        triggerConfig: null,
        webhookToken: null,
        activatedAt: null,
        warnings: [],
        createdAt: now,
        updatedAt: now,
      };
      qc.setQueryData<WorkflowDto[]>(workflowKeys.list, (old) => [
        optimistic,
        ...(old ?? []),
      ]);
      return { previous };
    },
    onError: (_err, _payload, context) => {
      if (context?.previous) {
        qc.setQueryData(workflowKeys.list, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.list });
    },
  });
}

interface UpdateVars {
  id: string;
  data: UpdateWorkflowDto;
}

/** Update (optimistic status/name; definition persists on save). */
export function useUpdateWorkflow() {
  const qc = useQueryClient();
  return useMutation<
    WorkflowDto,
    NormalizedApiError,
    UpdateVars,
    WorkflowsContext
  >({
    mutationFn: updateWorkflow,
    onMutate: async ({ id, data }) => {
      await qc.cancelQueries({ queryKey: workflowKeys.list });
      const previous = qc.getQueryData<WorkflowDto[]>(workflowKeys.list);
      qc.setQueryData<WorkflowDto[]>(workflowKeys.list, (old) =>
        (old ?? []).map((w) => (w.id === id ? { ...w, ...data } : w)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(workflowKeys.list, context.previous);
      }
    },
    onSettled: (_data, _err, { id }) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.list });
      void qc.invalidateQueries({ queryKey: workflowKeys.detail(id) });
    },
  });
}

/** Delete (optimistic): remove the row immediately, roll back on error. */
export function useDeleteWorkflow() {
  const qc = useQueryClient();
  return useMutation<void, NormalizedApiError, string, WorkflowsContext>({
    mutationFn: deleteWorkflow,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: workflowKeys.list });
      const previous = qc.getQueryData<WorkflowDto[]>(workflowKeys.list);
      qc.setQueryData<WorkflowDto[]>(workflowKeys.list, (old) =>
        (old ?? []).filter((w) => w.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        qc.setQueryData(workflowKeys.list, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.list });
    },
  });
}

interface ActivateContext {
  previousList?: WorkflowDto[];
  previousDetail?: WorkflowDto;
}

/**
 * Activate/deactivate share one optimistic shape: flip the workflow's status in
 * both the list and detail caches, roll back on error, then invalidate so the
 * server truth (webhookToken/activatedAt) lands.
 */
function useSetActive(activate: boolean) {
  const qc = useQueryClient();
  const status: WorkflowDto['status'] = activate ? 'ACTIVE' : 'PAUSED';
  return useMutation<WorkflowDto, NormalizedApiError, string, ActivateContext>({
    mutationFn: (id) => (activate ? activateWorkflow(id) : deactivateWorkflow(id)),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: workflowKeys.list });
      await qc.cancelQueries({ queryKey: workflowKeys.detail(id) });
      const previousList = qc.getQueryData<WorkflowDto[]>(workflowKeys.list);
      const previousDetail = qc.getQueryData<WorkflowDto>(
        workflowKeys.detail(id),
      );
      qc.setQueryData<WorkflowDto[]>(workflowKeys.list, (old) =>
        (old ?? []).map((w) => (w.id === id ? { ...w, status } : w)),
      );
      qc.setQueryData<WorkflowDto>(workflowKeys.detail(id), (old) =>
        old ? { ...old, status } : old,
      );
      return { previousList, previousDetail };
    },
    onError: (_err, id, context) => {
      if (context?.previousList) {
        qc.setQueryData(workflowKeys.list, context.previousList);
      }
      if (context?.previousDetail) {
        qc.setQueryData(workflowKeys.detail(id), context.previousDetail);
      }
    },
    onSettled: (_data, _err, id) => {
      void qc.invalidateQueries({ queryKey: workflowKeys.list });
      void qc.invalidateQueries({ queryKey: workflowKeys.detail(id) });
    },
  });
}

/** Activate a workflow (arms its trigger). Optimistic status → ACTIVE. */
export function useActivateWorkflow() {
  return useSetActive(true);
}

/** Deactivate a workflow. Optimistic status → PAUSED. */
export function useDeactivateWorkflow() {
  return useSetActive(false);
}

// --- Runs ------------------------------------------------------------------

export function useRunWorkflow(id: string) {
  const qc = useQueryClient();
  return useMutation<
    WorkflowRunDto,
    NormalizedApiError,
    { trigger?: Record<string, unknown> }
  >({
    mutationFn: ({ trigger }) => runWorkflow({ id, trigger }),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: workflowKeys.runs(id) });
    },
  });
}

export function useWorkflowRuns(id: string) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<WorkflowRunDto[], NormalizedApiError>({
    queryKey: workflowKeys.runs(id),
    queryFn: () => listWorkflowRuns(id),
    enabled: Boolean(accessToken && id),
  });
}

/** True while the run is still executing. */
function isActive(run: WorkflowRunDto | undefined): boolean {
  return run?.status === 'PENDING' || run?.status === 'RUNNING';
}

/**
 * A single run WITH its steps. Polls every 1s while PENDING/RUNNING so the run
 * log advances live, then stops (refetchInterval → false).
 */
export function useWorkflowRun(runId: string | null) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<WorkflowRunDto, NormalizedApiError>({
    queryKey: workflowKeys.run(runId ?? ''),
    queryFn: () => getWorkflowRun(runId as string),
    enabled: Boolean(accessToken && runId),
    refetchInterval: (query) => (isActive(query.state.data) ? 1000 : false),
  });
}

/** AI-assisted draft generation — no cache to update; the chat holds its own state. */
export function useGenerateWorkflowDraft() {
  return useMutation<GenerateWorkflowResultDto, NormalizedApiError, GenerateWorkflowMessageDto[]>({
    mutationFn: generateWorkflowDraft,
  });
}
