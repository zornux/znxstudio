/**
 * Editor tabs — the pure model (UX-5).
 *
 * The editor was single-document; this adds a real tab strip on top of the
 * DocumentManager (which stays the owner of the models + dirty state). The model
 * here is DOM-free and Monaco-free: it tracks open tabs, their order, and the
 * three states an enterprise IDE distinguishes —
 *
 *   • preview  — a "peek" tab (italic), opened by a single click in a picker or
 *                the explorer. There is at most ONE preview tab; opening another
 *                file as a preview REUSES its slot. Editing or an explicit open
 *                promotes it to permanent.
 *   • pinned   — kept to the left, never reused by a preview, closed only on
 *                purpose. "Close Others"/"Close All" spare pinned tabs.
 *   • dirty    — has unsaved edits (● in the UI). Editing also promotes preview.
 *
 * Ordering invariant: pinned tabs first (in their order), then the rest (in
 * theirs). Every operation re-partitions stably so the invariant always holds.
 */
export interface EditorTab {
  uri: string;
  path: string;
  name: string;
  dirty: boolean;
  pinned: boolean;
  preview: boolean;
}

export interface TabsState {
  tabs: EditorTab[];
  activeUri: string | null;
}

export const EMPTY_TABS: TabsState = { tabs: [], activeUri: null };

/** A newly-opened document's identity (the model already lives in DocumentManager). */
export interface TabEntry {
  uri: string;
  path: string;
  name: string;
}

/** Pinned tabs first (stable), then the rest (stable). */
function partition(tabs: EditorTab[]): EditorTab[] {
  return [...tabs.filter((tab) => tab.pinned), ...tabs.filter((tab) => !tab.pinned)];
}

/**
 * Open (or re-activate) a document. A single preview tab is reused when a new
 * preview open lands; a permanent open of an already-preview tab promotes it.
 */
export function openTab(state: TabsState, entry: TabEntry, options: { preview?: boolean } = {}): TabsState {
  const preview = options.preview ?? false;
  const existing = state.tabs.find((tab) => tab.uri === entry.uri);
  if (existing) {
    // Re-activate; a non-preview (explicit) open promotes an existing preview.
    const tabs = state.tabs.map((tab) =>
      tab.uri === entry.uri && !preview ? { ...tab, preview: false } : tab,
    );
    return { tabs, activeUri: entry.uri };
  }

  const tab: EditorTab = { ...entry, dirty: false, pinned: false, preview };
  if (preview) {
    const slot = state.tabs.findIndex((existingTab) => existingTab.preview && !existingTab.pinned);
    if (slot >= 0) {
      const tabs = [...state.tabs];
      tabs[slot] = tab;
      return { tabs: partition(tabs), activeUri: entry.uri };
    }
  }
  return { tabs: partition([...state.tabs, tab]), activeUri: entry.uri };
}

/** Make a tab active (no-op if it isn't open). */
export function setActive(state: TabsState, uri: string): TabsState {
  return state.tabs.some((tab) => tab.uri === uri) ? { ...state, activeUri: uri } : state;
}

/** Promote a preview tab to a permanent one (double-click / edit). */
export function makePermanent(state: TabsState, uri: string): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) => (tab.uri === uri ? { ...tab, preview: false } : tab)),
  };
}

/** Set/clear dirty. Becoming dirty also promotes a preview tab (you edited it). */
export function markDirty(state: TabsState, uri: string, dirty: boolean): TabsState {
  return {
    ...state,
    tabs: state.tabs.map((tab) =>
      tab.uri === uri ? { ...tab, dirty, preview: dirty ? false : tab.preview } : tab,
    ),
  };
}

/** Pin a tab (implies permanent) and float it into the pinned prefix. */
export function pinTab(state: TabsState, uri: string): TabsState {
  return {
    ...state,
    tabs: partition(
      state.tabs.map((tab) => (tab.uri === uri ? { ...tab, pinned: true, preview: false } : tab)),
    ),
  };
}

/** Unpin a tab; it drops to the start of the unpinned section. */
export function unpinTab(state: TabsState, uri: string): TabsState {
  return {
    ...state,
    tabs: partition(state.tabs.map((tab) => (tab.uri === uri ? { ...tab, pinned: false } : tab))),
  };
}

/** Toggle pinned. */
export function togglePin(state: TabsState, uri: string): TabsState {
  const tab = state.tabs.find((candidate) => candidate.uri === uri);
  if (!tab) return state;
  return tab.pinned ? unpinTab(state, uri) : pinTab(state, uri);
}

/**
 * Close a tab. When the active tab closes, focus moves to its right neighbor (or
 * left, if it was last) so the editor never lands on nothing while tabs remain.
 */
export function closeTab(state: TabsState, uri: string): TabsState {
  const index = state.tabs.findIndex((tab) => tab.uri === uri);
  if (index < 0) return state;
  const tabs = state.tabs.filter((tab) => tab.uri !== uri);
  let activeUri = state.activeUri;
  if (state.activeUri === uri) {
    const neighbor = tabs[index] ?? tabs[index - 1] ?? null;
    activeUri = neighbor ? neighbor.uri : null;
  }
  return { tabs, activeUri };
}

/** Close everything except the target and any pinned tabs. */
export function closeOthers(state: TabsState, uri: string): TabsState {
  const tabs = state.tabs.filter((tab) => tab.uri === uri || tab.pinned);
  const activeUri = tabs.some((tab) => tab.uri === state.activeUri)
    ? state.activeUri
    : tabs.find((tab) => tab.uri === uri)?.uri ?? tabs[0]?.uri ?? null;
  return { tabs, activeUri };
}

/** Close all unpinned tabs (pinned survive, as in every mainstream IDE). */
export function closeAll(state: TabsState): TabsState {
  const tabs = state.tabs.filter((tab) => tab.pinned);
  const activeUri = tabs.some((tab) => tab.uri === state.activeUri)
    ? state.activeUri
    : tabs[tabs.length - 1]?.uri ?? null;
  return { tabs, activeUri };
}
