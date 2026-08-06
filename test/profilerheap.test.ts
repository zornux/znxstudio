import { describe, expect, test } from './harness';
import {
  diffCounts,
  heapClassCounts,
  heapTypeCounts,
  leakSuspects,
  summarizeHeap,
} from '../src/renderer/profiler/heap';
import type { HeapSnapshot } from '../src/renderer/profiler/profile';

function snap(customers: number, extra: Partial<HeapSnapshot> = {}): HeapSnapshot {
  return {
    totalObjects: customers + 10,
    maxDepth: 3,
    truncated: false,
    types: [{ type: 'Number', count: 500 }, { type: 'Text', count: 20 }],
    classes: [{ class: 'Customer', count: customers }, { class: 'Order', count: 10 }],
    topContainers: [{ kind: 'List', size: 42 }, { kind: 'Map', size: 7 }],
    ...extra,
  };
}

describe('count extraction', () => {
  test('classes and types become named counts', () => {
    expect(heapClassCounts(snap(5))).toEqual([{ name: 'Customer', count: 5 }, { name: 'Order', count: 10 }]);
    expect(heapTypeCounts(snap(5))[0]).toEqual({ name: 'Number', count: 500 });
  });
});

describe('diffCounts', () => {
  test('computes deltas, grown first, treating missing as zero', () => {
    const deltas = diffCounts([{ name: 'Customer', count: 120 }, { name: 'Gone', count: 5 }], [{ name: 'Customer', count: 420 }, { name: 'New', count: 3 }]);
    expect(deltas[0]).toEqual({ name: 'Customer', before: 120, after: 420, delta: 300 });
    expect(deltas.find((d) => d.name === 'New')).toEqual({ name: 'New', before: 0, after: 3, delta: 3 });
    expect(deltas.find((d) => d.name === 'Gone')).toEqual({ name: 'Gone', before: 5, after: 0, delta: -5 });
  });
});

describe('leakSuspects', () => {
  test('flags growth that survives a later snapshot (120 → 420 → 420)', () => {
    const suspects = leakSuspects(snap(120), snap(420), snap(420));
    expect(suspects).toHaveLength(1);
    expect(suspects[0]).toEqual({ name: 'Customer', before: 120, after: 420, afterGc: 420, retained: 300 });
  });

  test('reclaimed objects are not leaks (120 → 420 → 120)', () => {
    expect(leakSuspects(snap(120), snap(420), snap(120))).toHaveLength(0);
  });

  test('partial reclamation still retains', () => {
    const [suspect] = leakSuspects(snap(120), snap(420), snap(200));
    expect(suspect.retained).toBe(80);
  });

  test('without a third snapshot, growth alone is the signal', () => {
    expect(leakSuspects(snap(120), snap(420))).toHaveLength(1);
    expect(leakSuspects(snap(120), snap(120))).toHaveLength(0);
  });

  test('minGrowth suppresses noise', () => {
    expect(leakSuspects(snap(120), snap(121), snap(121), 5)).toHaveLength(0);
  });
});

describe('summarizeHeap', () => {
  test('returns top-N sorted types, classes and containers', () => {
    const summary = summarizeHeap(snap(420), 1);
    expect(summary.totalObjects).toBe(430);
    expect(summary.maxDepth).toBe(3);
    expect(summary.topTypes).toEqual([{ name: 'Number', count: 500 }]);
    expect(summary.topClasses).toEqual([{ name: 'Customer', count: 420 }]);
    expect(summary.topContainers).toEqual([{ kind: 'List', size: 42 }]);
  });
});
