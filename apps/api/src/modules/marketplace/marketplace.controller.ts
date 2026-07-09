import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type {
  AiEmployeeDto,
  MarketplaceCatalogDto,
  WorkflowDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InstallEmployeeDto } from './dto/install-employee.dto';
import { MarketplaceService } from './marketplace.service';

/**
 * Marketplace routes: tenant-scoped by companyId (from the JWT), JWT-guarded.
 * The catalog is code-defined; installs delegate to the existing services.
 * (Skill installs stay at the existing POST /skills/install.)
 */
@Controller('marketplace')
@UseGuards(JwtAuthGuard)
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  /** The unified catalog (employees + workflows + reused skills). */
  @Get()
  catalog(): MarketplaceCatalogDto {
    return this.marketplace.catalog();
  }

  /** Hire an AI employee from a template (optional name override). */
  @Post('employees/:key/install')
  installEmployee(
    @CurrentTenant() companyId: string,
    @Param('key') key: string,
    @Body() dto: InstallEmployeeDto,
  ): Promise<AiEmployeeDto> {
    return this.marketplace.installEmployee(companyId, key, dto);
  }

  /** Install a workflow template as a new workflow. */
  @Post('workflows/:key/install')
  installWorkflow(
    @CurrentTenant() companyId: string,
    @Param('key') key: string,
  ): Promise<WorkflowDto> {
    return this.marketplace.installWorkflow(companyId, key);
  }
}
