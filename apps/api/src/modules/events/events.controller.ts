import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type { CanonicalEventDto, EventLineageDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { EventsService } from './events.service';

/**
 * Tenant-scoped global canonical-event feed (JWT-guarded, any member). Optional
 * `?type=` filters to one CanonicalEventType; `?limit=` caps the page size.
 */
@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get('canonical')
  listCanonical(
    @CurrentTenant() companyId: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ): Promise<CanonicalEventDto[]> {
    return this.events.listCanonicalEvents(companyId, type, limit);
  }

  /**
   * Event→run lineage (docs §9): the canonical event + the workflow run(s) it
   * triggered (joined on triggerEventId), each with status + step summary.
   */
  @Get('canonical/:id/lineage')
  lineage(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<EventLineageDto> {
    return this.events.getCanonicalLineage(companyId, id);
  }
}
