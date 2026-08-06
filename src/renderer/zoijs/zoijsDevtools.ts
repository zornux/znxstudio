/**
 * Zoijs DevTools foundation (Phase 6F). Zoijs exposes a runtime, read-only
 * inspector hook at `@zoijs/core/devtools` (`attachInspector`, RFC 0005): the
 * reactive engine fires `onAttach / onCreate(node, kind, label) / onRun / onWrite
 * / onDispose` at lifecycle points. This module is the IDE-side foundation:
 *   - a pure `DevtoolsModel` that folds a stream of inspector events into a live
 *     reactive-node view (kinds, run/write counts, liveness);
 *   - `ZOIJS_DEVTOOLS_BRIDGE` — the small injectable snippet that attaches to the
 *     real hook in a running app and forwards serialized events to the IDE.
 * Live Preview (6G) will point this at an actual page; here it is verified
 * against the real hook's contract + the real reactivity engine.
 */

/** Serializable events forwarded by the bridge (nodes reduced to ids). */
export type DevtoolsEvent =
  | { type: 'attach' }
  | { type: 'detach' }
  | { type: 'create'; id: number; nodeKind: string; label?: string }
  | { type: 'run'; id: number }
  | { type: 'write'; id: number }
  | { type: 'dispose'; id: number };

export interface DevtoolsNode {
  id: number;
  kind: string;
  label?: string;
  runs: number;
  writes: number;
  alive: boolean;
}

export interface DevtoolsSnapshot {
  attached: boolean;
  nodes: DevtoolsNode[];
  countsByKind: Record<string, number>;
  totalRuns: number;
  totalWrites: number;
  liveCount: number;
}

/**
 * Folds inspector events into a live model. Pure/deterministic — no DOM, no time
 * source — so it is unit-testable and identical whether driven by the real
 * engine, a preview page (6G), or synthetic events.
 */
export class DevtoolsModel {
  private attached = false;
  private readonly nodes = new Map<number, DevtoolsNode>();

  apply(event: DevtoolsEvent): void {
    switch (event.type) {
      case 'attach':
        this.attached = true;
        break;
      case 'detach':
        this.attached = false;
        break;
      case 'create':
        this.nodes.set(event.id, { id: event.id, kind: event.nodeKind, label: event.label, runs: 0, writes: 0, alive: true });
        break;
      case 'run': {
        const node = this.nodes.get(event.id);
        if (node) node.runs += 1;
        break;
      }
      case 'write': {
        const node = this.nodes.get(event.id);
        if (node) node.writes += 1;
        break;
      }
      case 'dispose': {
        const node = this.nodes.get(event.id);
        if (node) node.alive = false;
        break;
      }
    }
  }

  isAttached(): boolean {
    return this.attached;
  }

  reset(): void {
    this.attached = false;
    this.nodes.clear();
  }

  snapshot(): DevtoolsSnapshot {
    const nodes = [...this.nodes.values()];
    const countsByKind: Record<string, number> = {};
    let totalRuns = 0;
    let totalWrites = 0;
    let liveCount = 0;
    for (const node of nodes) {
      countsByKind[node.kind] = (countsByKind[node.kind] ?? 0) + 1;
      totalRuns += node.runs;
      totalWrites += node.writes;
      if (node.alive) liveCount += 1;
    }
    return { attached: this.attached, nodes, countsByKind, totalRuns, totalWrites, liveCount };
  }
}

/**
 * The inspector callbacks the real engine invokes (from
 * vendor/zoijs/core/reactivity/devtools.js). The bridge implements exactly
 * these; the self-test asserts this set matches the real file.
 */
export const BRIDGE_CALLBACKS: readonly string[] = ['onAttach', 'onCreate', 'onRun', 'onWrite', 'onDispose'];

// The injectable bridge lives in shared (the main-process preview server injects
// it into served HTML). Re-exported here for the renderer + tests.
export { ZOIJS_DEVTOOLS_BRIDGE } from '../../shared/zoijsPreview';
