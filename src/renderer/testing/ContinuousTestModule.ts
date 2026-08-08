import {
  ServiceKeys,
  type CompilerService,
  type StatusService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { captureTask } from '../database/runCapture';
import { buildTestArgs, parseTestBlocks, parseTestResult } from './testModel';
import { totalDuration } from './testModel';
import { isWatchable, RunHistory } from './continuous';

/**
 * Continuous Testing (Phase 9G — the Testing capstone). A watch loop that
 * re-runs tests on save: saving a test file re-runs it; saving another .zx file
 * re-runs all discovered test files (source changed). Records a rolling history
 * with a pass/fail streak + live status. Ties the runner (9A–9F) together.
 */
export class ContinuousTestModule implements IModule {
  readonly id = 'znxstudio.continuous';
  readonly displayName = 'Continuous Testing';

  private context!: ModuleContext;
  private documents!: DocumentManager;
  private workspace!: WorkspaceService;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private readonly history = new RunHistory();
  private watching = false;
  private running = false;
  private testFiles: string[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private discoveryGeneration = 0;

  activate(context: ModuleContext): void {
    this.context = context;
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-continuous';
    context.layout.addPanelView({ id: 'continuous', title: 'Continuous', element: this.panel });
    context.commands.register(CommandIds.ContinuousShow, () => this.context.layout.showPanelView('continuous'), 'Test: Show Continuous Testing');
    context.commands.register(CommandIds.ContinuousToggle, () => this.toggle(), 'Test: Toggle Continuous Testing');
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (id !== CommandIds.ContinuousToggle) return undefined;
        const trusted = context.services.tryGet<TrustService>(ServiceKeys.Trust)?.isTrusted() ?? true;
        return this.watching || (trusted && this.workspace.folders().length > 0);
      }),
      this.documents.onDidSave((doc) => this.onSave(doc.path)),
      this.workspace.onDidChangeFolders(() => {
        if (this.workspace.folders().length === 0) this.stopWatching();
        else if (this.watching) void this.discover();
        context.commands.notifyEnablementChanged();
      }),
    );

    const trust = context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust) {
      context.subscriptions.push(trust.onDidChange(() => {
        if (!trust.isTrusted()) this.stopWatching();
        context.commands.notifyEnablementChanged();
      }));
    }

    this.render();
    this.updateStatus();
    void selfTestCoordinator.run('continuous', () => this.maybeSelfTest());
  }

  private async toggle(): Promise<void> {
    if (this.watching) {
      this.stopWatching();
      return;
    }
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Continuous testing')) return;
    if (this.workspace.folders().length === 0) return;
    this.watching = true;
    await this.discover();
    this.render();
    this.updateStatus();
    if (this.watching) this.context.layout.showToast('Continuous testing on — tests re-run on save.', 'info');
  }

  private async discover(): Promise<void> {
    const generation = ++this.discoveryGeneration;
    const roots = this.workspace.folders().map((folder) => folder.root);
    if (roots.length === 0) {
      this.testFiles = [];
      return;
    }
    const files = new Set<string>();
    for (const root of roots) {
      try {
        const result = await window.znxstudio.search.text({ root, query: '^test\\s+"', isRegex: true });
        for (const file of result.files) files.add(file.file);
      } catch (error) {
        this.context.layout.showToast(`Continuous test discovery failed in ${this.basename(root)}: ${(error as Error).message}`, 'error');
      }
    }
    if (generation === this.discoveryGeneration) this.testFiles = [...files].sort();
  }

  private stopWatching(): void {
    this.watching = false;
    this.discoveryGeneration += 1;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = null;
    this.context.commands.notifyEnablementChanged();
    this.render();
    this.updateStatus();
  }

  private onSave(path: string): void {
    if (!this.watching || !isWatchable(path)) return;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => void this.runFor(path), 500);
  }

  private async runFor(savedPath: string): Promise<void> {
    if (!this.watching || this.running) return;
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) return;

    // The saved file itself a test file? run only it; else re-run all test files.
    let targets: string[];
    try {
      const text = await window.znxstudio.fs.readFile(savedPath);
      const owner = this.workspace.folderContaining(savedPath);
      if (!owner) return;
      targets = parseTestBlocks(text).length > 0
        ? [savedPath]
        : this.testFiles.filter((file) => this.workspace.folderContaining(file)?.root === owner?.root);
    } catch {
      const owner = this.workspace.folderContaining(savedPath);
      if (!owner) return;
      targets = this.testFiles.filter((file) => this.workspace.folderContaining(file)?.root === owner?.root);
    }
    if (targets.length === 0) return;

    this.running = true;
    this.render();
    try {
      for (const file of targets) {
        if (!this.watching) break;
        await this.runFile(info.path, file);
      }
    } catch (error) {
      this.context.layout.showToast(`Continuous test run failed: ${(error as Error).message}`, 'error');
    } finally {
      this.running = false;
      this.render();
      this.updateStatus();
    }

    const latest = this.history.latest();
    if (latest && !latest.ok) this.context.layout.showToast(`Tests failing in ${this.basename(latest.file)} (${latest.failed}✗).`, 'error');
  }

  private async runFile(compilerPath: string, file: string): Promise<void> {
    const args = buildTestArgs({ engine: 'interpreter', failFast: false });
    const { output } = await captureTask(`"${compilerPath}" test "${file}" ${args}`, file.replace(/[\\/][^\\/]*$/, ''));
    const parsed = parseTestResult(output);
    if (!parsed) return;
    this.history.push({
      file,
      total: parsed.total,
      passed: parsed.passed,
      failed: parsed.failed,
      durationMs: totalDuration(parsed),
    });
  }

  private updateStatus(): void {
    if (!this.status) return;
    const latest = this.history.latest();
    const state = this.watching ? (this.running ? '👁 running…' : '👁 watching') : '👁 off';
    const result = latest ? ` · ${latest.ok ? '✓' : `✗${latest.failed}`}` : '';
    this.status.setItem('editor.continuous', {
      text: `${state}${result}`,
      tooltip: 'Continuous testing — click to toggle',
      command: CommandIds.ContinuousToggle,
      side: 'right',
      priority: 30,
    });
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-continuous-toolbar';
    const toggle = document.createElement('button');
    toggle.className = 'znxstudio-btn-small';
    toggle.textContent = this.watching ? '⏸ Stop watching' : '▶ Watch';
    toggle.disabled = !this.context.commands.isEnabled(CommandIds.ContinuousToggle);
    toggle.addEventListener('click', () => {
      if (this.context.commands.isEnabled(CommandIds.ContinuousToggle)) {
        this.context.commands.executeFromUi(CommandIds.ContinuousToggle);
      }
    });
    const state = document.createElement('span');
    state.className = 'znxstudio-continuous-state';
    state.textContent = this.watching
      ? this.running
        ? 'running…'
        : `watching ${this.testFiles.length} test file${this.testFiles.length === 1 ? '' : 's'}`
      : 'idle';
    const streak = this.history.passStreak();
    if (this.watching && streak > 1) {
      const streakEl = document.createElement('span');
      streakEl.className = 'znxstudio-continuous-streak';
      streakEl.textContent = `🔥 ${streak} green`;
      toolbar.append(toggle, state, streakEl);
    } else {
      toolbar.append(toggle, state);
    }
    this.panel.appendChild(toolbar);

    const entries = this.history.entries();
    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-continuous-empty';
      empty.textContent = this.watching ? 'Save a .zx file to trigger a run.' : 'Turn on watch to re-run tests on save.';
      this.panel.appendChild(empty);
      return;
    }

    for (const record of entries) {
      const row = document.createElement('div');
      row.className = `znxstudio-continuous-row ${record.ok ? 'is-pass' : 'is-fail'}`;
      const badge = document.createElement('span');
      badge.className = 'znxstudio-continuous-badge';
      badge.textContent = record.ok ? '✓' : '✗';
      const name = document.createElement('span');
      name.className = 'znxstudio-continuous-file';
      name.textContent = `#${record.seq} ${this.basename(record.file)}`;
      const stats = document.createElement('span');
      stats.className = 'znxstudio-continuous-stats';
      stats.textContent = `${record.passed}/${record.total}${record.failed ? ` ✗${record.failed}` : ''} · ${record.durationMs}ms`;
      row.append(badge, name, stats);
      this.panel.appendChild(row);
    }
  }

  private basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    let tempDir = '';
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
      tempDir = info.tempDir;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Pure history: push, cap, streak, latest.
    const history = new RunHistory(3);
    history.push({ file: 'a.zx', total: 2, passed: 2, failed: 0, durationMs: 5 });
    history.push({ file: 'a.zx', total: 2, passed: 2, failed: 0, durationMs: 4 });
    history.push({ file: 'a.zx', total: 2, passed: 1, failed: 1, durationMs: 6 });
    history.push({ file: 'a.zx', total: 2, passed: 2, failed: 0, durationMs: 3 });
    log(`continuous history: size=${history.size()} latestSeq=${history.latest()?.seq} passStreak=${history.passStreak()} (cap 3, last passed)`);
    const green = new RunHistory();
    green.push({ file: 'x', total: 1, passed: 1, failed: 0, durationMs: 1 });
    green.push({ file: 'x', total: 1, passed: 1, failed: 0, durationMs: 1 });
    log(`continuous streak(all green): ${green.passStreak()} · isWatchable(a.zx)=${isWatchable('a.zx')} isWatchable(a.js)=${isWatchable('a.js')}`);

    // Real watch cycle: pass → edit to fail → re-run, recorded in history.
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const run = new RunHistory();
        const file = `${tempDir}\\znxstudio-watch.zx`;
        await window.znxstudio.fs.writeFile(file, 'test "t"\n    expect 1 + 1 to equal 2\nend\n');
        let parsed = parseTestResult((await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir)).output);
        if (parsed) run.push({ file, total: parsed.total, passed: parsed.passed, failed: parsed.failed, durationMs: totalDuration(parsed) });
        await window.znxstudio.fs.writeFile(file, 'test "t"\n    expect 1 + 1 to equal 3\nend\n'); // edit → now fails
        parsed = parseTestResult((await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir)).output);
        if (parsed) run.push({ file, total: parsed.total, passed: parsed.passed, failed: parsed.failed, durationMs: totalDuration(parsed) });
        log(`continuous REAL cycle: runs=${run.size()} latest.ok=${run.latest()?.ok} history=[${run.entries().map((r) => (r.ok ? 'pass' : 'fail')).join(',')}] streak=${run.passStreak()}`);
      } else {
        log('continuous REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`continuous REAL failed: ${(error as Error).message}`);
    }
  }
}
