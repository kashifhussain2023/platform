import { Injectable } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type {
  ExecutorContext,
  SkillExecutor,
  SkillExecutionResult,
} from './skill-executor';
import { assertUrlAllowed } from './ssrf';

/** Coerce a possibly-unknown credential/arg value to a trimmed string (or ''). */
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** True when a credentials object actually carries at least one value. */
function hasCreds(creds: Record<string, unknown> | null | undefined): boolean {
  return Boolean(creds && Object.keys(creds).length > 0);
}

/**
 * fetch() with an abort timeout so a hung backend can't stall the runtime. The
 * init type is derived from the global fetch (no reliance on a DOM `RequestInit`
 * name — tsconfig lib is ES2022 with @types/node globals).
 */
async function fetchWithTimeout(
  url: string,
  init: Parameters<typeof fetch>[1],
  timeoutMs = 10_000,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * REAL skill executor (`SKILL_EXECUTOR=real`, or chosen per-call by the `auto`
 * dispatcher). Dispatches by skillKey using the tenant's DECRYPTED credentials +
 * config that SkillsService resolves into `ctx` (never logged). Implements real
 * network calls for slack/http/gmail; anything else — or a call with no
 * credentials — DELEGATES to the injected `fallback` (the mock executor) so a
 * missing connection degrades gracefully instead of 500-ing.
 *
 * Returns the SAME `{ ok, result?, error? }` shape as MockSkillExecutor and never
 * throws (tool-level failures come back as `{ ok:false, error }`).
 *
 * TODO: real executors for stripe/github/hubspot/jira/calendar/gdrive; OAuth
 * access-token refresh when `expiresAt` has passed (currently the stored token
 * is used as-is and a 401 surfaces as a tool error).
 */
@Injectable()
export class RealSkillExecutor implements SkillExecutor {
  readonly name = 'real';
  readonly usesInstalledCredentials = true;

  constructor(
    private readonly config: ConfigService,
    /** Offline fallback (the mock executor) for unimplemented/unconnected calls. */
    private readonly fallback: SkillExecutor,
  ) {}

  async execute(
    skillKey: string,
    tool: string,
    args: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<SkillExecutionResult> {
    try {
      switch (`${skillKey}.${tool}`) {
        case 'slack.send_message':
          return await this.slackSendMessage(args, ctx);
        case 'http.request':
          return await this.httpRequest(args);
        case 'gmail.send_email':
          return await this.gmailSendEmail(args, ctx);
        default:
          // No real implementation for this tool → mock (never 500).
          return this.fallback.execute(skillKey, tool, args, ctx);
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Tool execution failed',
      };
    }
  }

  // --- slack.send_message ---------------------------------------------------
  // Supports EITHER an incoming-webhook URL OR a bot token (chat.postMessage).
  private async slackSendMessage(
    args: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<SkillExecutionResult> {
    const creds = ctx.credentials ?? {};
    const config = ctx.config ?? {};
    if (!hasCreds(creds)) {
      return this.fallback.execute('slack', 'send_message', args, ctx);
    }
    const text = str(args.text);
    const channel = str(args.channel) || str(config.defaultChannel);
    const webhookUrl =
      str(creds.webhookUrl) || str(creds.incomingWebhookUrl) || str(creds.url);
    const botToken =
      str(creds.botToken) || str(creds.token) || str(creds.accessToken);

    if (webhookUrl) {
      const res = await fetchWithTimeout(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(channel ? { text, channel } : { text }),
      });
      const body = await res.text();
      if (!res.ok) {
        return { ok: false, error: `Slack webhook failed (${res.status}): ${body}` };
      }
      return { ok: true, result: { delivered: true, via: 'webhook', channel } };
    }

    if (botToken) {
      if (!channel) {
        return { ok: false, error: 'Slack chat.postMessage requires a channel' };
      }
      const res = await fetchWithTimeout('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${botToken}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({ channel, text }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; ts?: string; channel?: string };
      if (!data.ok) {
        return { ok: false, error: `Slack API error: ${data.error ?? 'unknown'}` };
      }
      return { ok: true, result: { delivered: true, via: 'chat.postMessage', ts: data.ts, channel: data.channel } };
    }

    return {
      ok: false,
      error: 'Slack not connected: expected a webhookUrl or botToken credential',
    };
  }

  // --- http.request (SSRF-guarded real fetch) -------------------------------
  private async httpRequest(
    args: Record<string, unknown>,
  ): Promise<SkillExecutionResult> {
    const allowPrivate =
      (this.config.get<string>('HTTP_SKILL_ALLOW_PRIVATE') ?? '').toLowerCase() ===
      'true';
    const method = (str(args.method) || 'GET').toUpperCase();
    const rawUrl = str(args.url);
    if (!rawUrl) {
      return { ok: false, error: 'http.request requires a url' };
    }
    // Throws (→ caught by execute) for blocked schemes/hosts/private addresses.
    const url = await assertUrlAllowed(rawUrl, allowPrivate);

    const hasBody = args.body !== undefined && method !== 'GET' && method !== 'HEAD';
    const res = await fetchWithTimeout(url.toString(), {
      method,
      // Do NOT auto-follow redirects — a 3xx could point at an internal host.
      redirect: 'manual',
      headers: hasBody ? { 'content-type': 'application/json' } : undefined,
      body: hasBody ? String(args.body) : undefined,
    });
    const raw = await res.text();
    const body = raw.length > 10_000 ? `${raw.slice(0, 10_000)}…[truncated]` : raw;
    return {
      ok: true,
      result: {
        status: res.status,
        ok: res.ok,
        headers: { 'content-type': res.headers.get('content-type') },
        body,
      },
    };
  }

  // --- gmail.send_email (Gmail API users.messages.send, OAuth) --------------
  private async gmailSendEmail(
    args: Record<string, unknown>,
    ctx: ExecutorContext,
  ): Promise<SkillExecutionResult> {
    const creds = ctx.credentials ?? {};
    if (!hasCreds(creds)) {
      return this.fallback.execute('gmail', 'send_email', args, ctx);
    }
    const accessToken = str(creds.accessToken) || str(creds.access_token);
    if (!accessToken) {
      return {
        ok: false,
        error: 'Gmail not connected: no OAuth accessToken in credentials',
      };
    }
    const to = str(args.to);
    const subject = str(args.subject);
    const bodyText = typeof args.body === 'string' ? args.body : '';
    const mime = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      bodyText,
    ].join('\r\n');
    const raw = Buffer.from(mime, 'utf8').toString('base64url');

    const res = await fetchWithTimeout(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ raw }),
      },
    );
    const data = (await res.json()) as {
      id?: string;
      threadId?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      return {
        ok: false,
        error: `Gmail API error (${res.status}): ${data.error?.message ?? 'send failed'}`,
      };
    }
    return { ok: true, result: { id: data.id, threadId: data.threadId, to } };
  }
}
