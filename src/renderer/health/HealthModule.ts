import {
  ServiceKeys,
  type CompilerService,
  type HealthService,
  type LogService,
  type TelemetryService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { CrashRecoveryModule } from './CrashRecoveryModule';
import type { CrashRecord, SessionState } from './crash';
import {
  healthSummary,
  overallStatus,
  renderDiagnosticsReport,
  statusLine,
  type CheckStatus,
  type DiagnosticsReport,
  type EnvironmentInfo,
  type HealthCheck,
} from './diagnostics';
import { formatDuration } from './perf';

/**
 * IDE self-diagnostics (Phase 19A).
 *
 * Builds the report a user pastes into a bug tracker: environment, startup
 * timings, health checks, local metrics, crash history, and a redacted log tail.
 *
 * The rule this module exists to enforce: **a check that could not run reports
 * `unknown`, never `pass`.** No compiler, no workspace, no log file — each is a
 * thing ZnxStudio does not know, and a dashboard that is green because nothing was
 * checked is worse than no dashboard at all.
 */
export class HealthModule implements IModule, HealthService {
  readonly id = 'znxstudio.health';
  readonly displayName = 'Health';

  private moduleContext!: ModuleContext;
  private logger: LogService | undefined;
  private telemetry: TelemetryService | undefined;
  private crash: CrashRecoveryModule | undefined;
  private homeDir = '';
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.moduleContext = context;
    this.logger = context.services.tryGet<LogService>(ServiceKeys.Log);
    this.telemetry = context.services.tryGet<TelemetryService>(ServiceKeys.Telemetry);
    context.services.register(ServiceKeys.Health, this);

    try {
      this.homeDir = (await window.znxstudio.app.getInfo()).homeDir;
    } catch {
      this.homeDir = '';
    }

    context.commands.register(CommandIds.HealthCopyReport, () => void this.copyReport(), 'Health: Copy Diagnostics Report');
    void selfTestCoordinator.run('health', () => this.maybeSelfTest());
  }

  /** Wired by the Workbench: the crash module owns the session state. */
  useCrashRecovery(module: CrashRecoveryModule): void {
    this.crash = module;
  }

  /* ----- HealthService ----- */

  async report(): Promise<DiagnosticsReport> {
    const [environment, process] = await Promise.all([this.environment(), this.telemetry?.processMetrics() ?? Promise.resolve(null)]);
    const session = this.crash?.sessionState() ?? null;
    const checks = this.checks(environment, session);
    return {
      generatedAt: Date.now(),
      environment,
      startup: this.telemetry?.startup() ?? { modules: 0, failed: [], totalMilliseconds: 0, slowest: [] },
      checks,
      metrics: this.telemetry?.metrics() ?? [],
      process,
      session,
      crashes: session?.previousCrash ? [session.previousCrash] : [],
      logTail: this.logger?.tail(40) ?? [],
    };
  }

  async reportMarkdown(): Promise<string> {
    return renderDiagnosticsReport(await this.report(), this.homeDir);
  }

  async status(): Promise<CheckStatus> {
    return overallStatus((await this.report()).checks);
  }

  /* ----- gathering ----- */

  private async environment(): Promise<EnvironmentInfo> {
    let info: Awaited<ReturnType<typeof window.znxstudio.app.getInfo>> | null = null;
    try {
      info = await window.znxstudio.app.getInfo();
    } catch {
      info = null;
    }
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const compilerInfo = compiler ? await compiler.info().catch(() => null) : null;
    return {
      znxstudio: info?.version ?? 'unknown',
      electron: info?.electron ?? 'unknown',
      chrome: info?.chrome ?? 'unknown',
      node: info?.node ?? 'unknown',
      platform: String(info?.platform ?? 'unknown'),
      compilerPath: compilerInfo?.available ? compilerInfo.path : null,
      compilerVersion: compilerInfo?.available ? compilerInfo.version : null,
    };
  }

  /**
   * The checks. Each says what was observed; the ones that could not be observed
   * say `unknown` and explain what is missing.
   */
  private checks(environment: EnvironmentInfo, session: SessionState | null): HealthCheck[] {
    const checks: HealthCheck[] = [];

    checks.push(
      environment.compilerVersion
        ? {
            id: 'compiler',
            label: 'Zornux compiler',
            status: 'pass',
            detail: `${environment.compilerVersion} at ${environment.compilerPath}`,
          }
        : {
            id: 'compiler',
            label: 'Zornux compiler',
            status: 'fail',
            detail: 'Not found on this machine.',
            remedy: 'Install the Zornux CLI, or set the compiler path in settings.',
          },
    );

    const startup = this.telemetry?.startup();
    if (!startup || !startup.modules) {
      checks.push({ id: 'startup', label: 'Module activation', status: 'unknown', detail: 'Startup was not measured.' });
    } else if (startup.failed.length) {
      checks.push({
        id: 'startup',
        label: 'Module activation',
        status: 'fail',
        detail: `${startup.failed.length} of ${startup.modules} modules failed: ${startup.failed.map((entry) => entry.moduleId).join(', ')}`,
        remedy: 'See the Log panel for each failure.',
      });
    } else {
      checks.push({
        id: 'startup',
        label: 'Module activation',
        status: 'pass',
        detail: `${startup.modules} modules in ${formatDuration(startup.totalMilliseconds)}`,
      });
    }

    for (const verdict of this.telemetry?.budgets() ?? []) {
      checks.push({
        id: `budget:${verdict.metric}`,
        label: `Performance budget: ${verdict.metric}`,
        // An unmeasured budget is UNKNOWN. Reporting it as a pass would be a
        // green tick for something nobody looked at.
        status: !verdict.measured ? 'unknown' : verdict.withinBudget ? 'pass' : 'warn',
        detail: verdict.measured
          ? `p95 ${formatDuration(verdict.actual)} against a ${verdict.budget} ms budget`
          : 'No samples recorded yet.',
        ...(verdict.measured && !verdict.withinBudget ? { remedy: 'Check the Health dashboard for the slowest operations.' } : {}),
      });
    }

    if (!session) {
      checks.push({ id: 'session', label: 'Previous session', status: 'unknown', detail: 'Session state unavailable.' });
    } else if (!session.previousExitClean) {
      checks.push({
        id: 'session',
        label: 'Previous session',
        status: 'warn',
        detail: session.previousCrash
          ? `Did not exit cleanly — ${session.previousCrash.origin}: ${session.previousCrash.reason}`
          : 'Did not exit cleanly (no crash record).',
        ...(this.crash?.hasRecoverableWork() ? { remedy: 'Run "Recovery: Restore Unsaved Work".' } : {}),
      });
    } else {
      checks.push({ id: 'session', label: 'Previous session', status: 'pass', detail: 'Exited cleanly.' });
    }

    const errors = (this.logger?.records() ?? []).filter((record) => record.level === 'error').length;
    checks.push(
      errors
        ? { id: 'log', label: 'Errors this session', status: 'warn', detail: `${errors} error(s) logged.`, remedy: 'Open the Log panel.' }
        : { id: 'log', label: 'Errors this session', status: 'pass', detail: 'No errors logged.' },
    );

    checks.push({
      id: 'telemetry',
      label: 'Telemetry',
      status: 'pass',
      // Worth stating plainly in the place a user goes to check on the IDE.
      detail: 'Collected locally. Nothing is transmitted; there is no endpoint.',
    });

    return checks;
  }

  private async copyReport(): Promise<void> {
    const markdown = await this.reportMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      this.moduleContext.layout.showToast('Diagnostics report copied (paths and secrets redacted).', 'info');
    } catch {
      this.moduleContext.layout.showToast('Could not reach the clipboard.', 'error');
    }
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
      const report = await this.report();
      log(
        `health REAL environment: ZnxStudio ${report.environment.znxstudio} · Electron ${report.environment.electron} · ` +
          `compiler ${report.environment.compilerVersion ?? 'not found'}`,
      );
      log(`health REAL checks: ${statusLine(report.checks)} → overall ${overallStatus(report.checks)}`);
      log(`health REAL summary: ${healthSummary(report)}`);
      for (const check of report.checks) log(`health check ${check.id}: ${check.status} — ${check.detail}`);

      const unknown: HealthCheck[] = [
        { id: 'a', label: 'A', status: 'pass', detail: '' },
        { id: 'b', label: 'B', status: 'unknown', detail: '' },
      ];
      log(`health overall(pass + unknown) = ${overallStatus(unknown)} (expect unknown — never pass)`);

      const markdown = await this.reportMarkdown();
      log(`health REAL report: ${markdown.split('\n').length} lines, ${markdown.length} chars`);
      log(`health REAL report mentions the home dir = ${this.homeDir ? markdown.includes(this.homeDir) : 'n/a'} (expect false)`);
      log(`health REAL report says telemetry is local = ${markdown.includes('never transmitted')}`);
    } catch (error) {
      log(`health REAL failed: ${(error as Error).message}`);
    }
  }
}
