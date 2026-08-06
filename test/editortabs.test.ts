import { describe, expect, test } from './harness';
import {
  closeAll,
  closeOthers,
  closeTab,
  EMPTY_TABS,
  makePermanent,
  markDirty,
  openTab,
  pinTab,
  togglePin,
  unpinTab,
  type TabsState,
} from '../src/renderer/editor/editorTabs';

const entry = (n: string) => ({ uri: `file:///w/${n}`, path: `/w/${n}`, name: n });

function openMany(names: string[], preview = false): TabsState {
  return names.reduce((state, name) => openTab(state, entry(name), { preview }), EMPTY_TABS);
}

describe('editor tabs — opening + preview', () => {
  test('permanent opens append and activate', () => {
    const state = openMany(['a.zx', 'b.zx']);
    expect(state.tabs.map((t) => t.name)).toEqual(['a.zx', 'b.zx']);
    expect(state.activeUri).toBe(entry('b.zx').uri);
    expect(state.tabs.every((t) => !t.preview)).toBe(true);
  });

  test('a preview open reuses the single preview slot instead of stacking', () => {
    let state = openTab(EMPTY_TABS, entry('a.zx'), { preview: true });
    state = openTab(state, entry('b.zx'), { preview: true });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].name).toBe('b.zx');
    expect(state.tabs[0].preview).toBe(true);
    expect(state.activeUri).toBe(entry('b.zx').uri);
  });

  test('a permanent open of an existing preview tab promotes it', () => {
    let state = openTab(EMPTY_TABS, entry('a.zx'), { preview: true });
    state = openTab(state, entry('a.zx'), { preview: false });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0].preview).toBe(false);
  });

  test('a preview tab coexists with permanent tabs and only it is reused', () => {
    let state = openMany(['a.zx']); // permanent
    state = openTab(state, entry('b.zx'), { preview: true });
    state = openTab(state, entry('c.zx'), { preview: true });
    expect(state.tabs.map((t) => t.name)).toEqual(['a.zx', 'c.zx']);
  });
});

describe('editor tabs — dirty + permanence', () => {
  test('editing a preview tab promotes it to permanent', () => {
    let state = openTab(EMPTY_TABS, entry('a.zx'), { preview: true });
    state = markDirty(state, entry('a.zx').uri, true);
    expect(state.tabs[0].preview).toBe(false);
    expect(state.tabs[0].dirty).toBe(true);
  });

  test('makePermanent clears the preview flag without touching dirty', () => {
    let state = openTab(EMPTY_TABS, entry('a.zx'), { preview: true });
    state = makePermanent(state, entry('a.zx').uri);
    expect(state.tabs[0].preview).toBe(false);
    expect(state.tabs[0].dirty).toBe(false);
  });
});

describe('editor tabs — pinning + order', () => {
  test('pinning floats a tab to the pinned prefix and makes it permanent', () => {
    let state = openMany(['a.zx', 'b.zx', 'c.zx']);
    state = pinTab(state, entry('c.zx').uri);
    expect(state.tabs.map((t) => t.name)).toEqual(['c.zx', 'a.zx', 'b.zx']);
    expect(state.tabs[0].pinned).toBe(true);
    expect(state.tabs[0].preview).toBe(false);
  });

  test('unpin drops a tab back to the start of the unpinned section', () => {
    let state = openMany(['a.zx', 'b.zx']);
    state = pinTab(state, entry('b.zx').uri);
    state = unpinTab(state, entry('b.zx').uri);
    expect(state.tabs.map((t) => t.name)).toEqual(['b.zx', 'a.zx']);
    expect(state.tabs.every((t) => !t.pinned)).toBe(true);
  });

  test('togglePin flips state', () => {
    let state = openMany(['a.zx']);
    state = togglePin(state, entry('a.zx').uri);
    expect(state.tabs[0].pinned).toBe(true);
    state = togglePin(state, entry('a.zx').uri);
    expect(state.tabs[0].pinned).toBe(false);
  });
});

describe('editor tabs — closing', () => {
  test('closing the active tab focuses the right neighbor', () => {
    let state = openMany(['a.zx', 'b.zx', 'c.zx']);
    state = closeTab({ ...state, activeUri: entry('b.zx').uri }, entry('b.zx').uri);
    expect(state.tabs.map((t) => t.name)).toEqual(['a.zx', 'c.zx']);
    expect(state.activeUri).toBe(entry('c.zx').uri);
  });

  test('closing the last active tab falls back to the left neighbor', () => {
    let state = openMany(['a.zx', 'b.zx']);
    state = closeTab(state, entry('b.zx').uri); // b was active (last opened)
    expect(state.activeUri).toBe(entry('a.zx').uri);
  });

  test('closing the only tab clears the active uri', () => {
    let state = openMany(['a.zx']);
    state = closeTab(state, entry('a.zx').uri);
    expect(state.tabs).toHaveLength(0);
    expect(state.activeUri).toBeNull();
  });

  test('close others keeps the target and any pinned tabs', () => {
    let state = openMany(['a.zx', 'b.zx', 'c.zx']);
    state = pinTab(state, entry('a.zx').uri);
    state = closeOthers(state, entry('c.zx').uri);
    expect(state.tabs.map((t) => t.name).sort()).toEqual(['a.zx', 'c.zx']);
  });

  test('close all spares pinned tabs', () => {
    let state = openMany(['a.zx', 'b.zx']);
    state = pinTab(state, entry('a.zx').uri);
    state = closeAll(state);
    expect(state.tabs.map((t) => t.name)).toEqual(['a.zx']);
  });
});
