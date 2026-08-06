import type { WorkspaceInfo } from '../../shared/types';

/**
 * The set of open workspace roots (multi-root workspaces, Phase 5A). Pure and
 * Monaco/IPC-free so it is unit-testable; the WorkspaceModule owns loading and
 * event emission around it. The FIRST folder is the "primary" — the single-root
 * accessors (`currentWorkspace`/`currentFolder`) and existing consumers keep
 * working against it until they become multi-root aware in later phases.
 */
export class WorkspaceFolderSet {
  private folders: WorkspaceInfo[] = [];

  list(): WorkspaceInfo[] {
    return [...this.folders];
  }
  primary(): WorkspaceInfo | null {
    return this.folders[0] ?? null;
  }
  isEmpty(): boolean {
    return this.folders.length === 0;
  }
  has(root: string): boolean {
    const key = normalizeRoot(root);
    return this.folders.some((folder) => normalizeRoot(folder.root) === key);
  }

  /** Replace the whole set (e.g. "Open Folder"). */
  set(folders: WorkspaceInfo[]): void {
    this.folders = [];
    for (const folder of folders) this.upsert(folder);
  }

  /** Add a folder; returns false (and refreshes in place) if its root is already open. */
  add(folder: WorkspaceInfo): boolean {
    if (this.has(folder.root)) {
      this.upsert(folder);
      return false;
    }
    this.folders.push(folder);
    return true;
  }

  /** Refresh a folder's info in place (keeps its position), or append it if new. */
  upsert(folder: WorkspaceInfo): void {
    const key = normalizeRoot(folder.root);
    const index = this.folders.findIndex((f) => normalizeRoot(f.root) === key);
    if (index >= 0) this.folders[index] = folder;
    else this.folders.push(folder);
  }

  remove(root: string): boolean {
    const key = normalizeRoot(root);
    const before = this.folders.length;
    this.folders = this.folders.filter((folder) => normalizeRoot(folder.root) !== key);
    return this.folders.length !== before;
  }

  /** The open folder that owns `path` (longest matching root wins for nested roots). */
  containing(path: string): WorkspaceInfo | null {
    const target = normalizeRoot(path);
    let best: WorkspaceInfo | null = null;
    let bestLength = -1;
    for (const folder of this.folders) {
      const root = normalizeRoot(folder.root);
      const owns = target === root || target.startsWith(`${root}/`);
      if (owns && root.length > bestLength) {
        best = folder;
        bestLength = root.length;
      }
    }
    return best;
  }
}

/** Normalize a path for comparison: forward slashes, no trailing slash, lower-case. */
export function normalizeRoot(path: string): string {
  return path
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}
