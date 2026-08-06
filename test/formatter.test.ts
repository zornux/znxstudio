import { describe, expect, test } from './harness';
import { formatZornux } from '../src/renderer/language/languages/zornux/formatter';
import { parseZornux } from '../src/renderer/language/languages/zornux/parser';

const opt = { tabSize: 2, insertSpaces: true };

describe('formatter', () => {
  test('re-indents by delimiter depth', () => {
    const out = formatZornux('function main(){\nsay 1\nif true then {\nsay 2\n}\n}\n', opt);
    const lines = out.split('\n');
    expect(lines[1]).toBe('  say 1');
    expect(lines[3]).toBe('    say 2');
  });

  test('is idempotent', () => {
    const once = formatZornux('function f(){\nsay 1\n}\n', opt);
    expect(formatZornux(once, opt)).toBe(once);
  });

  test('ignores braces inside strings', () => {
    const out = formatZornux('function f(){\nsay "a { b } c"\n}\n', opt);
    const strLine = out.split('\n').find((l) => l.includes('a {'))!;
    expect(strLine.length - strLine.trimStart().length).toBe(2);
  });

  test('honors tabs mode', () => {
    const out = formatZornux('function f(){\nsay 1\n}\n', { tabSize: 4, insertSpaces: false });
    expect(out.split('\n').some((l) => l.startsWith('\t'))).toBe(true);
  });

  test('preserves meaning (same parser diagnostics)', () => {
    const src = 'define g to "x"\nfunction main() {\n  say g\n}\n';
    const before = parseZornux(src).diagnostics.length;
    const after = parseZornux(formatZornux(src, opt)).diagnostics.length;
    expect(after).toBe(before);
  });

  test('leaves whitespace-only input unchanged', () => {
    expect(formatZornux('   \n\t\n', opt)).toBe('   \n\t\n');
  });
});
