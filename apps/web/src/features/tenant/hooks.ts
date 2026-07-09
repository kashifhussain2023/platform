'use client';

import { useQuery } from '@tanstack/react-query';
import type { CompanyDto } from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import { currentCompanyRequest } from './api';

export const tenantKeys = {
  current: ['tenant', 'current'] as const,
};

/** Mirrors the auth feature: current company for the authenticated tenant. */
export function useCurrentCompany() {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<CompanyDto, NormalizedApiError>({
    queryKey: tenantKeys.current,
    queryFn: currentCompanyRequest,
    enabled: Boolean(accessToken),
  });
}
