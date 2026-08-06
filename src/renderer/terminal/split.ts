/**
 * Pure geometry for the split-pane divider. Given the current pixel sizes and
 * flex-grow weights of the two panes flanking a divider, plus how far the
 * pointer moved, return the new flex-grow weights — clamped so neither pane
 * shrinks below `min` pixels. Kept DOM-free so it is unit-testable off Electron.
 */
export function resizeSplit(
  sizeBefore: number,
  sizeAfter: number,
  growBefore: number,
  growAfter: number,
  delta: number,
  min = 60,
): { before: number; after: number } {
  const totalPx = sizeBefore + sizeAfter;
  const totalGrow = growBefore + growAfter;
  if (totalPx <= 0 || totalGrow <= 0) return { before: growBefore, after: growAfter };
  // Clamp so both panes keep at least `min` px (and never invert).
  const clampedMin = Math.min(min, totalPx / 2);
  let newBefore = sizeBefore + delta;
  newBefore = Math.max(clampedMin, Math.min(totalPx - clampedMin, newBefore));
  const before = totalGrow * (newBefore / totalPx);
  return { before, after: totalGrow - before };
}
