/**
 * Workspace Trust — the pure model (Phase 20J, Work Item 1).
 *
 * Trust is decided by workspace LOCATION: a folder is trusted when it, or one of
 * its ancestors, is on the user's trusted list. A multi-root window is trusted
 * only when EVERY root is trusted (one untrusted root restricts the window). An
 * empty window (no folder open) has no untrusted content, so it is trusted.
 *
 * This module never touches disk, Electron, or the DOM — enforcement (main
 * process) and UI (renderer) both build on these rules, and every rule is
 * testable without a filesystem.
 */

export interface TrustStore {
  /** Absolute folder paths the user has trusted (normalized). */
  trustedFolders: string[];
}

export interface TrustState {
  /** Is the current workspace trusted (execution allowed)? */
  trusted: boolean;
  /**
   * Has the user made an explicit decision for the current workspace — either
   * it is trusted, or they chose to continue in Restricted Mode this session?
   * When false, the UI should prompt.
   */
  decided: boolean;
  /** The current workspace roots (empty = no folder open). */
  roots: string[];
  /** The persisted trusted-folder list. */
  trustedFolders: string[];
}

export const EMPTY_TRUST_STORE: TrustStore = { trustedFolders: [] };

/** Normalize a path for comparison: `/`-separators, no trailing slash, folded case where the FS is case-insensitive. */
export function normalizeTrustPath(path: string, caseInsensitive: boolean): string {
  let out = path.replace(/\\/g, '/').replace(/\/+$/, '');
  if (out === '') out = '/';
  return caseInsensitive ? out.toLowerCase() : out;
}

/** The parent folder of a path, or the path itself when it has no parent. */
export function parentFolder(path: string, caseInsensitive: boolean): string {
  const norm = normalizeTrustPath(path, caseInsensitive);
  const slash = norm.lastIndexOf('/');
  if (slash <= 0) return norm; // root or top-level — no meaningful parent
  return norm.slice(0, slash);
}

/** Is `path` inside (or equal to) `folder`? */
export function isPathWithin(path: string, folder: string, caseInsensitive: boolean): boolean {
  const p = normalizeTrustPath(path, caseInsensitive);
  const f = normalizeTrustPath(folder, caseInsensitive);
  return p === f || p.startsWith(f.endsWith('/') ? f : `${f}/`);
}

/** Is a single folder trusted — i.e. it or an ancestor is on the trusted list? */
export function isFolderTrusted(path: string, trustedFolders: string[], caseInsensitive: boolean): boolean {
  return trustedFolders.some((folder) => isPathWithin(path, folder, caseInsensitive));
}

/** Is the whole workspace trusted? Empty = trusted; multi-root requires ALL roots trusted. */
export function isWorkspaceTrusted(roots: string[], trustedFolders: string[], caseInsensitive: boolean): boolean {
  if (roots.length === 0) return true;
  return roots.every((root) => isFolderTrusted(root, trustedFolders, caseInsensitive));
}

/** Add a folder to the trusted list (normalized, deduped, no redundant descendants). */
export function addTrustedFolder(store: TrustStore, folder: string, caseInsensitive: boolean): TrustStore {
  const norm = normalizeTrustPath(folder, caseInsensitive);
  // If an ancestor already covers it, adding it is a no-op.
  if (isFolderTrusted(norm, store.trustedFolders, caseInsensitive)) return store;
  // Drop any existing entries that this new (broader) folder now covers.
  const kept = store.trustedFolders.filter((f) => !isPathWithin(f, norm, caseInsensitive));
  return { trustedFolders: [...kept, norm].sort() };
}

/**
 * Make `path` untrusted by removing every trusted entry that covers it (the
 * exact folder and any ancestor granting it trust). This is "Remove Trust".
 */
export function removeTrustCovering(store: TrustStore, path: string, caseInsensitive: boolean): TrustStore {
  const trustedFolders = store.trustedFolders.filter((f) => !isPathWithin(path, f, caseInsensitive));
  return { trustedFolders };
}

/** Parse an untrusted persisted blob into a valid TrustStore (bad input → empty). */
export function parseTrustStore(value: unknown, caseInsensitive: boolean): TrustStore {
  if (!value || typeof value !== 'object') return { ...EMPTY_TRUST_STORE };
  const raw = (value as { trustedFolders?: unknown }).trustedFolders;
  if (!Array.isArray(raw)) return { ...EMPTY_TRUST_STORE };
  const folders = raw
    .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
    .map((f) => normalizeTrustPath(f, caseInsensitive));
  return { trustedFolders: [...new Set(folders)].sort() };
}
