import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type {
  CompleteOnboardingResultDto,
  EmployeeRoleTemplate,
  OnboardingStatusDto,
} from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CompleteOnboardingDto } from './dto/complete-onboarding.dto';
import { OnboardingService } from './onboarding.service';

/** AI Onboarding Wizard routes, tenant-scoped by companyId from the JWT. */
@Controller('onboarding')
@UseGuards(JwtAuthGuard)
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get('status')
  status(@CurrentTenant() companyId: string): Promise<OnboardingStatusDto> {
    return this.onboarding.status(companyId);
  }

  @Get('catalog')
  catalog(): EmployeeRoleTemplate[] {
    return this.onboarding.catalog();
  }

  @Post('complete')
  complete(
    @CurrentTenant() companyId: string,
    @Body() dto: CompleteOnboardingDto,
  ): Promise<CompleteOnboardingResultDto> {
    return this.onboarding.complete(companyId, dto);
  }
}
