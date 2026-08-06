import { describe, expect, test } from './harness';
import {
  buildCallTree,
  exclusiveTotals,
  exportProfile,
  flameLayout,
  flattenCallTree,
  selfCost,
} from '../src/renderer/profiler/cpu';
import { emptyReport, type ProfilerEvent } from '../src/renderer/profiler/profile';

function ev(sequence: number, kind: ProfilerEvent['kind'], name: string, depth = 0): ProfilerEvent {
  return { sequence, kind, name, category: kind.startsWith('Call') ? 'call' : 'program', depth, source: null, timestampMicroseconds: null };
}

/** program(0..10) > calculate_tax(1..9) > compute_rate(2..8) */
const TRACE: ProfilerEvent[] = [
  ev(0, 'ProgramStart', 'program'),
  ev(1, 'CallEnter', 'calculate_tax', 1),
  ev(2, 'CallEnter', 'compute_rate', 2),
  ev(8, 'CallExit', 'compute_rate', 2),
  ev(9, 'CallExit', 'calculate_tax', 1),
  ev(10, 'ProgramEnd', 'program'),
];

describe('buildCallTree', () => {
  test('reconstructs nesting with inclusive cost in event units', () => {
    const root = buildCallTree(TRACE);
    expect(root.inclusive).toBe(10);
    const tax = root.children[0];
    expect(tax.name).toBe('calculate_tax');
    expect(tax.inclusive).toBe(8); // 9 - 1
    expect(tax.children[0].name).toBe('compute_rate');
    expect(tax.children[0].inclusive).toBe(6); // 8 - 2
  });

  test('merges repeated calls of the same function and counts them', () => {
    const root = buildCallTree([
      ev(0, 'ProgramStart', 'program'),
      ev(1, 'CallEnter', 'f', 1),
      ev(3, 'CallExit', 'f', 1),
      ev(4, 'CallEnter', 'f', 1),
      ev(9, 'CallExit', 'f', 1),
      ev(10, 'ProgramEnd', 'program'),
    ]);
    expect(root.children).toHaveLength(1);
    expect(root.children[0].calls).toBe(2);
    expect(root.children[0].inclusive).toBe(7); // 2 + 5
  });

  test('closes unclosed frames at the end of a truncated trace', () => {
    const root = buildCallTree([ev(0, 'ProgramStart', 'program'), ev(1, 'CallEnter', 'f', 1), ev(9, 'ProgramEnd', 'program')]);
    expect(root.children[0].inclusive).toBe(8); // closed at last sequence
  });

  test('handles subsystem spans (queries/requests) and empty traces', () => {
    const root = buildCallTree([ev(0, 'ProgramStart', 'p'), ev(1, 'QueryStart', 'SELECT', 1), ev(5, 'QueryEnd', 'SELECT', 1), ev(6, 'ProgramEnd', 'p')]);
    expect(root.children[0].name).toBe('SELECT');
    expect(root.children[0].inclusive).toBe(4);
    expect(buildCallTree([]).children).toHaveLength(0);
  });
});

describe('selfCost', () => {
  test('is inclusive minus children (exclusive cost)', () => {
    const root = buildCallTree(TRACE);
    const tax = root.children[0];
    expect(selfCost(tax)).toBe(2); // 8 inclusive - 6 in compute_rate
    expect(selfCost(tax.children[0])).toBe(6); // leaf: all self
    expect(selfCost(root)).toBe(2); // 10 - 8
  });
});

describe('flattenCallTree', () => {
  test('depth-first with depths, children sorted by inclusive', () => {
    const rows = flattenCallTree(buildCallTree(TRACE));
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual(['0:<program>', '1:calculate_tax', '2:compute_rate']);
  });
});

describe('flameLayout', () => {
  test('widths are inclusive proportions and stack by depth', () => {
    const rects = flameLayout(buildCallTree(TRACE));
    expect(rects[0]).toEqual({ name: '<program>', depth: 0, x: 0, width: 1, inclusive: 10 });
    expect(rects[1].name).toBe('calculate_tax');
    expect(rects[1].width).toBe(0.8);
    expect(rects[2].width).toBe(0.6);
  });
  test('zero-cost subtrees are omitted', () => {
    const root = buildCallTree([ev(0, 'ProgramStart', 'p'), ev(1, 'CallEnter', 'f', 1), ev(1, 'CallExit', 'f', 1), ev(4, 'ProgramEnd', 'p')]);
    expect(flameLayout(root).map((r) => r.name)).toEqual(['<program>']);
  });
});

describe('exclusiveTotals & exportProfile', () => {
  test('sorts hot spots by sample count (samples are self cost)', () => {
    const report = { ...emptyReport(), hotSpots: [
      { name: 'a', calls: 1, samples: 2, allocations: 0, percent: 5, source: null, timestampMicroseconds: null },
      { name: 'b', calls: 1, samples: 40, allocations: 0, percent: 95, source: null, timestampMicroseconds: null },
    ] };
    expect(exclusiveTotals(report).map((h) => h.name)).toEqual(['b', 'a']);
  });
  test('export is valid JSON carrying report and events', () => {
    const parsed = JSON.parse(exportProfile(emptyReport(), TRACE));
    expect(parsed.format).toBe('zornux-profile');
    expect(parsed.events).toHaveLength(6);
  });
});
