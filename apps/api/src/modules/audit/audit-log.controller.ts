import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { AuditLogDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { AuditLogService } from './audit-log.service';
import { ListAuditLogQueryDto } from './dto/list-audit-log-query.dto';

/** Who-did-what feed (tenant-scoped, JWT-guarded). OWNER/ADMIN only. */
@Controller('audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  list(
    @CurrentTenant() companyId: string,
    @Query() query: ListAuditLogQueryDto,
  ): Promise<AuditLogDto[]> {
    return this.auditLog.list(companyId, query.entityType, query.limit);
  }
}
