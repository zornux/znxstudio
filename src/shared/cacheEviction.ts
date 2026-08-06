import { fastHash } from './hash';

/**
 * Pure helpers for the persistent compile cache. The filesystem orchestration
 * lives in the main process; the collision-safe filename derivation and the
 * bounded LRU eviction decision are pure and unit-tested here.
 */

/** Filesystem-safe cache filename for a composite key. */
export function cacheFileName(key: string): string {
  return `${fastHash(key)}.json`;
}

export interface CacheEntryMeta {
  file: string;
  size: number;
  mtimeMs: number;
}

export interface CacheLimits {
  maxEntries: number;
  maxBytes: number;
}

/**
 * Choose the least-recently-used entries to remove so the cache stays within
 * both the entry-count and byte-size limits. Oldest (lowest mtime) go first.
 * Returns the filenames to evict (empty when already within limits).
 */
export function selectEvictions(entries: CacheEntryMeta[], limits: CacheLimits): string[] {
  let count = entries.length;
  let bytes = entries.reduce((total, entry) => total + entry.size, 0);
  if (count <= limits.maxEntries && bytes <= limits.maxBytes) return [];

  const oldestFirst = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const evict: string[] = [];
  for (const entry of oldestFirst) {
    if (count <= limits.maxEntries && bytes <= limits.maxBytes) break;
    evict.push(entry.file);
    count--;
    bytes -= entry.size;
  }
  return evict;
}
