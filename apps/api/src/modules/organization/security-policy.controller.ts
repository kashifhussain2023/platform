import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import type { SecurityPolicyDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.provider';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateSecurityPolicyDto } from './dto/update-security-policy.dto';
import { OrganizationService } from './organization.service';

/**
 * Security policy (P1 #7), one per company, tenant-scoped by companyId from the
 * JWT. GET self-heals a default policy when none exists (open to any member);
 * PATCH is @Roles('OWNER','ADMIN').
 */
@Controller('security-policy')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SecurityPolicyController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  get(@CurrentTenant() companyId: string): Promise<SecurityPolicyDto> {
    return this.org.getSecurityPolicy(companyId);
  }

  @Patch()
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSecurityPolicyDto,
  ): Promise<SecurityPolicyDto> {
    return this.org.updateSecurityPolicy(companyId, dto, user.userId);
  }
}
