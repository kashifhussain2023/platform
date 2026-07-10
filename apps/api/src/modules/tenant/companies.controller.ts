import { Body, Controller, Patch, UseGuards } from '@nestjs/common';
import type { CompanyDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { TenantService } from './tenant.service';

/** Company profile routes, tenant-scoped by companyId from the JWT. */
@Controller('companies')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CompaniesController {
  constructor(private readonly tenant: TenantService) {}

  /** Update the current tenant's company profile (OWNER/ADMIN only). */
  @Patch('current')
  @Roles('OWNER', 'ADMIN')
  update(
    @CurrentTenant() companyId: string,
    @Body() dto: UpdateCompanyDto,
  ): Promise<CompanyDto> {
    return this.tenant.update(companyId, dto);
  }
}
