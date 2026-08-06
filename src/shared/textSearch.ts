/**
 * Pure text-search primitives (Phase 7A). Building a matcher and finding match
 * ranges on a line are separated from the file walk (which lives in the main
 * process), so the matching logic is unit-testable. No DOM/Node.
 */
export interface SearchOptions {
  isRegex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the search regex, or null for an empty query / invalid user regex. */
export function buildSearchRegex(query: string, options: SearchOptions): RegExp | null {
  if (!query) return null;
  let source = options.isRegex ? query : escapeRegExp(query);
  if (options.wholeWord) source = `\\b${source}\\b`;
  try {
    // `m` (multiline) is required so `^`/`$` anchor to LINE boundaries. Preview
    // matches per line, but replace runs against whole-file content; without `m`
    // an anchored pattern (e.g. `^import`) would preview N matches yet replace
    // only the first — a silent, incorrect Replace All. `m` makes both agree.
    return new RegExp(source, `gm${options.caseSensitive ? '' : 'i'}`);
  } catch {
    return null;
  }
}

/** All match ranges `[start, end)` for `regex` on `line` (zero-width safe). */
export function findMatches(line: string, regex: RegExp): [number, number][] {
  const ranges: [number, number][] = [];
  regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = regex.exec(line)) && guard < 10000) {
    guard += 1;
    ranges.push([match.index, match.index + match[0].length]);
    if (match[0].length === 0) regex.lastIndex += 1; // never spin on a zero-width match
  }
  return ranges;
}
