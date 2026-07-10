import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { SkillsModule } from './modules/skills/skills.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { BillingModule } from './modules/billing/billing.module';
import { MarketplaceModule } from './modules/marketplace/marketplace.module';
import { OrganizationModule } from './modules/organization/organization.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    CryptoModule,
    AuthModule,
    UsersModule,
    TenantModule,
    KnowledgeModule,
    EmployeesModule,
    OnboardingModule,
    SkillsModule,
    WorkflowsModule,
    ApprovalsModule,
    AnalyticsModule,
    BillingModule,
    MarketplaceModule,
    OrganizationModule,
  ],
})
export class AppModule {}
