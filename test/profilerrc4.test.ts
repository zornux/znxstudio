import { describe, expect, test } from './harness';
import {
  buildProfileArgs,
  emptyReport,
  hasTimestamps,
  parseProfileReport,
  parseTimelineEvents,
  traceDurationMicroseconds,
  type ProfileReport,
} from '../src/renderer/profiler/profile';
import {
  allocationsByStackTop,
  formatBytes,
  formatStack,
  gcSummary,
  hasAllocationStacks,
  inclusiveAllocations,
  sitesForType,
  sitesThrough,
  topAllocationSites,
  traceAllocation,
} from '../src/renderer/profiler/allocations';
import { buildTimeline } from '../src/renderer/profiler/timeline';

/**
 * A verbatim capture of
 * `zornux profile allocations app.zx --json --allocation-stacks --gc-stats`,
 * with the report under the envelope's `result`.
 */
const REAL_RC4_ALLOCATIONS = `{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": {
  "engine": "interpreter",
  "totalCalls": 1,
  "totalSamples": 0,
  "totalAllocations": 1266,
  "hotSpots": [
    { "name": "build_rows", "calls": 1, "samples": 0, "allocations": 53, "percent": 0, "source": null }
  ],
  "hotLines": [],
  "allocations": [
    { "type": "Number", "count": 1153 },
    { "type": "List", "count": 51 }
  ],
  "allocationSites": [
    { "type": "Number", "stack": ["<program>"], "count": 1153 },
    { "type": "Number", "stack": ["build_rows", "<program>"], "count": 58 },
    { "type": "List", "stack": ["build_rows", "<program>"], "count": 51 },
    { "type": "Truth", "stack": ["build_rows", "<program>"], "count": 2 }
  ],
  "gc": { "gen0Collections": 1, "gen1Collections": 0, "gen2Collections": 0, "allocatedBytes": 358456 },
  "subsystems": [],
  "heap": null,
  "truncated": false,
  "notes": []
  }, "diagnostics": []
}`;

/** The same program profiled WITHOUT the new flags — the default, and still supported. */
const REAL_RC4_DEFAULT = `{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": {
  "engine": "interpreter",
  "totalCalls": 1,
  "totalSamples": 0,
  "totalAllocations": 1266,
  "hotSpots": [],
  "hotLines": [],
  "allocations": [{ "type": "Number", "count": 1153 }],
  "allocationSites": [],
  "gc": null,
  "subsystems": [],
  "heap": null,
  "truncated": false,
  "notes": []
  }, "diagnostics": []
}`;

const REAL_RC4_TIMELINE = `{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": [
  { "sequence": 0, "kind": "ProgramStart", "name": "program", "category": "program", "depth": 0, "source": null, "timestampMicroseconds": 15456 },
  { "sequence": 1, "kind": "CallEnter", "name": "build_rows", "category": "call", "depth": 1, "source": null, "timestampMicroseconds": 32891 },
  { "sequence": 2, "kind": "CallExit", "name": "build_rows", "category": "call", "depth": 1, "source": null, "timestampMicroseconds": 41000 },
  { "sequence": 3, "kind": "ProgramEnd", "name": "program", "category": "program", "depth": 0, "source": null, "timestampMicroseconds": 44000 }
  ], "diagnostics": []
}`;

function report(): ProfileReport {
  const parsed = parseProfileReport(REAL_RC4_ALLOCATIONS);
  if (!parsed) throw new Error('fixture did not parse');
  return parsed;
}

describe('buildProfileArgs (rc.4 flags)', () => {
  test('the new flags are off by default, so the default invocation is unchanged', () => {
    expect(buildProfileArgs('allocations', 'a.zx')).toEqual(['profile', 'allocations', 'a.zx', '--json']);
  });

  test('allocation stacks, timestamps and gc stats are opt-in', () => {
    expect(buildProfileArgs('allocations', 'a.zx', { allocationStacks: true, gcStats: true })).toEqual([
      'profile',
      'allocations',
      'a.zx',
      '--json',
      '--allocation-stacks',
      '--gc-stats',
    ]);
    expect(buildProfileArgs('timeline', 'a.zx', { trace: 'all', timestamps: true })).toEqual([
      'profile',
      'timeline',
      'a.zx',
      '--json',
      '--trace',
      'all',
      '--timestamps',
    ]);
  });
});

describe('parseProfileReport (rc.4 fields)', () => {
  test('reads allocation sites with their call stacks', () => {
    const parsed = report();
    expect(parsed.allocationSites).toHaveLength(4);
    expect(parsed.allocationSites[1].type).toBe('Number');
    expect(parsed.allocationSites[1].stack).toEqual(['build_rows', '<program>']);
    expect(parsed.allocationSites[1].count).toBe(58);
  });

  test('reads host GC counters', () => {
    expect(report().gc).toEqual({ gen0Collections: 1, gen1Collections: 0, gen2Collections: 0, allocatedBytes: 358456 });
  });

  test('a default run carries no sites and no gc, and that is not an error', () => {
    const parsed = parseProfileReport(REAL_RC4_DEFAULT);
    expect(parsed?.allocationSites).toHaveLength(0);
    expect(parsed?.gc).toBeNull();
    expect(parsed?.totalAllocations).toBe(1266);
  });

  test('an emptyReport carries the new fields', () => {
    expect(emptyReport().allocationSites).toHaveLength(0);
    expect(emptyReport().gc).toBeNull();
  });
});

describe('allocation stacks', () => {
  test('hasAllocationStacks distinguishes "no stacks captured" from "nothing allocated"', () => {
    expect(hasAllocationStacks(report())).toBe(true);
    const bare = parseProfileReport(REAL_RC4_DEFAULT)!;
    expect(hasAllocationStacks(bare)).toBe(false);
    expect(bare.totalAllocations).toBeGreaterThan(0);
  });

  test('a stack is displayed outermost-first, the way a person reads a call chain', () => {
    expect(formatStack(['build_rows', '<program>'])).toBe('<program> → build_rows');
  });

  test('topAllocationSites ranks by count', () => {
    expect(topAllocationSites(report(), 2).map((s) => s.count)).toEqual([1153, 58]);
  });

  test('sitesForType answers "which call paths create all these Lists?"', () => {
    const sites = sitesForType(report(), 'List');
    expect(sites).toHaveLength(1);
    expect(sites[0].stack).toEqual(['build_rows', '<program>']);
    expect(sites[0].count).toBe(51);
  });

  test('sitesThrough finds allocations beneath a function, not only its direct ones', () => {
    // `<program>` allocates 1153 directly and drives build_rows, which allocates 111 more.
    expect(inclusiveAllocations(report(), '<program>')).toBe(1153 + 58 + 51 + 2);
    expect(sitesThrough(report(), 'build_rows')).toHaveLength(3);
    expect(inclusiveAllocations(report(), 'build_rows')).toBe(111);
  });

  test('a function that appears in no stack has no inclusive allocations', () => {
    expect(inclusiveAllocations(report(), 'nowhere')).toBe(0);
    expect(sitesThrough(report(), 'nowhere')).toHaveLength(0);
  });

  test('allocationsByStackTop attributes each site to its immediate allocator', () => {
    const byTop = allocationsByStackTop(report());
    expect(byTop[0].name).toBe('<program>');
    expect(byTop[0].count).toBe(1153);
    expect(byTop[0].percent).toBeGreaterThan(91);
    expect(byTop[1].name).toBe('build_rows');
    expect(byTop[1].count).toBe(111);
  });

  test('traceAllocation is the question the old runtime could not answer', () => {
    const trace = traceAllocation(report(), 'List');
    expect(trace).toHaveLength(1);
    expect(trace[0].path).toBe('<program> → build_rows');
    expect(trace[0].count).toBe(51);
  });

  test('tracing a type in a profile with no stacks returns nothing, never a guess', () => {
    expect(traceAllocation(parseProfileReport(REAL_RC4_DEFAULT)!, 'Number')).toHaveLength(0);
  });
});

describe('gc stats', () => {
  test('formatBytes scales', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(358456)).toBe('350.1 KB');
  });

  test('gcSummary names the collections and says the bytes are the HOST’s', () => {
    const summary = gcSummary(report());
    expect(summary).toContain('350.1 KB allocated by the host');
    expect(summary).toContain('gen0 1');
  });

  test('a run without --gc-stats has no summary rather than a fabricated zero', () => {
    expect(gcSummary(parseProfileReport(REAL_RC4_DEFAULT)!)).toBeNull();
  });
});

describe('timeline timestamps', () => {
  test('parses the elapsed microseconds the runtime stamps on each event', () => {
    const events = parseTimelineEvents(REAL_RC4_TIMELINE);
    expect(events[0].timestampMicroseconds).toBe(15456);
    expect(hasTimestamps(events)).toBe(true);
    expect(traceDurationMicroseconds(events)).toBe(44000 - 15456);
  });

  test('a trace captured without --timestamps reports no duration, not a duration of zero', () => {
    const events = parseTimelineEvents(REAL_RC4_TIMELINE.replace(/"timestampMicroseconds": \d+/g, '"timestampMicroseconds": null'));
    expect(hasTimestamps(events)).toBe(false);
    expect(traceDurationMicroseconds(events)).toBeNull();
  });

  test('a span carries real elapsed time when both of its ends are stamped', () => {
    const timeline = buildTimeline(parseTimelineEvents(REAL_RC4_TIMELINE));
    const span = timeline.spans.find((s) => s.name === 'build_rows');
    expect(span?.units).toBe(1);
    expect(span?.microseconds).toBe(41000 - 32891);
  });

  test('a span in an unstamped trace has null microseconds — never derived from event units', () => {
    const timeline = buildTimeline(parseTimelineEvents(REAL_RC4_TIMELINE.replace(/"timestampMicroseconds": \d+/g, '"timestampMicroseconds": null')));
    const span = timeline.spans.find((s) => s.name === 'build_rows');
    expect(span?.units).toBe(1);
    expect(span?.microseconds).toBeNull();
  });
});
