import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const ENVELOPE_VERSION = 'v1';
/**
 * PUBLIC, fixed seed used to derive an INSECURE key only when ENCRYPTION_KEY is
 * unset — so local dev/tests work with zero config. Never relied on in prod.
 */
const DEV_KEY_SEED = 'vaep-dev-insecure-encryption-key-seed';

/**
 * AES-256-GCM encryption for secrets at rest (skill credentials today; any other
 * secret later). Produces a self-describing, authenticated envelope string:
 *   `v1:<ivB64>:<tagB64>:<ctB64>`
 * A fresh random IV per encrypt means the same plaintext encrypts differently
 * every time; we never query by the ciphertext so that is fine.
 *
 * Key resolution (env `ENCRYPTION_KEY`):
 *   - 64 hex chars   → 32 raw bytes, or
 *   - base64 of exactly 32 bytes.
 *   - UNSET          → derive an INSECURE dev key from a fixed seed and log ONE
 *     warning. A real 32-byte key MUST be set in production.
 *   - SET but invalid → throw at boot (fail fast on misconfiguration).
 *
 * Singleton, exported by the global CryptoModule so any module can inject it.
 */
@Injectable()
export class CryptoService {
  private readonly logger = new Logger(CryptoService.name);
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    this.key = this.resolveKey(config.get<string>('ENCRYPTION_KEY'));
  }

  /** Encrypt a UTF-8 string into a versioned envelope. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      ENVELOPE_VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join(':');
  }

  /** Decrypt a `v1:…` envelope. Throws if malformed, tampered, or wrong key. */
  decrypt(envelope: string): string {
    const parts = typeof envelope === 'string' ? envelope.split(':') : [];
    if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
      throw new Error('Invalid credential envelope');
    }
    const [, ivB64, tagB64, ctB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const ct = Buffer.from(ctB64, 'base64');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    // GCM verifies the auth tag on final() — tampered input throws here.
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      'utf8',
    );
  }

  /** Encrypt any JSON-serialisable value. */
  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  /** Decrypt an envelope back into a JSON value. */
  decryptJson<T = unknown>(envelope: string): T {
    return JSON.parse(this.decrypt(envelope)) as T;
  }

  /**
   * HMAC-SHA256 signature (hex) of `data` under the service key. Used for signed,
   * STATELESS tokens (e.g. the OAuth `state` parameter) — nothing is stored; the
   * signature proves the token was minted by us and was not tampered with.
   */
  sign(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('hex');
  }

  /** Constant-time verification of a hex signature produced by {@link sign}. */
  verify(data: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(data), 'hex');
    let provided: Buffer;
    try {
      provided = Buffer.from(signature, 'hex');
    } catch {
      return false;
    }
    return (
      expected.length === provided.length &&
      timingSafeEqual(expected, provided)
    );
  }

  /** Resolve a 32-byte key from env, or derive an insecure dev key (warn once). */
  private resolveKey(raw: string | undefined): Buffer {
    const trimmed = raw?.trim();
    const isProd = process.env.NODE_ENV === 'production';
    if (!trimmed) {
      if (isProd) {
        throw new Error(
          'ENCRYPTION_KEY is not set. Refusing to start in production with an ' +
            'insecure derived key — set a real 32-byte ENCRYPTION_KEY (64 hex ' +
            'chars or base64).',
        );
      }
      this.logger.warn(
        'ENCRYPTION_KEY is not set — deriving an INSECURE development key. ' +
          'Set a 32-byte ENCRYPTION_KEY (64 hex chars or base64) in production.',
      );
      return createHash('sha256').update(DEV_KEY_SEED).digest();
    }
    // 64 hex chars → 32 bytes.
    let buf: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
      buf = Buffer.from(trimmed, 'hex');
    } else {
      // Otherwise interpret as base64 of exactly 32 bytes.
      buf = Buffer.from(trimmed, 'base64');
      if (buf.length !== KEY_BYTES) {
        throw new Error(
          'ENCRYPTION_KEY must be 64 hex chars or base64 encoding 32 bytes (AES-256).',
        );
      }
    }
    if (isProd && this.isWeakKey(buf)) {
      throw new Error(
        'ENCRYPTION_KEY looks like a placeholder, not a real random key ' +
          '(too few unique bytes or a repeating pattern). Generate a real ' +
          'one, e.g.: openssl rand -hex 32',
      );
    }
    return buf;
  }

  /**
   * Reject an obviously-fake key: a short repeating pattern (e.g. the literal
   * placeholder "0123456789abcdef" repeated 4 times) or too few unique bytes
   * to plausibly be random 32-byte material. A genuine random key has an
   * astronomically low chance of tripping either check.
   */
  private isWeakKey(buf: Buffer): boolean {
    for (let period = 1; period <= buf.length / 2; period++) {
      if (buf.length % period !== 0) {
        continue;
      }
      let repeats = true;
      for (let i = period; i < buf.length; i++) {
        if (buf[i] !== buf[i % period]) {
          repeats = false;
          break;
        }
      }
      if (repeats) {
        return true;
      }
    }
    const uniqueBytes = new Set(buf).size;
    return uniqueBytes < buf.length / 2;
  }
}
