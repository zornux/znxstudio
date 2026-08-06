import { describe, expect, test } from './harness';
import {
  buildProfileArgs,
  parseProfileReport,
  parseTimelineEvents,
} from '../src/renderer/profiler/profile';

/** Real `zornux profile run --json` output: program output precedes the envelope. */
const REPORT_STDOUT = `799960000
1
{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": {
  "engine": "interpreter",
  "totalCalls": 3,
  "totalSamples": 41,
  "totalAllocations": 0,
  "hotSpots": [
    { "name": "compute_rate", "calls": 1, "samples": 40, "allocations": 0, "percent": 97.56, "source": null },
    { "name": "<program>", "calls": 0, "samples": 1, "allocations": 0, "percent": 2.44, "source": null }
  ],
  "hotLines": [ { "source": "zx-prof.zx:5", "samples": 40, "percent": 97.56 } ],
  "allocations": [],
  "subsystems": [],
  "heap": null,
  "truncated": false,
  "notes": []
  }, "diagnostics": []
}`;

const HEAP_STDOUT = `1
{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": {
  "engine": "interpreter", "totalCalls": 3, "totalSamples": 41, "totalAllocations": 0,
  "hotSpots": [], "hotLines": [], "allocations": [{ "type": "Number", "count": 59586 }],
  "subsystems": [{ "category": "query", "count": 2 }],
  "heap": { "totalObjects": 3, "maxDepth": 1, "truncated": false,
    "types": [{ "type": "Function", "count": 3 }],
    "classes": [{ "class": "Customer", "count": 420 }],
    "topContainers": [{ "kind": "List", "size": 12 }] },
  "truncated": true,
  "notes": ["timeline truncated"]
  }, "diagnostics": []
}`;

const TIMELINE_STDOUT = `799960000
{
  "zornuxJson": 1, "ok": true, "command": "profile", "result": [
  { "sequence": 0, "kind": "ProgramStart", "name": "program", "category": "program", "depth": 0, "source": null },
  { "sequence": 1, "kind": "CallEnter", "name": "calculate_tax", "category": "call", "depth": 1, "source": null },
  { "sequence": 2, "kind": "CallExit", "name": "calculate_tax", "category": "call", "depth": 1, "source": null },
  { "sequence": 3, "kind": "Bogus", "name": "x", "category": null, "depth": 0, "source": null },
  { "sequence": 4, "kind": "ProgramEnd", "name": "program", "category": "program", "depth": 0, "source": null }
  ], "diagnostics": []
}`;

describe('buildProfileArgs', () => {
  test('builds the real CLI argv with --json by default', () => {
    expect(buildProfileArgs('run', 'a.zx')).toEqual(['profile', 'run', 'a.zx', '--json']);
  });
  test('threads trace, caps, and sampling interval', () => {
    expect(buildProfileArgs('timeline', 'a.zx', { trace: 'all', maxEvents: 500, samplingInterval: 4, maxSamples: 10 })).toEqual([
      'profile', 'timeline', 'a.zx', '--json', '--trace', 'all', '--max-samples', '10', '--max-events', '500', '--sampling-interval', '4',
    ]);
  });
  test('json can be disabled for the human-readable report', () => {
    expect(buildProfileArgs('heap', 'a.zx', { json: false })).toEqual(['profile', 'heap', 'a.zx']);
  });
});

describe('parseProfileReport', () => {
  test('extracts the trailing JSON past the program output', () => {
    const report = parseProfileReport(REPORT_STDOUT)!;
    expect(report.engine).toBe('interpreter');
    expect(report.totalSamples).toBe(41);
    expect(report.hotSpots).toHaveLength(2);
    expect(report.hotSpots[0].name).toBe('compute_rate');
    expect(report.hotSpots[0].percent).toBe(97.56);
    expect(report.hotLines[0].source).toBe('zx-prof.zx:5');
    expect(report.heap).toBeNull();
  });
  test('parses heap counts, subsystems, truncation and notes', () => {
    const report = parseProfileReport(HEAP_STDOUT)!;
    expect(report.heap!.totalObjects).toBe(3);
    expect(report.heap!.classes[0]).toEqual({ class: 'Customer', count: 420 });
    expect(report.heap!.topContainers[0]).toEqual({ kind: 'List', size: 12 });
    expect(report.allocations[0]).toEqual({ type: 'Number', count: 59586 });
    expect(report.subsystems[0]).toEqual({ category: 'query', count: 2 });
    expect(report.truncated).toBe(true);
    expect(report.notes).toEqual(['timeline truncated']);
  });
  test('returns null for non-report output', () => {
    expect(parseProfileReport('just program output')).toBeNull();
    expect(parseProfileReport('{ "notEngine": 1 }')).toBeNull();
  });
});

describe('parseTimelineEvents', () => {
  test('extracts the trailing array and drops unknown kinds', () => {
    const events = parseTimelineEvents(TIMELINE_STDOUT);
    expect(events).toHaveLength(4); // "Bogus" dropped
    expect(events[0].kind).toBe('ProgramStart');
    expect(events[1]).toEqual({ sequence: 1, kind: 'CallEnter', name: 'calculate_tax', category: 'call', depth: 1, source: null, timestampMicroseconds: null });
  });
  test('sorts by sequence and tolerates junk', () => {
    expect(parseTimelineEvents('no json here')).toHaveLength(0);
    const events = parseTimelineEvents(
      '{"zornuxJson":1,"ok":true,"command":"profile","result":[{"sequence":2,"kind":"ProgramEnd","name":"p","depth":0},{"sequence":1,"kind":"ProgramStart","name":"p","depth":0}],"diagnostics":[]}',
    );
    expect(events.map((e) => e.sequence)).toEqual([1, 2]);
  });
});
