/**
 * Diagnostics types that cross the process boundary (Phase 19).
 *
 * These live in `shared` because the main process produces them and the
 * renderer consumes them. The renderer's `health/` modules re-export them so
 * consumers there import from one place.
 */

export interface CrashRecord {
  /** Milliseconds since the epoch. */
  time: number;
  /** Where it died. */
  origin: 'renderer' | 'main' | 'gpu' | 'unknown';
  /** Electron's own reason string for a gone process, or an error name. */
  reason: string;
  message: string;
  /** Truncated: a stack in a report is useful, a novel is not. */
  stack?: string;
}

export interface SessionState {
  /** False when the previous run never reached `before-quit` — i.e. it crashed. */
  previousExitClean: boolean;
  previousCrash: CrashRecord | null;
  logDirectory: string;
}

/** One row of Electron's real `app.getAppMetrics()`. */
export interface ProcessMetric {
  type: string;
  pid: number;
  /**
   * Private (non-shared) working set. Electron reports `memory.privateBytes` in
   * KILOBYTES despite the name — treating it as bytes overstates memory by 1024×.
   */
  privateBytesKb: number;
  /** Percent of one core, averaged since the process started. */
  cpuPercent: number;
}

export interface ProcessSnapshot {
  metrics: ProcessMetric[];
  uptimeSeconds: number;
}

/** Cap a stack so one crash cannot fill the log file. */
export const MAX_STACK_CHARACTERS = 4_000;

/**
 * Turn an unknown thrown value into a record. Anything can be thrown — a
 * string, `undefined`, a DOM event — so nothing here assumes `Error`. Lives in
 * `shared` because both processes catch their own crashes.
 */
export function serializeError(value: unknown, origin: CrashRecord['origin'], time: number): CrashRecord {
  if (value instanceof Error) {
    return {
      time,
      origin,
      reason: value.name || 'Error',
      message: value.message || String(value),
      ...(value.stack ? { stack: value.stack.slice(0, MAX_STACK_CHARACTERS) } : {}),
    };
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(value).slice(0, 500);
    return { time, origin, reason: String(record.name ?? 'Error'), message };
  }
  return { time, origin, reason: 'Error', message: String(value) };
}
