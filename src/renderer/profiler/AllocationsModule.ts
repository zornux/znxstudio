import { ServiceKeys, type ProfilerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { emptyReport } from './profile';
import {
  allocationHeavyFunctions,
  allocationRate,
  allocationsByFunction,
  allocationsByType,
  attributionFor,
  formatStack,
  gcSummary,
  hasAllocationStacks,
  topAllocationSites,
} from './allocations';

/**
 * Allocation Tracking view (Phase 14E). Shows where memory is allocated, from the
 * real `zornux profile allocations` run: which TYPES are allocated, which
 * FUNCTIONS allocate them, and the allocation rate per call/sample. The runtime
 * reports counts of allocated values — not bytes, and without per-allocation
 * stacks — so attribution is per-function, which is exactly the question
 * "which function is allocating all these objects?".
 */
export class AllocationsModule implements IModule {
  readonly id = 'znxstudio.perf.allocations';
  readonly displayName = 'Allocation Tracking';

  private context!: ModuleContext;
  private profiler!: ProfilerService;
  private panel!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.profiler = context.services.get<ProfilerService>(ServiceKeys.Performance);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-alloc';
    context.layout.addPanelView({ id: 'perf-allocations', title: 'Allocations', element: this.panel });
    context.commands.register(CommandIds.PerfAllocationsShow, () => context.layout.showPanelView('perf-allocations'), 'Performance: Show Allocations');

    context.subscriptions.push(this.profiler.onDidChange(() => this.render()));
    this.render();
    void selfTestCoordinator.run('perf-allocations', () => this.maybeSelfTest());
  }

  private render(): void {
    this.panel.replaceChildren();
    const report = this.profiler.report();
    if (!report) {
      this.panel.appendChild(this.message('Run "Profile Allocations" from the Performance panel.'));
      return;
    }
    if (report.totalAllocations === 0) {
      this.panel.appendChild(this.message('No allocations recorded. Use "Profile Allocations" (CPU profiling alone does not track them).'));
      return;
    }

    const rate = allocationRate(report);
    this.panel.appendChild(
      this.section(`${rate.totalAllocations.toLocaleString()} allocations · ${rate.perCall.toFixed(1)} per call · ${rate.perSample.toFixed(1)} per sample (counts, not bytes)`),
    );

    this.bars('By type — what is being allocated', allocationsByType(report));
    this.bars('By function — where it is allocated', allocationsByFunction(report));

    const heavy = allocationHeavyFunctions(report).slice(0, 5);
    if (heavy.length) {
      this.panel.appendChild(this.section('Allocating in hot code (allocations per CPU sample)'));
      for (const spot of heavy) {
        this.panel.appendChild(this.row(spot.name, `${(spot.allocations / spot.samples).toFixed(1)} alloc/sample · ${spot.allocations.toLocaleString()} total`, 0));
      }
    }

    // rc.4: the join between "what" and "where" — the call stack behind each allocation.
    if (hasAllocationStacks(report)) {
      this.panel.appendChild(this.section('Allocation sites — the call stack that produced each value'));
      for (const site of topAllocationSites(report, 12)) {
        this.panel.appendChild(this.row(`${site.type} × ${site.count.toLocaleString()}`, formatStack(site.stack), 0));
      }
    } else {
      this.panel.appendChild(
        this.message('No call stacks were captured. Re-profile with allocation stacks to trace each allocation back through its callers.'),
      );
    }

    const gc = gcSummary(report);
    if (gc) {
      this.panel.appendChild(this.section('Garbage collection'));
      this.panel.appendChild(this.message(`${gc}. These bytes are the host runtime's, not the program's logical heap.`));
    }
  }

  private bars(title: string, entries: { name: string; count: number; percent: number }[]): void {
    if (entries.length === 0) return;
    this.panel.appendChild(this.section(title));
    for (const entry of entries) {
      this.panel.appendChild(this.row(entry.name, `${entry.count.toLocaleString()}  (${entry.percent.toFixed(1)}%)`, entry.percent));
    }
  }

  private row(name: string, value: string, percent: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-alloc-row';
    const bar = document.createElement('div');
    bar.className = 'znxstudio-alloc-bar';
    bar.style.width = `${Math.min(100, percent)}%`;
    const label = document.createElement('span');
    label.className = 'znxstudio-alloc-name';
    label.textContent = name;
    const val = document.createElement('span');
    val.className = 'znxstudio-alloc-value';
    val.textContent = value;
    row.append(bar, label, val);
    return row;
  }

  private section(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-alloc-section';
    el.textContent = text;
    return el;
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-alloc-empty';
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
    const report = {
      ...emptyReport(),
      totalCalls: 3,
      totalSamples: 41,
      totalAllocations: 59591,
      allocations: [{ type: 'Number', count: 59586 }, { type: 'Text', count: 5 }],
      hotSpots: [
        { name: 'compute_rate', calls: 1, samples: 40, allocations: 59586, percent: 97.56, source: null },
        { name: 'calculate_tax', calls: 1, samples: 0, allocations: 5, percent: 0, source: null },
      ],
    };
    const byType = allocationsByType(report);
    const byFn = allocationsByFunction(report);
    const rate = allocationRate(report);
    log(`alloc byType: ${byType.map((t) => `${t.name}=${t.count}(${t.percent.toFixed(1)}%)`).join(' ')}`);
    log(`alloc byFunction: ${byFn.map((f) => `${f.name}=${f.count}(${f.percent.toFixed(1)}%)`).join(' ')}`);
    log(`alloc rate: perCall=${rate.perCall.toFixed(0)} perSample=${rate.perSample.toFixed(0)} attribution(compute_rate)=${attributionFor(report, 'compute_rate')?.percent.toFixed(1)}%`);
  }
}
