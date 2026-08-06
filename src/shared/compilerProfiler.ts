/**
 * Aggregates compiler operation timings into a performance profile. Pure and
 * dependency-free (runs in the main process where every check/build/project-check
 * flows through, and is unit-tested here). Cache hits are counted for the hit
 * rate but excluded from run-time stats and slowest-file tracking, since they do
 * no compilation.
 */

export interface CommandProfile {
  command: string;
  total: number;
  cached: number;
  /** Sum of durations for real (non-cached) runs. */
  ranMs: number;
  /** Slowest single real run. */
  maxMs: number;
}

export interface FileProfile {
  path: string;
  lastMs: number;
  maxMs: number;
  runs: number;
}

export interface CompilerProfile {
  totalOps: number;
  totalCached: number;
  commands: CommandProfile[];
  slowestFiles: FileProfile[];
}

const MAX_SLOWEST = 10;

export class CompilerProfiler {
  private readonly commands = new Map<string, Omit<CommandProfile, 'command'>>();
  private readonly files = new Map<string, Omit<FileProfile, 'path'>>();
  private totalOps = 0;
  private totalCached = 0;

  record(command: string, durationMs: number, cached: boolean, path?: string | null): void {
    this.totalOps++;
    if (cached) this.totalCached++;

    const entry = this.commands.get(command) ?? { total: 0, cached: 0, ranMs: 0, maxMs: 0 };
    entry.total++;
    if (cached) {
      entry.cached++;
    } else {
      entry.ranMs += durationMs;
      entry.maxMs = Math.max(entry.maxMs, durationMs);
    }
    this.commands.set(command, entry);

    // Only real runs contribute to per-file timings.
    if (path && !cached) {
      const file = this.files.get(path) ?? { lastMs: 0, maxMs: 0, runs: 0 };
      file.lastMs = durationMs;
      file.maxMs = Math.max(file.maxMs, durationMs);
      file.runs++;
      this.files.set(path, file);
    }
  }

  snapshot(): CompilerProfile {
    return {
      totalOps: this.totalOps,
      totalCached: this.totalCached,
      commands: [...this.commands.entries()]
        .map(([command, entry]) => ({ command, ...entry }))
        .sort((a, b) => a.command.localeCompare(b.command)),
      slowestFiles: [...this.files.entries()]
        .map(([path, entry]) => ({ path, ...entry }))
        .sort((a, b) => b.maxMs - a.maxMs)
        .slice(0, MAX_SLOWEST),
    };
  }

  reset(): void {
    this.commands.clear();
    this.files.clear();
    this.totalOps = 0;
    this.totalCached = 0;
  }
}
