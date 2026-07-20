import {
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { ChatwootClientService } from './chatwoot-client.service';
import {
  CHATWOOT_SIGNATURE_HEADER,
  CHATWOOT_TIMESTAMP_HEADER,
} from './support.constants';

interface ChatwootWebhookPayload {
  account?: { id?: number | string; name?: string };
  conversation?: { id?: number | string };
  sender?: { email?: string | null };
  message_type?: string;
  content?: string | null;
  id?: number | string;
}

/**
 * PUBLIC Chatwoot Agent-Bot webhook ingress (docs/architecture/engines/
 * chatwoot-engine.md §4/§20 — the Agent Bot / `outgoing_url` seam). Deliberately
 * NOT behind JwtAuthGuard/tenant guard: Chatwoot POSTs here with an HMAC
 * signature, not a JWT — same shape as BillingWebhookController.
 *
 * NON-NEGOTIABLE ORDERING, the entire reason this controller is written this
 * carefully: signature verification MUST complete successfully BEFORE any
 * `SupportConversation`/`SupportMessage` row is read or written, and any
 * failure returns 401 without touching those tables. The Marketing/Postiz
 * engine shipped an unauthenticated webhook write and had to fix it at final
 * review (see MarketingWebhookController's own comment) — this exists so that
 * mistake is not repeated for Support. The one read that happens pre-verification
 * is the `ChatwootAccount` lookup itself, which is required to even know which
 * secret to verify against; it is a read-only lookup keyed by the (untrusted,
 * attacker-controlled) `account.id` in the payload, not a write, and yields
 * nothing back to the caller other than a 401 either way.
 */
@Controller('engines/support/webhook')
export class SupportWebhookController {
  private readonly logger = new Logger(SupportWebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chatwootClient: ChatwootClientService,
    private readonly crypto: CryptoService,
  ) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(CHATWOOT_SIGNATURE_HEADER) signature?: string,
    @Headers(CHATWOOT_TIMESTAMP_HEADER) timestamp?: string,
  ): Promise<{ ok: boolean }> {
    if (!req.rawBody) {
      throw new UnauthorizedException('Missing request body');
    }
    const rawBody = req.rawBody.toString('utf8');

    let payload: ChatwootWebhookPayload;
    try {
      payload = JSON.parse(rawBody) as ChatwootWebhookPayload;
    } catch {
      throw new UnauthorizedException('Invalid payload');
    }

    const chatwootAccountId = idToString(payload.account?.id);
    if (!chatwootAccountId) {
      throw new UnauthorizedException('Missing account context');
    }

    // Resolve which company this claims to be from. chatwootAccountId is not
    // declared @unique in the schema (only companyId is) — see report for a
    // flagged follow-up to add that constraint — so this is a findFirst, not
    // findUnique. This is a read, not a write, and is required before we can
    // even know which secret to verify the signature against.
    const account = await this.prisma.chatwootAccount.findFirst({
      where: { chatwootAccountId },
    });
    if (!account) {
      throw new UnauthorizedException('Unknown Chatwoot account');
    }

    const webhookSecret = this.crypto.decrypt(account.webhookSecret);
    const verified = this.chatwootClient.verifyWebhookSignature(
      rawBody,
      signature,
      timestamp,
      webhookSecret,
    );
    if (!verified) {
      this.logger.warn(
        `Rejected Chatwoot webhook: signature mismatch for chatwootAccountId=${chatwootAccountId}`,
      );
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // ---- Signature verified. Only past this line may Support* tables be written. ----
    await this.applyPayload(account.companyId, account.id, payload);
    return { ok: true };
  }

  private async applyPayload(
    companyId: string,
    chatwootAccountRowId: string,
    payload: ChatwootWebhookPayload,
  ): Promise<void> {
    const chatwootConversationId = idToString(payload.conversation?.id);
    if (!chatwootConversationId) {
      // Account/inbox-level event with no conversation context — nothing to record.
      return;
    }

    const contactEmail = payload.sender?.email ?? undefined;
    const existing = await this.prisma.supportConversation.findFirst({
      where: { companyId, chatwootConversationId },
    });
    const conversation = existing
      ? await this.prisma.supportConversation.update({
          where: { id: existing.id },
          data: {
            lastMessageAt: new Date(),
            ...(contactEmail ? { contactEmail } : {}),
          },
        })
      : await this.prisma.supportConversation.create({
          data: {
            companyId,
            chatwootAccountId: chatwootAccountRowId,
            chatwootConversationId,
            contactEmail,
            lastMessageAt: new Date(),
          },
        });

    // Only an inbound customer message becomes a SupportMessage row here;
    // outbound replies are recorded where they're sent (RealSkillExecutor's
    // Chatwoot sendReply path), not re-derived from this webhook's own
    // `outgoing`/`activity`/`template` deliveries.
    if (payload.message_type === 'incoming' && payload.content) {
      await this.prisma.supportMessage.create({
        data: {
          companyId,
          conversationId: conversation.id,
          chatwootMessageId: idToString(payload.id) ?? null,
          direction: 'IN',
          content: payload.content,
        },
      });
    }
  }
}

function idToString(id: number | string | undefined | null): string | undefined {
  return id === undefined || id === null ? undefined : String(id);
}
