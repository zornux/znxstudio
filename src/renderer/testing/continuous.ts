/**
 * Pure run-history model (Phase 9G — the Testing capstone). Continuous testing
 * re-runs tests on save; this records the rolling run history that the module
 * renders and that drives the pass/fail streak + status. No DOM / no Monaco.
 */
export interface RunRecord {
  /** Monotonic run number (1-based). */
  seq: number;
  /** The file run, or 'all'. */
  file: string;
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
  ok: boolean;
}

export class RunHistory {
  private records: RunRecord[] = [];
  private counter = 0;

  constructor(private readonly max = 20) {}

  /** Record a run (newest first); returns the created record. */
  push(run: { file: string; total: number; passed: number; failed: number; durationMs: number }): RunRecord {
    this.counter += 1;
    const record: RunRecord = { ...run, seq: this.counter, ok: run.failed === 0 };
    this.records.unshift(record);
    if (this.records.length > this.max) this.records.pop();
    return record;
  }

  entries(): RunRecord[] {
    return [...this.records];
  }

  latest(): RunRecord | null {
    return this.records[0] ?? null;
  }

  /** Consecutive passing runs from the most recent. */
  passStreak(): number {
    let streak = 0;
    for (const record of this.records) {
      if (record.ok) streak += 1;
      else break;
    }
    return streak;
  }

  size(): number {
    return this.records.length;
  }

  clear(): void {
    this.records = [];
  }
}

/** A .zx file is watch-relevant (source or tests can affect a run). */
export function isWatchable(path: string): boolean {
  return path.toLowerCase().endsWith('.zx');
}
