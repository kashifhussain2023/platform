import { CryptoService } from './crypto.service';

/** Minimal stand-in for ConfigService — CryptoService only calls .get(). */
class FakeConfig {
  constructor(private readonly value: string | undefined) {}
  get(): string | undefined {
    return this.value;
  }
}

// A real, high-entropy 32-byte key (fixed so the test is deterministic;
// generated once via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
const REAL_KEY =
  'd0f1e723b7fbac5b093a43cbd0167f20a7db003a65518b8386b4933dd5e3d940';

// The exact placeholder shape the audit found sitting in apps/api/.env.
const PLACEHOLDER_KEY = '0123456789abcdef'.repeat(4);

describe('CryptoService key resolution', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it('accepts a real 64-hex-char key in production', () => {
    process.env.NODE_ENV = 'production';
    expect(
      () => new CryptoService(new FakeConfig(REAL_KEY) as any),
    ).not.toThrow();
  });

  it('derives an insecure dev key and only warns when unset outside production', () => {
    process.env.NODE_ENV = 'test';
    expect(
      () => new CryptoService(new FakeConfig(undefined) as any),
    ).not.toThrow();
  });

  it('refuses to start when ENCRYPTION_KEY is unset in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new CryptoService(new FakeConfig(undefined) as any)).toThrow(
      /ENCRYPTION_KEY is not set/,
    );
  });

  it('rejects the known placeholder pattern in production', () => {
    process.env.NODE_ENV = 'production';
    expect(
      () => new CryptoService(new FakeConfig(PLACEHOLDER_KEY) as any),
    ).toThrow(/looks like a placeholder/);
  });

  it('allows the same weak key outside production (dev/test convenience)', () => {
    process.env.NODE_ENV = 'test';
    expect(
      () => new CryptoService(new FakeConfig(PLACEHOLDER_KEY) as any),
    ).not.toThrow();
  });

  it('still rejects a malformed key regardless of environment', () => {
    process.env.NODE_ENV = 'test';
    expect(
      () => new CryptoService(new FakeConfig('too-short') as any),
    ).toThrow(/64 hex chars or base64/);
  });
});
