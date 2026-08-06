import type { HotLine, HotSpot, ProfileReport, SubsystemStat } from './profile';
import type { Span, Timeline } from './timeline';

/**
 * Hotspot analysis (Phase 14D) — "which code should I optimize first?".
 *
 * Every ranking below is a projection of the runtime's own numbers:
 *   • top CPU        → hotSpots sorted by the runtime's `percent` (share of samples)
 *   • most-called    → hotSpots sorted by `calls`
 *   • top allocators → hotSpots sorted by `allocations`
 *   • hottest lines  → hotLines
 *   • slowest spans  → the widest timeline spans (event units, e.g. slow queries)
 *
 * `<program>` is the synthetic root frame; callers usually exclude it.
 */

export const PROGRAM_FRAME = '<program>';

function withoutProgram(spots: HotSpot[]): HotSpot[] {
  return spots.filter((s) => s.name !== PROGRAM_FRAME);
}

/** Top CPU consumers by share of samples (exclusive/self cost). */
export function topCpu(report: ProfileReport, limit = 10, includeProgram = false): HotSpot[] {
  const spots = includeProgram ? [...report.hotSpots] : withoutProgram(report.hotSpots);
  return spots.sort((a, b) => b.percent - a.percent || b.samples - a.samples).slice(0, limit);
}

/** Most-frequently called functions (the `formatDate` × 2,400,000 case). */
export function mostCalled(report: ProfileReport, limit = 10): HotSpot[] {
  return withoutProgram(report.hotSpots)
    .filter((s) => s.calls > 0)
    .sort((a, b) => b.calls - a.calls || b.percent - a.percent)
    .slice(0, limit);
}

/** Functions responsible for the most allocations. */
export function topAllocators(report: ProfileReport, limit = 10): HotSpot[] {
  return withoutProgram(report.hotSpots)
    .filter((s) => s.allocations > 0)
    .sort((a, b) => b.allocations - a.allocations)
    .slice(0, limit);
}

/** The hottest source lines, most-sampled first. */
export function hottestLines(report: ProfileReport, limit = 10): HotLine[] {
  return [...report.hotLines].sort((a, b) => b.samples - a.samples).slice(0, limit);
}

/** Subsystem event counts (queries, requests, jobs, tasks, messages). */
export function subsystemCounts(report: ProfileReport): SubsystemStat[] {
  return [...report.subsystems].sort((a, b) => b.count - a.count);
}

/**
 * The widest spans in the trace — the "slowest SQL / slowest request" view.
 * Extent is in event units (the runtime emits sequence, not time).
 */
export function slowestSpans(timeline: Timeline, limit = 10, category?: string): Span[] {
  const spans = category ? timeline.spans.filter((s) => s.category === category) : timeline.spans;
  return [...spans].sort((a, b) => b.units - a.units).slice(0, limit);
}

export interface Recommendation {
  title: string;
  detail: string;
}

/**
 * Turn the rankings into a short, prioritized list of what to look at first.
 * Thresholds are deliberately conservative so we never cry wolf.
 */
export function recommendations(report: ProfileReport, timeline?: Timeline): Recommendation[] {
  const out: Recommendation[] = [];
  const [hottest] = topCpu(report, 1);
  if (hottest && hottest.percent >= 30) {
    out.push({
      title: `${hottest.name} dominates CPU (${hottest.percent.toFixed(1)}%)`,
      detail: `${hottest.samples} of ${report.totalSamples} samples landed here. Optimize this first.`,
    });
  }
  const [called] = mostCalled(report, 1);
  if (called && called.calls >= 100_000) {
    out.push({
      title: `${called.name} is called ${called.calls.toLocaleString()} times`,
      detail: 'Consider caching, hoisting the call out of a loop, or memoizing.',
    });
  }
  const [allocator] = topAllocators(report, 1);
  if (allocator && report.totalAllocations > 0 && allocator.allocations / report.totalAllocations >= 0.5) {
    out.push({
      title: `${allocator.name} makes ${((allocator.allocations / report.totalAllocations) * 100).toFixed(0)}% of allocations`,
      detail: `${allocator.allocations.toLocaleString()} allocations. Reuse values or avoid boxing in this path.`,
    });
  }
  if (timeline) {
    const [slowQuery] = slowestSpans(timeline, 1, 'query');
    if (slowQuery && timeline.units > 0 && slowQuery.units / timeline.units >= 0.25) {
      out.push({
        title: `Query "${slowQuery.name}" spans ${((slowQuery.units / timeline.units) * 100).toFixed(0)}% of the trace`,
        detail: `${slowQuery.units} of ${timeline.units} event units. Add an index or narrow the query.`,
      });
    }
  }
  if (report.truncated) {
    out.push({ title: 'Profile was truncated', detail: 'Raise --max-samples / --max-events for a complete picture.' });
  }
  return out;
}
