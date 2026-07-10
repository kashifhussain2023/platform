import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import type {
  CanonicalEventDto,
  ConnectorEventKind,
  RawEventDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { EventsService } from './events.service';

/**
 * Tenant-scoped observability for one connector's events (JWT-guarded, any
 * member). `?kind=raw` returns the append-only ingestion log; anything else (the
 * default) returns the normalized canonical events — newest first, limited.
 */
@Controller('connectors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConnectorEventsController {
  constructor(private readonly events: EventsService) {}

  @Get(':connectorId/events')
  list(
    @CurrentTenant() companyId: string,
    @Param('connectorId') connectorId: string,
    @Query('kind') kind?: string,
    @Query('limit') limit?: string,
  ): Promise<RawEventDto[] | CanonicalEventDto[]> {
    const resolved: ConnectorEventKind = kind === 'raw' ? 'raw' : 'canonical';
    return this.events.listConnectorEvents(
      companyId,
      connectorId,
      resolved,
      limit,
    );
  }
}
