import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type {
  ActivityFeedDto,
  EmployeeKpiDto,
  OverviewDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { normalizeRange } from './analytics.constants';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics / KPI dashboard: read-only aggregations over existing data. All
 * routes are tenant-scoped by companyId (from the JWT) and JWT-guarded. The
 * optional `?range=today|7d|30d|all` (default 7d) bounds activity metrics.
 */
@Controller('analytics')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /** Company-wide KPIs (raw counts + illustrative derived estimates). */
  @Get('overview')
  overview(
    @CurrentTenant() companyId: string,
    @Query('range') range?: string,
  ): Promise<OverviewDto> {
    return this.analytics.overview(companyId, normalizeRange(range));
  }

  /** Per-employee KPI rows. */
  @Get('employees')
  employees(
    @CurrentTenant() companyId: string,
    @Query('range') range?: string,
  ): Promise<EmployeeKpiDto[]> {
    return this.analytics.employees(companyId, normalizeRange(range));
  }

  /** "Today's AI Activity" feed: per-employee grouped skill/tool + message counts. */
  @Get('activity')
  activity(
    @CurrentTenant() companyId: string,
    @Query('range') range?: string,
  ): Promise<ActivityFeedDto[]> {
    return this.analytics.activity(companyId, normalizeRange(range));
  }
}
