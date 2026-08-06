import { describe, expect, test } from './harness';
import {
  hottestLines,
  mostCalled,
  recommendations,
  slowestSpans,
  subsystemCounts,
  topAllocators,
  topCpu,
} from '../src/renderer/profiler/hotspots';
import {
  allocationHeavyFunctions,
  allocationRate,
  allocationsByFunction,
  allocationsByType,
  attributionFor,
} from '../src/renderer/profiler/allocations';
import { buildTimeline } from '../src/renderer/profiler/timeline';
import { emptyReport, type ProfileReport, type ProfilerEvent } from '../src/renderer/profiler/profile';

const REPORT: ProfileReport = {
  ...emptyReport(),
  totalSamples: 100,
  totalCalls: 2_400_002,
  totalAllocations: 1000,
  hotSpots: [
    { name: '<program>', calls: 0, samples: 2, allocations: 0, percent: 2, source: null },
    { name: 'calculateTax', calls: 1, samples: 68, allocations: 900, percent: 68, source: 'a.zx:12' },
    { name: 'saveInvoice', calls: 1, samples: 20, allocations: 100, percent: 20, source: null },
    { name: 'formatDate', calls: 2_400_000, samples: 10, allocations: 0, percent: 10, source: null },
  ],
  hotLines: [{ source: 'a.zx:12', samples: 68, percent: 68 }, { source: 'a.zx:40', samples: 20, percent: 20 }],
  allocations: [{ type: 'Number', count: 900 }, { type: 'Text', count: 100 }],
  subsystems: [{ category: 'query', count: 3 }, { category: 'request', count: 9 }],
};

describe('hotspot rankings', () => {
  test('topCpu excludes the synthetic <program> frame by default', () => {
    expect(topCpu(REPORT).map((s) => s.name)).toEqual(['calculateTax', 'saveInvoice', 'formatDate']);
    expect(topCpu(REPORT, 10, true).map((s) => s.name)).toContain('<program>');
  });
  test('mostCalled surfaces the 2.4M-call function', () => {
    expect(mostCalled(REPORT, 1)[0]).toEqual({ name: 'formatDate', calls: 2_400_000, samples: 10, allocations: 0, percent: 10, source: null });
  });
  test('topAllocators ranks by allocation count and skips zero', () => {
    expect(topAllocators(REPORT).map((s) => s.name)).toEqual(['calculateTax', 'saveInvoice']);
  });
  test('hottestLines and subsystemCounts sort by magnitude', () => {
    expect(hottestLines(REPORT)[0].source).toBe('a.zx:12');
    expect(subsystemCounts(REPORT).map((s) => s.category)).toEqual(['request', 'query']);
  });
});

describe('slowestSpans', () => {
  const events: ProfilerEvent[] = [
    { sequence: 0, kind: 'RequestStart', name: 'GET /x', category: 'request', depth: 0, source: null, timestampMicroseconds: null },
    { sequence: 1, kind: 'QueryStart', name: 'SELECT big', category: 'query', depth: 1, source: null, timestampMicroseconds: null },
    { sequence: 9, kind: 'QueryEnd', name: 'SELECT big', category: 'query', depth: 1, source: null, timestampMicroseconds: null },
    { sequence: 10, kind: 'RequestEnd', name: 'GET /x', category: 'request', depth: 0, source: null, timestampMicroseconds: null },
  ];
  test('ranks widest spans and can filter by category', () => {
    const timeline = buildTimeline(events);
    expect(slowestSpans(timeline, 1)[0].name).toBe('GET /x');
    expect(slowestSpans(timeline, 1, 'query')[0].name).toBe('SELECT big');
  });
});

describe('recommendations', () => {
  test('flags a dominant function, a hot call count, and a dominant allocator', () => {
    const titles = recommendations(REPORT).map((r) => r.title);
    expect(titles[0]).toContain('calculateTax dominates CPU');
    expect(titles.some((t) => t.includes('formatDate is called'))).toBe(true);
    expect(titles.some((t) => t.includes('90% of allocations'))).toBe(true);
  });
  test('stays quiet on a flat profile and warns on truncation', () => {
    const flat = { ...emptyReport(), totalSamples: 10, hotSpots: [{ name: 'a', calls: 1, samples: 2, allocations: 0, percent: 20, source: null }] };
    expect(recommendations(flat)).toHaveLength(0);
    expect(recommendations({ ...flat, truncated: true }).map((r) => r.title)).toContain('Profile was truncated');
  });
});

describe('allocation analysis', () => {
  test('byType and byFunction carry share percentages', () => {
    expect(allocationsByType(REPORT)[0]).toEqual({ name: 'Number', count: 900, percent: 90 });
    expect(allocationsByFunction(REPORT)[0]).toEqual({ name: 'calculateTax', count: 900, percent: 90 });
  });
  test('allocationRate normalizes per call and per sample', () => {
    const rate = allocationRate(REPORT);
    expect(rate.perSample).toBe(10);
    expect(allocationRate(emptyReport()).perCall).toBe(0); // no divide-by-zero
  });
  test('allocationHeavyFunctions ranks allocations per sample', () => {
    expect(allocationHeavyFunctions(REPORT)[0].name).toBe('calculateTax'); // 900/68 > 100/20
  });
  test('attributionFor returns a share, or null for an unknown function', () => {
    expect(attributionFor(REPORT, 'saveInvoice')).toEqual({ name: 'saveInvoice', count: 100, percent: 10 });
    expect(attributionFor(REPORT, 'nope')).toBeNull();
  });
});
