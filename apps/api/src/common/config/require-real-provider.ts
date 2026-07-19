/**
 * Refuse to boot in production with a provider factory silently resolved to
 * "mock" (either the env var was never set, or it holds an unrecognized
 * value and the factory's `default:` branch quietly fell back). Mirrors
 * CryptoService's ENCRYPTION_KEY production guard — a config omission should
 * fail loudly at startup, not serve fake AI replies / skip real billing while
 * looking like it's working.
 */
export function requireRealProviderInProduction(
  envVarName: string,
  resolvedKind: string,
): void {
  if (process.env.NODE_ENV === 'production' && resolvedKind === 'mock') {
    throw new Error(
      `${envVarName} is unset (or not a recognized provider) — refusing to ` +
        `start in production with the mock/offline provider. Set ${envVarName} ` +
        `to a real provider.`,
    );
  }
}
