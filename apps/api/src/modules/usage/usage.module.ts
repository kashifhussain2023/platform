import { Global, Module } from '@nestjs/common';
import { UsageService } from './usage.service';

/**
 * `@Global` so UsageService can be injected from employees/workflows/billing
 * without each importing this module (same pattern as AuditModule).
 */
@Global()
@Module({
  providers: [UsageService],
  exports: [UsageService],
})
export class UsageModule {}
