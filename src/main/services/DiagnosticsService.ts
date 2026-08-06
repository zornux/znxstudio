import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { CrashRecord, ProcessSnapshot, SessionState } from '../../shared/health';
import { atomicWriteFileSync } from '../util/atomicWrite';

/**
 * Crash detection (Phase 19B) and real process metrics (Phase 19C).
 *
 * The crash marker is the whole trick. At startup this reads `session.json`; if
 * the previous run left `open: true`, that run never reached `before-quit` — it
 * was killed, crashed, or lost power. Then it writes `open: true` for THIS run,
 * and `markClean()` flips it on quit.
 *
 * The previous state is captured into `previous` at construction, BEFORE the
 * marker is overwritten. Reading it later would only ever see the current run.
 */
const SESSION_FILE = 'session.json';
const CRASH_FILE = 'last-crash.json';

export class DiagnosticsService {
  private readonly sessionPath: string;
  private readonly crashPath: string;
  /** Captured at construction — the marker on disk is overwritten immediately after. */
  private readonly previous: { exitClean: boolean; crash: CrashRecord | null };

  constructor(
    userDataPath = app.getPath('userData'),
    private readonly logDirectory = join(userDataPath, 'logs'),
  ) {
    this.sessionPath = join(userDataPath, SESSION_FILE);
    this.crashPath = join(userDataPath, CRASH_FILE);
    this.previous = {
      exitClean: this.readSessionClean(),
      crash: this.readCrash(),
    };
    this.markOpen();
  }

  /**
   * A missing marker means a first run, which is a clean start — not a crash.
   * Only an explicit `open: true` proves the previous session never quit.
   */
  private readSessionClean(): boolean {
    try {
      if (!existsSync(this.sessionPath)) return true;
      const raw = JSON.parse(readFileSync(this.sessionPath, 'utf8')) as { open?: unknown };
      return raw.open !== true;
    } catch {
      // An unreadable marker is not evidence of a crash.
      return true;
    }
  }

  private readCrash(): CrashRecord | null {
    try {
      if (!existsSync(this.crashPath)) return null;
      const raw = JSON.parse(readFileSync(this.crashPath, 'utf8')) as CrashRecord;
      return typeof raw?.time === 'number' ? raw : null;
    } catch {
      return null;
    }
  }

  private write(path: string, value: unknown): void {
    try {
      mkdirSync(dirname(path), { recursive: true });
      // Atomic: a crash mid-write must not corrupt the marker. A corrupt marker
      // parses as "clean exit" (readSessionClean), which would suppress crash
      // recovery on the very run that died — the worst possible moment to skip it.
      atomicWriteFileSync(path, JSON.stringify(value, null, 2));
    } catch {
      // Diagnostics must never break the app they are diagnosing.
    }
  }

  private markOpen(): void {
    this.write(this.sessionPath, { open: true, startedAt: Date.now(), pid: process.pid });
  }

  /** Called on `before-quit`. Its absence next launch is what proves a crash. */
  markClean(): void {
    this.write(this.sessionPath, { open: false, exitedAt: Date.now() });
  }

  /** Persist a crash so the NEXT session can show it. */
  recordCrash(record: CrashRecord): void {
    this.write(this.crashPath, record);
  }

  /** Clear the stored crash once the user has seen it. */
  acknowledgeCrash(): void {
    this.write(this.crashPath, {});
  }

  session(): SessionState {
    return {
      previousExitClean: this.previous.exitClean,
      previousCrash: this.previous.crash,
      logDirectory: this.logDirectory,
    };
  }

  /**
   * Electron's own per-process metrics. `memory.privateBytes` is reported in
   * KILOBYTES, not bytes, despite the name — mislabelling it would overstate
   * memory by 1024×.
   */
  processSnapshot(): ProcessSnapshot {
    return {
      uptimeSeconds: process.uptime(),
      metrics: app.getAppMetrics().map((metric) => ({
        type: metric.type,
        pid: metric.pid,
        privateBytesKb: metric.memory?.privateBytes ?? 0,
        cpuPercent: metric.cpu?.percentCPUUsage ?? 0,
      })),
    };
  }
}
