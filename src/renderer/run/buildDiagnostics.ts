import type { CompilerDiagnostic } from '../../shared/compilerProtocol';

/**
 * Pure helpers for turning a build's compiler diagnostics into per-file groups.
 * Monaco-free so it is unit-testable; the module converts the resolved paths to
 * document uris at the edge.
 */

const ABSOLUTE = /^([a-zA-Z]:[\\/]|[\\/])/;

export function isAbsolutePath(path: string): boolean {
  return ABSOLUTE.test(path);
}

/** Collapse redundant `/./` and `\.\` segments the CLI can emit for dir scans. */
export function normalizePath(path: string): string {
  return path.replace(/([\\/])\.(?=[\\/])/g, '$1').replace(/([\\/]){2,}/g, '$1');
}

/**
 * Resolve a diagnostic's `file` (which may be relative to the CLI working
 * directory) to an absolute path, using the workspace root as the base.
 */
export function resolveDiagnosticPath(file: string, workspaceRoot: string | null): string {
  if (isAbsolutePath(file)) return normalizePath(file);
  if (!workspaceRoot) return normalizePath(file);
  const base = workspaceRoot.replace(/[\\/]+$/, '');
  return normalizePath(`${base}/${file}`);
}

/** Group diagnostics by their resolved absolute file path, preserving order. */
export function groupByFile(
  diagnostics: CompilerDiagnostic[],
  workspaceRoot: string | null,
): Map<string, CompilerDiagnostic[]> {
  const groups = new Map<string, CompilerDiagnostic[]>();
  for (const diagnostic of diagnostics) {
    const path = resolveDiagnosticPath(diagnostic.file, workspaceRoot);
    const bucket = groups.get(path);
    if (bucket) bucket.push(diagnostic);
    else groups.set(path, [diagnostic]);
  }
  return groups;
}

/** Human-readable summary line for a finished build. */
export function buildSummary(errorCount: number, warningCount: number): string {
  if (errorCount === 0 && warningCount === 0) return 'no problems';
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? '' : 's'}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? '' : 's'}`);
  return parts.join(', ');
}
