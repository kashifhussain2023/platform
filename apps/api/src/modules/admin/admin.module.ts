import { Module } from '@nestjs/common';
import { DlqController } from './dlq.controller';

/**
 * Admin module (Unit C): the OWNER/ADMIN resilience surface — DLQ list/replay/
 * discard + connector circuit-breaker states. The services it uses (DlqService,
 * CircuitBreakerRegistry) come from the global ResilienceModule; PrismaService
 * from the global PrismaModule. No providers of its own — just the controller.
 */
@Module({
  controllers: [DlqController],
})
export class AdminModule {}
