import type { Prisma } from '@prisma/client';
import type { CryptoService } from '../../../common/crypto/crypto.service';

/**
 * Shared credential envelope helpers for the connector layer (SkillsService,
 * ConnectorHealthService, ConnectorTokenService). Secrets are stored on
 * `InstalledSkill.credentials` as an encrypted `{ enc: <v1:iv:tag:ct> }` envelope
 * and NEVER returned raw. Centralised here (single source of truth) so the health
 * probe + token refresh can read/re-seal creds without depending on SkillsService
 * (which would close a DI cycle).
 */

/**
 * Decrypt/unwrap stored credentials into the raw secrets object. Handles the
 * `{ enc: <envelope> }` shape, an empty/null column (→ `{}`), and legacy
 * plaintext objects written before encryption (→ used as-is).
 */
export function readCredentials(
  crypto: CryptoService,
  stored: Prisma.JsonValue | null,
): Record<string, unknown> {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return {};
  }
  const obj = stored as Record<string, unknown>;
  if (typeof obj.enc === 'string') {
    return crypto.decryptJson<Record<string, unknown>>(obj.enc);
  }
  // Back-compat: pre-encryption plaintext credentials — treat as raw secrets.
  return obj;
}

/**
 * Encrypt a raw secrets object into the `{ enc: <envelope> }` shape. Returns `{}`
 * for an empty object so `credentialsSet` stays false (no ciphertext for "no
 * secrets").
 */
export function sealCredentials(
  crypto: CryptoService,
  raw: Record<string, unknown>,
): Prisma.InputJsonObject {
  if (Object.keys(raw).length === 0) {
    return {};
  }
  return { enc: crypto.encryptJson(raw) };
}

/**
 * First non-empty trimmed string value among `keys` in `creds` (or ''). Used to
 * read token fields that providers spell differently (accessToken/access_token).
 */
export function credString(
  creds: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const value = creds[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}
