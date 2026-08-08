export type SaveAsTarget = { kind: 'cancel' } | { kind: 'overwrite' } | { kind: 'new'; path: string };

function normalize(path: string): string {
  const value = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value;
}

export function resolveSaveAsTarget(originalPath: string, selectedPath: string | null): SaveAsTarget {
  if (!selectedPath) return { kind: 'cancel' };
  return normalize(originalPath) === normalize(selectedPath)
    ? { kind: 'overwrite' }
    : { kind: 'new', path: selectedPath };
}

export function diskConflictPreview(content: string | null): string {
  return content ?? '(The file no longer exists on disk.)';
}
