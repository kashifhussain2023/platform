'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConnectorCircuitDto, DlqJobDto } from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useCurrentRole } from '@/features/users/hooks';
import { useSessionStore } from '@/stores/session.store';
import {
  discardDlqJob,
  listConnectorCircuits,
  listDlqJobs,
  replayDlqJob,
} from './api';

export const adminKeys = {
  all: ['admin'] as const,
  dlq: ['admin', 'dlq'] as const,
  circuits: ['admin', 'circuits'] as const,
};

/** Whether the current user may manage the system surface (OWNER/ADMIN). */
export function useCanManageSystem(): boolean {
  const role = useCurrentRole();
  return role === 'OWNER' || role === 'ADMIN';
}

/** Failed (dead-lettered) jobs across the company's queues; light polling. */
export function useDlqJobs() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const canManage = useCanManageSystem();
  return useQuery<DlqJobDto[], NormalizedApiError>({
    queryKey: adminKeys.dlq,
    queryFn: () => listDlqJobs(),
    enabled: Boolean(accessToken) && canManage,
    refetchInterval: 15_000,
  });
}

/** Per-connector circuit-breaker states for the company. */
export function useConnectorCircuits() {
  const accessToken = useSessionStore((s) => s.accessToken);
  const canManage = useCanManageSystem();
  return useQuery<ConnectorCircuitDto[], NormalizedApiError>({
    queryKey: adminKeys.circuits,
    queryFn: listConnectorCircuits,
    enabled: Boolean(accessToken) && canManage,
    refetchInterval: 15_000,
  });
}

interface DlqContext {
  previous?: DlqJobDto[];
}

/** Optimistically drop a job from the list, roll back on error, settle-invalidate. */
function useDlqMutation(
  fn: (vars: { queue: string; jobId: string }) => Promise<void>,
) {
  const qc = useQueryClient();
  return useMutation<
    void,
    NormalizedApiError,
    { queue: string; jobId: string },
    DlqContext
  >({
    mutationFn: fn,
    onMutate: async ({ jobId }) => {
      await qc.cancelQueries({ queryKey: adminKeys.dlq });
      const previous = qc.getQueryData<DlqJobDto[]>(adminKeys.dlq);
      qc.setQueryData<DlqJobDto[]>(adminKeys.dlq, (old) =>
        (old ?? []).filter((j) => j.id !== jobId),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(adminKeys.dlq, context.previous);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.dlq });
    },
  });
}

export function useReplayDlqJob() {
  return useDlqMutation(replayDlqJob);
}

export function useDiscardDlqJob() {
  return useDlqMutation(discardDlqJob);
}
