import { describe, expect, test } from './harness';
import { formatZornux } from '../src/renderer/language/languages/zornux/formatter';
import { parseZornux } from '../src/renderer/language/languages/zornux/parser';
import { lintMobileZornux } from '../src/renderer/language/languages/zornux/mobileSyntax';

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

  test('formats mobile end-block hierarchy and is idempotent', () => {
    const source = 'mobile app "Sweet_water"\n\nscreen Home\nstate greeting = "Hello"\ncolumn\ntext greeting\nend\nend\n\nstart with Home\n';
    const expected = 'mobile app "Sweet_water"\n\nscreen Home\n  state greeting = "Hello"\n  column\n    text greeting\n  end\nend\n\nstart with Home\n';
    const formatted = formatZornux(source, opt);
    expect(formatted).toBe(expected);
    expect(formatZornux(formatted, opt)).toBe(formatted);
  });

  test('accepts the generated mobile template without false diagnostics', () => {
    const source = 'mobile app "Sweet_water"\n\nscreen Home\n    state greeting = "Hello from Sweet_water!"\n\n    column\n        text greeting\n    end\nend\n\nstart with Home\n';
    expect(lintMobileZornux(source)).toHaveLength(0);
  });

  test('reports real mobile structural and navigation errors', () => {
    const source = 'mobile app "Demo"\n\nscreen Home\n    column\n        text "Hello"\nend\n\nstart with Missing\n';
    const codes = lintMobileZornux(source).map((diagnostic) => diagnostic.code);
    expect(codes).toContain('zx-mobile-unclosed-block');
    expect(codes).toContain('zx-mobile-unknown-screen');
  });

  test('blocks unsupported statements from an unsafe designer round trip', () => {
    const source = 'mobile app "Demo"\n\nscreen Home\n    future_widget "Value"\nend\n\nstart with Home\n';
    expect(lintMobileZornux(source).map((diagnostic) => diagnostic.code)).toContain('zx-mobile-unsupported-statement');
  });

  test('blocks unknown component attributes from an unsafe designer round trip', () => {
    const source = 'mobile app "Demo"\n\nscreen Home\n    button "Save" mystery=true\nend\n\nstart with Home\n';
    expect(lintMobileZornux(source).map((diagnostic) => diagnostic.code)).toContain('zx-mobile-unsupported-attribute');
  });
});
