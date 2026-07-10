import { Module } from '@nestjs/common';
import { DepartmentsController } from './departments.controller';
import { OrganizationService } from './organization.service';
import { SecurityPolicyController } from './security-policy.controller';
import { TeamsController } from './teams.controller';

/**
 * Organization module (Security Policies / Teams / Departments, P1 #7). Purely
 * tenant-scoped CRUD over new Prisma models; PrismaService is global. The
 * JwtAuthGuard/RolesGuard work because the JWT passport strategy is registered
 * globally by AuthModule. Exported so other modules could reuse the policy
 * later; enforcement of passwordMinLength/allowedEmailDomains currently lives in
 * UsersService (reads SecurityPolicy directly — no cross-module import needed).
 */
@Module({
  controllers: [
    DepartmentsController,
    TeamsController,
    SecurityPolicyController,
  ],
  providers: [OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
