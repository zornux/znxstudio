import { describe, expect, test } from './harness';
import { analyzeCoverage, callsIn, parseFunctions, parseTestCalls } from '../src/renderer/testing/coverage';

describe('parseFunctions', () => {
  test('extracts top-level functions with bodies, skipping nested ends', () => {
    const text = 'function f with x\n    if x is 1\n        give back 1\n    end\n    give back x\nend\nfunction g\n    give back 2\nend\n';
    const fns = parseFunctions(text);
    expect(fns.map((f) => f.name)).toEqual(['f', 'g']);
    expect(fns[0].body).toContain('give back x'); // nested `end` did not truncate the body
    expect(fns[0].line).toBe(0);
  });
});

describe('callsIn / parseTestCalls', () => {
  test('callsIn finds invoked identifiers', () => {
    expect([...callsIn('give back add(x, helper(y))')].sort()).toEqual(['add', 'helper']);
  });

  test('parseTestCalls only collects calls inside test blocks', () => {
    const text = 'function setup\n    seed()\nend\ntest "t"\n    expect add(1, 2) to equal 3\nend\n';
    const calls = parseTestCalls(text);
    expect(calls.has('add')).toBe(true);
    expect(calls.has('seed')).toBe(false); // outside a test block
  });
});

describe('analyzeCoverage', () => {
  const files = [
    { file: 'a.zx', text: 'function add with a, b\n    give back a + b\nend\nfunction helper with x\n    give back add(x, 1)\nend\nfunction unused with y\n    give back y\nend\n' },
    { file: 'b.zx', text: 'test "uses helper"\n    expect helper(2) to equal 3\nend\n' },
  ];

  test('covers directly and transitively called functions', () => {
    const report = analyzeCoverage(files);
    expect(report.total).toBe(3);
    expect(report.covered).toBe(2); // helper (direct) + add (transitive via helper)
    expect(report.percent).toBe(67);
    expect(report.functions.find((f) => f.name === 'add')!.covered).toBe(true);
    expect(report.functions.find((f) => f.name === 'unused')!.covered).toBe(false);
  });

  test('100% when there are no functions', () => {
    expect(analyzeCoverage([{ file: 'x.zx', text: 'test "t"\n    expect 1 to equal 1\nend\n' }]).percent).toBe(100);
  });

  test('a function only called by other untested functions stays uncovered', () => {
    const report = analyzeCoverage([
      { file: 'a.zx', text: 'function a\n    b()\nend\nfunction b\n    give back 1\nend\n' },
    ]);
    expect(report.covered).toBe(0); // no test calls anything
  });
});
