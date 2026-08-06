/**
 * Pure multi-cursor helpers (Phase 7C). Occurrence-finding, word-under-caret and
 * status formatting are separated from Monaco so they're unit-testable;
 * MultiCursorModule maps the 0-based ranges these return onto real editor
 * selections. No DOM / no Monaco here — just strings and numbers.
 */
import { buildSearchRegex, findMatches, type SearchOptions } from '../../shared/textSearch';
import type { CursorSelection } from '../core/Contracts';

/** Characters that make up an identifier-like "word" (matches the search word-boundary set). */
const WORD_CHAR = /[A-Za-z0-9_$]/;

/**
 * The identifier-like word under a 0-based caret, as a 0-based selection, or
 * null when the caret is not adjacent to a word (e.g. on whitespace). A caret at
 * either edge of a word selects that word — matching editor double-click intent.
 */
export function wordRangeAt(text: string, line: number, character: number): CursorSelection | null {
  const lines = text.split('\n');
  if (line < 0 || line >= lines.length) return null;
  const source = lines[line];
  const caret = Math.max(0, Math.min(character, source.length));

  let start = caret;
  let end = caret;
  while (start > 0 && WORD_CHAR.test(source[start - 1])) start -= 1;
  while (end < source.length && WORD_CHAR.test(source[end])) end += 1;
  if (start === end) return null; // caret not touching a word

  return { startLine: line, startCharacter: start, endLine: line, endCharacter: end };
}

/**
 * Every occurrence of `target` across `text`, as 0-based single-line selection
 * ranges (one per match). Line-oriented, so a multi-line target finds nothing —
 * the multi-cursor UI falls back gracefully. Reuses the 7A search primitives so
 * options (case / whole-word / regex) behave exactly like Find in Files.
 */
export function findOccurrences(
  text: string,
  target: string,
  options: SearchOptions = {},
): CursorSelection[] {
  const regex = buildSearchRegex(target, options);
  if (!regex) return [];
  const selections: CursorSelection[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    for (const [start, end] of findMatches(lines[i], regex)) {
      if (end === start) continue; // never place a cursor on a zero-width match
      selections.push({ startLine: i, startCharacter: start, endLine: i, endCharacter: end });
    }
  }
  return selections;
}

/**
 * Compact caret / selection readout for the status bar. `primary` is the 0-based
 * position of the primary cursor; the notes summarise extra cursors and total
 * selected characters (VS Code style).
 */
export function formatCursorStatus(
  primary: { line: number; character: number },
  cursorCount: number,
  selectedChars: number,
): string {
  const position = `Ln ${primary.line + 1}, Col ${primary.character + 1}`;
  const notes: string[] = [];
  if (cursorCount > 1) notes.push(`${cursorCount} cursors`);
  if (selectedChars > 0) notes.push(`${selectedChars} selected`);
  return notes.length ? `${position}  (${notes.join(', ')})` : position;
}
