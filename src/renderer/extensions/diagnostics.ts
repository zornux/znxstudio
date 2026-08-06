/**
 * Extension diagnostics (Phase 11F). Per-extension observability: a capped log
 * ring buffer, activation timing, and a running error count — the data behind
 * the manager's debug view and the "reload" workflow. Pure and unit-tested; the
 * runtime feeds it activation timings, the SDK logger feeds it logs, and the
 * sandbox feeds it contained faults.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  seq: number;
}

export interface ExtensionDiag {
  logs: LogEntry[];
  activationMs?: number;
  errorCount: number;
  lastError?: string;
}

export class ExtensionDiagnostics {
  private readonly map = new Map<string, ExtensionDiag>();
  private seq = 0;

  constructor(private readonly maxLogs = 100) {}

  private ensure(id: string): ExtensionDiag {
    let diag = this.map.get(id);
    if (!diag) {
      diag = { logs: [], errorCount: 0 };
      this.map.set(id, diag);
    }
    return diag;
  }

  log(id: string, level: LogLevel, message: string): void {
    const diag = this.ensure(id);
    diag.logs.push({ level, message, seq: ++this.seq });
    if (diag.logs.length > this.maxLogs) diag.logs.splice(0, diag.logs.length - this.maxLogs);
  }

  recordActivation(id: string, durationMs: number): void {
    this.ensure(id).activationMs = durationMs;
  }

  recordError(id: string, message: string): void {
    const diag = this.ensure(id);
    diag.errorCount++;
    diag.lastError = message;
    this.log(id, 'error', message);
  }

  get(id: string): ExtensionDiag | undefined {
    return this.map.get(id);
  }

  /** The most recent log lines (formatted), newest last. */
  recentMessages(id: string, limit = 20): string[] {
    const diag = this.map.get(id);
    if (!diag) return [];
    return diag.logs.slice(-limit).map((entry) => `[${entry.level}] ${entry.message}`);
  }

  /** Clear a single extension's diagnostics (e.g. on reload). */
  reset(id: string): void {
    this.map.delete(id);
  }
}
