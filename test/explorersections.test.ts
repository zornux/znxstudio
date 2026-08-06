import { describe, expect, test } from './harness';
import { isCollapsed, setCollapsed, sortSections } from '../src/renderer/explorer/explorerSections';

describe('explorer sections — ordering', () => {
  test('sorts by order, ties broken by id, and does not mutate the input', () => {
    const input = [
      { id: 'bookmarks', order: 30 },
      { id: 'files', order: 100 },
      { id: 'openEditors', order: 10 },
      { id: 'outline', order: 20 },
    ];
    const sorted = sortSections(input);
    expect(sorted.map((s) => s.id)).toEqual(['openEditors', 'outline', 'bookmarks', 'files']);
    expect(input[0].id).toBe('bookmarks'); // original order preserved
  });

  test('equal orders fall back to id order', () => {
    const sorted = sortSections([
      { id: 'b', order: 10 },
      { id: 'a', order: 10 },
    ]);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b']);
  });
});

describe('explorer sections — collapse state', () => {
  test('persisted value wins over the fallback', () => {
    expect(isCollapsed({}, 'outline', false)).toBe(false);
    expect(isCollapsed({}, 'outline', true)).toBe(true);
    expect(isCollapsed({ outline: false }, 'outline', true)).toBe(false);
  });

  test('setCollapsed returns a new map with the flag flipped', () => {
    const next = setCollapsed({ outline: true }, 'bookmarks', true);
    expect(next).toEqual({ outline: true, bookmarks: true });
    expect(setCollapsed(next, 'outline', false).outline).toBe(false);
  });
});
