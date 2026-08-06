/**
 * Minimal, OS-agnostic path helpers for the renderer (which has no Node `path`).
 * They preserve the separator style already present in the path so Windows
 * (`\`) and POSIX (`/`) workspace roots both work.
 */

/** The separator used by `path` (backslash if it contains one, else `/`). */
export function separatorOf(path: string): string {
  return path.includes('\\') ? '\\' : '/';
}

/** The leaf name of a path (`C:\a\b` -> `b`, `/a/b/` -> `b`). */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] || trimmed;
}

/** The parent directory of a path (`C:\a\b` -> `C:\a`). */
export function dirName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index > 0 ? trimmed.slice(0, index) : trimmed;
}

/** Join a directory and a child name using the directory's separator. */
export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/[\\/]+$/, '')}${separatorOf(dir)}${name}`;
}
