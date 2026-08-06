import { describe, expect, test } from './harness';
import {
  buildTimeline,
  categoryTotals,
  layoutTimeline,
  spansOverlap,
} from '../src/renderer/profiler/timeline';
import type { ProfilerEvent } from '../src/renderer/profiler/profile';

function ev(sequence: number, kind: ProfilerEvent['kind'], name: string, category: string | null, depth = 0): ProfilerEvent {
  return { sequence, kind, name, category, depth, source: null, timestampMicroseconds: null };
}

/** request(0..9) > query(1..5), with an error marker at 6. */
const TRACE: ProfilerEvent[] = [
  ev(0, 'RequestStart', 'GET /invoice', 'request', 0),
  ev(1, 'QueryStart', 'SELECT customer', 'query', 1),
  ev(5, 'QueryEnd', 'SELECT customer', 'query', 1),
  ev(6, 'ErrorThrown', 'Timeout', null, 1),
  ev(9, 'RequestEnd', 'GET /invoice', 'request', 0),
];

describe('buildTimeline', () => {
  test('pairs start/end into spans with event-unit extents', () => {
    const timeline = buildTimeline(TRACE);
    expect(timeline.spans).toHaveLength(2);
    expect(timeline.units).toBe(9);
    expect(timeline.maxDepth).toBe(1);
    const [request, query] = timeline.spans;
    expect(request).toEqual({ name: 'GET /invoice', category: 'request', startSeq: 0, endSeq: 9, depth: 0, units: 9, microseconds: null, unclosed: false });
    expect(query.units).toBe(4);
  });

  test('captures instantaneous markers separately', () => {
    const timeline = buildTimeline(TRACE);
    expect(timeline.markers).toEqual([{ name: 'Timeout', kind: 'ErrorThrown', sequence: 6, depth: 1 }]);
  });

  test('closes unclosed spans at the end of a truncated trace', () => {
    const timeline = buildTimeline([ev(0, 'RequestStart', 'r', 'request'), ev(7, 'ProgramEnd', 'p', 'program')]);
    expect(timeline.spans[0].unclosed).toBe(true);
    expect(timeline.spans[0].units).toBe(7);
  });

  test('matches the innermost span of the same name (recursion)', () => {
    const timeline = buildTimeline([
      ev(0, 'CallEnter', 'f', 'call', 0),
      ev(1, 'CallEnter', 'f', 'call', 1),
      ev(3, 'CallExit', 'f', 'call', 1),
      ev(8, 'CallExit', 'f', 'call', 0),
    ]);
    expect(timeline.spans.map((s) => s.units)).toEqual([8, 2]);
  });

  test('empty trace yields an empty timeline', () => {
    expect(buildTimeline([]).spans).toHaveLength(0);
  });
});

describe('spansOverlap', () => {
  test('nested spans overlap; sequential ones do not', () => {
    const { spans } = buildTimeline(TRACE);
    expect(spansOverlap(spans[0], spans[1])).toBe(true);
    const seq = buildTimeline([
      ev(0, 'CallEnter', 'a', 'call'), ev(2, 'CallExit', 'a', 'call'),
      ev(3, 'CallEnter', 'b', 'call'), ev(5, 'CallExit', 'b', 'call'),
    ]);
    expect(spansOverlap(seq.spans[0], seq.spans[1])).toBe(false);
  });
});

describe('layoutTimeline', () => {
  test('x/width are fractions of the extent and lane is depth', () => {
    const rects = layoutTimeline(buildTimeline(TRACE));
    expect(rects[0].x).toBe(0);
    expect(rects[0].width).toBe(1);
    expect(rects[0].lane).toBe(0);
    expect(rects[0].span.name).toBe('GET /invoice');
    expect(rects[1].x).toBeGreaterThan(0.1);
    expect(rects[1].lane).toBe(1);
  });
  test('zero-extent spans still get a hairline width', () => {
    const rects = layoutTimeline(buildTimeline([ev(0, 'CallEnter', 'f', 'call'), ev(0, 'CallExit', 'f', 'call'), ev(4, 'ProgramEnd', 'p', 'program')]));
    expect(rects[0].width).toBeGreaterThan(0);
  });
});

describe('categoryTotals', () => {
  test('aggregates extent and span count per category', () => {
    expect(categoryTotals(buildTimeline(TRACE))).toEqual([
      { category: 'request', units: 9, spans: 1 },
      { category: 'query', units: 4, spans: 1 },
    ]);
  });
});
