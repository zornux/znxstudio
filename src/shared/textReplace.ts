/**
 * Pure search-and-replace primitives (Phase 7B), paired with `textSearch`. The
 * regex is built by `buildSearchRegex`; here we expand the replacement (literal
 * in plain mode, `$1`-capable in regex mode) and apply it. Kept pure so both the
 * main-process disk apply and the renderer's open-editor apply share one
 * implementation. No DOM/Node.
 */

/**
 * Prepare a replacement string for `String.prototype.replace`. In plain mode
 * every `$` is escaped so it is inserted literally; in regex mode the string is
 * passed through so `$1`, `$&`, etc. work.
 */
export function expandReplacement(replacement: string, isRegex: boolean): string {
  return isRegex ? replacement : replacement.replace(/\$/g, '$$$$');
}

/** Count matches of a global regex in `text` (zero-width safe). */
export function countMatches(text: string, regex: RegExp): number {
  regex.lastIndex = 0;
  let count = 0;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = regex.exec(text)) && guard < 1_000_000) {
    guard += 1;
    count += 1;
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return count;
}

/** Apply `replacement` (already expanded) to every match; returns the new text + match count. */
export function replaceAll(content: string, regex: RegExp, replacement: string): { text: string; count: number } {
  const count = countMatches(content, regex);
  regex.lastIndex = 0;
  return { text: count === 0 ? content : content.replace(regex, replacement), count };
}

/** The replaced version of a single line (for preview). */
export function replaceLine(line: string, regex: RegExp, replacement: string): string {
  regex.lastIndex = 0;
  return line.replace(regex, replacement);
}
