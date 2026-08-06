import { describe, expect, test } from './harness';
import { resizeSplit } from '../src/renderer/terminal/split';

describe('split divider geometry (resizeSplit)', () => {
  test('a zero drag leaves the weights unchanged', () => {
    const r = resizeSplit(300, 300, 1, 1, 0);
    expect(Math.round(r.before * 1000) / 1000).toBe(1);
    expect(Math.round(r.after * 1000) / 1000).toBe(1);
  });

  test('dragging right grows the left pane and shrinks the right, sum preserved', () => {
    const r = resizeSplit(300, 300, 1, 1, 60); // +60px onto a 600px pair
    expect(r.before > 1).toBe(true);
    expect(r.after < 1).toBe(true);
    expect(Math.round((r.before + r.after) * 1000) / 1000).toBe(2);
    // 360/600 of the total grow (2) = 1.2
    expect(Math.round(r.before * 100) / 100).toBe(1.2);
  });

  test('the left pane cannot shrink below the minimum', () => {
    const r = resizeSplit(300, 300, 1, 1, -1000, 60);
    // Clamped so the left pane is 60/600 of the pair.
    expect(Math.round(r.before * 100) / 100).toBe(0.2);
    expect(Math.round((r.before + r.after) * 1000) / 1000).toBe(2);
  });

  test('the right pane cannot shrink below the minimum', () => {
    const r = resizeSplit(300, 300, 1, 1, 1000, 60);
    expect(Math.round(r.after * 100) / 100).toBe(0.2);
  });

  test('preserves an uneven total grow weight', () => {
    const r = resizeSplit(200, 400, 1, 2, 100); // total grow 3, move to 300/600
    expect(Math.round((r.before + r.after) * 1000) / 1000).toBe(3);
    expect(Math.round(r.before * 100) / 100).toBe(1.5); // 3 * 300/600
  });

  test('degenerate zero-size pair is a no-op (avoids divide-by-zero)', () => {
    const r = resizeSplit(0, 0, 1, 1, 50);
    expect(r.before).toBe(1);
    expect(r.after).toBe(1);
  });
});
