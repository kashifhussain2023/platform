import {
  Controller,
  Param,
  Post,
  Req,
  Res,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { WebhookAcceptedDto } from '@vaep/types';
import { EventsService } from './events.service';

/**
 * PUBLIC connector webhook ingress — the "dumb, fast" ingestion edge (§2.4).
 * Deliberately NOT behind JwtAuthGuard: providers POST here with a per-connector
 * HMAC signature, not a JWT. Verification uses the RAW request body (buffered via
 * `rawBody: true` in main.ts), so this reads `req.rawBody`. Mirrors the Stripe
 * billing webhook controller (which stays untouched, for subscription sync).
 *
 * A freshly-accepted event returns 202 (queued for async normalization); a
 * re-delivery of an already-seen event returns 200 (idempotent no-op). A missing
 * connector → 404 and a missing/invalid signature → 401 (thrown by the service).
 */
@Controller('connectors')
export class ConnectorWebhookController {
  constructor(private readonly events: EventsService) {}

  @Post(':connectorId/webhook')
  async webhook(
    @Param('connectorId') connectorId: string,
    @Req() req: RawBodyRequest<Request>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebhookAcceptedDto> {
    const result = await this.events.ingestWebhook(
      connectorId,
      req.rawBody,
      req.body,
      req.headers,
    );
    // Dynamic status (202 accepted vs 200 duplicate); passthrough keeps Nest's
    // exception handling for the 404/401 the service throws.
    res.status(result.deduped ? 200 : 202);
    return {
      received: true,
      deduped: result.deduped,
      rawEventId: result.rawEventId,
    };
  }
}
