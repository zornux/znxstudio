/**
 * Performance telemetry (Phase 19C).
 *
 * **This telemetry never leaves the machine.** There is no endpoint, no upload,
 * no opt-out to forget to set: the metrics live in memory, are shown in the
 * Health dashboard, and are written only into the diagnostics report the user
 * copies themselves. Nothing in `src/main` opens a socket for this. If a future
 * change adds one, it must be an explicit, off-by-default user decision — the
 * same rule the AI provider layer follows.
 *
 * What is measured is real: module activation durations from the extension
 * host, command durations from the command registry, and process memory/CPU
 * from Electron's own `app.getAppMetrics()`.
 */

import type { ProcessMetric, ProcessSnapshot } from '../../shared/health';

export interface Sample {
  name: string;
  milliseconds: number;
}

export interface MetricSummary {
  name: string;
  count: number;
  total: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p95: number;
}

/** Cap the retained samples per metric; a long session must not grow forever. */
export const MAX_SAMPLES_PER_METRIC = 500;

/**
 * The value at a percentile, by nearest-rank on the sorted samples. With few
 * samples every percentile collapses onto a real observation, which is what you
 * want: an invented interpolated number between two measurements is not a
 * measurement.
 */
export function percentile(sorted: number[], fraction: number): number {
  if (!sorted.length) return 0;
  const clamped = Math.min(Math.max(fraction, 0), 1);
  const rank = Math.ceil(clamped * sorted.length);
  return sorted[Math.max(0, rank - 1)];
}

export function summarize(name: string, samples: number[]): MetricSummary {
  if (!samples.length) {
    return { name, count: 0, total: 0, min: 0, max: 0, mean: 0, p50: 0, p95: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  return {
    name,
    count: samples.length,
    total,
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: total / samples.length,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

/**
 * Bounded per-metric sample store. When a metric exceeds its cap the OLDEST
 * sample is dropped, so the summary tracks recent behaviour rather than being
 * anchored to whatever happened at startup.
 */
export class PerfRegistry {
  private readonly samples = new Map<string, number[]>();

  record(name: string, milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    const bucket = this.samples.get(name) ?? [];
    bucket.push(milliseconds);
    if (bucket.length > MAX_SAMPLES_PER_METRIC) bucket.shift();
    this.samples.set(name, bucket);
  }

  summary(name: string): MetricSummary {
    return summarize(name, this.samples.get(name) ?? []);
  }

  all(): MetricSummary[] {
    return [...this.samples.keys()].map((name) => this.summary(name));
  }

  clear(): void {
    this.samples.clear();
  }
}

/** Slowest by TOTAL time — where the wall clock actually went. */
export function slowestByTotal(summaries: MetricSummary[], limit = 10): MetricSummary[] {
  return [...summaries].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Slowest by p95 — what the user feels on a bad invocation. */
export function slowestByP95(summaries: MetricSummary[], limit = 10): MetricSummary[] {
  return [...summaries].sort((a, b) => b.p95 - a.p95).slice(0, limit);
}

/* ---------------------------------------------------------------- startup */

export interface ActivationRecord {
  moduleId: string;
  milliseconds: number;
  /** The failure message, when the module threw. Activation is fault-isolated. */
  error?: string;
}

export interface StartupReport {
  modules: number;
  failed: ActivationRecord[];
  totalMilliseconds: number;
  slowest: ActivationRecord[];
}

export function startupReport(records: ActivationRecord[], limit = 5): StartupReport {
  return {
    modules: records.length,
    failed: records.filter((record) => record.error !== undefined),
    totalMilliseconds: records.reduce((sum, record) => sum + record.milliseconds, 0),
    slowest: [...records].sort((a, b) => b.milliseconds - a.milliseconds).slice(0, limit),
  };
}

/* ------------------------------------------------------- process metrics */

export type { ProcessMetric, ProcessSnapshot };

export function totalMemoryKb(metrics: ProcessMetric[]): number {
  return metrics.reduce((sum, metric) => sum + metric.privateBytesKb, 0);
}

export function formatBytesKb(kilobytes: number): string {
  if (kilobytes < 1024) return `${Math.round(kilobytes)} KB`;
  const megabytes = kilobytes / 1024;
  if (megabytes < 1024) return `${megabytes.toFixed(1)} MB`;
  return `${(megabytes / 1024).toFixed(2)} GB`;
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1) return `${(milliseconds * 1000).toFixed(0)} µs`;
  if (milliseconds < 1000) return `${milliseconds.toFixed(1)} ms`;
  return `${(milliseconds / 1000).toFixed(2)} s`;
}

export function formatUptime(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m ${whole % 60}s`;
  return `${whole}s`;
}

/* ------------------------------------------------------------ budgets */

/** A performance expectation the dashboard checks against. */
export interface PerfBudget {
  metric: string;
  /** p95 must stay at or below this, in milliseconds. */
  p95Milliseconds: number;
}

export const DEFAULT_BUDGETS: PerfBudget[] = [
  { metric: 'startup', p95Milliseconds: 3_000 },
  { metric: 'command', p95Milliseconds: 250 },
];

export interface BudgetVerdict {
  metric: string;
  budget: number;
  actual: number;
  /** False when there is no data — an unmeasured budget is not a passing one. */
  measured: boolean;
  withinBudget: boolean;
}

export function checkBudgets(summaries: MetricSummary[], budgets: PerfBudget[] = DEFAULT_BUDGETS): BudgetVerdict[] {
  return budgets.map((budget) => {
    const summary = summaries.find((entry) => entry.name === budget.metric);
    const measured = Boolean(summary?.count);
    return {
      metric: budget.metric,
      budget: budget.p95Milliseconds,
      actual: summary?.p95 ?? 0,
      measured,
      // Never report "within budget" for a metric nobody measured.
      withinBudget: measured && (summary as MetricSummary).p95 <= budget.p95Milliseconds,
    };
  });
}
