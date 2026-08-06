/**
 * Multi-toolchain resolution (Integration Layer, IL-F). An enterprise machine
 * may have several Zornux versions; a project may pin one. ZnxStudio resolves which
 * toolchain PATH to use, in precedence order, and checks a project's pinned
 * VERSION against whatever resolved — but it never silently switches a project's
 * toolchain.
 *
 * Path precedence: workspace setting → system installation → bundled fallback.
 * (A project's `toolchain` pin is a VERSION, not a path — ZnxStudio has no
 * version→path index, so the pin is a CONSTRAINT checked against the resolved
 * binary, surfaced as a warning, not an automatic switch.)
 *
 * Pure — no Node, no Electron — so it is unit-testable and shared.
 */

import { versionAtLeast } from './contracts';

export type ToolchainSource = 'workspace' | 'system' | 'bundled' | 'none';

export interface ToolchainCandidate {
  source: ToolchainSource;
  path: string | null;
}

export interface ToolchainResolution {
  /** The source that won (first with a real path), or 'none'. */
  source: ToolchainSource;
  path: string | null;
  /** All candidates in precedence order, for a picker / details view. */
  candidates: ToolchainCandidate[];
}

function clean(path: string | null | undefined): string | null {
  return typeof path === 'string' && path.trim() ? path.trim() : null;
}

/**
 * Resolve the toolchain path by precedence: workspace override → system install
 * → bundled fallback. The first source with a real path wins.
 */
export function resolveToolchainPath(input: {
  workspace?: string | null;
  system?: string | null;
  bundled?: string | null;
}): ToolchainResolution {
  const candidates: ToolchainCandidate[] = [
    { source: 'workspace', path: clean(input.workspace) },
    { source: 'system', path: clean(input.system) },
    { source: 'bundled', path: clean(input.bundled) },
  ];
  const chosen = candidates.find((candidate) => candidate.path !== null);
  return { source: chosen?.source ?? 'none', path: chosen?.path ?? null, candidates };
}

/* ---------------------------------------------------------------- pin */

export type PinVerdict =
  | 'none' // the project pins no toolchain version
  | 'satisfied' // the resolved toolchain is at least the pinned version
  | 'older' // the resolved toolchain is OLDER than the pin
  | 'unknown'; // a pin is set but the resolved version could not be read

/**
 * Compare a project's pinned version (a MINIMUM) against the resolved
 * toolchain's actual version. A pin means "this project needs at least Zornux
 * X"; an older toolchain is a real mismatch, a newer one satisfies it.
 */
export function evaluatePin(pinned: string | null, actualVersion: string | null): PinVerdict {
  if (!pinned) return 'none';
  if (!actualVersion) return 'unknown';
  return versionAtLeast(actualVersion, pinned) ? 'satisfied' : 'older';
}

/**
 * A user-facing message for a pin mismatch, or null when there is nothing to
 * say (no pin, or satisfied). The message NEVER implies ZnxStudio will switch the
 * toolchain — the user reviews and acts (upgrade Zornux, or adjust the pin).
 */
export function describePin(pinned: string | null, actualVersion: string | null): string | null {
  switch (evaluatePin(pinned, actualVersion)) {
    case 'none':
    case 'satisfied':
      return null;
    case 'unknown':
      return `This project pins Zornux ${pinned}, but no toolchain version could be read. Install a matching Zornux, or adjust the pin.`;
    case 'older':
      return `This project pins Zornux ${pinned}, but the resolved toolchain is ${actualVersion}. Update Zornux or adjust the pin — ZnxStudio won't switch it for you.`;
  }
}
