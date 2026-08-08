import { describe, expect, test } from './harness';
import {
  curateActivityBar,
  DEFAULT_ACTIVITY,
  EMPTY_CURATION,
  hideItem,
  movePinned,
  pinItem,
  unhideItem,
  unpinItem,
  type ActivityCuration,
} from '../src/renderer/layout/activityBar';
import { groupWorkspaces, workspaceGroupOf } from '../src/renderer/layout/viewMenu';

const REGISTERED = [
  'explorer',
  'search',
  'scm',
  'run-debug',
  'extensions',
  'ai-chat',
  'security',
  'performance',
  'testing',
  'database',
  'deploy',
  'collab',
];

describe('activity bar — curation', () => {
  test('with no customization the defaults are pinned and the rest overflow, grouped', () => {
    const layout = curateActivityBar(REGISTERED, EMPTY_CURATION);
    expect(layout.pinned).toEqual([...DEFAULT_ACTIVITY]);
    // Overflow groups appear in GROUP_ORDER, each carrying its items.
    expect(layout.overflow.map((g) => g.group)).toEqual(['Security', 'Performance', 'Database', 'Cloud', 'Collaboration']);
    expect(layout.overflow[0]).toEqual({ group: 'Security', ids: ['security'] });
  });

  test('a custom pinned order wins over the defaults', () => {
    const curation: ActivityCuration = { pinned: ['search', 'explorer', 'security'], hidden: [] };
    const layout = curateActivityBar(REGISTERED, curation);
    expect(layout.pinned).toEqual(['search', 'explorer', 'security']);
    // security is now pinned, so it leaves the overflow.
    expect(layout.overflow.find((g) => g.group === 'Security')).toBeFalsy();
  });

  test('hidden items appear in neither the bar nor the overflow', () => {
    const curation: ActivityCuration = { pinned: [], hidden: ['performance', 'collab'] };
    const layout = curateActivityBar(REGISTERED, curation);
    expect(layout.overflow.some((g) => g.ids.includes('performance'))).toBe(false);
    expect(layout.hidden).toEqual(['performance', 'collab']);
  });

  test('a stale preference for an unregistered item is ignored', () => {
    const curation: ActivityCuration = { pinned: ['explorer', 'ghost'], hidden: ['also-ghost'] };
    const layout = curateActivityBar(REGISTERED, curation);
    expect(layout.pinned).toEqual(['explorer']);
    expect(layout.hidden).toEqual([]);
  });

  test('an unmapped id falls into an "Other" group at the end', () => {
    const layout = curateActivityBar([...REGISTERED, 'mystery'], EMPTY_CURATION);
    const other = layout.overflow.find((g) => g.group === 'Other');
    expect(other?.ids).toEqual(['mystery']);
    expect(layout.overflow[layout.overflow.length - 1].group).toBe('Other');
  });
});

describe('activity bar — curation transitions', () => {
  test('pin adds to the bar and clears any hidden flag', () => {
    const next = pinItem({ pinned: [], hidden: ['security'] }, 'security');
    expect(next.pinned).toContain('security');
    expect(next.hidden).toEqual([]);
  });

  test('unpin from the defaults materializes them minus the item', () => {
    const next = unpinItem(EMPTY_CURATION, 'search');
    expect(next.pinned).toEqual(['explorer', 'scm', 'run-debug', 'testing', 'extensions', 'ai-chat']);
  });

  test('hide removes from pinned and records it; unhide reverses', () => {
    const hidden = hideItem({ pinned: ['explorer', 'security'], hidden: [] }, 'security');
    expect(hidden.pinned).toEqual(['explorer']);
    expect(hidden.hidden).toEqual(['security']);
    expect(unhideItem(hidden, 'security').hidden).toEqual([]);
  });

  test('movePinned swaps neighbors and clamps at the ends', () => {
    const curation: ActivityCuration = { pinned: ['a', 'b', 'c'], hidden: [] };
    expect(movePinned(curation, 'b', -1).pinned).toEqual(['b', 'a', 'c']);
    expect(movePinned(curation, 'c', 1).pinned).toEqual(['a', 'b', 'c']); // already last
    expect(movePinned(curation, 'a', -1).pinned).toEqual(['a', 'b', 'c']); // already first
  });
});

describe('view menu — workspace grouping (UX-3)', () => {
  test('defaults group under Core; others by workspace, Core first and Other last', () => {
    const groups = groupWorkspaces([
      { id: 'explorer', label: 'Explorer' },
      { id: 'ai-chat', label: 'AI Chat' },
      { id: 'security', label: 'Security' },
      { id: 'search', label: 'Search' },
      { id: 'mystery', label: 'Mystery' },
    ]);
    expect(groups[0].group).toBe('Core');
    expect(groups[0].items.map((i) => i.id)).toEqual(['explorer', 'ai-chat', 'search']);
    expect(groups[groups.length - 1].group).toBe('Other');
    expect(workspaceGroupOf('scm')).toBe('Core');
    expect(workspaceGroupOf('database')).toBe('Database');
  });
});
