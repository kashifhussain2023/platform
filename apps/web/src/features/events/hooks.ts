'use client';

import { useQuery } from '@tanstack/react-query';
import type { CanonicalEventDto } from '@vaep/types';
import type { NormalizedApiError } from '@/lib/apiClient';
import { useSessionStore } from '@/stores/session.store';
import { listCanonicalEvents, listConnectorEvents } from './api';

export const eventKeys = {
  connector: (connectorId: string) =>
    ['connectors', connectorId, 'events'] as const,
  canonical: (type?: string) => ['events', 'canonical', type ?? 'all'] as const,
};

/**
 * Recent canonical events for one connector (read-only). Lightly polls so a
 * freshly-ingested webhook surfaces without a manual refresh; disabled for the
 * optimistic `temp_` rows that have no server id yet.
 */
export function useConnectorEvents(connectorId: string) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<CanonicalEventDto[], NormalizedApiError>({
    queryKey: eventKeys.connector(connectorId),
    queryFn: () => listConnectorEvents(connectorId),
    enabled:
      Boolean(accessToken && connectorId) && !connectorId.startsWith('temp_'),
    refetchInterval: 5000,
  });
}

/** Recent canonical events across the company (optional type filter). */
export function useCanonicalEvents(type?: string) {
  const accessToken = useSessionStore((s) => s.accessToken);
  return useQuery<CanonicalEventDto[], NormalizedApiError>({
    queryKey: eventKeys.canonical(type),
    queryFn: () => listCanonicalEvents(type),
    enabled: Boolean(accessToken),
  });
}
