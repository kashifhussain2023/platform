/**
 * Swappable blob storage backend (mirrors the auth AuthProvider pattern). The
 * active implementation is chosen by the `STORAGE_PROVIDER` env var and provided
 * as a singleton under the STORAGE_PROVIDER_TOKEN DI token.
 */
export interface StorageProvider {
  put(key: string, buf: Buffer, mime: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

/** DI token for the active StorageProvider implementation. */
export const STORAGE_PROVIDER_TOKEN = Symbol('STORAGE_PROVIDER_TOKEN');
