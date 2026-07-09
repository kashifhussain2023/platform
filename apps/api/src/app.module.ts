import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [AppConfigModule, PrismaModule, AuthModule, TenantModule],
})
export class AppModule {}
