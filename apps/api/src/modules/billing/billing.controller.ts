import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import type { PlanDto, SubscriptionDto, UsageDto } from '@vaep/types';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BillingService } from './billing.service';
import { ChangePlanDto } from './dto/change-plan.dto';

/**
 * Billing & Subscription routes: tenant-scoped by companyId (from the JWT),
 * JWT-guarded. Plans are code-defined; the subscription self-heals to a default
 * STARTER/ACTIVE on read. Plan limits are SOFT — usage is informational only.
 */
@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  /** The code-defined plan catalog. */
  @Get('plans')
  plans(): PlanDto[] {
    return this.billing.plans();
  }

  /** Current subscription (auto-creates the default if missing). */
  @Get('subscription')
  subscription(@CurrentTenant() companyId: string): Promise<SubscriptionDto> {
    return this.billing.getSubscription(companyId);
  }

  /** Change plan via the active provider (mock: immediate; Stripe: TODO checkout). */
  @Post('subscription')
  changePlan(
    @CurrentTenant() companyId: string,
    @Body() dto: ChangePlanDto,
  ): Promise<SubscriptionDto> {
    return this.billing.changePlan(companyId, dto);
  }

  /** On-the-fly usage snapshot + plan limit + soft over-limit flag. */
  @Get('usage')
  usage(@CurrentTenant() companyId: string): Promise<UsageDto> {
    return this.billing.usage(companyId);
  }
}
