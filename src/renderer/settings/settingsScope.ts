/**
 * Settings scope model — the pure logic for user-vs-workspace settings.
 *
 * ZnxStudio persists one global `settings.json` (the "user" scope). A workspace
 * can override any setting for just that folder; those overrides live in a
 * folder-local, VCS-shareable `<root>/.znxstudio/settings.json` — a flat
 * `{ [key]: value }` map, so a project can commit its editor/compiler preferences
 * and everyone who opens it inherits them.
 *
 * Precedence for the effective value of a key: workspace override → user value →
 * caller fallback. A handful of keys are inherently global (the recent-workspaces
 * list, and the legacy global-override bucket) and are never workspace-scoped.
 *
 * These functions are pure and immutable so the SettingsModule can resolve and
 * mutate scopes without a DOM or IPC, and the behaviour is unit-tested directly.
 * The module owns loading/writing the folder file; this module only shapes data.
 */

import type { SettingScope } from '../core/Contracts';
import { normalizeRoot } from '../workspace/workspaceFolders';

export type { SettingScope };

/** The file (relative to a workspace root) that holds its settings overrides. */
export const WORKSPACE_SETTINGS_DIR = '.znxstudio';
export const WORKSPACE_SETTINGS_FILE = 'settings.json';

/**
 * Legacy (UX-021) global store key that held `{ [root]: { [key]: value } }`. Kept
 * only so the module can migrate old per-user overrides into the folder file.
 */
export const LEGACY_OVERRIDES_KEY = 'workbench.workspaceOverrides';

/** Keys that are always user-global and can never be overridden per-workspace. */
export const NON_OVERRIDABLE_KEYS: ReadonlySet<string> = new Set<string>([
  LEGACY_OVERRIDES_KEY,
  'workbench.recentWorkspaces',
]);

/** A flat per-workspace override map: setting key → value. */
export type WorkspaceStore = Record<string, unknown>;
type UserStore = Record<string, unknown>;

/** Whether a key may be overridden per-workspace (the meta/global keys may not). */
export function isOverridable(key: string): boolean {
  return !NON_OVERRIDABLE_KEYS.has(key);
}

/** Sanitize raw folder-file JSON into a trusted override map (drops junk + globals). */
export function sanitizeWorkspaceSettings(raw: unknown): WorkspaceStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: WorkspaceStore = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (isOverridable(key) && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The effective value of a key: workspace override (if the open folder has one and
 * the key is overridable) → user value → fallback.
 */
export function getEffective<T>(user: UserStore, ws: WorkspaceStore, key: string, fallback: T): T {
  if (isOverridable(key) && key in ws) return ws[key] as T;
  return (key in user ? user[key] : fallback) as T;
}

/** The raw user-scope value (ignores any workspace override); undefined if unset. */
export function getUserValue<T>(user: UserStore, key: string): T | undefined {
  return (key in user ? user[key] : undefined) as T | undefined;
}

/** Does an overriding value exist for this key in the open workspace? */
export function hasOverride(ws: WorkspaceStore, key: string): boolean {
  return isOverridable(key) && key in ws;
}

/** The keys the open workspace overrides (for form badges). */
export function overriddenKeys(ws: WorkspaceStore): Set<string> {
  return new Set(Object.keys(ws).filter(isOverridable));
}

/** A new override map with `key`=`value`. Immutable. Refuses non-overridable keys. */
export function withOverride(ws: WorkspaceStore, key: string, value: unknown): WorkspaceStore {
  if (!isOverridable(key)) throw new Error(`setting ${key} cannot be workspace-scoped`);
  return { ...ws, [key]: value };
}

/** A new override map with `key` removed. Immutable. */
export function withoutOverride(ws: WorkspaceStore, key: string): WorkspaceStore {
  if (!(key in ws)) return ws;
  const next = { ...ws };
  delete next[key];
  return next;
}

/** The effective settings for display/seeding: user overlaid with the workspace overrides. */
export function effectiveSettings(user: UserStore, ws: WorkspaceStore): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...user };
  delete merged[LEGACY_OVERRIDES_KEY];
  for (const [key, value] of Object.entries(ws)) if (isOverridable(key)) merged[key] = value;
  return merged;
}

/* ----- legacy migration (UX-021 global byRoot → folder file) ----- */

/** The legacy per-user override bucket for a root, sanitized (empty if none). */
export function legacyOverridesFor(user: UserStore, root: string): WorkspaceStore {
  const raw = user[LEGACY_OVERRIDES_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const bucket = (raw as Record<string, unknown>)[normalizeRoot(root)];
  return sanitizeWorkspaceSettings(bucket);
}

/**
 * A new legacy-overrides map with `root`'s bucket removed (prune after migrating).
 * Returns the value to assign back to `user[LEGACY_OVERRIDES_KEY]`, or undefined
 * when nothing legacy remains (the caller should then delete the key).
 */
export function withoutLegacyRoot(user: UserStore, root: string): Record<string, WorkspaceStore> | undefined {
  const raw = user[LEGACY_OVERRIDES_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const map: Record<string, WorkspaceStore> = {};
  const norm = normalizeRoot(root);
  for (const [key, bucket] of Object.entries(raw as Record<string, unknown>)) {
    if (key !== norm && bucket && typeof bucket === 'object' && !Array.isArray(bucket)) {
      map[key] = bucket as WorkspaceStore;
    }
  }
  return Object.keys(map).length === 0 ? undefined : map;
}
