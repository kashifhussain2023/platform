import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { ResilienceModule } from './common/resilience/resilience.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { AdminModule } from './modules/admin/admin.module';
import { UsersModule } from './modules/users/users.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SkillsModule } from './modules/skills/skills.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { EventsModule } from './modules/events/events.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BillingModule } from './modules/billing/billing.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';

@Module({
  imports: [
    AppConfigModule,
    // Global safety-net rate limit (docs status audit §3: no rate limiting
    // existed anywhere). Generous default so normal use/tests are unaffected;
    // specific cost-sensitive endpoints (auth login/register, AI workflow
    // generation) carry their own tighter @Throttle() override.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CryptoModule,
    ResilienceModule,
    AuditModule,
    AuthModule,
    UsersModule,
    TenantModule,
    KnowledgeModule,
    EmployeesModule,
    OnboardingModule,
    SchedulingModule,
    SkillsModule,
    WorkflowsModule,
    EventsModule,
    ApprovalsModule,
    AnalyticsModule,
    BillingModule,
    MarketplaceModule,
    OrganizationModule,
    AdminModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
