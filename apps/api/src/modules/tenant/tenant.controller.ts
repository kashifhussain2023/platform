import { Controller, Get, UseGuards } from '@nestjs/common';
import type { CompanyDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TenantService } from './tenant.service';

@Controller('tenant')
@UseGuards(JwtAuthGuard)
export class TenantController {
  constructor(private readonly tenant: TenantService) {}

  /** Current company for the authenticated user's tenant. */
  @Get('me')
  me(@CurrentTenant() companyId: string): Promise<CompanyDto> {
    return this.tenant.findById(companyId);
  }
}
