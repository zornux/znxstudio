/**
 * Crash detection and session recovery (Phase 19B).
 *
 * "Did ZnxStudio crash?" cannot be answered by asking a crashing process. It is
 * answered by a MARKER the main process writes: `{ open: true }` at startup,
 * `{ open: false }` on `before-quit`. If the marker still says `open` on the
 * next launch, the previous session died without ever reaching a clean quit —
 * a hard kill, a power loss, a renderer that took the app down.
 *
 * Recovery restores what the user would otherwise lose: unsaved editor buffers.
 * A snapshot is written to an OS-temp folder on a debounce, never into the
 * workspace, and it holds the buffer TEXT — restoring a list of file paths
 * would reopen the files while silently discarding the edits.
 *
 * The one rule that matters: **the snapshot is offered, never applied.** ZnxStudio
 * does not overwrite a file on disk that may have changed since the crash; it
 * shows what it recovered and lets the user decide.
 */

import { MAX_STACK_CHARACTERS, serializeError, type CrashRecord, type SessionState } from '../../shared/health';

export { MAX_STACK_CHARACTERS, serializeError };
export type { CrashRecord, SessionState };

export const SNAPSHOT_FILE = 'session-snapshot.json';
export const SNAPSHOT_FORMAT_VERSION = 1;

export interface OpenBuffer {
  path: string;
  /** The unsaved text. Absent when the buffer matched what was on disk. */
  text?: string;
  /** 0-based caret, restored with the buffer. */
  line: number;
  character: number;
}

export interface SessionSnapshot {
  formatVersion: number;
  /** Milliseconds since the epoch. Injected. */
  savedAt: number;
  buffers: OpenBuffer[];
  activeFile: string | null;
}

/** Cap a recovered buffer; beyond this the file is too big to hold in a marker. */
export const MAX_BUFFER_CHARACTERS = 2_000_000;
/** Cap how many buffers a snapshot carries. */
export const MAX_SNAPSHOT_BUFFERS = 50;

/**
 * Errors that are ROUTINE, not crashes. Monaco rejects its in-flight requests
 * with a `Canceled` error every time the user types over a pending completion,
 * and `AbortError` is what a cancelled fetch throws. Recording these would make
 * the crash log meaningless within a minute of ordinary editing — which is
 * precisely what the first version of this module did, three `Canceled` records
 * deep before anyone had touched the keyboard.
 */
const ROUTINE_REASONS = new Set(['Canceled', 'Cancelled', 'AbortError']);

export function isRoutineCancellation(value: unknown): boolean {
  if (!value || (typeof value !== 'object' && typeof value !== 'string')) return false;
  if (typeof value === 'string') return ROUTINE_REASONS.has(value);
  const record = value as { name?: unknown; message?: unknown };
  if (typeof record.name === 'string' && ROUTINE_REASONS.has(record.name)) return true;
  // Monaco's `Canceled` carries the word in its message on some paths.
  return typeof record.message === 'string' && ROUTINE_REASONS.has(record.message);
}

/** Untrusted JSON from disk → a crash record, or null. Never throws. */
export function parseCrashRecord(value: unknown): CrashRecord | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.time !== 'number' || !Number.isFinite(raw.time)) return null;
  const origin = raw.origin;
  return {
    time: raw.time,
    origin: origin === 'renderer' || origin === 'main' || origin === 'gpu' ? origin : 'unknown',
    reason: String(raw.reason ?? 'Error'),
    message: String(raw.message ?? ''),
    ...(typeof raw.stack === 'string' ? { stack: raw.stack.slice(0, MAX_STACK_CHARACTERS) } : {}),
  };
}

/**
 * Build a snapshot. Buffers whose text matches disk carry no text — there is
 * nothing to recover, and copying every open file into the marker would make it
 * enormous for no benefit.
 */
export function buildSnapshot(buffers: OpenBuffer[], activeFile: string | null, savedAt: number): SessionSnapshot {
  const trimmed = buffers.slice(0, MAX_SNAPSHOT_BUFFERS).map((buffer) => ({
    ...buffer,
    ...(buffer.text !== undefined ? { text: buffer.text.slice(0, MAX_BUFFER_CHARACTERS) } : {}),
  }));
  return { formatVersion: SNAPSHOT_FORMAT_VERSION, savedAt, buffers: trimmed, activeFile };
}

/** Untrusted JSON from disk → a snapshot, or null. Never throws. */
export function parseSnapshot(text: string): SessionSnapshot | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  if (record.formatVersion !== SNAPSHOT_FORMAT_VERSION) return null;
  if (!Array.isArray(record.buffers)) return null;

  const buffers: OpenBuffer[] = [];
  for (const entry of record.buffers) {
    if (!entry || typeof entry !== 'object') continue;
    const buffer = entry as Record<string, unknown>;
    if (typeof buffer.path !== 'string' || !buffer.path) continue;
    buffers.push({
      path: buffer.path,
      ...(typeof buffer.text === 'string' ? { text: buffer.text } : {}),
      line: typeof buffer.line === 'number' && buffer.line >= 0 ? buffer.line : 0,
      character: typeof buffer.character === 'number' && buffer.character >= 0 ? buffer.character : 0,
    });
  }
  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    savedAt: typeof record.savedAt === 'number' ? record.savedAt : 0,
    buffers,
    activeFile: typeof record.activeFile === 'string' ? record.activeFile : null,
  };
}

/** Only buffers holding unsaved text are worth offering back. */
export function recoverableBuffers(snapshot: SessionSnapshot): OpenBuffer[] {
  return snapshot.buffers.filter((buffer) => typeof buffer.text === 'string');
}

/**
 * Should a restore be offered? Only when the previous session did NOT exit
 * cleanly AND there is unsaved work in the snapshot. A clean quit means the
 * user closed the editor; re-opening their buffers uninvited would be rude, and
 * a snapshot with nothing unsaved has nothing to recover.
 */
export function shouldOfferRestore(state: SessionState, snapshot: SessionSnapshot | null): boolean {
  if (state.previousExitClean) return false;
  return Boolean(snapshot && recoverableBuffers(snapshot).length > 0);
}

export function describeCrash(crash: CrashRecord): string {
  const when = new Date(crash.time).toISOString();
  return `${when} — ${crash.origin} process: ${crash.reason}: ${crash.message}`;
}

export function snapshotSummary(snapshot: SessionSnapshot): string {
  const recoverable = recoverableBuffers(snapshot).length;
  const when = new Date(snapshot.savedAt).toISOString();
  return `${recoverable} unsaved file(s) of ${snapshot.buffers.length} open, captured ${when}`;
}
