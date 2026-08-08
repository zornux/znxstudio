import { ServiceKeys, type EditorService, type SecurityService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { parseSuppressions, unjustifiedSuppressions } from './suppression';
import {
  buildPosture,
  postureVerdict,
  renderMarkdownReport,
  securityGrade,
  securityScore,
  type SecurityPosture,
} from './dashboard';

const REPORT_FILE = 'security-report.md';

/**
 * Security dashboard (Phase 15E). One posture for the whole workspace, folded
 * from the last scan: severities, categories, rules, coverage and suppressions.
 * Since rc.4 every finding — code rules and dependency advisories alike — comes
 * from `zornux check --security`, so the dashboard reads one source and merely
 * groups it for the reader.
 *
 * The report is exported on request only, and written into the workspace.
 */
export class SecurityDashboardModule implements IModule {
  readonly id = 'znxstudio.security.dashboard';
  readonly displayName = 'Security Dashboard';

  private moduleContext!: ModuleContext;
  private security: SecurityService | undefined;
  private workspace: WorkspaceService | undefined;
  private editor: EditorService | undefined;
  private panel!: HTMLElement;
  private posture: SecurityPosture | null = null;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.security = context.services.tryGet<SecurityService>(ServiceKeys.Security);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-secdash';
    context.layout.addPanelView({ id: 'security-dashboard', title: 'Security Dashboard', element: this.panel });

    context.commands.register(CommandIds.SecurityDashboardShow, () => this.reveal(), 'Security: Show Dashboard');
    context.commands.register(CommandIds.SecurityExportReport, () => this.exportReport(), 'Security: Export Report');

    if (this.security) context.subscriptions.push(this.security.onDidChange(() => void this.refresh()));
    this.render();
    void selfTestCoordinator.run('security-dashboard', () => this.maybeSelfTest());
  }

  private reveal(): void {
    void this.refresh();
    this.moduleContext.layout.showPanelView('security-dashboard');
  }

  private async readFile(path: string): Promise<string | null> {
    try {
      return await window.znxstudio.fs.readFile(path);
    } catch {
      return null;
    }
  }

  /** Count the suppression directives across every file the scan touched. */
  private async countSuppressions(files: string[]): Promise<{ total: number; unjustified: number }> {
    let total = 0;
    let unjustified = 0;
    for (const file of files) {
      const text = await this.readFile(file);
      if (!text) continue;
      const suppressions = parseSuppressions(text);
      total += suppressions.length;
      unjustified += unjustifiedSuppressions(suppressions).length;
    }
    return { total, unjustified };
  }

  private async refresh(): Promise<void> {
    const results = this.security?.results() ?? [];
    if (!results.length) {
      this.posture = null;
      this.render();
      return;
    }
    // ZX3709 already rides inside the scan results — the compiler put it there.
    const suppressions = await this.countSuppressions(results.map((r) => r.file));
    this.posture = buildPosture({
      results,
      suppressions: suppressions.total,
      unjustifiedSuppressions: suppressions.unjustified,
    });
    this.render();
  }

  private async exportReport(): Promise<void> {
    await this.refresh();
    const root = this.workspace?.currentFolder();
    if (!this.posture || !root) {
      this.moduleContext.layout.showToast('Scan a workspace before exporting a report.', 'info');
      return;
    }
    const markdown = renderMarkdownReport(this.posture, {
      projectName: root.split(/[\\/]/).filter(Boolean).pop(),
      generatedAt: new Date().toISOString(),
    });
    const path = `${root}\\${REPORT_FILE}`;
    try {
      await window.znxstudio.fs.writeFile(path, markdown);
      await this.editor?.openFile(path);
      this.moduleContext.layout.showToast(`Wrote ${REPORT_FILE}.`, 'info');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not write the report: ${(error as Error).message}`, 'error');
    }
  }

  private render(): void {
    if (!this.panel) return;
    this.panel.replaceChildren();

    if (!this.posture) {
      this.panel.appendChild(note('Scan a file or workspace from the Security panel to build a posture.', 'znxstudio-secdash-note'));
      return;
    }
    const posture = this.posture;

    const grade = document.createElement('div');
    grade.className = `znxstudio-secdash-grade grade-${securityGrade(posture).toLowerCase()}`;
    grade.textContent = securityGrade(posture);
    const score = document.createElement('div');
    score.className = 'znxstudio-secdash-score';
    score.textContent = `${securityScore(posture)}/100`;
    const headline = document.createElement('div');
    headline.className = 'znxstudio-secdash-headline';
    headline.append(grade, score);
    this.panel.appendChild(headline);

    this.panel.appendChild(note(postureVerdict(posture), posture.blocking ? 'znxstudio-secdash-warn' : 'znxstudio-secdash-note'));

    if (!posture.complete) {
      this.panel.appendChild(
        note(
          `Coverage: ${posture.filesAnalyzed}/${posture.filesScanned} analyzed. A file that does not compile is never examined — its silence is not a clean bill.`,
          'znxstudio-secdash-warn',
        ),
      );
    }

    this.panel.appendChild(this.renderSeverityBar(posture));

    const sources = document.createElement('div');
    sources.className = 'znxstudio-secdash-sources';
    sources.textContent =
      `Code rules: ${posture.analyzerFindings} · ` +
      `Dependency advisories (ZX3709): ${posture.dependencyFindings}`;
    this.panel.appendChild(sources);

    if (posture.byRule.length) {
      const table = document.createElement('div');
      table.className = 'znxstudio-secdash-rules';
      for (const rule of posture.byRule) {
        const row = document.createElement('div');
        row.className = 'znxstudio-secdash-rule';
        row.textContent = `${rule.ruleId} · ${rule.title} · ${rule.category} · ${rule.count}`;
        table.appendChild(row);
      }
      this.panel.appendChild(table);
    }

    if (posture.suppressions) {
      this.panel.appendChild(
        note(
          `${posture.suppressions} suppression(s), ${posture.unjustifiedSuppressions} without a reason (those silence nothing).`,
          posture.unjustifiedSuppressions ? 'znxstudio-secdash-warn' : 'znxstudio-secdash-note',
        ),
      );
    }

    const exportButton = document.createElement('button');
    exportButton.className = 'znxstudio-btn-small';
    exportButton.textContent = `Export ${REPORT_FILE}`;
    exportButton.addEventListener('click', () => void this.exportReport());
    this.panel.appendChild(exportButton);
  }

  private renderSeverityBar(posture: SecurityPosture): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'znxstudio-secdash-severities';
    for (const severity of ['Critical', 'Error', 'Warning', 'Info'] as const) {
      const chip = document.createElement('span');
      chip.className = `znxstudio-severity znxstudio-severity-${severity.toLowerCase()}`;
      chip.textContent = `${severity} ${posture.bySeverity[severity]}`;
      bar.appendChild(chip);
    }
    return bar;
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

    // The analyzer already ran on the real programs written by the Security
    // module's self-test; fold whatever it found into a posture.
    const results = this.security?.results() ?? [];
    if (!results.length) {
      log('security dashboard: no scan results to fold (scan self-test ran in another order)');
      return;
    }
    const posture = buildPosture({ results, suppressions: 2, unjustifiedSuppressions: 1 });
    log(
      `security dashboard REAL: files=${posture.filesScanned} analyzed=${posture.filesAnalyzed} complete=${posture.complete} ` +
        `findings=${posture.totalFindings} blocking=${posture.blocking} grade=${securityGrade(posture)} score=${securityScore(posture)}`,
    );
    log(`security dashboard verdict: ${postureVerdict(posture)}`);
    log(`security dashboard rules: ${posture.byRule.map((r) => `${r.ruleId}x${r.count}`).join(' ')}`);

    const report = renderMarkdownReport(posture, { projectName: 'selftest' });
    const heading = report.split('\n').filter((line) => line.startsWith('##')).join(' | ');
    log(`security dashboard report sections: ${heading}`);
  }
}

function note(text: string, className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = className;
  element.textContent = text;
  return element;
}
