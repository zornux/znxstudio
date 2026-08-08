import { ServiceKeys, type ProfilerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  buildCallTree,
  exclusiveTotals,
  exportProfile,
  flameLayout,
  flattenCallTree,
  selfCost,
} from './cpu';

/**
 * CPU Profiler view (Phase 14A). Renders the real runtime data three ways:
 * the hot-spot table (exclusive sample counts + the runtime's own percent), the
 * reconstructed call tree (inclusive vs exclusive), and a flame graph. Inclusive
 * cost is in EVENT UNITS — the runtime emits sequence numbers, not timestamps.
 */
export class CpuProfilerModule implements IModule {
  readonly id = 'znxstudio.perf.cpu';
  readonly displayName = 'CPU Profiler';

  private context!: ModuleContext;
  private profiler!: ProfilerService;
  private panel!: HTMLElement;
  private view: 'hotspots' | 'tree' | 'flame' = 'hotspots';

  activate(context: ModuleContext): void {
    this.context = context;
    this.profiler = context.services.get<ProfilerService>(ServiceKeys.Performance);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-cpu';
    context.layout.addPanelView({ id: 'cpu-profiler', title: 'CPU', element: this.panel });

    context.commands.register(CommandIds.PerfCpuShow, () => context.layout.showPanelView('cpu-profiler'), 'Performance: Show CPU Profiler');
    context.commands.register(CommandIds.PerfExport, () => this.exportProfile(), 'Performance: Export Profile');

    context.subscriptions.push(this.profiler.onDidChange(() => this.render()));
    this.render();
    void selfTestCoordinator.run('perf-cpu', () => this.maybeSelfTest());
  }

  private exportProfile(): void {
    const json = exportProfile(this.profiler.report(), this.profiler.events());
    void navigator.clipboard?.writeText(json);
    this.context.layout.showToast('Profile JSON copied to the clipboard.', 'success');
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-cpu-toolbar';
    for (const view of ['hotspots', 'tree', 'flame'] as const) {
      const button = document.createElement('button');
      button.className = `znxstudio-btn-small${this.view === view ? ' is-active' : ''}`;
      button.textContent = view === 'hotspots' ? 'Hot Spots' : view === 'tree' ? 'Call Tree' : 'Flame Graph';
      button.addEventListener('click', () => {
        this.view = view;
        this.render();
      });
      toolbar.appendChild(button);
    }
    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'znxstudio-btn-small';
    exportBtn.textContent = 'Export';
    exportBtn.addEventListener('click', () => this.exportProfile());
    toolbar.append(spacer, exportBtn);
    this.panel.appendChild(toolbar);

    const report = this.profiler.report();
    const events = this.profiler.events();

    if (this.view === 'hotspots') {
      if (!report) return void this.panel.appendChild(this.message('Run "Profile CPU" from the Performance panel.'));
      this.renderHotSpots(report);
      return;
    }
    if (events.length === 0) {
      this.panel.appendChild(this.message('Run "Profile Timeline" to capture the call trace this view needs.'));
      return;
    }
    if (this.view === 'tree') this.renderTree(events);
    else this.renderFlame(events);
  }

  private renderHotSpots(report: ReturnType<ProfilerService['report']> & object): void {
    const head = document.createElement('div');
    head.className = 'znxstudio-cpu-summary';
    head.textContent = `${report.engine} engine · ${report.totalSamples} samples · ${report.totalCalls} calls · exclusive (self) cost`;
    this.panel.appendChild(head);

    for (const spot of exclusiveTotals(report)) {
      const row = document.createElement('div');
      row.className = 'znxstudio-cpu-row';
      const bar = document.createElement('div');
      bar.className = 'znxstudio-cpu-bar';
      bar.style.width = `${Math.min(100, spot.percent)}%`;
      const name = document.createElement('span');
      name.className = 'znxstudio-cpu-name';
      name.textContent = spot.name;
      const pct = document.createElement('span');
      pct.className = 'znxstudio-cpu-pct';
      pct.textContent = `${spot.percent.toFixed(2)}%`;
      const meta = document.createElement('span');
      meta.className = 'znxstudio-cpu-meta';
      meta.textContent = `${spot.samples} samples · ${spot.calls} calls${spot.source ? ` · ${spot.source}` : ''}`;
      row.append(bar, name, pct, meta);
      this.panel.appendChild(row);
    }

    if (report.hotLines.length) {
      const lines = document.createElement('div');
      lines.className = 'znxstudio-cpu-summary';
      lines.textContent = 'Hot source lines';
      this.panel.appendChild(lines);
      for (const line of report.hotLines) {
        const row = document.createElement('div');
        row.className = 'znxstudio-cpu-line';
        row.textContent = `${line.source} — ${line.samples} samples (${line.percent.toFixed(2)}%)`;
        this.panel.appendChild(row);
      }
    }
  }

  private renderTree(events: ReturnType<ProfilerService['events']>): void {
    const root = buildCallTree(events);
    const head = document.createElement('div');
    head.className = 'znxstudio-cpu-summary';
    head.textContent = 'Call tree — inclusive / self cost in event units (the runtime emits sequence, not time)';
    this.panel.appendChild(head);

    for (const { node, depth } of flattenCallTree(root)) {
      const row = document.createElement('div');
      row.className = 'znxstudio-cpu-treerow';
      row.style.paddingLeft = `${8 + depth * 14}px`;
      const name = document.createElement('span');
      name.className = 'znxstudio-cpu-name';
      name.textContent = node.name;
      const stats = document.createElement('span');
      stats.className = 'znxstudio-cpu-meta';
      stats.textContent = `incl ${node.inclusive} · self ${selfCost(node)} · ${node.calls} call${node.calls === 1 ? '' : 's'}`;
      row.append(name, stats);
      this.panel.appendChild(row);
    }
  }

  private renderFlame(events: ReturnType<ProfilerService['events']>): void {
    const rects = flameLayout(buildCallTree(events));
    const head = document.createElement('div');
    head.className = 'znxstudio-cpu-summary';
    head.textContent = 'Flame graph — width is inclusive cost (event units)';
    this.panel.appendChild(head);

    const flame = document.createElement('div');
    flame.className = 'znxstudio-cpu-flame';
    const maxDepth = Math.max(...rects.map((r) => r.depth));
    flame.style.height = `${(maxDepth + 1) * 20}px`;
    for (const rect of rects) {
      const block = document.createElement('div');
      block.className = 'znxstudio-cpu-frame';
      block.style.left = `${rect.x * 100}%`;
      block.style.width = `${rect.width * 100}%`;
      block.style.top = `${rect.depth * 20}px`;
      block.textContent = rect.name;
      block.title = `${rect.name} — inclusive ${rect.inclusive} units (${(rect.width * 100).toFixed(1)}%)`;
      flame.appendChild(block);
    }
    this.panel.appendChild(flame);
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-cpu-empty';
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
    const events = [
      { sequence: 0, kind: 'ProgramStart' as const, name: 'program', category: 'program', depth: 0, source: null, timestampMicroseconds: null },
      { sequence: 1, kind: 'CallEnter' as const, name: 'calculate_tax', category: 'call', depth: 1, source: null, timestampMicroseconds: null },
      { sequence: 2, kind: 'CallEnter' as const, name: 'compute_rate', category: 'call', depth: 2, source: null, timestampMicroseconds: null },
      { sequence: 8, kind: 'CallExit' as const, name: 'compute_rate', category: 'call', depth: 2, source: null, timestampMicroseconds: null },
      { sequence: 9, kind: 'CallExit' as const, name: 'calculate_tax', category: 'call', depth: 1, source: null, timestampMicroseconds: null },
      { sequence: 10, kind: 'ProgramEnd' as const, name: 'program', category: 'program', depth: 0, source: null, timestampMicroseconds: null },
    ];
    const root = buildCallTree(events);
    const tax = root.children[0];
    const rate = tax.children[0];
    log(`cpu tree: root.incl=${root.inclusive} tax.incl=${tax.inclusive} tax.self=${selfCost(tax)} rate.incl=${rate.inclusive} (tax self=2, rate=6)`);
    const flame = flameLayout(root);
    log(`cpu flame: frames=${flame.length} rootWidth=${flame[0].width} deepest=${Math.max(...flame.map((f) => f.depth))}`);
  }
}
