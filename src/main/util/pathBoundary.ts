import { realpathSync } from 'node:fs';
import { dirname, normalize, resolve, sep } from 'node:path';

/** True when `target` is `root` itself or nested inside it (lexical check). */
function within(root: string, target: string): boolean {
  const r = normalize(root);
  const base = r.endsWith(sep) ? r : r + sep;
  return target === r || target.startsWith(base);
}

/**
 * Confine a renderer-supplied filesystem path to the open workspace roots —
 * defense-in-depth for the `fs:*` IPC surface so a renderer-side compromise
 * (a CSP bypass, or a future in-process extension) cannot read or write files
 * outside the project the user opened (SSH keys, shell rc files, autostart, …).
 *
 * Returns the resolved absolute path when it is inside a root, or `null` when it
 * escapes. When no workspace is open (`roots` empty) there is no project context
 * to confine against and nothing untrusted is loaded, so access is allowed.
 * Rejects empty/non-string input and NUL-byte injection. When the target exists,
 * a `realpath` re-check rejects symlinks that resolve outside every root.
 */
export function confineToRoots(rawPath: string, roots: readonly string[]): string | null {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\0')) return null;
  const target = normalize(resolve(rawPath));
  if (roots.length === 0) return target; // no workspace context to confine to
  if (!roots.some((root) => within(root, target))) return null;
  try {
    const real = normalize(realpathSync(target));
    return roots.some((root) => within(root, real)) ? real : null;
  } catch {
    // Target does not exist yet (a new-file write). Resolve the nearest
    // existing ancestor to catch symlinked parent directories that escape
    // workspace roots, rather than relying on the lexical check alone.
    let ancestor = dirname(target);
    while (ancestor !== dirname(ancestor)) {
      try {
        const realAncestor = normalize(realpathSync(ancestor));
        if (roots.some((root) => within(root, realAncestor))) return target;
        if (roots.some((root) => within(realAncestor, root))) return target;
        return null;
      } catch {
        ancestor = dirname(ancestor);
      }
    }
    return target;
  }
}
