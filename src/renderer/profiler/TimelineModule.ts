import { ServiceKeys, type ProfilerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { buildTimeline, categoryTotals, layoutTimeline, spansOverlap } from './timeline';

/**
 * Performance Timeline view (Phase 14C). Renders the real trace as nested spans —
 * calls, queries, requests, jobs and tasks — in event order, with markers for
 * messages and errors. Extents are EVENT UNITS: the Zornux runtime emits sequence
 * numbers, not timestamps, so this shows order/nesting rather than milliseconds.
 */
export class TimelineModule implements IModule {
  readonly id = 'znxstudio.perf.timeline';
  readonly displayName = 'Performance Timeline';

  private context!: ModuleContext;
  private profiler!: ProfilerService;
  private panel!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.profiler = context.services.get<ProfilerService>(ServiceKeys.Performance);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-tl';
    context.layout.addPanelView({ id: 'perf-timeline', title: 'Timeline', element: this.panel });
    context.commands.register(CommandIds.PerfTimelineShow, () => context.layout.showPanelView('perf-timeline'), 'Performance: Show Timeline');

    this.profiler.onDidChange(() => this.render());
    this.render();
    void selfTestCoordinator.run('perf-timeline', () => this.maybeSelfTest());
  }

  private render(): void {
    this.panel.replaceChildren();

    const events = this.profiler.events();
    if (events.length === 0) {
      this.panel.appendChild(this.message('Run "Profile Timeline" from the Performance panel to capture a trace.'));
      return;
    }

    const timeline = buildTimeline(events);
    const head = document.createElement('div');
    head.className = 'znxstudio-tl-summary';
    head.textContent = `${timeline.spans.length} spans · ${timeline.units} event units · depth ${timeline.maxDepth} (order & nesting; the runtime emits sequence, not time)`;
    this.panel.appendChild(head);

    // Category breakdown — "where did the work go".
    const totals = categoryTotals(timeline);
    if (totals.length) {
      const cats = document.createElement('div');
      cats.className = 'znxstudio-tl-cats';
      cats.textContent = totals.map((t) => `${t.category}: ${t.units}u (${t.spans})`).join('  ·  ');
      this.panel.appendChild(cats);
    }

    // Span lanes.
    const chart = document.createElement('div');
    chart.className = 'znxstudio-tl-chart';
    chart.style.height = `${(timeline.maxDepth + 1) * 22 + 8}px`;
    for (const rect of layoutTimeline(timeline)) {
      const bar = document.createElement('div');
      bar.className = `znxstudio-tl-span is-${rect.span.category}${rect.span.unclosed ? ' is-unclosed' : ''}`;
      bar.style.left = `${rect.x * 100}%`;
      bar.style.width = `${rect.width * 100}%`;
      bar.style.top = `${rect.lane * 22}px`;
      bar.textContent = rect.span.name;
      bar.title = `${rect.span.name} (${rect.span.category}) — ${rect.span.units} units, seq ${rect.span.startSeq}→${rect.span.endSeq}${rect.span.unclosed ? ' [unclosed]' : ''}`;
      chart.appendChild(bar);
    }
    for (const marker of timeline.markers) {
      const pin = document.createElement('div');
      pin.className = `znxstudio-tl-marker is-${marker.kind}`;
      pin.style.left = `${((marker.sequence - timeline.startSeq) / (timeline.units || 1)) * 100}%`;
      pin.title = `${marker.kind}: ${marker.name} @ seq ${marker.sequence}`;
      chart.appendChild(pin);
    }
    this.panel.appendChild(chart);
  }

  private message(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-tl-empty';
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
      { sequence: 0, kind: 'RequestStart' as const, name: 'GET /invoice', category: 'request', depth: 0, source: null, timestampMicroseconds: null },
      { sequence: 1, kind: 'QueryStart' as const, name: 'SELECT customer', category: 'query', depth: 1, source: null, timestampMicroseconds: null },
      { sequence: 5, kind: 'QueryEnd' as const, name: 'SELECT customer', category: 'query', depth: 1, source: null, timestampMicroseconds: null },
      { sequence: 6, kind: 'ErrorThrown' as const, name: 'Timeout', category: null, depth: 1, source: null, timestampMicroseconds: null },
      { sequence: 9, kind: 'RequestEnd' as const, name: 'GET /invoice', category: 'request', depth: 0, source: null, timestampMicroseconds: null },
    ];
    const timeline = buildTimeline(events);
    const [request, query] = timeline.spans;
    log(`timeline: spans=${timeline.spans.length} units=${timeline.units} markers=${timeline.markers.length} maxDepth=${timeline.maxDepth}`);
    log(`timeline spans: ${request.name}=${request.units}u ${query.name}=${query.units}u overlap=${spansOverlap(request, query)} (query nested in request)`);
    log(`timeline categories: ${categoryTotals(timeline).map((c) => `${c.category}:${c.units}u`).join(' ')}`);
  }
}
