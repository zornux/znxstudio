/**
 * Pure query-profiling synthesis (Phase 8F). Zornux has no query EXPLAIN, but it
 * ships the language's own clock (`current_datetime()` / `elapsed_time(began)` →
 * seconds) and TWO engines (interpreter `run` + bytecode VM `vm-run`, advertised
 * as identical output). We time a query by looping it N times between timestamps,
 * printing `__PROF__<seconds>|<accumulator>`, and compare the engines. No DOM.
 */
export const PROFILE_MARK = '__PROF__';

/** Append a timing loop that runs `runExpr` (a scalar) `iterations` times. */
export function buildProfileProgram(source: string, runExpr: string, iterations: number): string {
  return (
    `${source}\n` +
    'create zprof_total = 0\n' +
    'create zprof_began = current_datetime()\n' +
    `repeat ${iterations} times\n` +
    `    zprof_total = zprof_total + (${runExpr})\n` +
    'end\n' +
    `show "${PROFILE_MARK}" + text(elapsed_time(zprof_began)) + "|" + text(zprof_total)\n`
  );
}

export interface ProfileSample {
  /** Total seconds for all iterations (from the language clock). */
  seconds: number;
  /** The accumulated result (row-count sum, or aggregate sum), as printed. */
  result: string;
}

export function parseProfile(output: string): ProfileSample | null {
  const match = new RegExp(`${PROFILE_MARK}([\\d.]+)\\|(.+)`).exec(output);
  if (!match) return null;
  return { seconds: Number(match[1]), result: match[2].trim() };
}

/** Mean per-query time in microseconds. */
export function perQueryMicros(seconds: number, iterations: number): number {
  if (iterations <= 0) return 0;
  return (seconds / iterations) * 1_000_000;
}

/** Clamp a requested iteration count into a sane range. */
export function clampIterations(value: number): number {
  if (!Number.isFinite(value) || value < 1) return 1;
  return Math.min(Math.floor(value), 100_000);
}
