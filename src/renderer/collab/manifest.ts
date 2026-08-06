/**
 * Workspace manifests (Phase 16A). A guest joining a session needs to know what
 * the host is sharing and whether its own copy matches. A manifest is the file
 * list with a content hash per file; the diff between two manifests says
 * exactly what must be fetched.
 *
 * The hash is FNV-1a: fast, dependency-free, and deterministic. It detects
 * accidental divergence between two copies of a workspace, which is what it is
 * for. It is NOT a security primitive and nothing here treats it as one.
 */

export interface ManifestEntry {
  /** Workspace-relative, always forward-slashed, so two machines agree. */
  path: string;
  hash: string;
  size: number;
}

export interface WorkspaceManifest {
  root: string;
  entries: ManifestEntry[];
}

export interface ManifestDiff {
  added: string[];
  changed: string[];
  removed: string[];
}

/** FNV-1a, 32-bit, over the UTF-16 code units of the text. */
export function hashContent(content: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    // hash *= 16777619, in 32-bit arithmetic that JavaScript will not round.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Workspace-relative and forward-slashed. Paths outside the root pass through as-is. */
export function relativePath(root: string, file: string): string {
  const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = file.replace(/\\/g, '/');
  const prefix = `${normalizedRoot}/`;
  return normalizedFile.toLowerCase().startsWith(prefix.toLowerCase()) ? normalizedFile.slice(prefix.length) : normalizedFile;
}

export function buildManifest(root: string, files: { path: string; content: string }[]): WorkspaceManifest {
  return {
    root,
    entries: files
      .map((file) => ({ path: relativePath(root, file.path), hash: hashContent(file.content), size: file.content.length }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

/**
 * What a guest holding `mine` must do to match the host's `theirs`. Comparison
 * is case-insensitive on the path, because one side may be on Windows.
 */
export function diffManifest(mine: WorkspaceManifest, theirs: WorkspaceManifest): ManifestDiff {
  const ours = new Map(mine.entries.map((entry) => [entry.path.toLowerCase(), entry]));
  const diff: ManifestDiff = { added: [], changed: [], removed: [] };

  for (const entry of theirs.entries) {
    const existing = ours.get(entry.path.toLowerCase());
    if (!existing) diff.added.push(entry.path);
    else if (existing.hash !== entry.hash) diff.changed.push(entry.path);
    ours.delete(entry.path.toLowerCase());
  }
  diff.removed = [...ours.values()].map((entry) => entry.path).sort((a, b) => a.localeCompare(b));
  return diff;
}

export function isInSync(diff: ManifestDiff): boolean {
  return diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0;
}

/** One line describing how far apart two copies are. */
export function diffSummary(diff: ManifestDiff): string {
  if (isInSync(diff)) return 'In sync with the host.';
  const parts: string[] = [];
  if (diff.added.length) parts.push(`${diff.added.length} to fetch`);
  if (diff.changed.length) parts.push(`${diff.changed.length} differ`);
  if (diff.removed.length) parts.push(`${diff.removed.length} not shared`);
  return parts.join(' · ');
}
