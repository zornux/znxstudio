/**
 * UI zoom model (Phase 20J WI4) — pure.
 *
 * Zoom is expressed as an integer LEVEL (0 = 100%); each step multiplies the
 * page scale by 1.2, matching the familiar Ctrl +/- behavior. The level is
 * clamped to a sane range so the chrome can never be zoomed into uselessness.
 */

export const MIN_ZOOM_LEVEL = -5;
export const MAX_ZOOM_LEVEL = 8;
const STEP = 1.2;

export function clampZoomLevel(level: number): number {
  if (!Number.isFinite(level)) return 0;
  return Math.max(MIN_ZOOM_LEVEL, Math.min(MAX_ZOOM_LEVEL, Math.round(level)));
}

/** The webContents zoom FACTOR for a level (level 0 → 1.0). */
export function zoomFactorForLevel(level: number): number {
  return STEP ** clampZoomLevel(level);
}

/** A user-facing percentage label, e.g. level 1 → "120%". */
export function zoomPercentLabel(level: number): string {
  return `${Math.round(zoomFactorForLevel(level) * 100)}%`;
}
