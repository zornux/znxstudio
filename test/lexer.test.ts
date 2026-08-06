import { describe, expect, test } from './harness';
import { tokenize, TokenKind } from '../src/renderer/language/languages/zornux/lexer';

describe('lexer', () => {
  test('classifies keywords, identifiers, numbers, strings', () => {
    const { tokens } = tokenize('define greeting to "hi"');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain(TokenKind.Keyword); // define / to
    expect(kinds).toContain(TokenKind.Identifier); // greeting
    expect(kinds).toContain(TokenKind.String); // "hi"
    expect(tokens[tokens.length - 1].kind).toBe(TokenKind.EOF);
  });

  test('recognizes real Zornux keywords (create/show/give/each/has)', () => {
    // These color as keywords in the editor; regression guard for the keyword set.
    for (const word of ['create', 'show', 'give', 'back', 'each', 'has', 'times']) {
      const token = tokenize(`${word} x`).tokens[0];
      expect(token.kind).toBe(TokenKind.Keyword);
    }
  });

  test('produces 0-based token ranges', () => {
    const { tokens } = tokenize('say value');
    const value = tokens.find((t) => t.value === 'value')!;
    expect(value.range).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
  });

  test('flags an unterminated string', () => {
    const { diagnostics } = tokenize('say "oops');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('zx-unterminated-string');
  });

  test('flags an invalid character', () => {
    const { diagnostics } = tokenize('define x to 5 @ 3');
    expect(diagnostics.map((d) => d.code)).toContain('zx-invalid-token');
  });

  test('tracks line numbers across lines', () => {
    const { tokens } = tokenize('a\nb\nc');
    const c = tokens.find((t) => t.value === 'c')!;
    expect(c.range.start.line).toBe(2);
  });

  test('treats # as a line comment — keywords inside are NOT code', () => {
    const { tokens, diagnostics } = tokenize('create x = 5 # define show give back');
    const comment = tokens.find((t) => t.kind === TokenKind.Comment);
    expect(comment?.value).toBe('# define show give back');
    // No keyword from inside the comment leaks out as a keyword token.
    expect(tokens.some((t) => t.kind === TokenKind.Keyword && ['define', 'show', 'give', 'back'].includes(t.value))).toBe(false);
    expect(diagnostics).toHaveLength(0); // '#' is no longer an invalid character
  });

  test('treats /* … */ as a block comment on one line', () => {
    const { tokens } = tokenize('create /* show give */ x');
    const comment = tokens.find((t) => t.kind === TokenKind.Comment);
    expect(comment?.value).toBe('/* show give */');
    expect(tokens.some((t) => t.kind === TokenKind.Keyword && ['show', 'give'].includes(t.value))).toBe(false);
  });

  test('recognizes all delimiters', () => {
    const { tokens } = tokenize('{}()[]');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toContain(TokenKind.BraceOpen);
    expect(kinds).toContain(TokenKind.BraceClose);
    expect(kinds).toContain(TokenKind.ParenOpen);
    expect(kinds).toContain(TokenKind.BracketClose);
  });
});
