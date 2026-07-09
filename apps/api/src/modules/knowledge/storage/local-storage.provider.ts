import { promises as fs } from 'fs';
import * as path from 'path';
import type { StorageProvider } from './storage.provider';

/**
 * DEFAULT storage provider: writes blobs under STORAGE_DIR (default
 * `apps/api/.storage`, gitignored). Zero infra — good for local dev + e2e.
 * Keys may contain `/` (e.g. `<companyId>/<uuid>`) and become nested dirs.
 */
export class LocalStorageProvider implements StorageProvider {
  constructor(private readonly baseDir: string) {}

  async put(key: string, buf: Buffer, _mime: string): Promise<void> {
    const target = this.resolve(key);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, buf);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.resolve(key), { force: true });
  }

  private resolve(key: string): string {
    // Guard against path traversal in the storage key.
    const safe = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    return path.join(this.baseDir, safe);
  }
}
