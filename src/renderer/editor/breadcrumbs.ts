/**
 * Pure breadcrumb helpers (Phase 7D). Computing the symbol trail under the caret
 * and the workspace-relative path is separated from the DOM so it's unit-testable;
 * BreadcrumbsModule renders the returned segments. No DOM / no Monaco here.
 */
import type { DocumentSymbol, Position, Range } from '../language/api';

export interface BreadcrumbSegment {
  name: string;
  kind: string;
  /** 0-based navigation target — the symbol's selection-range start. */
  line: number;
  character: number;
}

/** Is `pos` within `range` (inclusive, 0-based)? */
function within(range: Range, pos: Position): boolean {
  const afterStart =
    pos.line > range.start.line ||
    (pos.line === range.start.line && pos.character >= range.start.character);
  const beforeEnd =
    pos.line < range.end.line ||
    (pos.line === range.end.line && pos.character <= range.end.character);
  return afterStart && beforeEnd;
}

function toSegment(symbol: DocumentSymbol): BreadcrumbSegment {
  return {
    name: symbol.name,
    kind: symbol.kind,
    line: symbol.selectionRange.start.line,
    character: symbol.selectionRange.start.character,
  };
}

/**
 * The chain of symbols (outermost → innermost) whose full range contains `pos`.
 * Descends one level at a time, so a caret inside a method yields
 * `[Class, method]`.
 */
export function symbolTrailAt(symbols: DocumentSymbol[], pos: Position): BreadcrumbSegment[] {
  const trail: BreadcrumbSegment[] = [];
  let level: DocumentSymbol[] = symbols;
  for (;;) {
    const match: DocumentSymbol | undefined = level.find((symbol) => within(symbol.range, pos));
    if (!match) break;
    trail.push(toSegment(match));
    if (!match.children || match.children.length === 0) break;
    level = match.children;
  }
  return trail;
}

/**
 * The sibling list at breadcrumb `depth` (0 = the top level), for the segment
 * dropdown. Follows the trail down `depth` steps and returns that level's
 * symbols; empty if the trail doesn't resolve.
 */
export function symbolsAtDepth(
  symbols: DocumentSymbol[],
  trail: BreadcrumbSegment[],
  depth: number,
): DocumentSymbol[] {
  let level: DocumentSymbol[] = symbols;
  for (let i = 0; i < depth; i += 1) {
    const segment = trail[i];
    const match = level.find(
      (symbol) =>
        symbol.name === segment.name &&
        symbol.selectionRange.start.line === segment.line &&
        symbol.selectionRange.start.character === segment.character,
    );
    if (!match || !match.children) return [];
    level = match.children;
  }
  return level;
}

/**
 * Workspace-relative path segments for the leading breadcrumbs. Falls back to
 * just the basename when the file is outside the workspace root. Slash- and
 * case-insensitive on the root prefix (Windows-friendly).
 */
export function breadcrumbFilePath(root: string | null, path: string): string[] {
  const normalizedPath = path.replace(/\\/g, '/');
  if (root) {
    const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (normalizedPath.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
      return normalizedPath.slice(normalizedRoot.length + 1).split('/').filter(Boolean);
    }
  }
  const base = normalizedPath.split('/').pop();
  return base ? [base] : [];
}
