import { apiClient } from '@/lib/apiClient';
import type {
  CreateWorkflowDto,
  GenerateWorkflowMessageDto,
  GenerateWorkflowResultDto,
  UpdateWorkflowDto,
  WorkflowDto,
  WorkflowRunDto,
} from '@vaep/types';

// --- Workflow CRUD ---------------------------------------------------------

export async function listWorkflows(): Promise<WorkflowDto[]> {
  const { data } = await apiClient.get<WorkflowDto[]>('/workflows');
  return data;
}

export async function getWorkflow(id: string): Promise<WorkflowDto> {
  const { data } = await apiClient.get<WorkflowDto>(`/workflows/${id}`);
  return data;
}

export async function createWorkflow(
  payload: CreateWorkflowDto,
): Promise<WorkflowDto> {
  const { data } = await apiClient.post<WorkflowDto>('/workflows', payload);
  return data;
}

export async function updateWorkflow(vars: {
  id: string;
  data: UpdateWorkflowDto;
}): Promise<WorkflowDto> {
  const { data } = await apiClient.patch<WorkflowDto>(
    `/workflows/${vars.id}`,
    vars.data,
  );
  return data;
}

export async function deleteWorkflow(id: string): Promise<void> {
  await apiClient.delete(`/workflows/${id}`);
}

export async function activateWorkflow(id: string): Promise<WorkflowDto> {
  const { data } = await apiClient.post<WorkflowDto>(
    `/workflows/${id}/activate`,
  );
  return data;
}

export async function deactivateWorkflow(id: string): Promise<WorkflowDto> {
  const { data } = await apiClient.post<WorkflowDto>(
    `/workflows/${id}/deactivate`,
  );
  return data;
}

// --- Runs ------------------------------------------------------------------

export async function runWorkflow(vars: {
  id: string;
  trigger?: Record<string, unknown>;
}): Promise<WorkflowRunDto> {
  const { data } = await apiClient.post<WorkflowRunDto>(
    `/workflows/${vars.id}/run`,
    { trigger: vars.trigger },
  );
  return data;
}

export async function listWorkflowRuns(id: string): Promise<WorkflowRunDto[]> {
  const { data } = await apiClient.get<WorkflowRunDto[]>(
    `/workflows/${id}/runs`,
  );
  return data;
}

export async function getWorkflowRun(runId: string): Promise<WorkflowRunDto> {
  const { data } = await apiClient.get<WorkflowRunDto>(
    `/workflows/runs/${runId}`,
  );
  return data;
}

// --- AI generation -----------------------------------------------------------

export async function generateWorkflowDraft(
  messages: GenerateWorkflowMessageDto[],
): Promise<GenerateWorkflowResultDto> {
  const { data } = await apiClient.post<GenerateWorkflowResultDto>(
    '/workflows/generate',
    { messages },
  );
  return data;
}
