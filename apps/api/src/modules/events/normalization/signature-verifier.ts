import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Per-provider webhook signature verification (the ingestion edge's step 1, §2.4)
 * plus extraction of the provider's delivery id used for at-least-once dedupe
 * (step 3). Each provider is ugly in its own way; a `ProviderDriver` encapsulates
 * both concerns so the edge stays provider-agnostic. New ingress drivers (Gmail
 * Pub/Sub token, Graph subscription validation, Salesforce Pub/Sub, a Stripe
 * business-event endpoint) plug in here following the SAME shape.
 *
 * Verification is over the EXACT RAW request body (never the parsed+re-stringified
 * JSON) under the connector's decrypted `credentials.webhookSecret`, compared in
 * constant time. Verify BEFORE any parsing/business logic — an invalid or missing
 * signature is rejected with 401 and never normalized.
 */

/** Request headers normalized to lowercase keys → single string value. */
export type NormalizedHeaders = Record<string, string>;

export interface ProviderDriver {
  /** True iff the request signature matches HMAC(secret, rawBody) for this provider. */
  verify(secret: string, rawBody: Buffer, headers: NormalizedHeaders): boolean;
  /** The provider delivery id for dedupe (e.g. GitHub X-GitHub-Delivery), or null. */
  externalId(headers: NormalizedHeaders): string | null;
}

/** HMAC-SHA256(secret, rawBody) as lowercase hex. */
function hmacHex(secret: string, rawBody: Buffer): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time compare of two hex strings. Returns false (never throws) for
 * empty/odd/non-hex input or a length mismatch, so a malformed header can never
 * crash the edge or leak timing.
 */
function hexEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length > 0 && ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * GitHub (App or repo webhooks): `X-Hub-Signature-256: sha256=<hex>` where <hex>
 * is HMAC-SHA256 of the raw body under the shared secret. Delivery id is the
 * `X-GitHub-Delivery` GUID.
 */
const githubDriver: ProviderDriver = {
  verify(secret, rawBody, headers) {
    const header = headers['x-hub-signature-256'] ?? '';
    const prefix = 'sha256=';
    if (!secret || !header.startsWith(prefix)) {
      return false;
    }
    return hexEqual(header.slice(prefix.length), hmacHex(secret, rawBody));
  },
  externalId(headers) {
    return headers['x-github-delivery'] || null;
  },
};

/**
 * Generic signed webhook: `X-Signature: <hex>` = HMAC-SHA256 hex of the raw body.
 * Delivery id is `X-Event-Id`. This is the fallback driver for any provider that
 * has no dedicated driver yet.
 */
const genericDriver: ProviderDriver = {
  verify(secret, rawBody, headers) {
    const header = headers['x-signature'] ?? '';
    if (!secret || !header) {
      return false;
    }
    return hexEqual(header, hmacHex(secret, rawBody));
  },
  externalId(headers) {
    return headers['x-event-id'] || null;
  },
};

const DRIVERS: Record<string, ProviderDriver> = {
  github: githubDriver,
  generic: genericDriver,
};

/** Resolve the driver for a provider, falling back to the generic HMAC driver. */
export function getProviderDriver(provider: string): ProviderDriver {
  return DRIVERS[provider] ?? genericDriver;
}
