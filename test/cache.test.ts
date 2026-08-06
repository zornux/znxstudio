import { describe, expect, test } from './harness';
import { cacheFileName, selectEvictions, type CacheEntryMeta } from '../src/shared/cacheEviction';

const entry = (file: string, size: number, mtimeMs: number): CacheEntryMeta => ({ file, size, mtimeMs });

describe('cache: filename', () => {
  test('is deterministic and .json-suffixed', () => {
    expect(cacheFileName('check|a|1.0|/x|hash')).toBe(cacheFileName('check|a|1.0|/x|hash'));
    expect(cacheFileName('a').endsWith('.json')).toBeTruthy();
  });
  test('differs for different keys', () => {
    expect(cacheFileName('build|x') === cacheFileName('build|y')).toBeFalsy();
  });
});

describe('cache: eviction', () => {
  test('keeps everything when within limits', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2)];
    expect(selectEvictions(entries, { maxEntries: 10, maxBytes: 1000 })).toEqual([]);
  });

  test('evicts oldest first to satisfy the entry-count limit', () => {
    const entries = [entry('new', 10, 300), entry('old', 10, 100), entry('mid', 10, 200)];
    expect(selectEvictions(entries, { maxEntries: 1, maxBytes: 1000 })).toEqual(['old', 'mid']);
  });

  test('evicts oldest first to satisfy the byte limit', () => {
    const entries = [entry('a', 100, 1), entry('b', 100, 2), entry('c', 100, 3)];
    // limit 250 bytes → must drop down to <=250; evict 'a' (300→200)
    expect(selectEvictions(entries, { maxEntries: 100, maxBytes: 250 })).toEqual(['a']);
  });

  test('stops as soon as both limits are satisfied', () => {
    const entries = [entry('a', 10, 1), entry('b', 10, 2), entry('c', 10, 3), entry('d', 10, 4)];
    const evicted = selectEvictions(entries, { maxEntries: 2, maxBytes: 1000 });
    expect(evicted).toEqual(['a', 'b']);
  });
});
