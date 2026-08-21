import type { SimulatorClock } from './SimulatorClock';

export interface PerformanceMetric {
  name: string;
  value: number;
  unit: string;
  timestamp: number;
}

export interface RenderTrace {
  timestamp: number;
  trigger: string;
  duration: number;
  components: string[];
}

const MAX_METRICS = 500;
const MAX_TRACES = 200;

export class SimulatorPerformance {
  private readonly metrics: PerformanceMetric[] = [];
  private readonly traces: RenderTrace[] = [];
  private readonly clock: SimulatorClock;
  private renderCount = 0;
  private lastRenderStart = 0;

  constructor(clock: SimulatorClock) {
    this.clock = clock;
  }

  beginRender(): void {
    this.lastRenderStart = performance.now();
  }

  endRender(trigger: string, components: string[]): void {
    const duration = performance.now() - this.lastRenderStart;
    this.renderCount++;
    this.record('render_duration', duration, 'ms');
    this.traces.push({ timestamp: this.clock.now(), trigger, duration, components });
    if (this.traces.length > MAX_TRACES) this.traces.splice(0, this.traces.length - MAX_TRACES);
  }

  record(name: string, value: number, unit: string): void {
    this.metrics.push({ name, value, unit, timestamp: this.clock.now() });
    if (this.metrics.length > MAX_METRICS) this.metrics.splice(0, this.metrics.length - MAX_METRICS);
  }

  recordStateUpdate(duration: number): void {
    this.record('state_update', duration, 'ms');
  }

  recordNavigation(duration: number): void {
    this.record('screen_transition', duration, 'ms');
  }

  recordHotReload(duration: number): void {
    this.record('hot_reload', duration, 'ms');
  }

  recordHttpDuration(duration: number): void {
    this.record('http_duration', duration, 'ms');
  }

  getMetrics(name?: string, count?: number): PerformanceMetric[] {
    let filtered = name ? this.metrics.filter(m => m.name === name) : this.metrics;
    if (count) filtered = filtered.slice(-count);
    return filtered;
  }

  getTraces(count?: number): RenderTrace[] {
    if (count) return this.traces.slice(-count);
    return [...this.traces];
  }

  getSummary(): Record<string, { avg: number; max: number; count: number; unit: string }> {
    const groups = new Map<string, { values: number[]; unit: string }>();
    for (const m of this.metrics) {
      let group = groups.get(m.name);
      if (!group) { group = { values: [], unit: m.unit }; groups.set(m.name, group); }
      group.values.push(m.value);
    }
    const result: Record<string, { avg: number; max: number; count: number; unit: string }> = {};
    for (const [name, group] of groups) {
      const sum = group.values.reduce((a, b) => a + b, 0);
      result[name] = {
        avg: Math.round(sum / group.values.length * 100) / 100,
        max: Math.max(...group.values),
        count: group.values.length,
        unit: group.unit,
      };
    }
    return result;
  }

  getRenderCount(): number {
    return this.renderCount;
  }

  getDOMNodeCount(root: HTMLElement): number {
    return root.querySelectorAll('*').length;
  }

  reset(): void {
    this.metrics.length = 0;
    this.traces.length = 0;
    this.renderCount = 0;
  }

  dispose(): void {
    this.reset();
  }
}
