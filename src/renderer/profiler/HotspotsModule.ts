import { ServiceKeys, type ProfilerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { emptyReport } from './profile';
import { buildTimeline } from './timeline';
import {
  hottestLines,
  mostCalled,
  recommendations,
  slowestSpans,
  subsystemCounts,
  topAllocators,
  topCpu,
} from './hotspots';

/**
 * Hotspot Analysis view (Phase 14D). Answers "what should I optimize first?" by
 * projecting the runtime's own numbers into ranked lists — top CPU consumers,
 * most-called functions, top allocators, hottest source lines, slowest spans —
 * plus a short prioritized recommendation list.
 */
export class HotspotsModule implements IModule {
  readonly id = 'znxstudio.perf.hotspots';
  readonly displayName = 'Hotspot Analysis';

  private context!: ModuleContext;
  private profiler!: ProfilerService;
  private panel!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.profiler = context.services.get<ProfilerService>(ServiceKeys.Performance);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-hot';
    context.layout.addPanelView({ id: 'perf-hotspots', title: 'Hotspots', element: this.panel });
    context.commands.register(CommandIds.PerfHotspotsShow, () => context.layout.showPanelView('perf-hotspots'), 'Performance: Show Hotspots');

    this.profiler.onDidChange(() => this.render());
    this.render();
    void selfTestCoordinator.run('perf-hotspots', () => this.maybeSelfTest());
  }

  private render(): void {
    this.panel.replaceChildren();
    const report = this.profiler.report();
    const events = this.profiler.events();

    if (!report && events.length === 0) {
      this.panel.appendChild(this.message('Profile a program to see hotspots.'));
      return;
    }
    const timeline = events.length ? buildTimeline(events) : undefined;

    if (report) {
      const recs = recommendations(report, timeline);
      if (recs.length) {
        this.panel.appendChild(this.section('Optimize first'));
        for (const rec of recs) {
          const row = document.createElement('div');
          row.className = 'znxstudio-hot-rec';
          const title = document.createElement('div');
          title.className = 'znxstudio-hot-rec-title';
          title.textContent = rec.title;
          const detail = document.createElement('div');
          detail.className = 'znxstudio-hot-rec-detail';
          detail.textContent = rec.detail;
          row.append(title, detail);
          this.panel.appendChild(row);
        }
      }

      this.rank('Top CPU consumers', topCpu(report).map((s) => [s.name, `${s.percent.toFixed(2)}%  (${s.samples} samples)`]));
      this.rank('Most-called functions', mostCalled(report).map((s) => [s.name, `${s.calls.toLocaleString()} calls`]));
      if (report.totalAllocations > 0) {
        this.rank('Top allocators', topAllocators(report).map((s) => [s.name, `${s.allocations.toLocaleString()} allocations`]));
      }
      this.rank('Hottest source lines', hottestLines(report).map((l) => [l.source, `${l.samples} samples (${l.percent.toFixed(2)}%)`]));
      const subsystems = subsystemCounts(report);
      if (subsystems.length) this.rank('Subsystem activity', subsystems.map((s) => [s.category, `${s.count} events`]));
    }

    if (timeline && timeline.spans.length) {
      this.rank('Slowest spans (event units)', slowestSpans(timeline).map((s) => [`${s.name} (${s.category})`, `${s.units} units`]));
      const queries = slowestSpans(timeline, 5, 'query');
      if (queries.length) this.rank('Slowest queries', queries.map((s) => [s.name, `${s.units} units`]));
    }
  }

  private rank(title: string, rows: [string, string][]): void {
    if (rows.length === 0) return;
    this.panel.appendChild(this.section(title));
    rows.forEach(([name, value], index) => {
      const row = document.createElement('div');
      row.className = 'znxstudio-hot-row';
      const rank = document.createElement('span');
      rank.className = 'znxstudio-hot-rank';
      rank.textContent = `${index + 1}.`;
      const label = document.createElement('span');
      label.className = 'znxstudio-hot-name';
      label.textContent = name;
      const val = document.createElement('span');
      val.className = 'znxstudio-hot-value';
      val.textContent = value;
      row.append(rank, label, val);
      this.panel.appendChild(row);
    });
  }

  private section(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-hot-section';
    el.textContent = text;
    return el;
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-hot-empty';
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
      totalSamples: 100,
      totalCalls: 2_400_002,
      totalAllocations: 1000,
      hotSpots: [
        { name: '<program>', calls: 0, samples: 2, allocations: 0, percent: 2, source: null },
        { name: 'calculateTax', calls: 1, samples: 68, allocations: 900, percent: 68, source: 'a.zx:12' },
        { name: 'saveInvoice', calls: 1, samples: 20, allocations: 100, percent: 20, source: null },
        { name: 'formatDate', calls: 2_400_000, samples: 10, allocations: 0, percent: 10, source: null },
      ],
    };
    log(`hotspots topCpu: ${topCpu(report, 2).map((s) => `${s.name}@${s.percent}%`).join(' ')} (program excluded)`);
    log(`hotspots mostCalled: ${mostCalled(report, 1).map((s) => `${s.name}x${s.calls}`).join('')}`);
    log(`hotspots topAllocators: ${topAllocators(report, 1).map((s) => `${s.name}=${s.allocations}`).join('')}`);
    log(`hotspots recommendations: ${recommendations(report).map((r) => r.title).join(' | ')}`);
  }
}
