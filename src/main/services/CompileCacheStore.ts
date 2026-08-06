import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { cacheFileName, selectEvictions, type CacheEntryMeta } from '../../shared/cacheEviction';

const MAX_ENTRIES = 1_000;
const MAX_BYTES = 32 * 1024 * 1024; // 32 MB

export interface DiskCacheStats {
  entries: number;
  bytes: number;
}

/**
 * Persistent, content-addressed cache for compiler results — the on-disk L2 that
 * survives IDE restarts (the in-memory L1 lives in CompilerService). Entries are
 * small JSON files named by a hash of the composite key; the full key is stored
 * inside for collision verification. Bounded by entry count + total bytes with
 * LRU eviction (access bumps the file mtime). Every operation is best-effort and
 * never throws — a disk problem degrades to a cache miss.
 */
export class CompileCacheStore {
  private enabled = true;
  private index: Map<string, CacheEntryMeta> | null = null;

  constructor(private readonly dir = join(homedir(), '.znxstudio', 'cache', 'compiler')) {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled) return null;
    const file = cacheFileName(key);
    try {
      await this.ensureIndex();
      if (!this.index!.has(file)) return null;
      const full = join(this.dir, file);
      const parsed = JSON.parse(await fs.readFile(full, 'utf8')) as { key: string; value: T };
      if (parsed.key !== key) return null; // hash collision guard

      const now = Date.now();
      await fs.utimes(full, now / 1000, now / 1000).catch(() => undefined);
      const meta = this.index!.get(file);
      if (meta) meta.mtimeMs = now;
      return parsed.value;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (!this.enabled) return;
    const file = cacheFileName(key);
    try {
      await fs.mkdir(this.dir, { recursive: true });
      await this.ensureIndex();
      const payload = JSON.stringify({ key, value, storedAt: Date.now() });
      await fs.writeFile(join(this.dir, file), payload, 'utf8');
      this.index!.set(file, { file, size: Buffer.byteLength(payload), mtimeMs: Date.now() });
      await this.evict();
    } catch {
      /* best-effort */
    }
  }

  async clear(): Promise<DiskCacheStats> {
    const before = await this.stats();
    try {
      await this.ensureIndex();
      for (const file of [...this.index!.keys()]) {
        await fs.rm(join(this.dir, file), { force: true }).catch(() => undefined);
      }
      this.index!.clear();
    } catch {
      /* best-effort */
    }
    return before;
  }

  async stats(): Promise<DiskCacheStats> {
    try {
      await this.ensureIndex();
    } catch {
      return { entries: 0, bytes: 0 };
    }
    let bytes = 0;
    for (const meta of this.index!.values()) bytes += meta.size;
    return { entries: this.index!.size, bytes };
  }

  private async ensureIndex(): Promise<void> {
    if (this.index) return;
    const index = new Map<string, CacheEntryMeta>();
    try {
      for (const name of await fs.readdir(this.dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const stat = await fs.stat(join(this.dir, name));
          index.set(name, { file: name, size: stat.size, mtimeMs: stat.mtimeMs });
        } catch {
          /* skip unreadable entry */
        }
      }
    } catch {
      /* directory missing → empty index */
    }
    this.index = index;
  }

  private async evict(): Promise<void> {
    if (!this.index) return;
    const toEvict = selectEvictions([...this.index.values()], {
      maxEntries: MAX_ENTRIES,
      maxBytes: MAX_BYTES,
    });
    for (const file of toEvict) {
      await fs.rm(join(this.dir, file), { force: true }).catch(() => undefined);
      this.index.delete(file);
    }
  }
}
