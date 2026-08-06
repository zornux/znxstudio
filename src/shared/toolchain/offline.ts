/**
 * Offline / incompatible mode (Integration Layer, IL-G). ZnxStudio stays useful
 * without a usable Zornux: the built-in front end keeps `.zx` recognition,
 * syntax highlighting, and bracket matching alive, while the toolchain-backed
 * intelligence is disabled — with a clear explanation, not a silent gap.
 *
 * Pure — maps a compatibility status to an editing mode + a message.
 */

import type { CompatibilityStatus } from './compatibility';

export type EditorMode =
  | 'full' // a usable toolchain (ok or merely behind): advanced features attempted
  | 'basic'; // no usable toolchain: built-in editing only

/** What the built-in front end always provides, with no toolchain at all. */
export const BUILTIN_FEATURES = [
  '.zx file recognition',
  'syntax highlighting',
  'bracket matching',
  'code folding',
  'plain-text editing',
] as const;

/** What needs a compatible toolchain (off in basic mode). */
export const TOOLCHAIN_FEATURES = [
  'compiler diagnostics',
  'language intelligence (LSP)',
  'debugging (DAP)',
  'profiling',
  'security analysis',
  'test running',
] as const;

/**
 * The editing mode for a compatibility status. `ok`/`degraded` keep full
 * features (degraded still works, just possibly limited); `unsupported`
 * (protocol-incompatible) and `unavailable` (no toolchain) fall back to the
 * built-in front end only.
 */
export function editorMode(status: CompatibilityStatus): EditorMode {
  return status === 'ok' || status === 'degraded' ? 'full' : 'basic';
}

/**
 * A user-facing explanation for basic mode, or null in full mode. It states WHY
 * the advanced features are off and reassures that basic editing remains — so a
 * missing/incompatible toolchain reads as a clear, bounded degradation.
 */
export function offlineExplanation(status: CompatibilityStatus, version: string | null): string | null {
  if (editorMode(status) === 'full') return null;
  const reason =
    status === 'unavailable'
      ? 'no Zornux toolchain was found'
      : `the installed Zornux${version ? ` (${version})` : ''} speaks an unsupported protocol`;
  return `Advanced Zornux features are off because ${reason}. Basic editing stays available: ${BUILTIN_FEATURES.join(', ')}.`;
}
