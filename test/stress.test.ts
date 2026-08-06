import { describe, expect, test } from './harness';
import {
  closeAll,
  closeOthers,
  closeTab,
  EMPTY_TABS,
  markDirty,
  openTab,
  pinTab,
  type TabsState,
} from '../src/renderer/editor/editorTabs';
import { fuzzyFilter } from '../src/renderer/productivity/fuzzy';
import { searchEverywhere, type SearchCandidate } from '../src/renderer/palette/searchEverywhere';
import { inStrip, openPanel, stripPanels, type PanelDescriptor, type PanelPreferences } from '../src/renderer/layout/panels';
import { computeMetrics } from '../src/renderer/metrics/metrics';

/**
 * Stress tests (Phase 20E). Push the pure models far past normal use and assert
 * they stay CORRECT and keep their invariants — no duplicates, no lost active
 * state, no unbounded output. Completion is the perf signal: an accidental O(n²)
 * or a runaway would hang the zero-dep harness.
 */

const entry = (i: number) => ({ uri: `file:///w/f${i}.zx`, path: `/w/f${i}.zx`, name: `f${i}.zx` });

/** The tab-model invariants that must hold no matter what sequence ran. */
function assertTabInvariants(state: TabsState): void {
  const uris = state.tabs.map((t) => t.uri);
  expect(new Set(uris).size).toBe(uris.length); // no duplicates
  const firstUnpinned = state.tabs.findIndex((t) => !t.pinned);
  if (firstUnpinned >= 0) {
    // No pinned tab appears after the first unpinned one (stable partition).
    expect(state.tabs.slice(firstUnpinned).some((t) => t.pinned)).toBe(false);
  }
  expect(state.activeUri === null || uris.includes(state.activeUri)).toBe(true);
}

describe('stress — editor tabs (20E)', () => {
  test('2000 opens keep every invariant and the last is active', () => {
    let state = EMPTY_TABS;
    for (let i = 0; i < 2000; i += 1) state = openTab(state, entry(i), { preview: false });
    expect(state.tabs).toHaveLength(2000);
    expect(state.activeUri).toBe(entry(1999).uri);
    assertTabInvariants(state);
  });

  test('a mixed pin/dirty/close storm drains cleanly to zero', () => {
    let state = EMPTY_TABS;
    for (let i = 0; i < 800; i += 1) state = openTab(state, entry(i), { preview: false });
    for (let i = 0; i < 800; i += 3) state = pinTab(state, entry(i).uri);
    for (let i = 1; i < 800; i += 2) state = markDirty(state, entry(i).uri, true);
    assertTabInvariants(state);
    // Close every active tab until empty — must never throw or wedge.
    let guard = 0;
    while (state.activeUri && guard < 5000) {
      state = closeTab(state, state.activeUri);
      assertTabInvariants(state);
      guard += 1;
    }
    expect(state.tabs.length).toBe(0);
  });

  test('closeOthers on 1000 tabs keeps only the target + pinned', () => {
    let state = EMPTY_TABS;
    for (let i = 0; i < 1000; i += 1) state = openTab(state, entry(i), { preview: false });
    for (let i = 0; i < 1000; i += 10) state = pinTab(state, entry(i).uri); // 100 pinned
    state = closeOthers(state, entry(7).uri);
    // 100 pinned + the target (not itself pinned) = 101.
    expect(state.tabs).toHaveLength(101);
    assertTabInvariants(state);
    expect(closeAll(state).tabs.every((t) => t.pinned)).toBe(true);
  });
});

describe('stress — fuzzy + search everywhere (20E)', () => {
  test('fuzzy over 20 000 items returns a ranked subset, best first', () => {
    const items = Array.from({ length: 20000 }, (_, i) => `src/module${i % 50}/file_${i}_config.zx`);
    const ranked = fuzzyFilter('config', items, (s) => s);
    expect(ranked.length).toBe(20000); // every item contains "config"
    // Scores are non-increasing.
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].match.score >= ranked[i].match.score).toBe(true);
    }
    expect(fuzzyFilter('zzzznotfound', items, (s) => s)).toHaveLength(0);
  });

  test('search-everywhere caps each section under a 10 000-candidate flood', () => {
    const candidates: SearchCandidate[] = Array.from({ length: 10000 }, (_, i) => ({
      category: (['commands', 'files', 'symbols', 'settings', 'views'] as const)[i % 5],
      id: `c${i}`,
      label: `build target ${i}`,
    }));
    const { groups } = searchEverywhere('build', candidates, 'all', 8);
    // Five categories, each capped at 8 → never floods the UI.
    expect(groups.length).toBe(5);
    for (const group of groups) expect(group.hits.length).toBeLessThan(9);
  });
});

describe('stress — panels + metrics (20E)', () => {
  test('500 panels resolve a strip without loss', () => {
    const descriptors: PanelDescriptor[] = Array.from({ length: 500 }, (_, i) => ({ id: `p${i}`, title: `Panel ${i}` }));
    let prefs: PanelPreferences = { order: [], hidden: [], opened: [], active: null };
    for (let i = 0; i < 500; i += 2) prefs = openPanel(prefs, `p${i}`); // open 250
    const strip = stripPanels(descriptors, prefs);
    expect(strip.length).toBe(250);
    expect(inStrip(prefs, 'p0')).toBe(true);
    expect(inStrip(prefs, 'p1')).toBe(false);
  });

  test('metrics on a 50 000-line file completes and stays bounded', () => {
    const huge = Array.from({ length: 50000 }, (_, i) => (i % 3 === 0 ? `# comment ${i}` : `say value_${i}`)).join('\n');
    const metrics = computeMetrics(huge, 'zornux');
    expect(metrics.total).toBe(50000);
    expect(metrics.code).toBeGreaterThan(0);
    expect(metrics.maintainability).toBeGreaterThan(-1); // clamped, never NaN
    expect(metrics.maintainability).toBeLessThan(101);
  });
});
