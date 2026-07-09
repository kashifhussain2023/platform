import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

@Module({
  controllers: [TenantController, CompaniesController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
