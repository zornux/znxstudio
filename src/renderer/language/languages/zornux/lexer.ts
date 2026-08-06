/**
 * Zornux lexer — a self-contained, Monaco-free tokenizer.
 *
 * This is the first stage of the Zornux front-end. It knows nothing about the
 * IDE, Monaco, or the language-service API: it consumes source text and produces
 * tokens + lexical diagnostics using 0-based positions. The real Zornux compiler
 * lexer can replace this file wholesale without touching anything else.
 *
 * Crucially, Zornux has no multi-line lexical constructs (strings and comments
 * end at the line), so every line tokenizes INDEPENDENTLY. `tokenizeLineRelative`
 * is the per-line core (positions relative to the line); both the batch
 * `tokenize` and the incremental tokenizer build on it — guaranteeing identical
 * output whether or not caching is involved.
 */
import { ZORNUX_KEYWORDS } from './keywords';

export enum TokenKind {
  Keyword = 'keyword',
  Identifier = 'identifier',
  String = 'string',
  Number = 'number',
  Comment = 'comment',
  Operator = 'operator',
  BraceOpen = 'brace.open',
  BraceClose = 'brace.close',
  ParenOpen = 'paren.open',
  ParenClose = 'paren.close',
  BracketOpen = 'bracket.open',
  BracketClose = 'bracket.close',
  Punctuation = 'punctuation',
  Invalid = 'invalid',
  EOF = 'eof',
}

export interface SrcPosition {
  line: number;
  character: number;
}
export interface SrcRange {
  start: SrcPosition;
  end: SrcPosition;
}
export interface Token {
  kind: TokenKind;
  value: string;
  range: SrcRange;
}

export type ZornuxSeverity = 'error' | 'warning' | 'info';
export interface ZornuxDiagnostic {
  severity: ZornuxSeverity;
  code: string;
  message: string;
  hint?: string;
  range: SrcRange;
}

export interface LexResult {
  tokens: Token[];
  diagnostics: ZornuxDiagnostic[];
}

const KEYWORDS = new Set(ZORNUX_KEYWORDS);
const OPERATOR_CHARS = new Set(['+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|']);
const PUNCTUATION = new Set([',', ';', ':', '.']);
const SINGLE: Record<string, TokenKind> = {
  '{': TokenKind.BraceOpen,
  '}': TokenKind.BraceClose,
  '(': TokenKind.ParenOpen,
  ')': TokenKind.ParenClose,
  '[': TokenKind.BracketOpen,
  ']': TokenKind.BracketClose,
};

const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentPart = (c: string): boolean => /[A-Za-z0-9_]/.test(c);

/**
 * Tokenize a single line (no newlines). Positions are line-relative (line 0);
 * callers shift them to the absolute line. This is the hot char-scanning core.
 */
export function tokenizeLineRelative(text: string): LexResult {
  const tokens: Token[] = [];
  const diagnostics: ZornuxDiagnostic[] = [];
  const length = text.length;
  let i = 0;

  const peek = (offset = 0): string => text[i + offset] ?? '';
  const at = (character: number): SrcPosition => ({ line: 0, character });

  while (i < length) {
    const ch = peek();

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      i++;
      continue;
    }

    const start = i;

    // Line comment (`#` to end of line — Zornux's only line-comment syntax).
    if (ch === '#') {
      let value = '';
      while (i < length) value += text[i++];
      tokens.push({ kind: TokenKind.Comment, value, range: { start: at(start), end: at(i) } });
      continue;
    }

    // Block comment (`/* … */`). This per-line lexer keeps each line independent,
    // so it captures a block that opens and closes on this line, and colours the
    // rest of the line for an unterminated `/*`. The Monarch grammar carries true
    // multi-line spans for display, and the compiler's lexer for semantics.
    if (ch === '/' && peek(1) === '*') {
      let value = text[i++] + text[i++]; // consume `/*`
      while (i < length) {
        if (text[i] === '*' && text[i + 1] === '/') {
          value += text[i++];
          value += text[i++];
          break;
        }
        value += text[i++];
      }
      tokens.push({ kind: TokenKind.Comment, value, range: { start: at(start), end: at(i) } });
      continue;
    }

    // String literal (line-bounded)
    if (ch === '"') {
      let value = text[i++];
      let terminated = false;
      while (i < length) {
        const c = text[i++];
        value += c;
        if (c === '"') {
          terminated = true;
          break;
        }
      }
      const range = { start: at(start), end: at(i) };
      tokens.push({ kind: TokenKind.String, value, range });
      if (!terminated) {
        diagnostics.push({
          severity: 'error',
          code: 'zx-unterminated-string',
          message: 'Unterminated string literal.',
          hint: 'Add a closing double quote (").',
          range,
        });
      }
      continue;
    }

    // Number
    if (isDigit(ch)) {
      let value = '';
      while (i < length && (isDigit(peek()) || peek() === '.')) value += text[i++];
      tokens.push({ kind: TokenKind.Number, value, range: { start: at(start), end: at(i) } });
      continue;
    }

    // Identifier / keyword
    if (isIdentStart(ch)) {
      let value = '';
      while (i < length && isIdentPart(peek())) value += text[i++];
      tokens.push({
        kind: KEYWORDS.has(value) ? TokenKind.Keyword : TokenKind.Identifier,
        value,
        range: { start: at(start), end: at(i) },
      });
      continue;
    }

    // Braces / parentheses / brackets
    const bracket = SINGLE[ch];
    if (bracket !== undefined) {
      i++;
      tokens.push({ kind: bracket, value: ch, range: { start: at(start), end: at(i) } });
      continue;
    }

    // Operators (greedy run)
    if (OPERATOR_CHARS.has(ch)) {
      let value = '';
      while (i < length && OPERATOR_CHARS.has(peek())) value += text[i++];
      tokens.push({ kind: TokenKind.Operator, value, range: { start: at(start), end: at(i) } });
      continue;
    }

    // Punctuation
    if (PUNCTUATION.has(ch)) {
      i++;
      tokens.push({ kind: TokenKind.Punctuation, value: ch, range: { start: at(start), end: at(i) } });
      continue;
    }

    // Anything else is an invalid token.
    i++;
    const range = { start: at(start), end: at(i) };
    tokens.push({ kind: TokenKind.Invalid, value: ch, range });
    diagnostics.push({
      severity: 'error',
      code: 'zx-invalid-token',
      message: `Invalid character ${JSON.stringify(ch)}.`,
      hint: 'Remove or replace this character.',
      range,
    });
  }

  return { tokens, diagnostics };
}

/** Return a copy of a line-relative token placed on absolute `line`. */
export function shiftToken(token: Token, line: number): Token {
  return {
    kind: token.kind,
    value: token.value,
    range: {
      start: { line, character: token.range.start.character },
      end: { line, character: token.range.end.character },
    },
  };
}

/** Return a copy of a line-relative diagnostic placed on absolute `line`. */
export function shiftDiagnostic(diagnostic: ZornuxDiagnostic, line: number): ZornuxDiagnostic {
  return {
    ...diagnostic,
    range: {
      start: { line, character: diagnostic.range.start.character },
      end: { line, character: diagnostic.range.end.character },
    },
  };
}

/** Batch tokenizer: line-independent, so it simply assembles per-line results. */
export function tokenize(source: string): LexResult {
  const lines = source.split(/\r?\n/);
  const tokens: Token[] = [];
  const diagnostics: ZornuxDiagnostic[] = [];

  for (let line = 0; line < lines.length; line++) {
    const relative = tokenizeLineRelative(lines[line]);
    for (const token of relative.tokens) tokens.push(shiftToken(token, line));
    for (const diagnostic of relative.diagnostics) diagnostics.push(shiftDiagnostic(diagnostic, line));
  }

  const last = lines.length - 1;
  const end: SrcPosition = { line: last, character: lines[last].length };
  tokens.push({ kind: TokenKind.EOF, value: '', range: { start: end, end: { ...end } } });
  return { tokens, diagnostics };
}
