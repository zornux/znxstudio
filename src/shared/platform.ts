/**
 * Cross-platform compatibility layer (Phase 20G) — pure, dependency-free.
 *
 * Every platform-dependent decision the app makes — path shape, executable
 * naming, shell selection, PATH parsing, line endings, filesystem case
 * sensitivity — routed through here and parameterized by `platform`/`arch` so it
 * is unit-testable for ALL targets on ONE machine. The main process passes the
 * real `process.platform`; the tests pass every target.
 */

export type Platform = 'win32' | 'darwin' | 'linux';
export type Arch = 'x64' | 'arm64';

/** The officially targeted platform × architecture matrix (20F/20G). */
export const SUPPORTED_TARGETS: { platform: Platform; arch: Arch }[] = [
  { platform: 'win32', arch: 'x64' },
  { platform: 'win32', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'linux', arch: 'x64' },
  { platform: 'linux', arch: 'arm64' },
];

/** Only Linux has a case-sensitive filesystem by default. */
export function isCaseSensitiveFs(platform: Platform): boolean {
  return platform === 'linux';
}

export function lineEnding(platform: Platform): '\r\n' | '\n' {
  return platform === 'win32' ? '\r\n' : '\n';
}

/** PATH-style list separator: `;` on Windows, `:` elsewhere. */
export function pathListSeparator(platform: Platform): ';' | ':' {
  return platform === 'win32' ? ';' : ':';
}

/** Add the platform's executable suffix (`.exe` on Windows). */
export function exeName(base: string, platform: Platform): string {
  return platform === 'win32' ? `${base}.exe` : base;
}

/**
 * A sensible default shell when the environment doesn't specify one. The main
 * process prefers `$SHELL`/`$COMSPEC`; this is the fallback.
 */
export function defaultShell(platform: Platform, env: Record<string, string | undefined> = {}): string {
  if (platform === 'win32') return env.COMSPEC || 'powershell.exe';
  return env.SHELL || (platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
}

/** Normalize a path to forward slashes for stable internal comparison. */
export function toPosixPath(path: string): string {
  return path.replace(/\\/g, '/');
}

/** Compare two paths with the platform's case rule. */
export function pathsEqual(a: string, b: string, platform: Platform): boolean {
  const na = toPosixPath(a);
  const nb = toPosixPath(b);
  return isCaseSensitiveFs(platform) ? na === nb : na.toLowerCase() === nb.toLowerCase();
}

/**
 * Executable-discovery candidates: `exeName(base)` joined onto each PATH dir.
 * Pure — the caller stats them; this only builds the ordered candidate list.
 */
export function executableCandidates(base: string, pathDirs: string[], platform: Platform): string[] {
  const name = exeName(base, platform);
  return pathDirs.filter((dir) => dir.length > 0).map((dir) => `${dir.replace(/[\\/]+$/, '')}/${name}`);
}

/** Split a raw PATH env value into directories for the platform. */
export function parsePathEnv(pathValue: string | undefined, platform: Platform): string[] {
  if (!pathValue) return [];
  return pathValue.split(pathListSeparator(platform)).filter((dir) => dir.trim().length > 0);
}
