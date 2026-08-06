import { describe, expect, test } from './harness';
import { isWatchable, RunHistory } from '../src/renderer/testing/continuous';

describe('RunHistory', () => {
  test('records runs newest-first with seq and ok', () => {
    const history = new RunHistory();
    const a = history.push({ file: 'a', total: 2, passed: 2, failed: 0, durationMs: 5 });
    const b = history.push({ file: 'b', total: 3, passed: 2, failed: 1, durationMs: 8 });
    expect(a.seq).toBe(1);
    expect(a.ok).toBe(true);
    expect(b.seq).toBe(2);
    expect(b.ok).toBe(false);
    expect(history.latest()).toBe(b);
    expect(history.entries().map((r) => r.seq)).toEqual([2, 1]); // newest first
  });

  test('caps at the max, dropping the oldest', () => {
    const history = new RunHistory(2);
    history.push({ file: '1', total: 1, passed: 1, failed: 0, durationMs: 1 });
    history.push({ file: '2', total: 1, passed: 1, failed: 0, durationMs: 1 });
    history.push({ file: '3', total: 1, passed: 1, failed: 0, durationMs: 1 });
    expect(history.size()).toBe(2);
    expect(history.entries().map((r) => r.file)).toEqual(['3', '2']);
    expect(history.latest()!.seq).toBe(3); // seq keeps counting
  });

  test('passStreak counts consecutive passes from the newest', () => {
    const history = new RunHistory();
    history.push({ file: 'a', total: 1, passed: 0, failed: 1, durationMs: 1 }); // old fail
    history.push({ file: 'b', total: 1, passed: 1, failed: 0, durationMs: 1 });
    history.push({ file: 'c', total: 1, passed: 1, failed: 0, durationMs: 1 });
    expect(history.passStreak()).toBe(2);
  });

  test('a failure resets the streak', () => {
    const history = new RunHistory();
    history.push({ file: 'a', total: 1, passed: 1, failed: 0, durationMs: 1 });
    history.push({ file: 'b', total: 1, passed: 0, failed: 1, durationMs: 1 });
    expect(history.passStreak()).toBe(0);
  });
});

describe('isWatchable', () => {
  test('only .zx files are watched', () => {
    expect(isWatchable('a.zx')).toBe(true);
    expect(isWatchable('C:/x/Y.ZX')).toBe(true);
    expect(isWatchable('a.js')).toBe(false);
    expect(isWatchable('README.md')).toBe(false);
  });
});
