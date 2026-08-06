import type { ProfilerEvent } from './profile';

/**
 * Performance timeline (Phase 14C) over the real trace stream from
 * `zornux profile timeline --json --trace all`.
 *
 * The runtime emits `sequence` + `depth`, NOT timestamps — so a span's extent is
 * measured in EVENT UNITS (sequence span), and the timeline shows the ORDER and
 * NESTING of work, not wall-clock milliseconds. Overlap here means "one span was
 * open while another ran" (nesting), which is exactly what the depth encodes.
 */

const SPAN_KINDS: Record<string, string> = {
  CallEnter: 'CallExit',
  TaskStart: 'TaskEnd',
  JobStart: 'JobEnd',
  RequestStart: 'RequestEnd',
  QueryStart: 'QueryEnd',
};

export interface Span {
  name: string;
  /** call / query / request / job / task, from the runtime. */
  category: string;
  startSeq: number;
  endSeq: number;
  depth: number;
  /** Extent in event units (endSeq − startSeq). */
  units: number;
  /**
   * Real elapsed microseconds, or null when the trace was captured WITHOUT
   * `--timestamps`. Never derive one from `units`: event units are a count of
   * profiler events, not a duration, and the two are not proportional.
   */
  microseconds: number | null;
  /** True when the trace ended before this span closed. */
  unclosed: boolean;
}

/** Instantaneous events (MessagePublish/Handle, ErrorThrown/Caught). */
export interface Marker {
  name: string;
  kind: string;
  sequence: number;
  depth: number;
}

export interface Timeline {
  spans: Span[];
  markers: Marker[];
  startSeq: number;
  endSeq: number;
  /** Total extent in event units. */
  units: number;
  maxDepth: number;
}

const MARKER_KINDS = new Set(['MessagePublish', 'MessageHandle', 'ErrorThrown', 'ErrorCaught']);

/** Build spans by matching Enter/Exit (or Start/End) pairs by name and nesting. */
export function buildTimeline(events: ProfilerEvent[]): Timeline {
  if (events.length === 0) return { spans: [], markers: [], startSeq: 0, endSeq: 0, units: 0, maxDepth: 0 };

  const startSeq = events[0].sequence;
  const endSeq = events[events.length - 1].sequence;
  const spans: Span[] = [];
  const markers: Marker[] = [];
  const open: { index: number; endKind: string; name: string; startedAt: number | null }[] = [];

  for (const event of events) {
    if (MARKER_KINDS.has(event.kind)) {
      markers.push({ name: event.name, kind: event.kind, sequence: event.sequence, depth: event.depth });
      continue;
    }
    const endKind = SPAN_KINDS[event.kind];
    if (endKind) {
      spans.push({
        name: event.name,
        category: event.category ?? 'other',
        startSeq: event.sequence,
        endSeq: event.sequence,
        depth: event.depth,
        units: 0,
        microseconds: null,
        unclosed: true,
      });
      open.push({ index: spans.length - 1, endKind: endKind, name: event.name, startedAt: event.timestampMicroseconds });
      continue;
    }
    // A closing event: match the innermost open span with this kind + name.
    let i = open.length - 1;
    while (i >= 0 && !(open[i].endKind === event.kind && open[i].name === event.name)) i--;
    if (i < 0) continue;
    const span = spans[open[i].index];
    span.endSeq = event.sequence;
    span.units = event.sequence - span.startSeq;
    // Only when BOTH ends carry a stamp is the duration real.
    const startedAt = open[i].startedAt;
    span.microseconds = startedAt !== null && event.timestampMicroseconds !== null ? event.timestampMicroseconds - startedAt : null;
    span.unclosed = false;
    open.length = i;
  }
  // Close any span still open at the end of the trace.
  for (const frame of open) {
    const span = spans[frame.index];
    span.endSeq = endSeq;
    span.units = endSeq - span.startSeq;
  }

  spans.sort((a, b) => a.startSeq - b.startSeq || a.depth - b.depth);
  const maxDepth = spans.reduce((max, s) => Math.max(max, s.depth), 0);
  return { spans, markers, startSeq, endSeq, units: endSeq - startSeq, maxDepth };
}

/** Do two spans overlap in sequence space? (Nesting counts as overlap.) */
export function spansOverlap(a: Span, b: Span): boolean {
  return a.startSeq < b.endSeq && b.startSeq < a.endSeq;
}

export interface SpanRect {
  span: Span;
  /** Fraction of the total extent, 0..1. */
  x: number;
  width: number;
  lane: number;
}

/**
 * Lay spans out for rendering: `lane` is the nesting depth, `x`/`width` are
 * fractions of the timeline extent. Zero-extent spans get a hairline width so
 * they remain visible.
 */
export function layoutTimeline(timeline: Timeline, minWidth = 0.004): SpanRect[] {
  const total = timeline.units || 1;
  return timeline.spans.map((span) => ({
    span,
    lane: span.depth,
    x: (span.startSeq - timeline.startSeq) / total,
    width: Math.max(minWidth, span.units / total),
  }));
}

/** Aggregate total extent per category (where did the work go?). */
export function categoryTotals(timeline: Timeline): { category: string; units: number; spans: number }[] {
  const totals = new Map<string, { units: number; spans: number }>();
  for (const span of timeline.spans) {
    const entry = totals.get(span.category) ?? { units: 0, spans: 0 };
    entry.units += span.units;
    entry.spans += 1;
    totals.set(span.category, entry);
  }
  return [...totals.entries()]
    .map(([category, value]) => ({ category, ...value }))
    .sort((a, b) => b.units - a.units);
}
