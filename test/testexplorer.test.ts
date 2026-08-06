import { describe, expect, test } from './harness';
import {
  buildTestArgs,
  classifyTestFile,
  parseTestBlocks,
  parseTestResult,
  summarizeRun,
  totalDuration,
} from '../src/renderer/testing/testModel';

const SOURCE = `# math tests
test "adds two numbers"
    expect 2 + 3 to equal 5
end

test "dividing by zero throws"
    expect 1 / 0 to throw
end
`;

describe('parseTestBlocks', () => {
  test('finds each test block with its line', () => {
    const blocks = parseTestBlocks(SOURCE);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ name: 'adds two numbers', line: 1 });
    expect(blocks[1]).toEqual({ name: 'dividing by zero throws', line: 5 });
  });

  test('no tests yields an empty list', () => {
    expect(parseTestBlocks('show "hi"\n')).toHaveLength(0);
  });
});

describe('parseTestResult', () => {
  // The summary lives in the envelope's `result`.
  const json =
    '{"zornuxJson":1,"ok":false,"command":"test","result":{"total":2,"passed":1,"failed":1,"tests":[{"name":"a","status":"passed","durationMs":5},{"name":"b","status":"failed","durationMs":1,"code":"ZX1503","message":"Expected 3, but got 2."}]},"diagnostics":[]}';

  test('decodes counts and cases', () => {
    const result = parseTestResult(json)!;
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.tests[0]).toEqual({ name: 'a', status: 'passed', durationMs: 5, code: undefined, message: undefined });
    expect(result.tests[1].message).toBe('Expected 3, but got 2.');
    expect(result.tests[1].code).toBe('ZX1503');
  });

  test('tolerates surrounding log lines', () => {
    expect(parseTestResult(`compiling…\n${json}\ndone`)!.total).toBe(2);
  });

  test('returns null on non-envelope output or a result with no tests array', () => {
    expect(parseTestResult('no json here')).toBeNull();
    expect(parseTestResult('{"total":0}')).toBeNull();
    expect(parseTestResult('{"zornuxJson":1,"ok":true,"command":"test","result":{"total":0},"diagnostics":[]}')).toBeNull();
  });

  test('derives counts when the runner omits them', () => {
    const result = parseTestResult(
      '{"zornuxJson":1,"ok":false,"command":"test","result":{"tests":[{"name":"a","status":"passed","durationMs":0},{"name":"b","status":"failed","durationMs":0}]},"diagnostics":[]}',
    )!;
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.failed).toBe(1);
  });
});

describe('buildTestArgs (9B)', () => {
  test('defaults to just --json', () => {
    expect(buildTestArgs({ engine: 'interpreter', failFast: false })).toBe('--json');
  });

  test('adds engine, fail-fast and filter flags', () => {
    expect(buildTestArgs({ engine: 'vm', failFast: true, filter: 'add' })).toBe('--json --engine vm --fail-fast --filter "add"');
  });

  test('ignores a blank filter', () => {
    expect(buildTestArgs({ engine: 'interpreter', failFast: false, filter: '   ' })).toBe('--json');
  });

  test('adds integration context (identity + role)', () => {
    expect(buildTestArgs({ engine: 'interpreter', failFast: false, identity: 'kim', role: 'Editor' })).toBe(
      '--json --identity "kim" --role "Editor"',
    );
  });
});

describe('classifyTestFile (9C)', () => {
  test('plain function tests are unit', () => {
    const result = classifyTestFile('function g\n    give back 1\nend\ntest "t"\n    expect g() to equal 1\nend\n');
    expect(result.kind).toBe('unit');
    expect(result.markers).toHaveLength(0);
  });

  test('policy/restrict/service/database mark integration', () => {
    expect(classifyTestFile('policy P\n    require role "X"\nend\ntest "t"\n    expect 1 to equal 1\nend\n').kind).toBe('integration');
    expect(classifyTestFile('service S\n    on GET "/x"\n        give back 1\n    end\nend\n').markers).toContain('service');
    expect(classifyTestFile('database D\n    provider memory\nend\n').markers).toContain('database');
    expect(classifyTestFile('function f\n    restrict to policy P otherwise give back 0\nend\n').markers).toContain('restrict');
  });

  test('the word "required" (record constraint) is not a restrict marker', () => {
    expect(classifyTestFile('record R\n    has name\n        required\nend\n').kind).toBe('unit');
  });
});

describe('summarizeRun + totalDuration (9B)', () => {
  test('sums per-file summaries', () => {
    expect(
      summarizeRun([
        { file: 'a', total: 3, passed: 2, failed: 1, durationMs: 10 },
        { file: 'b', total: 2, passed: 2, failed: 0, durationMs: 5 },
      ]),
    ).toEqual({ total: 5, passed: 4, failed: 1, durationMs: 15 });
  });

  test('totalDuration sums test times', () => {
    const result = parseTestResult(
      '{"zornuxJson":1,"ok":true,"command":"test","result":{"total":2,"passed":2,"failed":0,"tests":[{"name":"a","status":"passed","durationMs":18},{"name":"b","status":"passed","durationMs":6}]},"diagnostics":[]}',
    )!;
    expect(totalDuration(result)).toBe(24);
  });
});
