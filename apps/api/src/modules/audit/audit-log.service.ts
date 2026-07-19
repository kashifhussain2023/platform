import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditLogDto } from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { clampLimit } from '../../common/pagination';
import { toAuditLogDto } from './audit-log.mapper';

export interface RecordAuditParams {
  companyId: string;
  actorUserId?: string | null;
  /** e.g. "workflow.create", "user.role_changed", "skill.install". */
  action: string;
  /** e.g. "Workflow", "User", "InstalledSkill". */
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Minimal who-did-what trail (founder-market-readiness-audit.md §6/§4).
 * `@Global`-exported (see audit.module.ts) so any module can inject this
 * without a circular import back to a "core" module.
 */
@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record one entry. Never throws -- an audit-log write failing must not
   * break the real action it's describing (same "best-effort" contract as
   * SkillsService.recordEgressHealth).
   */
  async record(params: RecordAuditParams): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: params.companyId,
          actorUserId: params.actorUserId ?? null,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId ?? null,
          metadata: (params.metadata ?? undefined) as
            | Prisma.InputJsonValue
            | undefined,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to record audit log entry (${params.action}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Recent entries for the company (a global feed), optionally by entityType. */
  async list(
    companyId: string,
    entityType?: string,
    limitRaw?: unknown,
  ): Promise<AuditLogDto[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { companyId, ...(entityType ? { entityType } : {}) },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limitRaw),
    });

    const actorIds = [
      ...new Set(
        rows
          .map((r) => r.actorUserId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actors = actorIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(actors.map((u) => [u.id, u.name]));

    return rows.map((r) =>
      toAuditLogDto(r, r.actorUserId ? (nameById.get(r.actorUserId) ?? null) : null),
    );
  }
}
