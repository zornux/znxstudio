import { describe, expect, test } from './harness';
import { fastHash } from '../src/shared/hash';

describe('fastHash: content hashing', () => {
  test('is deterministic', () => {
    expect(fastHash('define x to 1\n')).toBe(fastHash('define x to 1\n'));
    expect(fastHash('')).toBe(fastHash(''));
  });

  test('differs for different content', () => {
    expect(fastHash('define x to 1') === fastHash('define x to 2')).toBeFalsy();
    expect(fastHash('a') === fastHash('b')).toBeFalsy();
  });

  test('is order-sensitive (not just a character sum)', () => {
    expect(fastHash('ab') === fastHash('ba')).toBeFalsy();
  });

  test('distinguishes length (no prefix collision)', () => {
    expect(fastHash('x') === fastHash('xx')).toBeFalsy();
    expect(fastHash('say') === fastHash('say ')).toBeFalsy();
  });

  test('produces a 16-char hex string', () => {
    const h = fastHash('function main() {}');
    expect(h).toHaveLength(16);
    expect(/^[0-9a-f]{16}$/.test(h)).toBeTruthy();
  });

  test('has no collisions across a batch of distinct inputs', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(fastHash(`line ${i} of source\n`));
    expect(seen.size).toBe(2000);
  });
});
