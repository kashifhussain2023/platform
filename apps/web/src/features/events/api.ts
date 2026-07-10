import { apiClient } from '@/lib/apiClient';
import type { CanonicalEventDto } from '@vaep/types';

/**
 * Recent CANONICAL events for one connector (newest first). Backs the read-only
 * "Recent Events" panel on the connector/skill detail. Mirrors the backend
 * `GET /connectors/:connectorId/events?kind=canonical`.
 */
export async function listConnectorEvents(
  connectorId: string,
  limit = 20,
): Promise<CanonicalEventDto[]> {
  const { data } = await apiClient.get<CanonicalEventDto[]>(
    `/connectors/${connectorId}/events`,
    { params: { kind: 'canonical', limit } },
  );
  return data;
}

/** Recent canonical events for the whole company (global feed). */
export async function listCanonicalEvents(
  type?: string,
  limit = 50,
): Promise<CanonicalEventDto[]> {
  const { data } = await apiClient.get<CanonicalEventDto[]>(
    '/events/canonical',
    { params: { ...(type ? { type } : {}), limit } },
  );
  return data;
}
