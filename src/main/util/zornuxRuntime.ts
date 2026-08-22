import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CompilerLocationSource } from '../../shared/types';
import { parsePathEnv, type Platform } from '../../shared/platform';
import { compareSemVer } from '../../shared/update';

/**
 * Single source of truth for locating the `zornux` toolchain from the main
 * process. Every service (compiler, LSP, debugger, config, packages, project)
 * resolves through here so a packaged build and a dev build agree on which
 * binary they run.
 *
 * Resolution order (first existing wins; otherwise fall through to PATH):
 *   1. an explicit override (settings / negotiated compiler path)
 *   2. ZORNUX_CLI / ZORNUX_HOME environment overrides
 *   3. the newest discovered system, bundled, or contributor runtime
 *
 * Kept free of any `electron` import so it stays usable from the Node unit-test
 * bundle: the packaged location is read from `process.resourcesPath`, an Electron
 * main-process global that is simply `undefined` under the test runner.
 */
export const ZORNUX_EXE = process.platform === 'win32' ? 'zornux.exe' : 'zornux';

export interface ResolvedZornux {
  path: string;
  source: CompilerLocationSource;
}

export interface VersionedZornux extends ResolvedZornux {
  version: string | null;
}

/**
 * Dev-build locations for the Zornux CLI on a contributor workstation. The xojin
 * repo is a sibling of the ZnxStudio directory — derive the path from cwd() so
 * it resolves on both Windows and Linux.
 */
const DEV_BUILD_BASE = join(process.cwd(), '..', 'xojin', 'src', 'Zornux.Cli', 'bin');

/** The .NET runtime identifier for the host, used to pick the bundled binary. */
export function hostRid(): string {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'osx' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

/**
 * Paths to the zornux binary bundled with a packaged ZnxStudio. electron-builder
 * ships the toolchain via `extraResources` into `<resources>/zornux/`, so
 * installing the IDE installs zornux — offline and version-matched to the IDE.
 * Because one installer can target multiple architectures, the staged runtime
 * lives under a per-RID subdir (`zornux/<rid>/zornux.exe`); a flat
 * `zornux/zornux.exe` is accepted as a single-arch fallback.
 *
 * `process.resourcesPath` is undefined outside a packaged Electron app, so this
 * returns [] in dev/tests and the search falls through to the dev/PATH lookups.
 */
export function bundledZornuxPaths(): string[] {
  const base = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!base) return [];
  const dir = join(base, 'zornux');
  return [join(dir, hostRid(), ZORNUX_EXE), join(dir, ZORNUX_EXE)];
}

/** Ordered candidate list; callers pick the first that exists on disk. */
export function zornuxCandidates(override?: string | null): ResolvedZornux[] {
  const candidates: ResolvedZornux[] = [];
  if (override && override.trim()) candidates.push({ path: override, source: 'env' });
  if (process.env.ZORNUX_CLI) candidates.push({ path: process.env.ZORNUX_CLI, source: 'env' });
  if (process.env.ZORNUX_HOME) {
    candidates.push({ path: join(process.env.ZORNUX_HOME, ZORNUX_EXE), source: 'env' });
    candidates.push({ path: join(process.env.ZORNUX_HOME, 'bin', ZORNUX_EXE), source: 'env' });
  }
  for (const bundled of bundledZornuxPaths()) candidates.push({ path: bundled, source: 'bundled' });
  candidates.push({ path: join(DEV_BUILD_BASE, 'Release', 'net10.0', ZORNUX_EXE), source: 'default' });
  candidates.push({ path: join(DEV_BUILD_BASE, 'Debug', 'net10.0', ZORNUX_EXE), source: 'default' });

  // GUI applications on Windows do not always inherit a freshly updated PATH.
  // Check the normal per-user installation locations as well as every PATH entry.
  const home = homedir();
  const systemPaths = [
    join(home, '.local', 'bin', ZORNUX_EXE),
    join(home, '.dotnet', 'tools', ZORNUX_EXE),
  ];
  if (process.platform === 'win32') {
    if (process.env.LOCALAPPDATA) systemPaths.push(join(process.env.LOCALAPPDATA, 'Zornux', ZORNUX_EXE));
    if (process.env.ProgramFiles) systemPaths.push(join(process.env.ProgramFiles, 'Zornux', ZORNUX_EXE));
  }
  const platform: Platform = process.platform === 'win32' || process.platform === 'darwin' ? process.platform : 'linux';
  for (const dir of parsePathEnv(process.env.PATH, platform)) {
    systemPaths.push(join(dir, ZORNUX_EXE));
  }
  const seen = new Set<string>();
  return [...candidates, ...systemPaths.map((path) => ({ path, source: 'path' as const }))].filter((candidate) => {
    const key = process.platform === 'win32' ? candidate.path.toLowerCase() : candidate.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Read a candidate's product version without involving a shell. */
function probeVersion(path: string): string | null {
  try {
    const result = spawnSync(path, ['--version'], { encoding: 'utf8', windowsHide: true, timeout: 8_000 });
    if (result.status !== 0) return null;
    return /zornux\s+([0-9][\w.-]*)/i.exec(result.stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Select the newest usable runtime; equal/unknown versions preserve discovery order. */
export function newestZornux(candidates: readonly VersionedZornux[]): VersionedZornux | null {
  let best: VersionedZornux | null = null;
  for (const candidate of candidates) {
    if (!candidate.version) continue;
    if (!best || compareSemVer(candidate.version, best.version ?? '') > 0) best = candidate;
  }
  return best;
}

/** Resolve the newest installed zornux binary. Explicit settings/environment overrides still win. */
export function resolveZornux(override?: string | null): ResolvedZornux {
  const candidates = zornuxCandidates(override);
  const explicitCount = (override?.trim() ? 1 : 0) + (process.env.ZORNUX_CLI ? 1 : 0) + (process.env.ZORNUX_HOME ? 2 : 0);
  for (const candidate of candidates.slice(0, explicitCount)) {
    if (existsSync(candidate.path)) return candidate;
  }
  const installed = candidates.slice(explicitCount)
    .filter((candidate) => existsSync(candidate.path))
    .map((candidate) => ({ ...candidate, version: probeVersion(candidate.path) }));
  const newest = newestZornux(installed);
  if (newest) return { path: newest.path, source: newest.source };
  if (installed[0]) return { path: installed[0].path, source: installed[0].source };
  return { path: ZORNUX_EXE, source: 'path' };
}
