import {
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service';

/**
 * PUBLIC Stripe webhook ingress. Deliberately NOT behind JwtAuthGuard — Stripe
 * POSTs here with a signature header, not a JWT. Verification uses the RAW
 * request body (enabled via `rawBody: true` in main.ts), so this route reads
 * `req.rawBody` rather than the parsed JSON. An unverifiable/unsupported request
 * yields 400 (thrown by BillingService/the provider). Lives on the `billing`
 * path but is a separate, unguarded controller (mirrors the workflow webhook).
 */
@Controller('billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('webhook')
  @HttpCode(200)
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
