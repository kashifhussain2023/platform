import { Module } from '@nestjs/common';
import { SchedulingController } from './scheduling.controller';
import { SchedulingService } from './scheduling.service';

/**
 * Interview slot management (bulk-hiring). Exports SchedulingService so the
 * skills module's real executor can call `claimNext` for the `scheduling`
 * skill's `claim_slot` tool.
 */
@Module({
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
