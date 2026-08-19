import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { CompilerLocationSource } from '../../shared/types';

/**
 * Single source of truth for locating the `zornux` toolchain from the main
 * process. Every service (compiler, LSP, debugger, config, packages, project)
 * resolves through here so a packaged build and a dev build agree on which
 * binary they run.
 *
 * Resolution order (first existing wins; otherwise fall through to PATH):
 *   1. an explicit override (settings / negotiated compiler path)
 *   2. ZORNUX_CLI / ZORNUX_HOME environment overrides
 *   3. the runtime BUNDLED inside a packaged ZnxStudio (see below)
 *   4. this workstation's dev build (contributor convenience)
 *   5. bare `zornux` on PATH
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
  return candidates;
}

/** Resolve the zornux binary, preferring a bundled runtime over PATH. */
export function resolveZornux(override?: string | null): ResolvedZornux {
  for (const candidate of zornuxCandidates(override)) {
    if (existsSync(candidate.path)) return candidate;
  }
  return { path: ZORNUX_EXE, source: 'path' };
}
