import { Injectable, Logger } from '@nestjs/common';
import { Prisma, type CanonicalEvent, type InstalledSkill } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ConnectorTokenService } from '../../skills/connectors/connector-token.service';
import { WorkflowsService } from '../../workflows/workflows.service';
import { GMAIL_HISTORY_MAX_PAGES, GMAIL_INBOUND_BATCH } from '../events.constants';
import { mapRawEvent } from '../normalization/event-mapper';

/** Prisma Json helper: JS null → the DB JSON-null sentinel. */
function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  return value == null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

/** Outcome of a single connector poll (surfaced by the manual poll endpoint). */
export interface PollResult {
  /** True when this poll only established the baseline cursor (fired nothing). */
  baseline: boolean;
  /** New inbound messages detected + normalized to canonical events this poll. */
  newMessages: number;
  /** WorkflowRuns fired by those new NEW_EMAIL canonical events. */
  firedRuns: number;
  /** True when nothing was done (not a gmail connector / no token / API error). */
  noop?: boolean;
  /** True when a stale cursor forced a re-baseline (Gmail 404 on history). */
  rebaselined?: boolean;
}

/** Flattened inbound message metadata a RawEvent payload carries. */
interface InboundMessage {
  messageId: string;
  from: string | null;
  subject: string | null;
  snippet: string | null;
  date: string | null;
}

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

/**
 * GmailInboundService — the INBOUND polling driver (the real-time-ish counterpart
 * to the webhook edge). It turns "a new email arrived in the connected Gmail
 * inbox" into a `NEW_EMAIL` CanonicalEvent that drives ACTIVE EVENT workflows
 * (RecruitAI), using the Gmail REST API via global `fetch` + the connector's
 * OAuth access token (auto-refreshed by ConnectorTokenService).
 *
 * poll(connector):
 *   - BASELINE (inboundCursor null): read the mailbox's current `historyId`
 *     (GET /profile), store it, and fire NOTHING — so connecting an inbox does
 *     not flood the pipeline with the whole existing history. Returns baseline.
 *   - DELTA (cursor set): GET /history?startHistoryId=<cursor>&historyTypes=
 *     messageAdded, collect NEW inbound message ids (skip sent-only), fetch each
 *     message's metadata, and run it through the SAME normalization it would get
 *     from a webhook: persist a RawEvent → map (gmail mapper → NEW_EMAIL) →
 *     idempotently upsert a CanonicalEvent → fireEvent. Advance the cursor to the
 *     newest historyId at the end.
 *
 * Idempotent end-to-end: RawEvent is unique on (connectorId, externalId=messageId)
 * and CanonicalEvent on (companyId, dedupeKey=`gmail:msg:<id>`), and a run fires
 * ONLY for a freshly-created canonical event — so a re-poll never double-fires.
 * Robust: any token/refresh/API error is logged and becomes a no-op; poll never
 * throws, so it can never crash the scheduler (or an offline test).
 */
@Injectable()
export class GmailInboundService {
  private readonly logger = new Logger(GmailInboundService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: ConnectorTokenService,
    private readonly workflows: WorkflowsService,
  ) {}

  // --- Public API ----------------------------------------------------------

  /** Poll ONE gmail connector. Never throws (errors → logged no-op). */
  async poll(connector: InstalledSkill): Promise<PollResult> {
    if (connector.skillKey !== 'gmail') {
      return { baseline: false, newMessages: 0, firedRuns: 0, noop: true };
    }
    try {
      const token = await this.tokens.getAccessToken(connector.id);
      if (!token) {
        this.logger.warn(
          `Gmail poll skipped for ${connector.id}: no access token`,
        );
        return { baseline: false, newMessages: 0, firedRuns: 0, noop: true };
      }

      if (!connector.inboundCursor) {
        return this.baseline(connector, token);
      }
      return this.delta(connector, token, connector.inboundCursor);
    } catch (err) {
      this.logger.error(
        `Gmail poll failed for connector ${connector.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { baseline: false, newMessages: 0, firedRuns: 0, noop: true };
    }
  }

  /**
   * Scheduled sweep: poll every CONNECTED, enabled gmail connector across tenants.
   * Per-connector failures are isolated (poll never throws). Safe when there are
   * no connected gmail connectors (offline tests) — it simply finds none.
   */
  async sweep(): Promise<{ polled: number; newMessages: number; firedRuns: number }> {
    const connectors = await this.prisma.installedSkill.findMany({
      where: { skillKey: 'gmail', connectionStatus: 'CONNECTED', enabled: true },
      take: GMAIL_INBOUND_BATCH,
    });
    let newMessages = 0;
    let firedRuns = 0;
    for (const connector of connectors) {
      const res = await this.poll(connector);
      newMessages += res.newMessages;
      firedRuns += res.firedRuns;
    }
    return { polled: connectors.length, newMessages, firedRuns };
  }

  // --- Baseline / delta ----------------------------------------------------

  /** Store the mailbox's current historyId as the watermark; fire nothing. */
  private async baseline(
    connector: InstalledSkill,
    token: string,
  ): Promise<PollResult> {
    const profile = await this.gapi<{ historyId?: string }>(token, '/profile');
    const historyId = profile?.historyId;
    if (!historyId) {
      this.logger.warn(`Gmail baseline for ${connector.id}: no historyId in profile`);
      return { baseline: false, newMessages: 0, firedRuns: 0, noop: true };
    }
    await this.prisma.installedSkill.update({
      where: { id: connector.id },
      data: { inboundCursor: historyId },
    });
    this.logger.log(
      `Gmail inbound baselined connector ${connector.id} at historyId ${historyId}`,
    );
    return { baseline: true, newMessages: 0, firedRuns: 0 };
  }

  /** Walk the Gmail history feed since the cursor and ingest new inbound mail. */
  private async delta(
    connector: InstalledSkill,
    token: string,
    cursor: string,
  ): Promise<PollResult> {
    const collected = await this.collectAddedMessageIds(token, cursor);
    if (collected.stale) {
      // Cursor too old (Gmail 404): re-baseline to the current historyId so the
      // next poll works from a fresh watermark. We fire nothing for the gap.
      const rebaselined = await this.baseline(connector, token);
      return { ...rebaselined, baseline: false, rebaselined: true };
    }

    let newMessages = 0;
    let firedRuns = 0;
    for (const messageId of collected.messageIds) {
      const message = await this.fetchMessage(token, messageId);
      if (!message) {
        continue;
      }
      const res = await this.ingestInbound(connector, message);
      if (res.created) {
        newMessages += 1;
        firedRuns += res.firedRuns;
      }
    }

    // Advance the watermark to the newest historyId the feed reported (only
    // forward; never below the current cursor).
    if (collected.newestHistoryId && collected.newestHistoryId !== cursor) {
      await this.prisma.installedSkill.update({
        where: { id: connector.id },
        data: { inboundCursor: collected.newestHistoryId },
      });
    }
    return { baseline: false, newMessages, firedRuns };
  }

  // --- Normalization (reuses the shared mapper + canonical pipeline) --------

  /**
   * Persist a RawEvent + idempotently upsert a CanonicalEvent (via the shared
   * gmail mapper) + fireEvent — the same steps the async normalize worker runs,
   * done inline so the poll can return an accurate firedRuns count. Idempotent on
   * both unique keys; fires ONLY when a canonical event was freshly created.
   */
  private async ingestInbound(
    connector: InstalledSkill,
    message: InboundMessage,
  ): Promise<{ created: boolean; firedRuns: number }> {
    const raw = await this.upsertRawEvent(connector, message);

    const mapping = mapRawEvent({
      provider: 'gmail',
      externalId: message.messageId,
      headers: null,
      payload: message as unknown as Record<string, unknown>,
    });

    let canonical: CanonicalEvent | null =
      await this.prisma.canonicalEvent.findUnique({
        where: {
          companyId_dedupeKey: {
            companyId: connector.companyId,
            dedupeKey: mapping.dedupeKey,
          },
        },
      });
    let created = false;
    if (!canonical) {
      try {
        canonical = await this.prisma.canonicalEvent.create({
          data: {
            companyId: connector.companyId,
            connectorId: connector.id,
            rawEventId: raw?.id ?? null,
            provider: 'gmail',
            type: mapping.type,
            dedupeKey: mapping.dedupeKey,
            occurredAt: mapping.occurredAt,
            subject: toJson(mapping.subject),
            data: toJson(mapping.data),
          },
        });
        created = true;
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          canonical = await this.prisma.canonicalEvent.findUnique({
            where: {
              companyId_dedupeKey: {
                companyId: connector.companyId,
                dedupeKey: mapping.dedupeKey,
              },
            },
          });
        } else {
          throw err;
        }
      }
    }

    if (raw && raw.status === 'RECEIVED') {
      await this.prisma.rawEvent.update({
        where: { id: raw.id },
        data: { status: 'NORMALIZED', error: null },
      });
    }

    let firedRuns = 0;
    if (created && canonical) {
      try {
        const result = await this.workflows.fireEvent(
          connector.companyId,
          canonical.type,
          {
            eventId: canonical.id,
            subject: canonical.subject ?? null,
            data: canonical.data ?? null,
          },
        );
        firedRuns = result.count;
      } catch (err) {
        // A downstream workflow error must not fail the poll (mirrors the worker).
        this.logger.error(
          `fireEvent failed for canonical ${canonical.id} (NEW_EMAIL): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return { created, firedRuns };
  }

  /** Append-only RawEvent for this message, idempotent on (connectorId, messageId). */
  private async upsertRawEvent(
    connector: InstalledSkill,
    message: InboundMessage,
  ) {
    const where = {
      connectorId_externalId: {
        connectorId: connector.id,
        externalId: message.messageId,
      },
    };
    const existing = await this.prisma.rawEvent.findUnique({ where });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.rawEvent.create({
        data: {
          companyId: connector.companyId,
          connectorId: connector.id,
          provider: 'gmail',
          externalId: message.messageId,
          // It came from our authenticated poll — treat as verified.
          signatureVerified: true,
          headers: {},
          payload: message as unknown as Prisma.InputJsonObject,
          status: 'RECEIVED',
        },
      });
    } catch (err) {
      // Lost a create race with a concurrent poll → reuse the winner.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return this.prisma.rawEvent.findUnique({ where });
      }
      throw err;
    }
  }

  // --- Gmail REST helpers --------------------------------------------------

  /**
   * Collect NEW inbound message ids from the history feed since `cursor`,
   * following pagination up to a page bound. Returns the newest historyId to
   * advance the cursor to. `stale=true` signals a 404 (cursor expired) so the
   * caller re-baselines. Sent-only messages (SENT without INBOX) are skipped.
   */
  private async collectAddedMessageIds(
    token: string,
    cursor: string,
  ): Promise<{ messageIds: string[]; newestHistoryId: string | null; stale: boolean }> {
    const seen = new Set<string>();
    const ordered: string[] = [];
    let newestHistoryId: string | null = cursor;
    let pageToken: string | undefined;

    for (let page = 0; page < GMAIL_HISTORY_MAX_PAGES; page += 1) {
      const params = new URLSearchParams({
        startHistoryId: cursor,
        historyTypes: 'messageAdded',
      });
      if (pageToken) {
        params.set('pageToken', pageToken);
      }
      const res = await this.gapiRaw(token, `/history?${params.toString()}`);
      if (res.status === 404) {
        return { messageIds: [], newestHistoryId: null, stale: true };
      }
      const body = res.body as {
        history?: Array<{
          messagesAdded?: Array<{
            message?: { id?: string; labelIds?: string[] };
          }>;
        }>;
        historyId?: string;
        nextPageToken?: string;
      } | null;
      if (!body) {
        break;
      }
      if (typeof body.historyId === 'string') {
        newestHistoryId = body.historyId;
      }
      for (const record of body.history ?? []) {
        for (const added of record.messagesAdded ?? []) {
          const msg = added.message;
          const id = msg?.id;
          if (!id || seen.has(id)) {
            continue;
          }
          const labels = msg?.labelIds ?? [];
          // Only inbound: skip sent-only messages (a self-email carries BOTH
          // SENT and INBOX and is kept, since it was delivered to the inbox).
          if (labels.includes('SENT') && !labels.includes('INBOX')) {
            continue;
          }
          seen.add(id);
          ordered.push(id);
        }
      }
      pageToken = body.nextPageToken;
      if (!pageToken) {
        break;
      }
    }
    return { messageIds: ordered, newestHistoryId, stale: false };
  }

  /** Fetch one message's metadata (From/Subject/Date headers + snippet). */
  private async fetchMessage(
    token: string,
    messageId: string,
  ): Promise<InboundMessage | null> {
    const params = new URLSearchParams({ format: 'metadata' });
    params.append('metadataHeaders', 'From');
    params.append('metadataHeaders', 'Subject');
    params.append('metadataHeaders', 'Date');
    const msg = await this.gapi<{
      snippet?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    }>(token, `/messages/${messageId}?${params.toString()}`);
    if (!msg) {
      return null;
    }
    const headers = msg.payload?.headers ?? [];
    const header = (name: string): string | null => {
      const found = headers.find(
        (h) => (h.name ?? '').toLowerCase() === name.toLowerCase(),
      );
      return typeof found?.value === 'string' ? found.value : null;
    };
    return {
      messageId,
      from: header('From'),
      subject: header('Subject'),
      snippet: typeof msg.snippet === 'string' ? msg.snippet : null,
      date: header('Date'),
    };
  }

  /** GET a Gmail API path with the bearer token; parsed JSON or null on error. */
  private async gapi<T>(token: string, path: string): Promise<T | null> {
    const res = await this.gapiRaw(token, path);
    if (res.status < 200 || res.status >= 300) {
      this.logger.warn(`Gmail API ${path} → HTTP ${res.status}`);
      return null;
    }
    return res.body as T | null;
  }

  /** Low-level GET with a bounded timeout; returns { status, body } (never throws to caller of poll). */
  private async gapiRaw(
    token: string,
    path: string,
  ): Promise<{ status: number; body: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${GMAIL_BASE}${path}`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: controller.signal,
      });
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      return { status: res.status, body };
    } finally {
      clearTimeout(timer);
    }
  }
}
