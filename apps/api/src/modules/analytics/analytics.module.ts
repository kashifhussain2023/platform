import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics / KPI dashboard module. Read-only aggregation over existing data
 * (SkillExecution, Message/Conversation, WorkflowRun, ApprovalRequest,
 * AiEmployee) — no new Prisma models, no writes. PrismaService is global.
 */
@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
