import { describe, expect, test } from './harness';
import { compareEngines, overBudget, perfStats, rankByDuration } from '../src/renderer/testing/perf';
import type { TestRunResult } from '../src/renderer/testing/testModel';

function result(durations: [string, number][]): TestRunResult {
  return {
    total: durations.length,
    passed: durations.length,
    failed: 0,
    tests: durations.map(([name, durationMs]) => ({ name, status: 'passed', durationMs })),
  };
}

const INTERP = result([
  ['fast', 2],
  ['slow', 60],
  ['mid', 20],
]);

describe('perfStats', () => {
  test('computes total, mean, max and the slowest test', () => {
    const stats = perfStats(INTERP);
    expect(stats.total).toBe(3);
    expect(stats.totalMs).toBe(82);
    expect(stats.meanMs).toBeGreaterThan(27);
    expect(stats.maxMs).toBe(60);
    expect(stats.slowest).toBe('slow');
  });

  test('empty result is all zero', () => {
    expect(perfStats(result([]))).toEqual({ total: 0, totalMs: 0, meanMs: 0, maxMs: 0, slowest: undefined });
  });
});

describe('rankByDuration', () => {
  test('orders tests slowest first', () => {
    expect(rankByDuration(INTERP).map((t) => t.name)).toEqual(['slow', 'mid', 'fast']);
  });
});

describe('overBudget', () => {
  test('flags tests strictly over the budget', () => {
    expect(overBudget(INTERP, 50).map((t) => t.name)).toEqual(['slow']);
    expect(overBudget(INTERP, 20)).toHaveLength(1); // 60 > 20, 20 is not > 20
  });
});

describe('compareEngines', () => {
  const VM = result([
    ['fast', 5],
    ['slow', 40],
    ['mid', 20],
  ]);

  test('reports the faster engine and delta per test', () => {
    const cmp = compareEngines(INTERP, VM);
    expect(cmp.find((c) => c.name === 'fast')).toEqual({ name: 'fast', interpreterMs: 2, vmMs: 5, faster: 'interpreter', deltaMs: 3 });
    expect(cmp.find((c) => c.name === 'slow')!.faster).toBe('vm');
    expect(cmp.find((c) => c.name === 'mid')!.faster).toBe('tie');
  });

  test('a test missing from the VM run has NaN vm time and zero delta', () => {
    const cmp = compareEngines(result([['only', 3]]), result([]));
    expect(Number.isNaN(cmp[0].vmMs)).toBe(true);
    expect(cmp[0].deltaMs).toBe(0);
  });
});
