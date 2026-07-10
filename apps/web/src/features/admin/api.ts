import { apiClient } from '@/lib/apiClient';
import type { ConnectorCircuitDto, DlqJobDto } from '@vaep/types';

// Admin resilience surface (Unit C): DLQ list/replay/discard + connector circuit
// states. OWNER/ADMIN only (enforced server-side); every result is company-scoped.

export async function listDlqJobs(queue?: string): Promise<DlqJobDto[]> {
  const { data } = await apiClient.get<DlqJobDto[]>('/admin/dlq', {
    params: queue ? { queue } : undefined,
  });
  return data;
}

export async function replayDlqJob(vars: {
  queue: string;
  jobId: string;
}): Promise<void> {
  await apiClient.post(
    `/admin/dlq/${encodeURIComponent(vars.queue)}/${encodeURIComponent(
      vars.jobId,
    )}/replay`,
  );
}

export async function discardDlqJob(vars: {
  queue: string;
  jobId: string;
}): Promise<void> {
  await apiClient.delete(
    `/admin/dlq/${encodeURIComponent(vars.queue)}/${encodeURIComponent(
      vars.jobId,
    )}`,
  );
}

export async function listConnectorCircuits(): Promise<ConnectorCircuitDto[]> {
  const { data } = await apiClient.get<ConnectorCircuitDto[]>('/admin/circuit');
  return data;
}
