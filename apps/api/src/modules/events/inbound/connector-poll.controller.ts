import {
  Controller,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentTenant } from '../../auth/decorators/current-tenant.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { GmailInboundService, type PollResult } from './gmail-inbound.service';

/**
 * Manual/immediate inbound poll trigger (OWNER/ADMIN, tenant-scoped). Resolves the
 * owned connector then runs one Gmail inbound poll NOW, returning the outcome.
 * Complements the ~60s scheduled sweep for testing and on-demand catch-up. Shares
 * the `connectors` path prefix with the health/events controllers; the `:id/poll`
 * route does not collide with `:id/health*` or `:connectorId/events`.
 */
@Controller('connectors')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConnectorPollController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inbound: GmailInboundService,
  ) {}

  @Post(':id/poll')
  @Roles('OWNER', 'ADMIN')
  @HttpCode(200)
  async poll(
    @CurrentTenant() companyId: string,
    @Param('id') id: string,
  ): Promise<PollResult> {
    const connector = await this.prisma.installedSkill.findFirst({
      where: { id, companyId },
    });
    if (!connector) {
      throw new NotFoundException('Connector not found');
    }
    return this.inbound.poll(connector);
  }
}
