/**
 * The REAL Zornux runtime profiling contract (Phase 14), mirrored from
 * `Zornux.Runtime/Profiling/ProfilerModel.cs` + `HeapSnapshot.cs` (v1.0.0-rc.4).
 *
 * CLI: `zornux profile <run|vm-run|allocations|heap|timeline|serve> <file> --json`
 *   • run / vm-run / allocations / heap / serve → a single `ProfileReport` object
 *   • timeline                                   → a JSON ARRAY of `ProfilerEvent`
 *
 * Three properties of the real data shape the analyses. rc.4 relaxed the first
 * two, but only when the caller opts in — the defaults are unchanged, so every
 * analysis must still work without them:
 *
 *   1. Events carry `sequence` + `depth`. `timestampMicroseconds` is populated
 *      ONLY under `--timestamps`, and is `null` otherwise. `sequence` remains
 *      authoritative for ordering, because it is what makes a run deterministic.
 *      So costs are in EVENT UNITS unless a trace was captured with timestamps.
 *   2. Allocations are attributed to a call STACK only under
 *      `--allocation-stacks` (`allocationSites`); otherwise that array is empty
 *      and only the per-type / per-function totals exist.
 *   3. Heap + allocations remain COUNTS, not bytes (the runtime deliberately
 *      records no addresses, field values or secrets). `--gc-stats` adds host
 *      GC counters, including `allocatedBytes` — the one byte figure available,
 *      and it is the HOST's, not the program's logical heap.
 */

import { envelopeResultArray, envelopeResultObject, parseEnvelope } from '../../shared/cli/envelope';

export type ProfileMode = 'run' | 'vm-run' | 'allocations' | 'heap' | 'timeline' | 'serve';
export type TraceKind = 'calls' | 'jobs' | 'queries' | 'requests' | 'all';

/** One CPU hot-spot row: a function/method/route/job/query. */
export interface HotSpot {
  name: string;
  calls: number;
  samples: number;
  allocations: number;
  percent: number;
  source: string | null;
}

/** One hot source line. */
export interface HotLine {
  source: string;
  samples: number;
  percent: number;
}

/** How many values of a type were allocated during the run (count, not bytes). */
export interface AllocationStat {
  type: string;
  count: number;
}

/**
 * One allocation site: a type allocated beneath a specific call stack
 * (`--allocation-stacks`, rc.4). The stack is innermost-first and bounded by the
 * runtime's `AllocationStackDepth` (8 by default), so a deep stack is truncated,
 * never fabricated. Only function names are recorded — never values.
 */
export interface AllocationSite {
  type: string;
  /** Innermost frame first. `<program>` is top-level code. */
  stack: string[];
  count: number;
}

/**
 * Host garbage-collection activity for the run (`--gc-stats`, rc.4).
 * `allocatedBytes` is the .NET host's total, NOT the program's logical heap —
 * the logical heap is still reported as object counts, never bytes.
 */
export interface GcStats {
  gen0Collections: number;
  gen1Collections: number;
  gen2Collections: number;
  allocatedBytes: number;
}

/** How many times a subsystem event occurred (tasks, jobs, requests, queries…). */
export interface SubsystemStat {
  category: string;
  count: number;
}

export interface HeapTypeCount {
  type: string;
  count: number;
}
export interface HeapClassCount {
  class: string;
  count: number;
}
export interface HeapContainer {
  kind: string;
  size: number;
}

/** A logical heap snapshot at program end — counts only, no bytes. */
export interface HeapSnapshot {
  totalObjects: number;
  maxDepth: number;
  truncated: boolean;
  types: HeapTypeCount[];
  classes: HeapClassCount[];
  topContainers: HeapContainer[];
}

/** The result of a profiling run (`--json` on run/vm-run/allocations/heap/serve). */
export interface ProfileReport {
  engine: string;
  totalCalls: number;
  totalSamples: number;
  totalAllocations: number;
  hotSpots: HotSpot[];
  hotLines: HotLine[];
  allocations: AllocationStat[];
  /** Empty unless the run used `--allocation-stacks`. */
  allocationSites: AllocationSite[];
  /** Null unless the run used `--gc-stats`. */
  gc: GcStats | null;
  subsystems: SubsystemStat[];
  heap: HeapSnapshot | null;
  truncated: boolean;
  notes: string[];
}

export type ProfilerEventKind =
  | 'ProgramStart'
  | 'ProgramEnd'
  | 'CallEnter'
  | 'CallExit'
  | 'TaskStart'
  | 'TaskEnd'
  | 'JobStart'
  | 'JobEnd'
  | 'RequestStart'
  | 'RequestEnd'
  | 'QueryStart'
  | 'QueryEnd'
  | 'MessagePublish'
  | 'MessageHandle'
  | 'ErrorThrown'
  | 'ErrorCaught';

/**
 * One trace event (`profile timeline --json`). `sequence` + `depth` always;
 * `timestampMicroseconds` only under `--timestamps`, `null` otherwise.
 */
export interface ProfilerEvent {
  sequence: number;
  kind: ProfilerEventKind;
  name: string;
  category: string | null;
  depth: number;
  source: string | null;
  /** Elapsed microseconds since the run began, or null when not captured. */
  timestampMicroseconds: number | null;
}

export interface ProfileOptions {
  json?: boolean;
  trace?: TraceKind;
  maxSamples?: number;
  maxEvents?: number;
  samplingInterval?: number;
  /** `--allocation-stacks`: record the call stack behind each allocation. */
  allocationStacks?: boolean;
  /** `--timestamps`: stamp timeline events with elapsed microseconds. */
  timestamps?: boolean;
  /** `--gc-stats`: report host garbage-collection activity. */
  gcStats?: boolean;
}

/** Build the argv for `zornux profile <mode> <file> …`. */
export function buildProfileArgs(mode: ProfileMode, file: string, options: ProfileOptions = {}): string[] {
  const args = ['profile', mode, file];
  if (options.json !== false) args.push('--json');
  if (options.trace) args.push('--trace', options.trace);
  if (options.maxSamples) args.push('--max-samples', String(options.maxSamples));
  if (options.maxEvents) args.push('--max-events', String(options.maxEvents));
  if (options.samplingInterval) args.push('--sampling-interval', String(options.samplingInterval));
  if (options.allocationStacks) args.push('--allocation-stacks');
  if (options.timestamps) args.push('--timestamps');
  if (options.gcStats) args.push('--gc-stats');
  return args;
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseHeap(raw: unknown): HeapSnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = asRecord(raw);
  return {
    totalObjects: num(h.totalObjects),
    maxDepth: num(h.maxDepth),
    truncated: h.truncated === true,
    types: (Array.isArray(h.types) ? h.types : []).map((t) => ({ type: String(asRecord(t).type ?? ''), count: num(asRecord(t).count) })),
    classes: (Array.isArray(h.classes) ? h.classes : []).map((c) => ({ class: String(asRecord(c).class ?? ''), count: num(asRecord(c).count) })),
    topContainers: (Array.isArray(h.topContainers) ? h.topContainers : []).map((c) => ({ kind: String(asRecord(c).kind ?? ''), size: num(asRecord(c).size) })),
  };
}

/** Host GC counters, present only under `--gc-stats`. */
function parseGc(raw: unknown): GcStats | null {
  if (!raw || typeof raw !== 'object') return null;
  const g = asRecord(raw);
  return {
    gen0Collections: num(g.gen0Collections),
    gen1Collections: num(g.gen1Collections),
    gen2Collections: num(g.gen2Collections),
    allocatedBytes: num(g.allocatedBytes),
  };
}

/** Parse a `ProfileReport` out of `zornux profile … --json` output. Never throws. */
export function parseProfileReport(stdout: string): ProfileReport | null {
  // The report is the envelope's `result` object.
  const envelope = parseEnvelope(stdout);
  const raw = envelope ? envelopeResultObject(envelope) : null;
  if (!raw) return null;
  const r = asRecord(raw);
  if (typeof r.engine !== 'string') return null;
  return {
    engine: r.engine,
    totalCalls: num(r.totalCalls),
    totalSamples: num(r.totalSamples),
    totalAllocations: num(r.totalAllocations),
    hotSpots: (Array.isArray(r.hotSpots) ? r.hotSpots : []).map((h) => {
      const s = asRecord(h);
      return {
        name: String(s.name ?? ''),
        calls: num(s.calls),
        samples: num(s.samples),
        allocations: num(s.allocations),
        percent: num(s.percent),
        source: typeof s.source === 'string' ? s.source : null,
      };
    }),
    hotLines: (Array.isArray(r.hotLines) ? r.hotLines : []).map((h) => {
      const s = asRecord(h);
      return { source: String(s.source ?? ''), samples: num(s.samples), percent: num(s.percent) };
    }),
    allocations: (Array.isArray(r.allocations) ? r.allocations : []).map((a) => {
      const s = asRecord(a);
      return { type: String(s.type ?? ''), count: num(s.count) };
    }),
    allocationSites: (Array.isArray(r.allocationSites) ? r.allocationSites : []).map((a) => {
      const s = asRecord(a);
      return {
        type: String(s.type ?? ''),
        stack: (Array.isArray(s.stack) ? s.stack : []).map((frame) => String(frame)),
        count: num(s.count),
      };
    }),
    gc: parseGc(r.gc),
    subsystems: (Array.isArray(r.subsystems) ? r.subsystems : []).map((s) => {
      const v = asRecord(s);
      return { category: String(v.category ?? ''), count: num(v.count) };
    }),
    heap: parseHeap(r.heap),
    truncated: r.truncated === true,
    notes: (Array.isArray(r.notes) ? r.notes : []).map((n) => String(n)),
  };
}

const EVENT_KINDS = new Set<string>([
  'ProgramStart', 'ProgramEnd', 'CallEnter', 'CallExit', 'TaskStart', 'TaskEnd',
  'JobStart', 'JobEnd', 'RequestStart', 'RequestEnd', 'QueryStart', 'QueryEnd',
  'MessagePublish', 'MessageHandle', 'ErrorThrown', 'ErrorCaught',
]);

/** Parse the trace-event array from `zornux profile timeline --json`. Never throws. */
export function parseTimelineEvents(stdout: string): ProfilerEvent[] {
  // The events ARE the envelope's `result`. Reach into it directly — the
  // envelope also carries an empty `diagnostics: []`, so a naive "grab the last
  // array" would find the wrong one.
  const envelope = parseEnvelope(stdout);
  const raw = envelope ? envelopeResultArray(envelope) : null;
  if (!Array.isArray(raw)) return [];
  const events: ProfilerEvent[] = [];
  for (const entry of raw) {
    const e = asRecord(entry);
    const kind = String(e.kind ?? '');
    if (!EVENT_KINDS.has(kind)) continue;
    events.push({
      sequence: num(e.sequence),
      kind: kind as ProfilerEventKind,
      name: String(e.name ?? ''),
      category: typeof e.category === 'string' ? e.category : null,
      depth: num(e.depth),
      source: typeof e.source === 'string' ? e.source : null,
      timestampMicroseconds: typeof e.timestampMicroseconds === 'number' ? e.timestampMicroseconds : null,
    });
  }
  return events.sort((a, b) => a.sequence - b.sequence);
}

/** An empty report, used before any profile has been captured. */
export function emptyReport(engine = 'interpreter'): ProfileReport {
  return {
    engine,
    totalCalls: 0,
    totalSamples: 0,
    totalAllocations: 0,
    hotSpots: [],
    hotLines: [],
    allocations: [],
    allocationSites: [],
    gc: null,
    subsystems: [],
    heap: null,
    truncated: false,
    notes: [],
  };
}

/** True when the trace carries real elapsed time, not just event ordering. */
export function hasTimestamps(events: ProfilerEvent[]): boolean {
  return events.some((event) => event.timestampMicroseconds !== null);
}

/** Elapsed microseconds a trace covers, or null when it was captured without timestamps. */
export function traceDurationMicroseconds(events: ProfilerEvent[]): number | null {
  const stamps = events.map((event) => event.timestampMicroseconds).filter((t): t is number => t !== null);
  return stamps.length ? Math.max(...stamps) - Math.min(...stamps) : null;
}
