/**
 * Extract the dotted identifier expression that ends at a given (1-based,
 * exclusive) column of a line — e.g. hovering `c` in `a.b.c` yields `a.b.c`.
 * Pure and Monaco-free so it is unit-testable; whitespace or operators around a
 * dot break the chain, so only a contiguous `ident(.ident)*` is returned.
 */
export function dottedExpressionAt(
  lineText: string,
  endColumnExclusive: number,
): { expression: string; startColumn: number } | null {
  if (endColumnExclusive <= 1) return null;
  const before = lineText.slice(0, endColumnExclusive - 1);
  const match = /[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.exec(before);
  if (!match) return null;
  return { expression: match[0], startColumn: endColumnExclusive - match[0].length };
}
