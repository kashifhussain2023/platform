import type { CanonicalEvent, RawEvent } from '@prisma/client';
import type {
  CanonicalEventDto,
  CanonicalEventType,
  RawEventDto,
  RawEventStatus,
} from '@vaep/types';

/** Prisma row → public DTO mappers for the events module. */

/**
 * The verbatim `headers`/`payload` columns are deliberately NOT exposed here —
 * the observability endpoints return a lightweight audit row, not the full
 * (potentially large / sensitive) provider payload.
 */
export function toRawEventDto(e: RawEvent): RawEventDto {
  return {
    id: e.id,
    companyId: e.companyId,
    connectorId: e.connectorId,
    provider: e.provider,
    externalId: e.externalId,
    signatureVerified: e.signatureVerified,
    status: e.status as RawEventStatus,
    error: e.error,
    receivedAt: e.receivedAt.toISOString(),
  };
}

export function toCanonicalEventDto(e: CanonicalEvent): CanonicalEventDto {
  return {
    id: e.id,
    companyId: e.companyId,
    connectorId: e.connectorId,
    rawEventId: e.rawEventId,
    provider: e.provider,
    type: e.type as CanonicalEventType,
    dedupeKey: e.dedupeKey,
    occurredAt: e.occurredAt?.toISOString() ?? null,
    receivedAt: e.receivedAt.toISOString(),
    subject: (e.subject as Record<string, unknown> | null) ?? null,
    data: (e.data as Record<string, unknown> | null) ?? null,
    schemaVersion: e.schemaVersion,
  };
}
