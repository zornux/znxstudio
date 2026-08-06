import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure core for AI documentation (Phase 10E). Locates the declaration around the
 * cursor, frames provider-agnostic requests for a doc comment (per symbol) or a
 * Markdown overview (whole file), and formats the reply into a Zornux `#` comment
 * block. Kept pure so declaration-finding and comment formatting are unit-tested.
 */

const DECL_KEYWORDS = [
  'function',
  'class',
  'record',
  'repository',
  'service',
  'application',
  'migration',
  'database',
  'enum',
  'module',
];
const DECL_RE = new RegExp(`^(\\s*)(${DECL_KEYWORDS.join('|')})\\b\\s*([A-Za-z_]\\w*)?`);

/** The Zornux line-comment prefix. */
export const COMMENT_PREFIX = '#';

export interface Declaration {
  /** 0-based line of the declaration header. */
  headerLine: number;
  /** Leading whitespace of the header (doc comment matches it). */
  indent: string;
  kind: string;
  name: string;
  header: string;
}

/**
 * Find the declaration to document: the nearest declaration header at or above
 * the cursor. Returns null when the cursor is not inside/after any declaration.
 */
export function findDeclaration(text: string, cursorLine: number): Declaration | null {
  const lines = text.split('\n');
  const start = Math.max(0, Math.min(cursorLine, lines.length - 1));
  for (let i = start; i >= 0; i--) {
    const match = lines[i].match(DECL_RE);
    if (match) {
      return {
        headerLine: i,
        indent: match[1] ?? '',
        kind: match[2],
        name: match[3] ?? '',
        header: lines[i].trim(),
      };
    }
  }
  return null;
}

/** Extract the declaration's source (header … matching `end`), bounded by maxLines. */
export function extractBlock(text: string, decl: Declaration, maxLines = 60): string {
  const lines = text.split('\n');
  const endRe = new RegExp(`^${decl.indent}end\\b`);
  let end = lines.length - 1;
  for (let i = decl.headerLine + 1; i < lines.length; i++) {
    if (endRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  end = Math.min(end, decl.headerLine + maxLines - 1);
  return lines.slice(decl.headerLine, end + 1).join('\n');
}

/** Build a request for a concise doc comment describing one declaration. */
export function buildSymbolDocMessages(
  decl: Declaration,
  snippet: string,
  fileName: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You write documentation comments for the Zornux language (.zx).',
    'Given a declaration, write a concise doc comment: first a one-line summary of its purpose;',
    'for a function with parameters, add a short line per parameter and one for the return value.',
    'Output PLAIN text lines only — no comment markers (#), no code, no Markdown, no fences. Keep it brief.',
  ].join('\n');
  const where = fileName ? `File: ${fileName}\n` : '';
  const user = `${where}Document this ${decl.kind} ${decl.name}:\n\n${snippet}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

/** Build a request for whole-file Markdown documentation. */
export function buildFileDocMessages(
  code: string,
  fileName: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You write developer documentation for Zornux (.zx) source files.',
    'Produce Markdown: a short overview paragraph, then the key declarations (functions, classes, services, records) with what each does.',
    'Output Markdown only. Do not restate the entire source.',
  ].join('\n');
  const title = fileName ? `# ${fileName}\n\n` : '';
  const user = `${title}Document this file:\n\n${code}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

function stripFences(text: string): string {
  const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return fence ? fence[1] : text;
}

/**
 * Clean model doc text into plain lines: unwrap fences, drop any leading comment
 * markers the model added, collapse runs of blank lines, and trim.
 */
export function cleanDocText(raw: string): string {
  const unfenced = stripFences(raw.replace(/\r\n/g, '\n'));
  const lines = unfenced
    .split('\n')
    .map((line) => line.replace(/^\s*(#+|\/\/)\s?/, '').replace(/\s+$/, ''));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\s+$/, '');
}

/**
 * Format cleaned doc text into a Zornux comment block at the given indent, ready
 * to insert on the line above a declaration (ends with a newline).
 */
export function formatDocComment(docText: string, indent: string): string {
  const body = cleanDocText(docText)
    .split('\n')
    .map((line) => (line.length ? `${indent}${COMMENT_PREFIX} ${line}` : `${indent}${COMMENT_PREFIX}`))
    .join('\n');
  return `${body}\n`;
}

/** Whether the line directly above the header is already a doc comment. */
export function hasDocCommentAbove(text: string, headerLine: number): boolean {
  if (headerLine <= 0) return false;
  return new RegExp(`^\\s*${COMMENT_PREFIX}`).test(text.split('\n')[headerLine - 1] ?? '');
}
