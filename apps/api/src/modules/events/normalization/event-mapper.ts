import { createHash } from 'node:crypto';
import { CANONICAL_EVENT_TYPES, type CanonicalEventType } from '@vaep/types';

/**
 * Provider MAPPERS: pure functions (raw → canonical) that translate a provider's
 * native payload into the one internal canonical envelope (§3). Being pure they
 * are trivially unit-testable and side-effect free; the normalization worker owns
 * all persistence + workflow firing. A provider we do not recognise, or an event
 * shape we do not map, yields type `UNKNOWN` (never throws).
 */

/** The subset of a RawEvent a mapper reads (no DB access — pure input). */
export interface RawEventInput {
  provider: string;
  externalId: string | null;
  headers: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
}

/** A mapper's output: the canonical fields (the envelope minus ids/provenance). */
export interface CanonicalMapping {
  type: CanonicalEventType;
  dedupeKey: string;
  occurredAt: Date | null;
  subject: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
}

const CANONICAL_SET = new Set<string>(CANONICAL_EVENT_TYPES);

/** Read a nested object field safely (returns undefined for non-objects). */
function obj(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Read a string field (or undefined). */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Parse a provider timestamp into a Date, or null if absent/unparseable. */
function parseDate(value: unknown): Date | null {
  const s = str(value);
  if (!s) {
    return null;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Stable sha256 (hex, truncated) of a JSON value — a dedupe key of last resort. */
function hashPayload(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(payload ?? {}))
    .digest('hex')
    .slice(0, 32);
}

/**
 * GitHub mapper. The native event type is the `X-GitHub-Event` header (e.g.
 * `pull_request`, `issues`) and the sub-action is `payload.action`. We map:
 *   pull_request.opened → NEW_GITHUB_PR
 *   issues.opened       → NEW_GITHUB_ISSUE
 * Everything else → UNKNOWN. dedupeKey = `github:<delivery|node_id>`.
 */
function mapGithub(raw: RawEventInput): CanonicalMapping {
  const headers = raw.headers ?? {};
  const payload = raw.payload ?? {};
  const ghEvent = str(headers['x-github-event']) ?? '';
  const action = str(payload['action']) ?? '';
  const pr = obj(payload['pull_request']);
  const issue = obj(payload['issue']);
  const repo = obj(payload['repository']);
  const repoName = str(repo?.['full_name']) ?? null;

  let type: CanonicalEventType = 'UNKNOWN';
  let subject: Record<string, unknown> | null = null;
  let data: Record<string, unknown> | null = null;
  let occurredAt: Date | null = null;
  let nodeId: string | undefined;

  if (ghEvent === 'pull_request' && action === 'opened' && pr) {
    type = 'NEW_GITHUB_PR';
    nodeId = str(pr['node_id']);
    occurredAt = parseDate(pr['created_at']);
    subject = { type: 'pull_request', repo: repoName, number: pr['number'] ?? null };
    data = {
      number: pr['number'] ?? null,
      title: pr['title'] ?? null,
      url: pr['html_url'] ?? null,
      author: obj(pr['user'])?.['login'] ?? null,
      repo: repoName,
    };
  } else if (ghEvent === 'issues' && action === 'opened' && issue) {
    type = 'NEW_GITHUB_ISSUE';
    nodeId = str(issue['node_id']);
    occurredAt = parseDate(issue['created_at']);
    subject = { type: 'issue', repo: repoName, number: issue['number'] ?? null };
    data = {
      number: issue['number'] ?? null,
      title: issue['title'] ?? null,
      url: issue['html_url'] ?? null,
      author: obj(issue['user'])?.['login'] ?? null,
      repo: repoName,
    };
  }

  const idPart = raw.externalId ?? nodeId ?? hashPayload(payload);
  return { type, dedupeKey: `github:${idPart}`, occurredAt, subject, data };
}

/**
 * Generic mapper for any provider without a dedicated one. Passes through
 * `payload.type` when it names a known CanonicalEventType, else UNKNOWN. Carries
 * `payload.subject` / `payload.data` verbatim when present. dedupeKey =
 * `generic:<externalId>` (or a payload hash when no delivery id was supplied).
 */
function mapGeneric(raw: RawEventInput): CanonicalMapping {
  const payload = raw.payload ?? {};
  const declared = str(payload['type']);
  const type: CanonicalEventType =
    declared && CANONICAL_SET.has(declared)
      ? (declared as CanonicalEventType)
      : 'UNKNOWN';
  const idPart = raw.externalId ?? hashPayload(payload);
  return {
    type,
    dedupeKey: `generic:${idPart}`,
    occurredAt: parseDate(payload['occurredAt']) ?? parseDate(payload['occurred_at']),
    subject: obj(payload['subject']) ?? null,
    data: obj(payload['data']) ?? null,
  };
}

/**
 * Gmail mapper. Fed by the INBOUND polling driver (GmailInboundService), whose
 * RawEvent payload already carries the flattened message metadata
 * `{ messageId, from, subject, snippet, date }` (pulled via the Gmail REST API).
 * Every inbound message maps to a `NEW_EMAIL` canonical event; the subject frames
 * the sender as a candidate so the RecruitAI EVENT workflow can screen it.
 * dedupeKey = `gmail:msg:<messageId>` (idempotent per Gmail message id).
 */
function mapGmail(raw: RawEventInput): CanonicalMapping {
  const payload = raw.payload ?? {};
  const messageId =
    str(payload['messageId']) ?? raw.externalId ?? hashPayload(payload);
  const from = str(payload['from']) ?? null;
  const subject = str(payload['subject']) ?? null;
  const snippet = str(payload['snippet']) ?? null;
  // Full-body + attachment text supplied by the INBOUND driver's format=full
  // fetch (null/absent for a metadata-only or webhook-sourced payload).
  const body = str(payload['body']) ?? null;
  const cv = str(payload['cv']) ?? null;
  const attachments = Array.isArray(payload['attachments'])
    ? (payload['attachments'] as unknown[])
    : [];
  // Passed through for audit visibility (`/events/canonical`) — the actual
  // reply-skip / spam-filter decisions happen in GmailInboundService, which
  // computes these; the mapper just carries them onto the canonical record.
  const isReply = payload['isReply'] === true;
  const looksLikeApplication = payload['looksLikeApplication'] === true;
  return {
    type: 'NEW_EMAIL',
    dedupeKey: `gmail:msg:${messageId}`,
    occurredAt: parseDate(payload['date']),
    subject: { type: 'candidate', email: from },
    // `body` (full text) + `cv` (attachment text) drive the RecruitAI screen;
    // `attachments` carries metadata only (filename + chars) to stay bounded.
    data: {
      from,
      subject,
      snippet,
      body,
      cv,
      attachments,
      messageId,
      isReply,
      looksLikeApplication,
    },
  };
}

/** Dispatch to the provider's mapper (generic fallback). Pure + total. */
export function mapRawEvent(raw: RawEventInput): CanonicalMapping {
  switch (raw.provider) {
    case 'github':
      return mapGithub(raw);
    case 'gmail':
      return mapGmail(raw);
    default:
      return mapGeneric(raw);
  }
}
