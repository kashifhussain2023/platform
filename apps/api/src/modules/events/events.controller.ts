import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import type { CanonicalEventDto } from '@vaep/types';
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
}
