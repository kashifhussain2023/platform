'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CompanyDto,
  CompleteOnboardingDto,
  CompleteOnboardingResultDto,
  EmployeeRoleTemplate,
  MeDto,
  OnboardingStatusDto,
} from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { authKeys } from '@/features/auth/hooks';
import { employeeKeys } from '@/features/employees/hooks';
import { tenantKeys } from '@/features/tenant/hooks';
import { useSessionStore } from '@/stores/session.store';
import {
  completeOnboardingRequest,
  onboardingCatalogRequest,
  onboardingStatusRequest,
} from './api';

export const onboardingKeys = {
  status: ['onboarding', 'status'] as const,
  catalog: ['onboarding', 'catalog'] as const,
};

/** Whether the current tenant has completed the onboarding wizard. */
export function useOnboardingStatus() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<OnboardingStatusDto, NormalizedApiError>({
    queryKey: onboardingKeys.status,
    queryFn: onboardingStatusRequest,
    enabled: Boolean(accessToken),
  });
}

/** The (static) code-defined hire catalog. */
export function useOnboardingCatalog() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<EmployeeRoleTemplate[], NormalizedApiError>({
    queryKey: onboardingKeys.catalog,
    queryFn: onboardingCatalogRequest,
    enabled: Boolean(accessToken),
    staleTime: Infinity,
  });
}

interface CompleteContext {
  previousStatus?: OnboardingStatusDto;
}

/**
 * Complete onboarding (optimistic): flip the status to completed immediately,
 * roll back on error; on success sync the returned company + refresh employees.
 */
export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation<
    CompleteOnboardingResultDto,
    NormalizedApiError,
    CompleteOnboardingDto,
    CompleteContext
  >({
    mutationFn: completeOnboardingRequest,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: onboardingKeys.status });
      const previousStatus = qc.getQueryData<OnboardingStatusDto>(
        onboardingKeys.status,
      );
      qc.setQueryData<OnboardingStatusDto>(onboardingKeys.status, {
        completed: true,
      });
      return { previousStatus };
    },
    onSuccess: (result) => {
      qc.setQueryData<CompanyDto>(tenantKeys.current, result.company);
      qc.setQueryData<MeDto>(authKeys.me, (old) =>
        old ? { ...old, company: result.company } : old,
      );
    },
    onError: (_err, _vars, context) => {
      if (context?.previousStatus) {
        qc.setQueryData(onboardingKeys.status, context.previousStatus);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: onboardingKeys.status });
      void qc.invalidateQueries({ queryKey: tenantKeys.current });
      void qc.invalidateQueries({ queryKey: authKeys.me });
      void qc.invalidateQueries({ queryKey: employeeKeys.list });
    },
  });
}
