import { describe, expect, test } from './harness';
import {
  MAX_ZOOM_LEVEL,
  MIN_ZOOM_LEVEL,
  clampZoomLevel,
  zoomFactorForLevel,
  zoomPercentLabel,
} from '../src/shared/zoom';

describe('zoom model (Phase 20J WI4)', () => {
  test('level 0 is 100%', () => {
    expect(zoomFactorForLevel(0)).toBe(1);
    expect(zoomPercentLabel(0)).toBe('100%');
  });

  test('each step scales by 1.2', () => {
    expect(zoomPercentLabel(1)).toBe('120%');
    expect(zoomPercentLabel(-1)).toBe('83%');
  });

  test('levels clamp to the supported range', () => {
    expect(clampZoomLevel(999)).toBe(MAX_ZOOM_LEVEL);
    expect(clampZoomLevel(-999)).toBe(MIN_ZOOM_LEVEL);
    expect(clampZoomLevel(2.4)).toBe(2);
    expect(clampZoomLevel(Number.NaN)).toBe(0);
  });

  test('the zoom factor is always positive', () => {
    for (let level = MIN_ZOOM_LEVEL; level <= MAX_ZOOM_LEVEL; level += 1) {
      expect(zoomFactorForLevel(level) > 0).toBe(true);
    }
  });
});
