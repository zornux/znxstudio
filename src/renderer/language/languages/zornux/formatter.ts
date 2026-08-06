/**
 * Zornux formatter — Monaco-free and platform-API-free.
 *
 * A token-aware re-indenter (not a full pretty-printer): it never reorders or
 * rewrites tokens, so it can't corrupt code. It:
 *   - re-indents each line by delimiter depth ({} () []), counting only real
 *     delimiter tokens from the lexer (so braces inside strings/comments are
 *     ignored),
 *   - trims trailing whitespace,
 *   - collapses runs of blank lines to a single blank,
 *   - guarantees exactly one trailing newline.
 *
 * It is deterministic and idempotent. The real Zornux formatter (expression
 * spacing, alignment, etc.) can replace this file behind the same provider.
 */
import { tokenize, TokenKind, type Token } from './lexer';

export interface FormatOptions {
  tabSize: number;
  insertSpaces: boolean;
}

const OPENERS = new Set([TokenKind.BraceOpen, TokenKind.ParenOpen, TokenKind.BracketOpen]);
const CLOSERS = new Set([TokenKind.BraceClose, TokenKind.ParenClose, TokenKind.BracketClose]);

export function formatZornux(source: string, options: FormatOptions): string {
  // Leave whitespace-only documents untouched.
  if (source.trim() === '') return source;

  const indentUnit = options.insertSpaces ? ' '.repeat(Math.max(1, options.tabSize)) : '\t';

  // Group real delimiter tokens by line (strings/comments are single tokens,
  // so their inner braces never appear here).
  const delimitersByLine = new Map<number, Token[]>();
  for (const token of tokenize(source).tokens) {
    if (OPENERS.has(token.kind) || CLOSERS.has(token.kind)) {
      const line = token.range.start.line;
      const list = delimitersByLine.get(line) ?? [];
      list.push(token);
      delimitersByLine.set(line, list);
    }
  }

  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let depth = 0;
  let blankRun = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed === '') {
      blankRun++;
      if (blankRun === 1) output.push('');
      continue;
    }
    blankRun = 0;

    // Leading closers dedent the current line.
    let leadingClosers = 0;
    for (const ch of trimmed) {
      if (ch === '}' || ch === ')' || ch === ']') leadingClosers++;
      else break;
    }

    const indent = Math.max(0, depth - leadingClosers);
    output.push(indent > 0 ? indentUnit.repeat(indent) + trimmed : trimmed);

    let net = 0;
    for (const token of delimitersByLine.get(i) ?? []) net += OPENERS.has(token.kind) ? 1 : -1;
    depth = Math.max(0, depth + net);
  }

  while (output.length && output[output.length - 1] === '') output.pop();
  return `${output.join('\n')}\n`;
}
