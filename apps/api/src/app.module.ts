import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { EmployeesModule } from './modules/employees/employees.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    AuthModule,
    TenantModule,
    KnowledgeModule,
    EmployeesModule,
  ],
})
export class AppModule {}
