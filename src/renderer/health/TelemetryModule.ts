import { ServiceKeys, type LogService, type TelemetryService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  DEFAULT_BUDGETS,
  PerfRegistry,
  checkBudgets,
  formatDuration,
  slowestByTotal,
  startupReport,
  type ActivationRecord,
  type BudgetVerdict,
  type MetricSummary,
  type ProcessSnapshot,
  type StartupReport,
} from './perf';

/**
 * Performance telemetry (Phase 19C).
 *
 * **Local only.** Nothing here uploads anything. The registry lives in memory,
 * the process metrics come from Electron's own `app.getAppMetrics()`, and the
 * only way any of it leaves the machine is the user copying the diagnostics
 * report themselves. There is no endpoint to disable because there is no
 * endpoint.
 *
 * Every command is timed through `CommandRegistry.onDidComplete` — including
 * the ones that throw, since a slow failure is exactly what a perf report
 * should surface. Per-command series live alongside one aggregate `command`
 * metric, which is what the budget is checked against.
 */
export class TelemetryModule implements IModule, TelemetryService {
  readonly id = 'znxstudio.health.telemetry';
  readonly displayName = 'Telemetry';

  private moduleContext!: ModuleContext;
  private logger: LogService | undefined;
  private readonly registry = new PerfRegistry();
  private activations: ActivationRecord[] = [];
  private startupMilliseconds = 0;
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.logger = context.services.tryGet<LogService>(ServiceKeys.Log);
    context.services.register(ServiceKeys.Telemetry, this);

    const off = context.commands.onDidComplete(({ id, milliseconds, ok }) => {
      this.registry.record('command', milliseconds);
      this.registry.record(`command:${id}`, milliseconds);
      if (!ok) this.logger?.debug('telemetry', `command ${id} failed after ${formatDuration(milliseconds)}`);
    });
    context.subscriptions.push({ dispose: off });

    context.commands.register(CommandIds.TelemetryReset, () => this.reset(), 'Telemetry: Reset Metrics');

    void selfTestCoordinator.run('telemetry', () => this.maybeSelfTest());
  }

  /* ----- TelemetryService ----- */

  record(metric: string, milliseconds: number): void {
    this.registry.record(metric, milliseconds);
    this.changeEmitter.fire();
  }

  /** Time an operation. The duration is recorded even when it throws. */
  async measure<T>(metric: string, operation: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      this.record(metric, performance.now() - startedAt);
    }
  }

  metrics(): MetricSummary[] {
    return this.registry.all();
  }

  /**
   * Told to us by the Workbench after activation finishes — the extension host
   * is still activating modules while THIS module's `activate` runs, so it
   * cannot read the records itself.
   */
  setStartup(records: ActivationRecord[], totalMilliseconds: number): void {
    this.activations = records;
    this.startupMilliseconds = totalMilliseconds;
    // One sample: startup happens once. It exists so the budget has something
    // to check, and so a slow launch shows up next to the command timings.
    this.registry.record('startup', totalMilliseconds);
    const failed = records.filter((record) => record.error !== undefined);
    this.logger?.info(
      'telemetry',
      `Started ${records.length} modules in ${formatDuration(totalMilliseconds)}${failed.length ? `, ${failed.length} failed` : ''}.`,
    );
    for (const failure of failed) this.logger?.error('telemetry', `module ${failure.moduleId} failed: ${failure.error}`);
    this.changeEmitter.fire();
  }

  startup(): StartupReport {
    return startupReport(this.activations);
  }

  budgets(): BudgetVerdict[] {
    return checkBudgets(this.metrics(), DEFAULT_BUDGETS);
  }

  /** Electron's real per-process memory and CPU. Null when unavailable. */
  async processMetrics(): Promise<ProcessSnapshot | null> {
    try {
      return await window.znxstudio.diagnostics.processMetrics();
    } catch {
      return null;
    }
  }

  reset(): void {
    this.registry.clear();
    this.changeEmitter.fire();
    this.moduleContext.layout.showToast('Performance metrics cleared (they were never sent anywhere).', 'info');
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
      // Self-tests run DURING activation, and the shell reports startup only
      // once activation has finished — so this module cannot see it yet. Saying
      // "0 modules" here would be a lie about the measurement, not about the
      // startup. The health self-test, which runs later, prints the real figure.
      const startup = this.startup();
      log(
        `telemetry startup not yet reported (modules=${startup.modules}) — the shell reports it after activation, ` +
          'and self-tests run during it. See "health check startup" below for the real numbers.',
      );

      // A REAL command, timed by the registry's own hook.
      await this.moduleContext.commands.execute(CommandIds.LayoutToggleSideBar);
      await this.moduleContext.commands.execute(CommandIds.LayoutToggleSideBar);
      const command = this.registry.summary('command');
      log(`telemetry REAL command timing: n=${command.count} p50=${formatDuration(command.p50)} max=${formatDuration(command.max)}`);

      // A command that THROWS is still timed, then rethrows.
      let threw = false;
      try {
        await this.moduleContext.commands.execute('znxstudio.does.not.exist');
      } catch {
        threw = true;
      }
      log(`telemetry: unknown command threw=${threw} (an unregistered command never reaches the timer)`);

      const snapshot = await this.processMetrics();
      const total = snapshot?.metrics.reduce((sum, metric) => sum + metric.privateBytesKb, 0) ?? 0;
      log(
        `telemetry REAL process metrics: ${snapshot?.metrics.length ?? 0} processes, ` +
          `${Math.round(total / 1024)} MB private (Electron reports privateBytes in KB, not bytes)`,
      );

      const budgets = this.budgets();
      for (const verdict of budgets) {
        log(
          `telemetry budget ${verdict.metric}: measured=${verdict.measured} p95=${formatDuration(verdict.actual)} ` +
            `budget=${verdict.budget}ms within=${verdict.withinBudget}`,
        );
      }
      const unmeasured = checkBudgets([], DEFAULT_BUDGETS);
      log(`telemetry budget with NO data: within=${unmeasured[0].withinBudget} (expect false — unmeasured is never a pass)`);

      log(`telemetry slowest metric by total: ${slowestByTotal(this.metrics(), 1)[0]?.name}`);
    } catch (error) {
      log(`telemetry REAL failed: ${(error as Error).message}`);
    }
  }
}
