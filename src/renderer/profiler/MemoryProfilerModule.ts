import { ServiceKeys, type ProfilerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { HeapSnapshot } from './profile';
import { diffCounts, heapClassCounts, heapTypeCounts, leakSuspects, summarizeHeap } from './heap';

interface LabelledSnapshot {
  label: string;
  heap: HeapSnapshot;
}

/**
 * Memory Profiler view (Phase 14B). Captures real `zornux profile heap` snapshots,
 * summarizes live object counts, diffs snapshots, and flags leak suspects — object
 * classes that grew and were never reclaimed. The runtime records COUNTS, not bytes
 * (no addresses/values/secrets), so this view never claims byte figures.
 */
export class MemoryProfilerModule implements IModule {
  readonly id = 'znxstudio.perf.memory';
  readonly displayName = 'Memory Profiler';

  private context!: ModuleContext;
  private profiler!: ProfilerService;
  private panel!: HTMLElement;
  private snapshots: LabelledSnapshot[] = [];
  private capturing = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.profiler = context.services.get<ProfilerService>(ServiceKeys.Performance);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-mem';
    context.layout.addPanelView({ id: 'memory-profiler', title: 'Memory', element: this.panel });

    context.commands.register(CommandIds.PerfMemoryShow, () => context.layout.showPanelView('memory-profiler'), 'Performance: Show Memory Profiler');
    context.commands.register(CommandIds.PerfHeapCapture, () => this.capture(), 'Performance: Capture Heap Snapshot');

    this.render();
    void selfTestCoordinator.run('perf-memory', () => this.maybeSelfTest());
  }

  /** Run the real heap profiler and keep the snapshot for comparison. */
  private async capture(): Promise<void> {
    if (this.capturing) return;
    this.capturing = true;
    this.render();
    await this.profiler.profile('heap');
    const heap = this.profiler.report()?.heap ?? null;
    this.capturing = false;
    if (!heap) {
      this.context.layout.showToast('No heap snapshot captured.', 'error');
      this.render();
      return;
    }
    this.snapshots.push({ label: `Snapshot ${this.snapshots.length + 1}`, heap });
    this.render();
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-mem-toolbar';
    const capture = document.createElement('button');
    capture.className = 'znxstudio-btn-small';
    capture.textContent = this.capturing ? 'Capturing…' : 'Capture Heap Snapshot';
    capture.disabled = this.capturing;
    capture.addEventListener('click', () => void this.capture());
    toolbar.appendChild(capture);
    if (this.snapshots.length) {
      const clear = document.createElement('button');
      clear.className = 'znxstudio-btn-small';
      clear.textContent = 'Clear';
      clear.addEventListener('click', () => {
        this.snapshots = [];
        this.render();
      });
      toolbar.appendChild(clear);
    }
    const info = document.createElement('span');
    info.className = 'znxstudio-mem-info';
    info.textContent = `${this.snapshots.length} snapshot${this.snapshots.length === 1 ? '' : 's'} · counts, not bytes`;
    toolbar.appendChild(info);
    this.panel.appendChild(toolbar);

    if (this.snapshots.length === 0) {
      this.panel.appendChild(this.message('Capture a heap snapshot to see live object counts. Capture two or more to diff them and find leaks.'));
      return;
    }

    // Latest snapshot summary.
    const latest = this.snapshots[this.snapshots.length - 1];
    const summary = summarizeHeap(latest.heap);
    this.panel.appendChild(this.section(`${latest.label} — ${summary.totalObjects} live objects · max retained depth ${summary.maxDepth}${summary.truncated ? ' · TRUNCATED' : ''}`));
    this.renderCounts('Types', summary.topTypes);
    if (summary.topClasses.length) this.renderCounts('Object classes', summary.topClasses);
    if (summary.topContainers.length) {
      this.panel.appendChild(this.section('Largest containers'));
      for (const container of summary.topContainers) {
        this.panel.appendChild(this.row(container.kind, `${container.size} elements`));
      }
    }

    // Comparison + leaks.
    if (this.snapshots.length >= 2) {
      const first = this.snapshots[0];
      const last = latest;
      const gc = this.snapshots.length >= 3 ? this.snapshots[this.snapshots.length - 1] : undefined;
      const base = this.snapshots.length >= 3 ? this.snapshots[this.snapshots.length - 2] : last;

      this.panel.appendChild(this.section(`Diff: ${first.label} → ${last.label} (object classes)`));
      const deltas = diffCounts(heapClassCounts(first.heap), heapClassCounts(last.heap)).filter((d) => d.delta !== 0);
      if (deltas.length === 0) this.panel.appendChild(this.message('No class-count changes.'));
      for (const delta of deltas.slice(0, 15)) {
        this.panel.appendChild(this.row(delta.name, `${delta.before} → ${delta.after}  (${delta.delta > 0 ? '+' : ''}${delta.delta})`, delta.delta > 0 ? 'is-grow' : 'is-shrink'));
      }

      const suspects = leakSuspects(first.heap, base.heap, gc?.heap);
      this.panel.appendChild(this.section(gc ? 'Leak suspects (grew, not reclaimed after the later snapshot)' : 'Growth suspects (capture a third snapshot after GC to confirm)'));
      if (suspects.length === 0) this.panel.appendChild(this.message('No retained growth detected.'));
      for (const suspect of suspects) {
        this.panel.appendChild(
          this.row(suspect.name, `${suspect.before} → ${suspect.after} → ${suspect.afterGc}  ·  ${suspect.retained} retained`, 'is-leak'),
        );
      }
    }
  }

  private renderCounts(title: string, counts: { name: string; count: number }[]): void {
    if (counts.length === 0) return;
    this.panel.appendChild(this.section(title));
    for (const entry of counts) this.panel.appendChild(this.row(entry.name, String(entry.count)));
  }

  private section(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-mem-section';
    el.textContent = text;
    return el;
  }

  private row(name: string, value: string, cls = ''): HTMLElement {
    const row = document.createElement('div');
    row.className = `znxstudio-mem-row ${cls}`.trim();
    const label = document.createElement('span');
    label.className = 'znxstudio-mem-name';
    label.textContent = name;
    const val = document.createElement('span');
    val.className = 'znxstudio-mem-value';
    val.textContent = value;
    row.append(label, val);
    return row;
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-mem-empty';
    el.textContent = text;
    return el;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);
    const snap = (customers: number): HeapSnapshot => ({
      totalObjects: customers, maxDepth: 2, truncated: false, types: [], topContainers: [],
      classes: [{ class: 'Customer', count: customers }, { class: 'Order', count: 10 }],
    });
    const suspects = leakSuspects(snap(120), snap(420), snap(420));
    const reclaimed = leakSuspects(snap(120), snap(420), snap(120));
    log(`memory leak: suspects=${suspects.length} ${suspects[0]?.name} ${suspects[0]?.before}→${suspects[0]?.after}→${suspects[0]?.afterGc} retained=${suspects[0]?.retained}`);
    log(`memory reclaimed (420→120 after GC): suspects=${reclaimed.length} (expect 0)`);
    const deltas = diffCounts(heapClassCounts(snap(120)), heapClassCounts(snap(420)));
    log(`memory diff: top=${deltas[0].name} ${deltas[0].before}→${deltas[0].after} delta=${deltas[0].delta}`);
  }
}
