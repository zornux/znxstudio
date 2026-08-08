import {
  ServiceKeys,
  type CompilerService,
  type EditorService,
  type StatusService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import {
  buildTestArgs,
  classifyTestFile,
  parseTestBlocks,
  parseTestResult,
  summarizeRun,
  totalDuration,
  type FileSummary,
  type TestKind,
  type TestRunOptions,
  type TestStatus,
} from './testModel';

interface UiTest {
  name: string;
  line: number;
  status: 'none' | TestStatus;
  durationMs?: number;
  message?: string;
  code?: string;
}

interface UiFile {
  file: string;
  tests: UiTest[];
  expanded: boolean;
  running: boolean;
  kind: TestKind;
  markers: string[];
}

const STATUS_ICON: Record<string, string> = {
  none: '○',
  passed: '✓',
  failed: '✗',
  skipped: '◌',
};

/**
 * Test Explorer (Phase 9A). Discovers `test "…"` blocks across the workspace and
 * runs them with the REAL `zornux test <file> --json`, showing pass/fail per test
 * with durations + failure messages. A sidebar tree (files → tests); run all / a
 * file / a single test (via `--filter`). No new IPC (reuses compiler + capture).
 */
export class TestExplorerModule implements IModule {
  readonly id = 'znxstudio.test';
  readonly displayName = 'Test Explorer';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private status: StatusService | undefined;
  private shell!: HTMLElement;
  private tree!: HTMLElement;
  private files: UiFile[] = [];
  private readonly options: TestRunOptions = { engine: 'interpreter', failFast: false, filter: '' };
  private resultsPanel!: HTMLElement;
  private lastRun: FileSummary[] = [];
  private runAllButton!: HTMLButtonElement;
  private refreshButton!: HTMLButtonElement;
  private discovering = false;
  private discoveryQueued = false;
  private runningAll = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.buildShell();
    this.resultsPanel = document.createElement('div');
    this.resultsPanel.className = 'znxstudio-testresults';
    context.layout.addPanelView({ id: 'testresults', title: 'Test Results', element: this.resultsPanel });
    this.renderResults();

    context.commands.register(CommandIds.TestExplorerShow, () => this.reveal(), 'Test: Show Test Explorer');
    context.commands.register(CommandIds.TestRunAll, () => void this.runAll(), 'Test: Run All Tests');
    context.commands.register(CommandIds.TestRefresh, () => void this.discover(), 'Test: Refresh Tests');
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (id === CommandIds.TestRunAll) return this.files.length > 0 && !this.discovering && !this.runningAll;
        if (id === CommandIds.TestRefresh) {
          return this.workspace.folders().length > 0 && !this.discovering && !this.runningAll;
        }
        return undefined;
      }),
    );
    const trust = context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust) {
      context.subscriptions.push(trust.onDidChange(() => {
        this.updateControls();
        this.render();
      }));
    }
    context.layout.addActivityItem({ id: 'testing', label: 'Testing', icon: '◇', onSelect: () => this.reveal() });

    context.subscriptions.push(
      this.workspace.onDidChangeFolders(() => {
        if (this.discovering) this.discoveryQueued = true;
        else void this.discover();
      }),
    );
    void this.discover();
    void selfTestCoordinator.run('testexplorer', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.setSideBar('Testing', this.shell);
    this.context.layout.focusSideBar();
  }

  private buildShell(): void {
    this.shell = document.createElement('div');
    this.shell.className = 'znxstudio-tests';

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-tests-toolbar';
    this.runAllButton = document.createElement('button');
    this.runAllButton.className = 'znxstudio-btn-small znxstudio-tests-run-all';
    this.runAllButton.textContent = '▶ Run All';
    this.runAllButton.addEventListener('click', () => {
      if (this.context.commands.isEnabled(CommandIds.TestRunAll)) {
        void this.context.commands.execute(CommandIds.TestRunAll);
      }
    });
    this.refreshButton = document.createElement('button');
    this.refreshButton.className = 'znxstudio-btn-small znxstudio-tests-icon-button';
    this.refreshButton.textContent = '⟳';
    this.refreshButton.title = 'Refresh test discovery';
    this.refreshButton.setAttribute('aria-label', 'Refresh test discovery');
    this.refreshButton.addEventListener('click', () => {
      if (this.context.commands.isEnabled(CommandIds.TestRefresh)) {
        void this.context.commands.execute(CommandIds.TestRefresh);
      }
    });
    toolbar.append(this.runAllButton, this.refreshButton);

    // Runner options (Phase 9B): engine · fail-fast · filter.
    const optionsRow = document.createElement('div');
    optionsRow.className = 'znxstudio-tests-options';

    const engine = document.createElement('select');
    engine.className = 'znxstudio-query-select';
    engine.title = 'Engine';
    engine.setAttribute('aria-label', 'Test engine');
    for (const value of ['interpreter', 'vm']) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      engine.appendChild(option);
    }
    engine.addEventListener('change', () => {
      this.options.engine = engine.value as 'interpreter' | 'vm';
    });

    const failFast = document.createElement('label');
    failFast.className = 'znxstudio-tests-check';
    const failFastBox = document.createElement('input');
    failFastBox.type = 'checkbox';
    failFastBox.setAttribute('aria-label', 'Stop after the first failed test');
    failFastBox.addEventListener('change', () => {
      this.options.failFast = failFastBox.checked;
    });
    failFast.append(failFastBox, document.createTextNode('Fail fast'));

    const filter = document.createElement('input');
    filter.className = 'znxstudio-query-select';
    filter.placeholder = 'Filter test names…';
    filter.setAttribute('aria-label', 'Filter test names when running');
    filter.addEventListener('input', () => {
      this.options.filter = filter.value;
    });

    optionsRow.append(engine, failFast, filter);

    // Integration context (Phase 9C): identity + role for guarded tests.
    const contextRow = document.createElement('div');
    contextRow.className = 'znxstudio-tests-options';
    const identity = document.createElement('input');
    identity.className = 'znxstudio-query-select';
    identity.placeholder = 'identity…';
    identity.title = '--identity (integration context)';
    identity.setAttribute('aria-label', 'Integration test identity');
    identity.addEventListener('input', () => {
      this.options.identity = identity.value;
    });
    const role = document.createElement('input');
    role.className = 'znxstudio-query-select';
    role.placeholder = 'role…';
    role.title = '--role (integration context)';
    role.setAttribute('aria-label', 'Integration test role');
    role.addEventListener('input', () => {
      this.options.role = role.value;
    });
    contextRow.append(identity, role);

    this.tree = document.createElement('div');
    this.tree.className = 'znxstudio-tests-tree';
    this.shell.append(toolbar, optionsRow, contextRow, this.tree);
  }

  private async compilerPath(): Promise<string | null> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    return info?.available && info.path ? info.path : null;
  }

  private dirOf(file: string): string {
    return file.replace(/[\\/][^\\/]*$/, '');
  }

  private async discover(): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;
    this.updateControls();
    const roots = this.workspace.folders().map((folder) => folder.root);
    if (roots.length === 0) {
      this.files = [];
      this.discovering = false;
      this.updateControls();
      this.render();
      this.updateStatus();
      return;
    }
    try {
      const discoveredFiles = new Set<string>();
      const failures: string[] = [];
      let successfulRoots = 0;
      for (const root of roots) {
        try {
          const result = await window.znxstudio.search.text({ root, query: '^test\\s+"', isRegex: true });
          successfulRoots += 1;
          for (const hit of result.files) discoveredFiles.add(hit.file);
        } catch (error) {
          failures.push(`${this.basename(root)}: ${(error as Error).message}`);
        }
      }
      if (successfulRoots === 0) throw new Error(failures.join('; ') || 'No workspace folder could be searched.');
      if (failures.length > 0) {
        this.context.layout.showToast(
          `Test discovery skipped ${failures.length} workspace folder${failures.length === 1 ? '' : 's'}: ${failures.join('; ')}`,
          'error',
        );
      }
      const previous = new Map(this.files.map((f) => [f.file, f]));
      const files: UiFile[] = [];
      for (const filePath of discoveredFiles) {
        let text: string;
        try {
          text = await window.znxstudio.fs.readFile(filePath);
        } catch {
          continue;
        }
        const blocks = parseTestBlocks(text);
        if (blocks.length === 0) continue;
        const prior = previous.get(filePath);
        const classification = classifyTestFile(text);
        files.push({
          file: filePath,
          expanded: prior?.expanded ?? false,
          running: false,
          kind: classification.kind,
          markers: classification.markers,
          tests: blocks.map((block) => {
            const before = prior?.tests.find((t) => t.name === block.name);
            return { name: block.name, line: block.line, status: before?.status ?? 'none', durationMs: before?.durationMs, message: before?.message };
          }),
        });
      }
      files.sort((a, b) => a.file.localeCompare(b.file));
      this.files = files;
    } catch (error) {
      this.context.layout.showToast(`Test discovery failed: ${(error as Error).message}`, 'error');
    } finally {
      this.discovering = false;
      this.updateControls();
      this.render();
      this.updateStatus();
      if (this.discoveryQueued) {
        this.discoveryQueued = false;
        void this.discover();
      }
    }
  }

  private async runAll(): Promise<void> {
    if (this.runningAll) return;
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Run tests')) return;
    if (this.files.length === 0) {
      this.context.layout.showToast('No tests were discovered to run.', 'info');
      return;
    }
    if (!(await this.compilerPath())) {
      this.context.layout.showToast('Zornux compiler not available.', 'error');
      return;
    }
    this.runningAll = true;
    this.lastRun = [];
    this.updateControls();
    try {
      for (const file of this.files) await this.runFile(file);
    } finally {
      this.runningAll = false;
      this.updateControls();
    }
  }

  private async runFile(file: UiFile, singleTest?: string): Promise<void> {
    if (file.running) return;
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Run tests')) return;
    const compilerPath = await this.compilerPath();
    if (!compilerPath) {
      this.context.layout.showToast('Zornux compiler not available.', 'error');
      return;
    }
    file.running = true;
    this.render();

    // A single-test run overrides the global filter with the exact name.
    const options: TestRunOptions = { ...this.options, filter: singleTest ?? this.options.filter };
    const args = buildTestArgs(options);
    try {
      const { output } = await captureTask(`"${compilerPath}" test "${file.file}" ${args}`, this.dirOf(file.file));
      const parsed = parseTestResult(output);
      if (!parsed) {
        this.context.layout.showToast(`Could not parse test output for ${this.basename(file.file)}.`, 'error');
        return;
      }
      // A filtered/fail-fast run only reports a subset; reset those not reported.
      for (const result of parsed.tests) {
        const test = file.tests.find((t) => t.name === result.name);
        if (test) {
          test.status = result.status;
          test.durationMs = result.durationMs;
          test.message = result.message;
          test.code = result.code;
        }
      }
      this.recordSummary({
        file: file.file,
        total: parsed.total,
        passed: parsed.passed,
        failed: parsed.failed,
        durationMs: totalDuration(parsed),
      });
    } catch (error) {
      this.context.layout.showToast(`Test run failed: ${(error as Error).message}`, 'error');
    } finally {
      file.running = false;
      this.render();
      this.updateStatus();
      this.renderResults();
    }
  }

  private updateControls(): void {
    if (!this.runAllButton || !this.refreshButton) return;
    this.runAllButton.disabled = !this.context.commands.isEnabled(CommandIds.TestRunAll);
    this.runAllButton.textContent = this.runningAll ? 'Running…' : '▶ Run All';
    this.refreshButton.disabled = !this.context.commands.isEnabled(CommandIds.TestRefresh);
    this.refreshButton.classList.toggle('is-spinning', this.discovering);
    this.context.commands.notifyEnablementChanged();
  }

  private recordSummary(summary: FileSummary): void {
    this.lastRun = this.lastRun.filter((s) => s.file !== summary.file);
    this.lastRun.push(summary);
  }

  private updateStatus(): void {
    if (!this.status) return;
    const all = this.files.flatMap((f) => f.tests);
    const passed = all.filter((t) => t.status === 'passed').length;
    const failed = all.filter((t) => t.status === 'failed').length;
    if (all.length === 0) {
      this.status.removeItem('editor.tests');
      return;
    }
    this.status.setItem('editor.tests', {
      text: `🧪 ${passed}✓${failed ? ` ${failed}✗` : ''}`,
      tooltip: 'Tests — click for the Test Explorer',
      command: CommandIds.TestExplorerShow,
      side: 'right',
      priority: 28,
    });
  }

  private renderResults(): void {
    this.resultsPanel.replaceChildren();
    if (this.lastRun.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-testresults-empty';
      empty.textContent = 'Run tests to see results.';
      this.resultsPanel.appendChild(empty);
      return;
    }

    const totals = summarizeRun(this.lastRun);
    const banner = document.createElement('div');
    banner.className = `znxstudio-testresults-banner ${totals.failed > 0 ? 'is-fail' : 'is-pass'}`;
    banner.textContent =
      `${totals.failed > 0 ? '✗' : '✓'} ${totals.passed}/${totals.total} passed` +
      `${totals.failed ? `, ${totals.failed} failed` : ''} · ${totals.durationMs}ms · engine: ${this.options.engine}`;
    this.resultsPanel.appendChild(banner);

    for (const summary of [...this.lastRun].sort((a, b) => a.file.localeCompare(b.file))) {
      const row = document.createElement('div');
      row.className = 'znxstudio-testresults-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `Open ${this.basename(summary.file)}`);
      const name = document.createElement('span');
      name.className = 'znxstudio-testresults-file';
      name.textContent = this.basename(summary.file);
      const stats = document.createElement('span');
      stats.className = summary.failed > 0 ? 'is-fail' : 'is-pass';
      stats.textContent = `${summary.passed}/${summary.total}${summary.failed ? ` ✗${summary.failed}` : ''} · ${summary.durationMs}ms`;
      row.append(name, stats);
      const open = (): void => void this.open(summary.file, 0);
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
      this.resultsPanel.appendChild(row);
    }
  }

  private render(): void {
    this.tree.replaceChildren();
    if (this.discovering && this.files.length === 0) {
      const loading = document.createElement('div');
      loading.className = 'znxstudio-tests-empty';
      loading.textContent = 'Discovering tests…';
      this.tree.appendChild(loading);
      return;
    }
    if (this.files.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-tests-empty';
      empty.textContent = 'No test files. Write `test "…" … end` blocks in a .zx file.';
      this.tree.appendChild(empty);
      return;
    }
    for (const file of this.files) this.tree.appendChild(this.renderFile(file));
  }

  private renderFile(file: UiFile): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-tests-file';

    const header = document.createElement('div');
    header.className = 'znxstudio-tests-file-head';
    const disclosure = document.createElement('div');
    disclosure.className = 'znxstudio-tests-file-disclosure';
    disclosure.tabIndex = 0;
    disclosure.setAttribute('role', 'button');
    disclosure.setAttribute('aria-expanded', String(file.expanded));
    disclosure.setAttribute('aria-label', `${this.basename(file.file)}, ${file.tests.length} tests`);
    const caret = document.createElement('span');
    caret.className = 'znxstudio-tests-caret';
    caret.textContent = file.expanded ? '▾' : '▸';
    const name = document.createElement('span');
    name.className = 'znxstudio-tests-file-name';
    name.textContent = this.basename(file.file);
    const kind = document.createElement('span');
    kind.className = `znxstudio-tests-kind znxstudio-tests-kind--${file.kind}`;
    kind.textContent = file.kind === 'integration' ? 'INT' : 'unit';
    if (file.markers.length) kind.title = `integration: ${file.markers.join(', ')}`;
    const summary = document.createElement('span');
    summary.className = 'znxstudio-tests-summary';
    const passed = file.tests.filter((t) => t.status === 'passed').length;
    const failed = file.tests.filter((t) => t.status === 'failed').length;
    summary.textContent = file.running ? '…' : `${passed}/${file.tests.length}${failed ? ` ✗${failed}` : ''}`;
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = '▶';
    run.title = 'Run this file';
    run.setAttribute('aria-label', `Run all tests in ${this.basename(file.file)}`);
    run.disabled = !this.canRunFile(file);
    run.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.canRunFile(file)) void this.runFile(file);
    });
    disclosure.append(caret, name, kind, summary);
    header.append(disclosure, run);
    const toggle = (): void => {
      file.expanded = !file.expanded;
      this.render();
    };
    disclosure.addEventListener('click', toggle);
    disclosure.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      }
    });
    wrap.appendChild(header);

    if (file.expanded) {
      for (const test of file.tests) wrap.appendChild(this.renderTest(file, test));
    }
    return wrap;
  }

  private renderTest(file: UiFile, test: UiTest): HTMLElement {
    const row = document.createElement('div');
    row.className = `znxstudio-tests-case znxstudio-tests-case--${test.status}`;
    const target = document.createElement('div');
    target.className = 'znxstudio-tests-case-target';
    target.tabIndex = 0;
    target.setAttribute('role', 'button');
    target.setAttribute('aria-label', `${test.name}, ${test.status === 'none' ? 'not run' : test.status}`);
    const icon = document.createElement('span');
    icon.className = 'znxstudio-tests-icon';
    icon.textContent = STATUS_ICON[test.status] ?? '○';
    icon.setAttribute('aria-hidden', 'true');
    const name = document.createElement('span');
    name.className = 'znxstudio-tests-case-name';
    name.textContent = test.name;
    if (test.message) name.title = test.message;
    const meta = document.createElement('span');
    meta.className = 'znxstudio-tests-meta';
    meta.textContent = test.durationMs !== undefined && test.status !== 'none' ? `${test.durationMs}ms` : '';
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = '▶';
    run.title = 'Run this test';
    run.setAttribute('aria-label', `Run test ${test.name}`);
    run.disabled = !this.canRunFile(file);
    run.addEventListener('click', (event) => {
      event.stopPropagation();
      if (this.canRunFile(file)) void this.runFile(file, test.name);
    });
    target.append(icon, name, meta);
    row.append(target, run);
    const open = (): void => void this.open(file.file, test.line);
    target.addEventListener('click', open);
    target.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });

    if (test.status === 'failed' && test.message) {
      const message = document.createElement('div');
      message.className = 'znxstudio-tests-failure';
      message.textContent = `${test.code ? `${test.code}: ` : ''}${test.message}`;
      row.appendChild(message);
    }
    return row;
  }

  private canRunFile(file: UiFile): boolean {
    const trusted = this.context.services.tryGet<TrustService>(ServiceKeys.Trust)?.isTrusted() ?? true;
    return trusted && !this.discovering && !this.runningAll && !file.running;
  }

  private async open(file: string, line: number): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    await editor.openFile(file);
    editor.revealPosition(line, 0);
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

    // Pure: parse test blocks + decode a --json result (incl. a failure).
    const blocks = parseTestBlocks('test "a"\n    expect 1 to equal 1\nend\ntest "b"\n    expect 2 to equal 2\nend\n');
    log(`testexplorer parseBlocks: n=${blocks.length} names=[${blocks.map((b) => b.name).join(',')}] line1=${blocks[1]?.line}`);
    const decoded = parseTestResult('log line\n{"total":2,"passed":1,"failed":1,"tests":[{"name":"a","status":"passed","durationMs":5},{"name":"b","status":"failed","durationMs":1,"code":"ZX1503","message":"Expected 3, but got 2."}]}');
    log(`testexplorer parseResult: total=${decoded?.total} passed=${decoded?.passed} failed=${decoded?.failed} bMsg="${decoded?.tests[1]?.message}"`);

    // 9B runner options → argument string.
    log(`testexplorer buildArgs(interp): "${buildTestArgs({ engine: 'interpreter', failFast: false })}"`);
    log(`testexplorer buildArgs(vm+ff+filter): "${buildTestArgs({ engine: 'vm', failFast: true, filter: 'add' })}"`);

    // 9C integration: context args + classification.
    log(`testexplorer buildArgs(context): "${buildTestArgs({ engine: 'interpreter', failFast: false, identity: 'kim', role: 'Editor' })}"`);
    log(`testexplorer classify(policy+restrict): ${JSON.stringify(classifyTestFile('policy P\n    require role "Editor"\nend\nfunction f\n    restrict to policy P otherwise give back 0\nend\ntest "t"\n    expect f() to equal 1\nend\n'))}`);
    log(`testexplorer classify(plain): ${JSON.stringify(classifyTestFile('function g\n    give back 1\nend\ntest "t"\n    expect g() to equal 1\nend\n'))}`);

    // Real run on a TEMP file: default, then vm engine, then fail-fast.
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const file = `${tempDir}\\znxstudio-tests.zx`;
        await window.znxstudio.fs.writeFile(file, 'test "p1"\n    expect 1 to equal 1\nend\ntest "f1"\n    expect 1 to equal 2\nend\ntest "p2"\n    expect 2 to equal 2\nend\n');

        const base = parseTestResult((await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir)).output);
        log(`testexplorer REAL default: total=${base?.total} passed=${base?.passed} failed=${base?.failed} fail="${base?.tests.find((t) => t.status === 'failed')?.message}"`);

        const vm = parseTestResult((await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'vm', failFast: false })}`, tempDir)).output);
        log(`testexplorer REAL vm: total=${vm?.total} passed=${vm?.passed} failed=${vm?.failed}`);

        const ff = parseTestResult((await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: true })}`, tempDir)).output);
        log(`testexplorer REAL fail-fast: total=${ff?.total} (stops after first failure; 3 declared)`);

        if (base) {
          const totals = summarizeRun([{ file, total: base.total, passed: base.passed, failed: base.failed, durationMs: totalDuration(base) }]);
          log(`testexplorer summarize: ${JSON.stringify(totals)}`);
        }

        // Integration context: a restrict-guarded test fails without a role, passes with it.
        const guarded = `${tempDir}\\znxstudio-guarded.zx`;
        await window.znxstudio.fs.writeFile(
          guarded,
          'policy CanEdit\n    require role "Editor"\nend\nfunction edit\n    restrict to policy CanEdit otherwise give back "denied"\n    give back "edited"\nend\ntest "editor can edit"\n    expect edit() to equal "edited"\nend\n',
        );
        const noCtx = parseTestResult((await captureTask(`"${info.path}" test "${guarded}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir)).output);
        const withCtx = parseTestResult((await captureTask(`"${info.path}" test "${guarded}" ${buildTestArgs({ engine: 'interpreter', failFast: false, identity: 'kim', role: 'Editor' })}`, tempDir)).output);
        log(`testexplorer REAL integration: noContext passed=${noCtx?.passed} failed=${noCtx?.failed} → withRole passed=${withCtx?.passed} failed=${withCtx?.failed}`);
      } else {
        log('testexplorer REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`testexplorer REAL failed: ${(error as Error).message}`);
    }
  }
}
