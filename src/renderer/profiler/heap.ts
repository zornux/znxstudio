import type { HeapSnapshot } from './profile';

/**
 * Heap / memory analysis (Phase 14B) over the real `profile heap --json` snapshot.
 *
 * The Zornux runtime records COUNTS, never bytes — deliberately: the snapshot
 * holds "no memory addresses, no field values, and no secrets". So every figure
 * here is a live-object count, and there are no GC statistics. Leak detection is
 * therefore count-based: an object class that grows across snapshots and is not
 * reclaimed afterwards is a suspect.
 */

export interface NamedCount {
  name: string;
  count: number;
}

export function heapClassCounts(heap: HeapSnapshot): NamedCount[] {
  return heap.classes.map((c) => ({ name: c.class, count: c.count }));
}

export function heapTypeCounts(heap: HeapSnapshot): NamedCount[] {
  return heap.types.map((t) => ({ name: t.type, count: t.count }));
}

export interface CountDelta {
  name: string;
  before: number;
  after: number;
  delta: number;
}

/** Diff two count lists (grown first). Entries missing from a side count as 0. */
export function diffCounts(before: NamedCount[], after: NamedCount[]): CountDelta[] {
  const beforeMap = new Map(before.map((c) => [c.name, c.count]));
  const afterMap = new Map(after.map((c) => [c.name, c.count]));
  const names = new Set([...beforeMap.keys(), ...afterMap.keys()]);
  const deltas: CountDelta[] = [];
  for (const name of names) {
    const b = beforeMap.get(name) ?? 0;
    const a = afterMap.get(name) ?? 0;
    deltas.push({ name, before: b, after: a, delta: a - b });
  }
  return deltas.sort((x, y) => y.delta - x.delta || x.name.localeCompare(y.name));
}

export interface LeakSuspect {
  name: string;
  before: number;
  after: number;
  /** Count after a later snapshot (e.g. post-GC). Equals `after` when not supplied. */
  afterGc: number;
  /** Objects retained relative to the baseline. */
  retained: number;
}

/**
 * Classes that grew between two snapshots and were NOT reclaimed in a later one.
 * With only two snapshots, growth alone is the (weaker) signal — the third
 * snapshot is what turns "grew" into "leaked".
 *
 * This is the `Customer: 120 → 420 → 420 (after GC)` case: it grew and nothing
 * came back, so 300 objects are retained.
 */
export function leakSuspects(
  before: HeapSnapshot,
  after: HeapSnapshot,
  afterGc?: HeapSnapshot,
  minGrowth = 1,
): LeakSuspect[] {
  const beforeMap = new Map(heapClassCounts(before).map((c) => [c.name, c.count]));
  const afterMap = new Map(heapClassCounts(after).map((c) => [c.name, c.count]));
  const gcMap = afterGc ? new Map(heapClassCounts(afterGc).map((c) => [c.name, c.count])) : null;

  const suspects: LeakSuspect[] = [];
  for (const [name, afterCount] of afterMap) {
    const beforeCount = beforeMap.get(name) ?? 0;
    const growth = afterCount - beforeCount;
    if (growth < minGrowth) continue;
    const gcCount = gcMap ? gcMap.get(name) ?? 0 : afterCount;
    // Reclaimed back to (or below) the baseline → not a leak.
    if (gcCount <= beforeCount) continue;
    suspects.push({ name, before: beforeCount, after: afterCount, afterGc: gcCount, retained: gcCount - beforeCount });
  }
  return suspects.sort((a, b) => b.retained - a.retained);
}

export interface HeapSummary {
  totalObjects: number;
  maxDepth: number;
  truncated: boolean;
  topTypes: NamedCount[];
  topClasses: NamedCount[];
  topContainers: { kind: string; size: number }[];
}

/** Top-N view of a snapshot for the memory panel. */
export function summarizeHeap(heap: HeapSnapshot, top = 10): HeapSummary {
  const byCount = (a: NamedCount, b: NamedCount) => b.count - a.count;
  return {
    totalObjects: heap.totalObjects,
    maxDepth: heap.maxDepth,
    truncated: heap.truncated,
    topTypes: [...heapTypeCounts(heap)].sort(byCount).slice(0, top),
    topClasses: [...heapClassCounts(heap)].sort(byCount).slice(0, top),
    topContainers: [...heap.topContainers].sort((a, b) => b.size - a.size).slice(0, top),
  };
}
