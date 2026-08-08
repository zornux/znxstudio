import { ServiceKeys, type HealthService, type TelemetryService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { STATUS_ICONS, sortChecks, statusLine, type DiagnosticsReport } from './diagnostics';
import { formatBytesKb, formatDuration, formatUptime, slowestByP95, totalMemoryKb } from './perf';

/**
 * Health dashboard (Phase 19E). One place that answers "is my IDE all right?"
 *
 * It shows the checks worst-first, because a report is read from the top, and it
 * renders an `unknown` check as a question mark rather than folding it into the
 * green count. Everything shown is measured on this machine and stays here.
 */
export class HealthDashboardModule implements IModule {
  readonly id = 'znxstudio.health.dashboard';
  readonly displayName = 'Health Dashboard';

  private moduleContext!: ModuleContext;
  private health: HealthService | undefined;
  private telemetry: TelemetryService | undefined;
  private view!: HTMLElement;
  private latest: DiagnosticsReport | null = null;
  private refreshing = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.health = context.services.tryGet<HealthService>(ServiceKeys.Health);
    this.telemetry = context.services.tryGet<TelemetryService>(ServiceKeys.Telemetry);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-health';
    context.layout.addPanelView({ id: 'health', title: 'Health', element: this.view });

    context.commands.register(CommandIds.HealthShow, () => this.reveal(), 'Health: Show Dashboard');
    context.commands.register(CommandIds.HealthRefresh, () => this.refresh(), 'Health: Refresh');

    this.render();
    void selfTestCoordinator.run('health-dashboard', () => this.maybeSelfTest());
  }

  private async reveal(): Promise<void> {
    this.moduleContext.layout.showPanelView('health');
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    if (!this.health || this.refreshing) return;
    this.refreshing = true;
    this.render();
    this.latest = await this.health.report();
    this.refreshing = false;
    this.render();
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-health-toolbar';

    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = this.refreshing ? 'Checking…' : '↻ Refresh';
    refresh.disabled = this.refreshing;
    refresh.addEventListener('click', () => void this.refresh());
    toolbar.appendChild(refresh);

    const copy = document.createElement('button');
    copy.className = 'znxstudio-btn-small';
    copy.textContent = 'Copy report';
    copy.title = 'Copy a Markdown diagnostics report. Home paths and secrets are redacted.';
    copy.addEventListener('click', () => this.moduleContext.commands.executeFromUi(CommandIds.HealthCopyReport));
    toolbar.appendChild(copy);

    const reset = document.createElement('button');
    reset.className = 'znxstudio-btn-small';
    reset.textContent = 'Reset metrics';
    reset.addEventListener('click', () => this.moduleContext.commands.executeFromUi(CommandIds.TelemetryReset));
    toolbar.appendChild(reset);
    this.view.appendChild(toolbar);

    const note = document.createElement('div');
    note.className = 'znxstudio-health-note';
    note.textContent = 'Everything below is measured on this machine and never transmitted.';
    this.view.appendChild(note);

    if (!this.latest) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-health-empty';
      empty.textContent = 'Refresh to run the health checks.';
      this.view.appendChild(empty);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'znxstudio-health-summary';
    summary.textContent = statusLine(this.latest.checks);
    this.view.appendChild(summary);

    const list = document.createElement('ul');
    list.className = 'znxstudio-health-checks';
    for (const check of sortChecks(this.latest.checks)) {
      const item = document.createElement('li');
      item.className = `znxstudio-health-check is-${check.status}`;
      const label = document.createElement('span');
      label.className = 'znxstudio-health-label';
      label.textContent = `${STATUS_ICONS[check.status]} ${check.label}`;
      const detail = document.createElement('span');
      detail.className = 'znxstudio-health-detail';
      detail.textContent = check.remedy ? `${check.detail} — ${check.remedy}` : check.detail;
      item.append(label, detail);
      list.appendChild(item);
    }
    this.view.appendChild(list);

    this.section('Startup', [
      `${this.latest.startup.modules} modules in ${formatDuration(this.latest.startup.totalMilliseconds)}`,
      ...this.latest.startup.slowest.map((entry) => `${entry.moduleId} — ${formatDuration(entry.milliseconds)}`),
    ]);

    const slowest = slowestByP95(
      this.latest.metrics.filter((metric) => metric.name.startsWith('command:')),
      5,
    );
    this.section(
      'Slowest commands (p95)',
      slowest.length
        ? slowest.map((metric) => `${metric.name.slice('command:'.length)} — ${formatDuration(metric.p95)} (n=${metric.count})`)
        : ['No commands have run yet.'],
    );

    const process = this.latest.process;
    this.section(
      'Processes',
      process
        ? [
            `Uptime ${formatUptime(process.uptimeSeconds)} · ${formatBytesKb(totalMemoryKb(process.metrics))} across ${process.metrics.length} processes`,
            ...process.metrics.map(
              (metric) => `${metric.type} (pid ${metric.pid}) — ${formatBytesKb(metric.privateBytesKb)}, ${metric.cpuPercent.toFixed(1)}% CPU`,
            ),
          ]
        : ['Process metrics unavailable.'],
    );
  }

  private section(title: string, lines: string[]): void {
    const heading = document.createElement('div');
    heading.className = 'znxstudio-health-section';
    heading.textContent = title;
    this.view.appendChild(heading);

    const list = document.createElement('ul');
    list.className = 'znxstudio-health-lines';
    for (const line of lines) {
      const item = document.createElement('li');
      item.textContent = line;
      list.appendChild(item);
    }
    this.view.appendChild(list);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      await this.refresh();
      const rendered = this.view.querySelectorAll('.znxstudio-health-check').length;
      const first = this.view.querySelector('.znxstudio-health-check');
      log(`dashboard REAL DOM: ${rendered} checks rendered, worst first = "${first?.className}"`);

      const memory = this.latest?.process ? totalMemoryKb(this.latest.process.metrics) : 0;
      log(`dashboard REAL memory: ${formatBytesKb(memory)} across ${this.latest?.process?.metrics.length ?? 0} real processes`);
      log(`dashboard REAL uptime: ${formatUptime(this.latest?.process?.uptimeSeconds ?? 0)}`);
      log(`dashboard telemetry note rendered = ${Boolean(this.view.querySelector('.znxstudio-health-note'))}`);
    } catch (error) {
      log(`dashboard REAL failed: ${(error as Error).message}`);
    }
  }
}
