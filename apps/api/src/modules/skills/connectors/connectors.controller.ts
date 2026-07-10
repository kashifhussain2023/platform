import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { ConnectorHealthDto } from '@vaep/types';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { ConnectorHealthService } from './connector-health.service';

/**
 * Connector health endpoints (Unit B, docs §1.8). A "connector" is an
 * InstalledSkill; routes are tenant-scoped by companyId from the JWT. Reading
 * health is open to any authenticated member; the manual health-check trigger is
 * OWNER/ADMIN. Shares the `connectors` path with the events controllers — the
 * `:id/health*` routes don't collide with `:connectorId/events|webhook`.
 */
@Controller('connectors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConnectorsController {
  constructor(private readonly health: ConnectorHealthService) {}

  /** Current health snapshot for an owned connector. */
  @Get(':id/health')
  getHealth(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<ConnectorHealthDto> {
    return this.health.getHealth(companyId, id);
  }

  /** Run an active probe now and return the updated health (OWNER/ADMIN). */
  @Post(':id/health-check')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  runHealthCheck(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<ConnectorHealthDto> {
    return this.health.runHealthCheck(companyId, id);
  }
}
