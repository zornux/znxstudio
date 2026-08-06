/**
 * Unsaved-changes + session model (Phase 20J WI2) — the pure logic.
 *
 * Keeps the data-loss-prevention rules (which tabs are dirty, what a session
 * snapshot contains, which snapshot entries are restorable, how the autosave
 * setting resolves to a trigger mode) out of the DOM so they are testable
 * without an editor.
 */

import type { OpenEditor } from '../core/Contracts';

/** When changed documents are written back to disk. */
export type AutosaveMode = 'off' | 'afterDelay' | 'onFocusChange' | 'onWindowChange';

export const AUTOSAVE_MODES: readonly AutosaveMode[] = ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'];

/**
 * Resolve the effective autosave mode from settings, tolerating the legacy
 * boolean `files.autosave`. Explicit `files.autosaveMode` wins; otherwise the
 * boolean maps to afterDelay/off. Unknown strings fall back to off (never lose
 * the user's intent to a typo by silently saving).
 */
export function resolveAutosaveMode(rawMode: unknown, legacyEnabled: unknown): AutosaveMode {
  // A non-empty mode string is authoritative: valid → use it; invalid → off
  // (never fall through to "on" on a typo). Only when no mode is set do we honor
  // the legacy `files.autosave` boolean for backward compatibility.
  if (typeof rawMode === 'string' && rawMode.length > 0) {
    return (AUTOSAVE_MODES as readonly string[]).includes(rawMode) ? (rawMode as AutosaveMode) : 'off';
  }
  return legacyEnabled === true ? 'afterDelay' : 'off';
}

/** The paths of every tab with unsaved edits. */
export function dirtyPaths(editors: OpenEditor[]): string[] {
  return editors.filter((editor) => editor.dirty).map((editor) => editor.path);
}

export function hasUnsaved(editors: OpenEditor[]): boolean {
  return editors.some((editor) => editor.dirty);
}

/** A persisted tab: enough to reopen it and restore pin/active state. */
export interface SessionTab {
  path: string;
  pinned: boolean;
}

export interface SessionSnapshot {
  version: 1;
  tabs: SessionTab[];
  activePath: string | null;
}

export const SESSION_VERSION = 1 as const;

/**
 * Snapshot the open editors for session restore. Preview (peek) tabs are NOT
 * persisted — they are transient by design — so only permanent tabs return.
 */
export function serializeSession(editors: OpenEditor[]): SessionSnapshot {
  const tabs = editors.filter((editor) => !editor.preview).map((editor) => ({ path: editor.path, pinned: editor.pinned }));
  const active = editors.find((editor) => editor.active && !editor.preview);
  return { version: SESSION_VERSION, tabs, activePath: active ? active.path : null };
}

/** Parse an untrusted persisted session blob into a valid snapshot (bad input → empty). */
export function parseSession(value: unknown): SessionSnapshot {
  const empty: SessionSnapshot = { version: SESSION_VERSION, tabs: [], activePath: null };
  if (!value || typeof value !== 'object') return empty;
  const raw = value as { tabs?: unknown; activePath?: unknown };
  if (!Array.isArray(raw.tabs)) return empty;
  const tabs: SessionTab[] = [];
  for (const entry of raw.tabs) {
    if (entry && typeof entry === 'object' && typeof (entry as SessionTab).path === 'string') {
      tabs.push({ path: (entry as SessionTab).path, pinned: (entry as { pinned?: unknown }).pinned === true });
    }
  }
  const activePath = typeof raw.activePath === 'string' ? raw.activePath : null;
  return { version: SESSION_VERSION, tabs, activePath };
}

/**
 * The tabs from a snapshot that can actually be reopened — those whose files
 * still exist. A file deleted since last session is dropped silently rather than
 * erroring on restore. Returns the (filtered) tabs and the active path if it
 * survived.
 */
export function restorableSession(snapshot: SessionSnapshot, exists: (path: string) => boolean): { tabs: SessionTab[]; activePath: string | null } {
  const tabs = snapshot.tabs.filter((tab) => exists(tab.path));
  const active = snapshot.activePath && tabs.some((tab) => tab.path === snapshot.activePath) ? snapshot.activePath : null;
  return { tabs, activePath: active };
}

/** Add a workspace to the front of the recent list, deduped, capped. */
export function addRecentWorkspace(recent: unknown, root: string, limit = 10): string[] {
  const list = Array.isArray(recent) ? recent.filter((r): r is string => typeof r === 'string') : [];
  const deduped = [root, ...list.filter((r) => r !== root)];
  return deduped.slice(0, limit);
}

/**
 * Drop recent workspaces that no longer exist on disk (deleted or moved), given
 * the set of roots confirmed to still exist. Order is preserved. Pure so the
 * existence check (async IPC) stays in the caller and this stays unit-testable.
 */
export function pruneRecentWorkspaces(recent: unknown, existing: ReadonlySet<string>): string[] {
  const list = Array.isArray(recent) ? recent.filter((r): r is string => typeof r === 'string' && r.length > 0) : [];
  return list.filter((path) => existing.has(path));
}

/** A recent workspace shaped for display: leaf name + its parent directory. */
export interface RecentWorkspaceEntry {
  path: string;
  name: string;
  dir: string;
}

/**
 * Turn persisted recent-workspace roots into display entries (leaf folder name
 * + parent directory), tolerating junk in storage and capping the list. Pure so
 * the Welcome screen can render real recents without a DOM.
 */
export function formatRecentWorkspaces(recent: unknown, limit = 6): RecentWorkspaceEntry[] {
  const list = Array.isArray(recent) ? recent.filter((r): r is string => typeof r === 'string' && r.length > 0) : [];
  return list.slice(0, limit).map((path) => {
    const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
    const name = parts[parts.length - 1] ?? path;
    const dir = path.slice(0, Math.max(0, path.length - name.length)).replace(/[\\/]+$/, '');
    return { path, name, dir };
  });
}
