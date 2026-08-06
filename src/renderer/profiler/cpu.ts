import type { HotSpot, ProfileReport, ProfilerEvent } from './profile';

/**
 * CPU profile analysis (Phase 14A). Two real data sources from the Zornux runtime:
 *
 *  • `hotSpots[]` from `profile run --json` — where SAMPLES landed. A sample lands
 *    in the function that was executing, so `samples` is EXCLUSIVE (self) cost.
 *  • the `profile timeline --trace calls` event stream — CallEnter/CallExit pairs,
 *    from which we reconstruct the call tree and INCLUSIVE cost.
 *
 * The runtime emits `sequence`, not timestamps, so inclusive cost is measured in
 * EVENT UNITS (sequence span), never milliseconds. Callers must label it as such.
 */

const ENTER_KINDS = new Set(['CallEnter', 'TaskStart', 'JobStart', 'RequestStart', 'QueryStart']);
const EXIT_KINDS = new Set(['CallExit', 'TaskEnd', 'JobEnd', 'RequestEnd', 'QueryEnd']);

export interface CallNode {
  name: string;
  category: string | null;
  /** How many times this node was entered along this path. */
  calls: number;
  /** Inclusive cost in event units (sum of exit−enter spans). */
  inclusive: number;
  children: CallNode[];
}

interface OpenFrame {
  node: CallNode;
  enterSeq: number;
}

function findOrCreate(parent: CallNode, name: string, category: string | null): CallNode {
  const existing = parent.children.find((c) => c.name === name);
  if (existing) return existing;
  const node: CallNode = { name, category, calls: 0, inclusive: 0, children: [] };
  parent.children.push(node);
  return node;
}

/**
 * Reconstruct the merged call tree from the trace. Identical stacks are merged,
 * accumulating `calls` and `inclusive`. Unclosed frames are closed at the last
 * observed sequence (a truncated trace still yields a usable tree).
 */
export function buildCallTree(events: ProfilerEvent[]): CallNode {
  const root: CallNode = { name: '<program>', category: 'program', calls: 1, inclusive: 0, children: [] };
  if (events.length === 0) return root;

  const lastSeq = events[events.length - 1].sequence;
  const firstSeq = events[0].sequence;
  root.inclusive = lastSeq - firstSeq;

  const stack: OpenFrame[] = [];
  for (const event of events) {
    if (ENTER_KINDS.has(event.kind)) {
      const parent = stack.length ? stack[stack.length - 1].node : root;
      const node = findOrCreate(parent, event.name, event.category);
      node.calls += 1;
      stack.push({ node, enterSeq: event.sequence });
    } else if (EXIT_KINDS.has(event.kind)) {
      // Pop the nearest matching open frame (tolerates a malformed pair).
      let index = stack.length - 1;
      while (index >= 0 && stack[index].node.name !== event.name) index--;
      if (index < 0) continue;
      const frame = stack[index];
      frame.node.inclusive += event.sequence - frame.enterSeq;
      stack.length = index;
    }
  }
  // Close anything still open at the end of the trace.
  for (const frame of stack) frame.node.inclusive += lastSeq - frame.enterSeq;
  return root;
}

/** Exclusive (self) cost of a node in event units: inclusive minus its children. */
export function selfCost(node: CallNode): number {
  const childTotal = node.children.reduce((sum, child) => sum + child.inclusive, 0);
  return Math.max(0, node.inclusive - childTotal);
}

export interface FlatCallRow {
  node: CallNode;
  depth: number;
}

/** Depth-first flatten for a call-tree view (children sorted by inclusive cost). */
export function flattenCallTree(root: CallNode, depth = 0): FlatCallRow[] {
  const rows: FlatCallRow[] = [{ node: root, depth }];
  for (const child of [...root.children].sort((a, b) => b.inclusive - a.inclusive)) {
    rows.push(...flattenCallTree(child, depth + 1));
  }
  return rows;
}

export interface FlameRect {
  name: string;
  depth: number;
  /** Fraction of the total width, 0..1. */
  x: number;
  width: number;
  inclusive: number;
}

/**
 * Flame-graph layout: each node occupies a horizontal slice proportional to its
 * inclusive cost, stacked by depth. Zero-cost subtrees are omitted.
 */
export function flameLayout(root: CallNode): FlameRect[] {
  const rects: FlameRect[] = [];
  const total = root.inclusive || 1;

  const walk = (node: CallNode, depth: number, x: number): void => {
    const width = node.inclusive / total;
    if (width <= 0) return;
    rects.push({ name: node.name, depth, x, width, inclusive: node.inclusive });
    let cursor = x;
    for (const child of [...node.children].sort((a, b) => b.inclusive - a.inclusive)) {
      walk(child, depth + 1, cursor);
      cursor += child.inclusive / total;
    }
  };
  walk(root, 0, 0);
  return rects;
}

/**
 * Exclusive (self) cost per function, straight from the runtime's sample counts.
 * `percent` is the runtime's own share-of-samples figure.
 */
export function exclusiveTotals(report: ProfileReport): HotSpot[] {
  return [...report.hotSpots].sort((a, b) => b.samples - a.samples || b.calls - a.calls);
}

/** A portable JSON export of everything captured (report + trace). */
export function exportProfile(report: ProfileReport | null, events: ProfilerEvent[]): string {
  return `${JSON.stringify({ tool: 'znxstudio', format: 'zornux-profile', version: 1, report, events }, null, 2)}\n`;
}
