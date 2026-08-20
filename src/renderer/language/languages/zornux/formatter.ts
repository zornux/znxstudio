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
import { formatMobileZornux, isMobileZornux } from './mobileSyntax';

export interface FormatOptions {
  tabSize: number;
  insertSpaces: boolean;
}

const OPENERS = new Set([TokenKind.BraceOpen, TokenKind.ParenOpen, TokenKind.BracketOpen]);
const CLOSERS = new Set([TokenKind.BraceClose, TokenKind.ParenClose, TokenKind.BracketClose]);

const BLOCK_OPENERS = new Set([
  'function', 'class', 'record', 'if', 'else', 'for', 'while', 'try', 'catch',
  'finally', 'test', 'module', 'service', 'database', 'table', 'repository',
  'policy', 'configuration', 'pipeline', 'step', 'job', 'task', 'transaction',
  'on', 'repeat', 'app', 'screen', 'controller', 'web',
]);

export function formatZornux(source: string, options: FormatOptions): string {
  // Leave whitespace-only documents untouched.
  if (source.trim() === '') return source;
  if (isMobileZornux(source)) return formatMobileZornux(source, options.tabSize, options.insertSpaces);

  const indentUnit = options.insertSpaces ? ' '.repeat(Math.max(1, options.tabSize)) : '\t';

  const { tokens } = tokenize(source);

  // Group real delimiter tokens by line (strings/comments are single tokens,
  // so their inner braces never appear here).
  const delimitersByLine = new Map<number, Token[]>();
  // Track `end`-keyword and block-opener keyword tokens by line.
  const endKeywordLines = new Set<number>();
  const blockOpenerLines = new Set<number>();
  for (const token of tokens) {
    if (OPENERS.has(token.kind) || CLOSERS.has(token.kind)) {
      const line = token.range.start.line;
      const list = delimitersByLine.get(line) ?? [];
      list.push(token);
      delimitersByLine.set(line, list);
    }
    if (token.kind === TokenKind.Keyword) {
      if (token.value === 'end') endKeywordLines.add(token.range.start.line);
      if (BLOCK_OPENERS.has(token.value)) blockOpenerLines.add(token.range.start.line);
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

    // `end` keyword on its own line dedents like a closing brace.
    const isEndLine = endKeywordLines.has(i) && trimmed === 'end';
    const dedent = leadingClosers + (isEndLine ? 1 : 0);

    const indent = Math.max(0, depth - dedent);
    output.push(indent > 0 ? indentUnit.repeat(indent) + trimmed : trimmed);

    let net = 0;
    for (const token of delimitersByLine.get(i) ?? []) net += OPENERS.has(token.kind) ? 1 : -1;
    // Block-opening keywords increase depth; `end` decreases it.
    if (blockOpenerLines.has(i) && !delimitersByLine.has(i)) net++;
    if (isEndLine) net--;
    depth = Math.max(0, depth + net);
  }

  while (output.length && output[output.length - 1] === '') output.pop();
  return `${output.join('\n')}\n`;
}
