import type { AllocationSite, HotSpot, ProfileReport } from './profile';

/**
 * Allocation tracking (Phase 14E) over the real `zornux profile allocations --json`.
 *
 * By default the runtime gives two independent projections:
 *   • `allocations[]`          — how many values of each TYPE were allocated
 *   • `hotSpots[].allocations` — how many allocations each FUNCTION made
 *
 * Since rc.4, `--allocation-stacks` adds `allocationSites[]`, which JOINS them:
 * a type, the call stack that allocated it, and a count. That is what finally
 * answers "trace this allocation back through the calls that made it".
 *
 * `allocationSites` is EMPTY without the flag, so every function below that reads
 * it degrades to "no stacks were captured" rather than to "nothing was allocated".
 * Counts are still values allocated, never bytes — the only byte figure the
 * runtime reports is the HOST's GC total, under `--gc-stats`.
 */

export interface AllocationShare {
  name: string;
  count: number;
  /** Share of `totalAllocations`, 0..100. */
  percent: number;
}

function share(count: number, total: number): number {
  return total > 0 ? (count / total) * 100 : 0;
}

/** Which types are allocated most (Number, Text, List, …). */
export function allocationsByType(report: ProfileReport, limit = 15): AllocationShare[] {
  const total = report.totalAllocations;
  return [...report.allocations]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((a) => ({ name: a.type, count: a.count, percent: share(a.count, total) }));
}

/** Which functions allocate most — the "where is this coming from" view. */
export function allocationsByFunction(report: ProfileReport, limit = 15): AllocationShare[] {
  const total = report.totalAllocations;
  return report.hotSpots
    .filter((s) => s.allocations > 0)
    .sort((a, b) => b.allocations - a.allocations)
    .slice(0, limit)
    .map((s) => ({ name: s.name, count: s.allocations, percent: share(s.allocations, total) }));
}

export interface AllocationRate {
  totalAllocations: number;
  totalCalls: number;
  totalSamples: number;
  /** Allocations per call (0 when nothing was called). */
  perCall: number;
  /** Allocations per CPU sample (allocation pressure while executing). */
  perSample: number;
}

/** Allocation pressure, normalized against calls and samples. */
export function allocationRate(report: ProfileReport): AllocationRate {
  return {
    totalAllocations: report.totalAllocations,
    totalCalls: report.totalCalls,
    totalSamples: report.totalSamples,
    perCall: report.totalCalls > 0 ? report.totalAllocations / report.totalCalls : 0,
    perSample: report.totalSamples > 0 ? report.totalAllocations / report.totalSamples : 0,
  };
}

/**
 * Functions that allocate heavily relative to how much CPU they use — a good
 * proxy for "allocating in a hot loop". Requires both samples and allocations.
 */
export function allocationHeavyFunctions(report: ProfileReport, minAllocations = 1): HotSpot[] {
  return report.hotSpots
    .filter((s) => s.allocations >= minAllocations && s.samples > 0)
    .sort((a, b) => b.allocations / b.samples - a.allocations / a.samples);
}

/** Allocations attributed to one function, as a fraction of the whole run. */
export function attributionFor(report: ProfileReport, fn: string): AllocationShare | null {
  const spot = report.hotSpots.find((s) => s.name === fn);
  if (!spot) return null;
  return { name: spot.name, count: spot.allocations, percent: share(spot.allocations, report.totalAllocations) };
}

/* --------------------------------------------------------- allocation stacks
 *
 * rc.4 added `--allocation-stacks`, so an allocation can finally be traced back
 * through the call stack that produced it, not merely to the function it landed
 * in. Everything below reads `report.allocationSites`, which is EMPTY unless the
 * profile was captured with that flag — so every caller must handle its absence
 * rather than imply the program allocated nothing.
 */

/** True when this report can answer "where did this allocation come from?". */
export function hasAllocationStacks(report: ProfileReport): boolean {
  return report.allocationSites.length > 0;
}

/** A stack rendered for display, outermost call first — the way a person reads it. */
export function formatStack(stack: string[]): string {
  return [...stack].reverse().join(' → ');
}

/** The allocation sites, heaviest first. */
export function topAllocationSites(report: ProfileReport, limit = 15): AllocationSite[] {
  return [...report.allocationSites].sort((a, b) => b.count - a.count).slice(0, limit);
}

/**
 * Every stack that allocated `type`, heaviest first. This is the question the
 * old runtime could not answer: "which call paths create all these Lists?".
 */
export function sitesForType(report: ProfileReport, type: string): AllocationSite[] {
  return report.allocationSites.filter((site) => site.type === type).sort((a, b) => b.count - a.count);
}

/**
 * Every allocation that flowed through `fn` anywhere in its stack — not just
 * the ones it made directly. A caller that allocates nothing itself but drives a
 * function that allocates heavily is exactly what this surfaces.
 */
export function sitesThrough(report: ProfileReport, fn: string): AllocationSite[] {
  return report.allocationSites.filter((site) => site.stack.includes(fn)).sort((a, b) => b.count - a.count);
}

/** Total allocations that passed through `fn`, direct and inherited. */
export function inclusiveAllocations(report: ProfileReport, fn: string): number {
  return sitesThrough(report, fn).reduce((total, site) => total + site.count, 0);
}

/**
 * The allocation sites collapsed to their immediate allocator (the innermost
 * frame), so a caller can compare "who allocated" against `allocationsByFunction`,
 * which reads the same attribution from the per-function totals.
 */
export function allocationsByStackTop(report: ProfileReport, limit = 15): AllocationShare[] {
  const totals = new Map<string, number>();
  for (const site of report.allocationSites) {
    const top = site.stack[0] ?? '<program>';
    totals.set(top, (totals.get(top) ?? 0) + site.count);
  }
  return [...totals.entries()]
    .map(([name, count]) => ({ name, count, percent: share(count, report.totalAllocations) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * The stack-attributed answer to "trace this allocation back": the heaviest
 * paths that produced `type`, each rendered outermost-first. Returns an empty
 * list — never a guess — when the profile carries no stacks.
 */
export function traceAllocation(report: ProfileReport, type: string, limit = 5): { path: string; count: number; percent: number }[] {
  return sitesForType(report, type)
    .slice(0, limit)
    .map((site) => ({ path: formatStack(site.stack), count: site.count, percent: share(site.count, report.totalAllocations) }));
}

/* ------------------------------------------------------------------ gc stats */

/** Bytes, rendered for a human. The one byte figure the runtime reports (host GC). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** One line summarising GC activity, or null when the run was not captured with `--gc-stats`. */
export function gcSummary(report: ProfileReport): string | null {
  if (!report.gc) return null;
  const { gen0Collections, gen1Collections, gen2Collections, allocatedBytes } = report.gc;
  return (
    `${formatBytes(allocatedBytes)} allocated by the host · ` +
    `gen0 ${gen0Collections} · gen1 ${gen1Collections} · gen2 ${gen2Collections} collections`
  );
}
