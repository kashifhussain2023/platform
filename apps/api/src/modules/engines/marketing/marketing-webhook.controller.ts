import { Body, Controller, Logger, Post } from '@nestjs/common';

@Controller('engines/marketing/webhook')
export class MarketingWebhookController {
  private readonly logger = new Logger(MarketingWebhookController.name);

  @Post()
  receive(@Body() body: { postId?: string; status?: string }): { ok: boolean } {
    // Postiz's own webhook payload is unsigned and has no delivery guarantee
    // (docs/architecture/engines/postiz-engine.md §13), so it must never be
    // treated as authoritative — this endpoint is publicly reachable with no
    // auth/signature check, and a DB write here would let anyone flip any
    // company's ScheduledPost status. The real source of truth is the
    // separate MarketingSyncProcessor sweep. This handler is a no-op
    // placeholder for a future signed/authenticated version.
    this.logger.debug(`marketing webhook received: ${JSON.stringify(body)}`);
    return { ok: true };
  }
}
