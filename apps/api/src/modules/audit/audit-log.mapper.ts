import type { AuditLog } from '@prisma/client';
import type { AuditLogDto } from '@vaep/types';

export function toAuditLogDto(row: AuditLog, actorName: string | null): AuditLogDto {
  return {
    id: row.id,
    companyId: row.companyId,
    actorUserId: row.actorUserId,
    actorName,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
