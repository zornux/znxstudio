import { describe, expect, test } from './harness';
import {
  buildProfileProgram,
  clampIterations,
  parseProfile,
  perQueryMicros,
  PROFILE_MARK,
} from '../src/renderer/database/profiler';

describe('buildProfileProgram', () => {
  test('wraps the query in a timed loop', () => {
    const program = buildProfileProgram('# seed', 'find count from Db.People', 500);
    expect(program).toContain('# seed');
    expect(program).toContain('create zprof_began = current_datetime()');
    expect(program).toContain('repeat 500 times');
    expect(program).toContain('zprof_total = zprof_total + (find count from Db.People)');
    expect(program).toContain(`show "${PROFILE_MARK}" + text(elapsed_time(zprof_began))`);
  });
});

describe('parseProfile', () => {
  test('extracts seconds and the accumulator', () => {
    const sample = parseProfile('People: 4\n__PROF__0.0108789|6000\n');
    expect(sample).toEqual({ seconds: 0.0108789, result: '6000' });
  });

  test('returns null without a marker', () => {
    expect(parseProfile('no marker here')).toBeNull();
  });

  test('handles a fractional aggregate result', () => {
    expect(parseProfile('__PROF__0.5|29.5')!.result).toBe('29.5');
  });
});

describe('perQueryMicros', () => {
  test('computes mean microseconds per query', () => {
    // 0.002s over 2000 iterations = 1µs each
    expect(perQueryMicros(0.002, 2000)).toBe(1);
  });

  test('guards against zero iterations', () => {
    expect(perQueryMicros(1, 0)).toBe(0);
  });
});

describe('clampIterations', () => {
  test('clamps to [1, 100000] and floors', () => {
    expect(clampIterations(-5)).toBe(1);
    expect(clampIterations(0)).toBe(1);
    expect(clampIterations(3.9)).toBe(3);
    expect(clampIterations(1e9)).toBe(100000);
    expect(clampIterations(NaN)).toBe(1);
  });
});
