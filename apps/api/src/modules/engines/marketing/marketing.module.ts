import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { PostizClientService } from './postiz-client.service';
import { MarketingSyncProcessor } from './marketing-sync.processor';
import { MarketingWebhookController } from './marketing-webhook.controller';
import { MARKETING_SYNC_QUEUE } from './marketing.constants';

/**
 * Marketing engine module: the Postiz REST client, the unsigned-webhook
 * receiver, and the reconciliation sync processor (BullMQ repeatable, docs
 * §13). Exports PostizClientService so SkillsModule's RealSkillExecutor can
 * use the same single instance rather than standing up its own.
 */
@Module({
  imports: [BullModule.registerQueue({ name: MARKETING_SYNC_QUEUE })],
  controllers: [MarketingWebhookController],
  providers: [PostizClientService, MarketingSyncProcessor],
  exports: [PostizClientService],
})
export class MarketingModule {}
