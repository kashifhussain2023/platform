import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../src/common/crypto/crypto.service';

// Pure unit-style spec (no Postgres/Redis) so it ALWAYS runs — verifies the
// AES-256-GCM envelope behaviour the credentials-at-rest feature depends on.
const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function makeService(encryptionKey?: string): CryptoService {
  const config = {
    get: (k: string) => (k === 'ENCRYPTION_KEY' ? encryptionKey : undefined),
  } as unknown as ConfigService;
  return new CryptoService(config);
}

describe('CryptoService (AES-256-GCM at rest)', () => {
  const crypto = makeService(KEY);

  it('round-trips encrypt → decrypt', () => {
    const secret = 'sk_test_super_secret_value';
    expect(crypto.decrypt(crypto.encrypt(secret))).toBe(secret);
  });

  it('produces a versioned envelope whose ciphertext differs from plaintext', () => {
    const secret = 'sk_live_abc123';
    const env = crypto.encrypt(secret);
    expect(env.startsWith('v1:')).toBe(true);
    expect(env.split(':')).toHaveLength(4);
    expect(env).not.toContain(secret);
  });

  it('uses a random IV — two encrypts of the same input differ', () => {
    const a = crypto.encrypt('same-input');
    const b = crypto.encrypt('same-input');
    expect(a).not.toBe(b);
    expect(crypto.decrypt(a)).toBe('same-input');
    expect(crypto.decrypt(b)).toBe('same-input');
  });

  it('round-trips JSON objects via encryptJson/decryptJson', () => {
    const obj = { apiKey: 'sk_test_x', region: 'us', nested: { n: 1 } };
    const env = crypto.encryptJson(obj);
    expect(env).not.toContain('sk_test_x');
    expect(crypto.decryptJson(env)).toEqual(obj);
  });

  it('fails to decrypt a tampered envelope (auth tag mismatch)', () => {
    const env = crypto.encrypt('tamper-me');
    const parts = env.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff; // flip a byte of the ciphertext
    parts[3] = ct.toString('base64');
    expect(() => crypto.decrypt(parts.join(':'))).toThrow();
  });

  it('rejects a malformed envelope', () => {
    expect(() => crypto.decrypt('not-a-valid-envelope')).toThrow();
  });

  it('cannot decrypt data sealed under a different key', () => {
    const other = makeService(
      'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    );
    expect(() => other.decrypt(crypto.encrypt('cross-key'))).toThrow();
  });

  it('accepts a base64-encoded 32-byte key', () => {
    const b64 = Buffer.from(KEY, 'hex').toString('base64');
    const svc = makeService(b64);
    expect(svc.decrypt(svc.encrypt('via-base64'))).toBe('via-base64');
  });

  it('derives a working dev key when ENCRYPTION_KEY is unset (no crash)', () => {
    const svc = makeService(undefined);
    expect(svc.decrypt(svc.encrypt('dev-fallback'))).toBe('dev-fallback');
  });

  it('throws for a present-but-invalid key (fail fast)', () => {
    expect(() => makeService('too-short')).toThrow();
  });
});
