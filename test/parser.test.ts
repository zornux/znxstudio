import { describe, expect, test } from './harness';
import { parseZornux } from '../src/renderer/language/languages/zornux/parser';

const codes = (src: string) => parseZornux(src).diagnostics.map((d) => d.code);

describe('parser: diagnostics', () => {
  test('valid file has no diagnostics', () => {
    expect(codes('define x to 1\nfunction main() {\n  say x\n}\n')).toHaveLength(0);
  });
  test('unclosed block', () => {
    expect(codes('function f() {\n  say 1\n')).toContain('zx-unclosed-delimiter');
  });
  test('unexpected closing brace', () => {
    expect(codes('say 1\n}\n')).toContain('zx-unexpected-close');
  });
  test('mismatched delimiter', () => {
    expect(codes('f(a]\n')).toContain('zx-mismatched-delimiter');
  });
});

describe('parser: AST', () => {
  test('builds a File node with top-level statements', () => {
    const { ast } = parseZornux('import util\ndefine PI to 3.14\nfunction main() {}\ntype Point\n');
    expect(ast.kind).toBe('File');
    const kinds = ast.body.map((n) => n.kind);
    expect(kinds).toContain('Import');
    expect(kinds).toContain('Constant');
    expect(kinds).toContain('Function');
    expect(kinds).toContain('Type');
  });

  test('captures function params and body', () => {
    const { ast } = parseZornux('function sum(a, b) {\n  let s is 0\n}\n');
    const fn = ast.body.find((n) => n.kind === 'Function');
    expect(fn?.kind).toBe('Function');
    if (fn?.kind === 'Function') {
      expect(fn.params.map((p) => p.name)).toEqual(['a', 'b']);
      expect(fn.body?.body[0]?.kind).toBe('Variable');
    }
  });

  test('recovers a partial AST from an unclosed function', () => {
    const { ast } = parseZornux('function start(config) {\n  let ready is true\n');
    const fn = ast.body.find((n) => n.kind === 'Function');
    expect(fn?.kind).toBe('Function');
  });

  test('never throws on garbage input', () => {
    for (const src of ['', '@#$%^', '((((', '}}}}', '"unclosed', 'a { b ( c [ d ] ) }']) {
      expect(() => parseZornux(src)).toBeTruthy();
      parseZornux(src);
    }
    expect(true).toBe(true);
  });
});
