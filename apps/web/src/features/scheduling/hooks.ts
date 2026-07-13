'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddSlotDto,
  BlockDateDto,
  GenerateSlotsDto,
  InterviewSlotDto,
  RescheduleResultDto,
  RescheduleSlotDto,
  SlotStatus,
  SlotSummaryDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import {
  addSlot,
  blockDate,
  cancelSlot,
  generateSlots,
  getSummary,
  listSlots,
  rescheduleSlot,
} from './api';

export const schedulingKeys = {
  all: ['scheduling'] as const,
  list: (status?: SlotStatus) => ['scheduling', 'slots', status ?? 'ALL'] as const,
  summary: () => ['scheduling', 'summary'] as const,
};

/** Slots for a status filter (omit for all). */
export function useSlots(status?: SlotStatus) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<InterviewSlotDto[], NormalizedApiError>({
    queryKey: schedulingKeys.list(status),
    queryFn: () => listSlots(status),
    enabled: Boolean(accessToken),
  });
}

/** Open/booked/cancelled counts. */
export function useSlotSummary() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<SlotSummaryDto, NormalizedApiError>({
    queryKey: schedulingKeys.summary(),
    queryFn: getSummary,
    enabled: Boolean(accessToken),
  });
}

/** Generate a recurring weekly slot pattern. */
export function useGenerateSlots() {
  const qc = useQueryClient();
  return useMutation<{ created: number }, NormalizedApiError, GenerateSlotsDto>({
    mutationFn: generateSlots,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

/** Add one custom one-off slot. */
export function useAddSlot() {
  const qc = useQueryClient();
  return useMutation<InterviewSlotDto, NormalizedApiError, AddSlotDto>({
    mutationFn: addSlot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

/** Block a whole date, cancelling every still-OPEN slot that day. */
export function useBlockDate() {
  const qc = useQueryClient();
  return useMutation<{ cancelled: number }, NormalizedApiError, BlockDateDto>({
    mutationFn: blockDate,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

/** Cancel one OPEN slot (optimistic). */
export function useCancelSlot() {
  const qc = useQueryClient();
  return useMutation<InterviewSlotDto, NormalizedApiError, string>({
    mutationFn: cancelSlot,
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: schedulingKeys.all });
      const snapshot = qc.getQueriesData<InterviewSlotDto[]>({
        queryKey: schedulingKeys.all,
      });
      for (const [key, data] of snapshot) {
        if (!data) continue;
        qc.setQueryData(
          key,
          data.map((s) => (s.id === id ? { ...s, status: 'CANCELLED' as const } : s)),
        );
      }
      return { snapshot };
    },
    onError: (_err, _id, context) => {
      const ctx = context as { snapshot: Array<[readonly unknown[], InterviewSlotDto[] | undefined]> } | undefined;
      if (!ctx) return;
      for (const [key, data] of ctx.snapshot) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}

/** Reschedule a booked interview: delete old event, book a fresh slot for the same candidate. */
export function useRescheduleSlot() {
  const qc = useQueryClient();
  return useMutation<
    RescheduleResultDto,
    NormalizedApiError,
    { id: string; data?: RescheduleSlotDto }
  >({
    mutationFn: rescheduleSlot,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: schedulingKeys.all });
    },
  });
}
