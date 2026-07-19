import { Global, Module } from '@nestjs/common';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';

/**
 * `@Global` so AuditLogService can be injected from workflows/users/skills/
 * organization without each importing this module (same pattern as
 * ResilienceModule/PrismaModule).
 */
@Global()
@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
