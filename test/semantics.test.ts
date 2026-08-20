import { describe, expect, test } from './harness';
import { tokenize } from '../src/renderer/language/languages/zornux/lexer';
import { parseZornux } from '../src/renderer/language/languages/zornux/parser';
import {
  analyze,
  findCallContext,
  findDefinition,
  findOccurrences,
  symbolAt,
  symbolsInScope,
} from '../src/renderer/language/languages/zornux/semantics';

function model(src: string) {
  const tokens = tokenize(src).tokens;
  const { ast } = parseZornux(src, { tokens, diagnostics: [] });
  return analyze(ast, tokens);
}
const semCodes = (src: string) => model(src).diagnostics.map((d) => d.code);

describe('semantics: diagnostics', () => {
  test('valid file has no semantic diagnostics', () => {
    expect(semCodes('define x to 1\nfunction main() {\n  say x\n}\n')).toHaveLength(0);
  });
  test('duplicate declaration', () => {
    expect(semCodes('define x to 1\ndefine x to 2\n')).toContain('zx-duplicate-declaration');
  });
  test('undefined identifier', () => {
    expect(semCodes('define total to 0\nsay missing\n')).toContain('zx-undefined-identifier');
  });
  test('scope resolution: local not visible in a sibling function', () => {
    const src = 'function outer() {\n  let local is 1\n  say local\n}\nfunction other() {\n  say local\n}\n';
    const undefinedRefs = model(src).diagnostics.filter((d) => d.code === 'zx-undefined-identifier');
    expect(undefinedRefs).toHaveLength(1);
    expect(undefinedRefs[0].range.start.line).toBe(5); // the `local` inside other()
  });
});

describe('semantics: imports', () => {
  const messages = (src: string) => model(src).diagnostics.map((d) => d.message);

  test('selective import `showing a, b` brings the symbols into scope', () => {
    const msgs = messages('import Math showing square, cube\ndefine a to square\ndefine b to cube\n');
    expect(msgs.some((m) => m.includes("'square'"))).toBe(false);
    expect(msgs.some((m) => m.includes("'cube'"))).toBe(false);
    // The contextual `showing` word must not be mistaken for an undefined name.
    expect(msgs.some((m) => m.includes("'showing'"))).toBe(false);
  });

  test('module handle resolves for a plain import', () => {
    expect(messages('import auth\ndefine a to auth\n').some((m) => m.includes("'auth'"))).toBe(false);
  });

  test('`import X as Y` puts the alias in scope', () => {
    expect(messages('import Toolkit as T\ndefine a to T\n').some((m) => m.includes("'T'"))).toBe(false);
  });

  test('dotted module path with `showing` brings the symbol into scope', () => {
    // Regression: `parseImport` used to read only the first path segment, so the
    // `showing` clause on a dotted import (`Api.Service showing ZornuxApi`) was
    // orphaned and every use of the exposed symbol was falsely flagged.
    const msgs = messages(
      'import Infrastructure.Identity.Configuration showing IdentityConfig\ncreate identity_settings from IdentityConfig\n',
    );
    expect(msgs.some((m) => m.includes("'IdentityConfig'"))).toBe(false);
    expect(msgs.some((m) => m.includes("'showing'"))).toBe(false);
    // Dotted segments are member access, not free names, so they must not flag.
    expect(msgs.some((m) => m.includes("'Identity'"))).toBe(false);
    expect(msgs.some((m) => m.includes("'Configuration'"))).toBe(false);
  });
});

describe('semantics: block scoping', () => {
  test('service/on blocks scope create declarations independently', () => {
    const src = [
      'import Shared.Envelope showing ok',
      'service Api',
      '  on GET "/"',
      '    create rid = ok()',
      '  end',
      '  on POST "/items"',
      '    create rid = ok()',
      '  end',
      'end',
      '',
    ].join('\n');
    const dupes = model(src).diagnostics.filter((d) => d.code === 'zx-duplicate-declaration');
    expect(dupes).toHaveLength(0);
  });

  test('if/for blocks inside handlers have their own scope', () => {
    const src = [
      'function process',
      '  if true',
      '    create x = 1',
      '  end',
      '  for each item in items',
      '    create x = 2',
      '  end',
      'end',
      '',
    ].join('\n');
    const dupes = model(src).diagnostics.filter((d) => d.code === 'zx-duplicate-declaration');
    expect(dupes).toHaveLength(0);
  });

  test('import showing symbols resolve inside nested service blocks', () => {
    const src = [
      'import Utils showing helper, format',
      'service TestApi',
      '  on GET "/"',
      '    create result = helper()',
      '    create text = format(result)',
      '  end',
      'end',
      '',
    ].join('\n');
    const unresolved = model(src).diagnostics.filter(
      (d) => d.code === 'zx-undefined-identifier' && (d.message.includes("'helper'") || d.message.includes("'format'")),
    );
    expect(unresolved).toHaveLength(0);
  });
});

describe('semantics: navigation', () => {
  const src = 'define shared to 10\nfunction a() {\n  say shared\n}\nfunction b() {\n  say shared\n}\n';

  test('find all references is scope-aware', () => {
    const occ = findOccurrences(model(src), { line: 0, character: 8 }, true);
    expect(occ?.ranges).toHaveLength(3); // declaration + 2 uses
  });

  test('go-to-definition resolves a reference to its declaration', () => {
    const target = findDefinition(model(src), { line: 2, character: 7 });
    expect(target?.nameRange.start.line).toBe(0);
  });

  test('symbolAt returns the declaration under a name', () => {
    const sym = symbolAt(model(src), { line: 0, character: 8 });
    expect(sym?.name).toBe('shared');
    expect(sym?.kind).toBe('constant');
  });
});

describe('semantics: completion + signature', () => {
  const src = 'define shared to 1\nfunction outer(param) {\n  let local is 0\n}\nfunction other() {\n}\n';

  test('symbolsInScope includes locals of the enclosing function', () => {
    const names = symbolsInScope(model(src), { line: 2, character: 4 }).map((s) => s.name);
    expect(names).toContain('param');
    expect(names).toContain('local');
    expect(names).toContain('shared');
  });

  test('symbolsInScope excludes another function’s locals', () => {
    const names = symbolsInScope(model(src), { line: 4, character: 2 }).map((s) => s.name);
    expect(names).toContain('shared');
    expect(names.includes('local')).toBe(false);
    expect(names.includes('param')).toBe(false);
  });

  test('findCallContext reports callee + active parameter', () => {
    const ctx = findCallContext('call sum(1, 2)\n', { line: 0, character: 12 });
    expect(ctx?.name).toBe('sum');
    expect(ctx?.activeParameter).toBe(1);
  });
});
