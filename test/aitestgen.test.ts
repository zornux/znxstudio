import { describe, expect, test } from './harness';
import {
  buildTestGenMessages,
  composeTestProgram,
  countTests,
  dedent,
  extractTestBlocks,
  isRunnableSource,
} from '../src/renderer/ai/testgen';

describe('buildTestGenMessages', () => {
  test('teaches the real Zornux test syntax and forbids prose/fences', () => {
    const { system, messages } = buildTestGenMessages('function add', 'm.zx', 'add');
    expect(system).toContain('test "describes the case"');
    expect(system).toContain('column 0');
    expect(system).toContain('no Markdown code fences');
    expect(messages[0].content).toContain('Focus on the function `add`');
    expect(messages[0].content).toContain('m.zx');
  });
});

describe('dedent', () => {
  test('removes the common leading indentation', () => {
    expect(dedent('    a\n    b')).toBe('a\nb');
    expect(dedent('  a\n    b')).toBe('a\n  b');
  });
  test('leaves unindented text alone', () => {
    expect(dedent('a\nb')).toBe('a\nb');
  });
});

describe('extractTestBlocks', () => {
  test('pulls test blocks out of fenced, prose-wrapped output', () => {
    const reply =
      'Here you go:\n```zornux\ntest "combines"\n    expect combine(2, 3) to equal 5\nend\n\ntest "zero"\n    expect combine(0, 0) to equal 0\nend\n```\nHope this helps!';
    const extracted = extractTestBlocks(reply);
    expect(extracted.startsWith('test "combines"')).toBe(true);
    expect(extracted.includes('```')).toBe(false);
    expect(extracted.includes('Hope')).toBe(false);
    expect(countTests(extracted)).toBe(2);
  });
  test('dedents uniformly-indented blocks to column 0', () => {
    const reply = '    test "x"\n        expect 1 to equal 1\n    end';
    const extracted = extractTestBlocks(reply);
    expect(extracted).toBe('test "x"\n    expect 1 to equal 1\nend');
  });
  test('returns empty when there are no test blocks', () => {
    expect(extractTestBlocks('no tests here')).toBe('');
    expect(extractTestBlocks('test "unterminated"\n    expect 1 to equal 1')).toBe('');
  });
});

describe('composeTestProgram & isRunnableSource', () => {
  test('appends tests after the source', () => {
    const program = composeTestProgram('function add with a, b\n    give back a + b\nend', 'test "t"\n    expect add(1,1) to equal 2\nend');
    expect(program.indexOf('give back a + b')).toBeLessThan(program.indexOf('expect add'));
    expect(program.endsWith('\n')).toBe(true);
  });
  test('flags service/publish sources as not auto-runnable', () => {
    expect(isRunnableSource('function add with a\n    give back a\nend')).toBe(true);
    expect(isRunnableSource('service Greeter\nend')).toBe(false);
    expect(isRunnableSource('publish "x"')).toBe(false);
  });
});
