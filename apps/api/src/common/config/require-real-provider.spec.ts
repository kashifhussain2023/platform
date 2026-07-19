import { requireRealProviderInProduction } from './require-real-provider';

describe('requireRealProviderInProduction', () => {
  const originalEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it('throws when NODE_ENV=production and the resolved kind is mock', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      requireRealProviderInProduction('LLM_PROVIDER', 'mock'),
    ).toThrow(/LLM_PROVIDER/);
  });

  it('does not throw in production when the resolved kind is a real provider', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      requireRealProviderInProduction('LLM_PROVIDER', 'anthropic'),
    ).not.toThrow();
  });

  it('does not throw outside production even when the resolved kind is mock', () => {
    process.env.NODE_ENV = 'test';
    expect(() =>
      requireRealProviderInProduction('BILLING_PROVIDER', 'mock'),
    ).not.toThrow();
  });
});
