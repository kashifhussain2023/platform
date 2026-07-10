import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  ConnectorCircuitDto,
  DlqJobDto,
  DlqSummaryEntryDto,
} from '@vaep/types';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CircuitBreakerRegistry } from '../../common/resilience/circuit-breaker.registry';
import { DlqService } from '../../common/resilience/dlq.service';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';

/**
 * Admin resilience surface (Unit C, docs §4.4/§9). OWNER/ADMIN only, and every
 * result is tenant-scoped to the caller's companyId (the DlqService filters
 * failed jobs by payload companyId; the circuit view lists only the company's
 * own connectors). MEMBERs get 403; unauthenticated callers 401.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('OWNER', 'ADMIN')
export class DlqController {
  constructor(
    private readonly dlq: DlqService,
    private readonly breakers: CircuitBreakerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Per-queue failed-job counts for the company (alert-friendly monitoring).
   * Declared before `GET /dlq` so the static `summary` segment matches first.
   */
  @Get('dlq/summary')
  summary(
    @CurrentTenant() companyId: string,
  ): Promise<DlqSummaryEntryDto[]> {
    return this.dlq.summary(companyId);
  }

  /** Dead-lettered (failed) jobs for the company, optionally for one queue. */
  @Get('dlq')
  list(
    @CurrentTenant() companyId: string,
    @Query('queue') queue?: string,
    @Query('limit') limit?: string,
  ): Promise<DlqJobDto[]> {
    const parsed = limit == null ? undefined : Number(limit);
    return this.dlq.list(companyId, queue || undefined, parsed);
  }

  /** Re-enqueue (retry) a dead-lettered job owned by the company. */
  @Post('dlq/:queue/:jobId/replay')
  @HttpCode(200)
  replay(
    @CurrentTenant() companyId: string,
    @Param('queue') queue: string,
    @Param('jobId') jobId: string,
  ) {
    return this.dlq.replay(companyId, queue, jobId);
  }

  /** Permanently discard a dead-lettered job owned by the company. */
  @Delete('dlq/:queue/:jobId')
  @HttpCode(200)
  discard(
    @CurrentTenant() companyId: string,
    @Param('queue') queue: string,
    @Param('jobId') jobId: string,
  ) {
    return this.dlq.discard(companyId, queue, jobId);
  }

  /**
   * Circuit-breaker state for each of the company's connectors (InstalledSkills).
   * Read-only; reflects an elapsed cooldown as HALF_OPEN. Light panel data.
   */
  @Get('circuit')
  async circuits(
    @CurrentTenant() companyId: string,
  ): Promise<ConnectorCircuitDto[]> {
    const connectors = await this.prisma.installedSkill.findMany({
      where: { companyId },
      select: { id: true, skillKey: true },
      orderBy: { createdAt: 'asc' },
    });
    return Promise.all(
      connectors.map(async (c) => ({
        connectorId: c.id,
        skillKey: c.skillKey,
        state: await this.breakers.getState(c.id),
      })),
    );
  }
}
