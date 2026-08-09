import {
  ServiceKeys,
  type CompilerService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import { joinPath } from '../explorer/paths';
import { buildTestArgs, parseTestResult, type TestRunResult } from './testModel';
import { compareEngines, overBudget, perfStats, type EngineComparison } from './perf';

/**
 * Test Perf (Phase 9E). Benchmarks a test file: runs it on BOTH engines
 * (interpreter + vm), compares per-test `durationMs`, flags tests over a budget,
 * and summarizes. Grounded in the real `zornux test --json` timings. No new IPC.
 */
export class TestPerfModule implements IModule {
  readonly id = 'znxstudio.testperf';
  readonly displayName = 'Test Perf';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private panel!: HTMLElement;
  private fileSelect!: HTMLSelectElement;
  private budgetInput!: HTMLInputElement;
  private results!: HTMLElement;
  private runButton!: HTMLButtonElement;
  private testFiles: string[] = [];
  private discoveryGeneration = 0;
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);

    this.buildPanel();
    context.layout.addPanelView({ id: 'testperf', title: 'Test Perf', element: this.panel });
    context.commands.register(CommandIds.TestPerfShow, () => this.context.layout.showPanelView('testperf'), 'Test: Show Test Perf');

    context.subscriptions.push(
      this.workspace.onDidChangeFolders(() => void this.discover()),
    );
    const trust = context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust) context.subscriptions.push(trust.onDidChange(() => this.refreshRunButton()));
    void this.discover();

    void selfTestCoordinator.run('testperf', () => this.maybeSelfTest());
  }

  private buildPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-query';

    const row = document.createElement('div');
    row.className = 'znxstudio-query-row';
    this.fileSelect = document.createElement('select');
    this.fileSelect.className = 'znxstudio-query-select';
    this.fileSelect.setAttribute('aria-label', 'Test file');
    this.fileSelect.addEventListener('change', () => this.refreshRunButton());
    this.budgetInput = document.createElement('input');
    this.budgetInput.className = 'znxstudio-query-select';
    this.budgetInput.type = 'number';
    this.budgetInput.value = '50';
    this.budgetInput.title = 'Budget (ms)';
    this.budgetInput.style.maxWidth = '80px';
    const run = document.createElement('button');
    this.runButton = run;
    run.className = 'znxstudio-btn-small';
    run.textContent = '⏱ Benchmark';
    run.addEventListener('click', () => void this.benchmark());
    row.append(this.fileSelect, this.budgetInput, run);

    this.results = document.createElement('div');
    this.results.className = 'znxstudio-query-result is-info';
    this.results.textContent = 'Pick a test file and benchmark it on both engines.';

    this.panel.append(row, this.results);
    this.refreshRunButton();
  }

  private async discover(): Promise<void> {
    const generation = ++this.discoveryGeneration;
    const roots = this.workspace.folders().map((folder) => folder.root);
    if (roots.length === 0) {
      this.testFiles = [];
      this.fileSelect.replaceChildren();
      this.refreshRunButton();
      return;
    }
    const discovered = new Set<string>();
    const failures: string[] = [];
    for (const root of roots) {
      try {
        const result = await window.znxstudio.search.text({ root, query: '^test\\s+"', isRegex: true });
        for (const file of result.files) discovered.add(file.file);
      } catch (error) {
        failures.push(`${root}: ${(error as Error).message}`);
      }
    }
    if (generation !== this.discoveryGeneration) return;
    if (failures.length === roots.length) {
      this.testFiles = [];
      this.fileSelect.replaceChildren();
      this.refreshRunButton();
      this.showMessage(`Test discovery failed: ${failures.join('; ')}`, true);
      return;
    }
    if (failures.length > 0) {
      this.context.layout.showToast(
        `Test performance discovery skipped ${failures.length} workspace folder${failures.length === 1 ? '' : 's'}.`,
        'error',
      );
    }
    this.testFiles = [...discovered].sort();
    const previous = this.fileSelect.value;
    const basenameCounts = new Map<string, number>();
    for (const file of this.testFiles) {
      const name = file.split(/[\\/]/).pop() ?? file;
      basenameCounts.set(name, (basenameCounts.get(name) ?? 0) + 1);
    }
    this.fileSelect.replaceChildren();
    for (const file of this.testFiles) {
      const option = document.createElement('option');
      option.value = file;
      const name = file.split(/[\\/]/).pop() ?? file;
      const owner = this.workspace.folderContaining(file);
      option.textContent = (basenameCounts.get(name) ?? 0) > 1
        ? `${name} — ${owner?.project?.name ?? owner?.root.split(/[\\/]/).pop() ?? 'workspace'}`
        : name;
      this.fileSelect.appendChild(option);
    }
    if (this.testFiles.includes(previous)) this.fileSelect.value = previous;
    this.refreshRunButton();
  }

  private async runEngine(compilerPath: string, file: string, engine: 'interpreter' | 'vm'): Promise<TestRunResult | null> {
    const args = buildTestArgs({ engine, failFast: false });
    const { output } = await captureTask(`"${compilerPath}" test "${file}" ${args}`, file.replace(/[\\/][^\\/]*$/, ''));
    return parseTestResult(output);
  }

  private async benchmark(): Promise<void> {
    if (this.running) return;
    const file = this.fileSelect.value;
    if (!file) return;
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Benchmark tests')) return;
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.showMessage('Zornux compiler not available.', true);
      return;
    }
    this.running = true;
    this.refreshRunButton();
    this.showMessage('Benchmarking…', false);
    try {
      const interpreter = await this.runEngine(info.path, file, 'interpreter');
      const vm = await this.runEngine(info.path, file, 'vm');
      if (!interpreter || !vm) {
        this.showMessage('Could not parse benchmark output.', true);
        return;
      }
      const budget = Number(this.budgetInput.value) || 0;
      this.renderResults(interpreter, vm, budget);
    } catch (error) {
      this.showMessage(`Benchmark failed: ${(error as Error).message}`, true);
    } finally {
      this.running = false;
      this.refreshRunButton();
    }
  }

  private refreshRunButton(): void {
    if (!this.runButton) return;
    const trusted = this.context.services.tryGet<TrustService>(ServiceKeys.Trust)?.isTrusted() ?? true;
    this.runButton.disabled = this.running || !trusted || !this.fileSelect?.value;
    this.runButton.textContent = this.running ? 'Benchmarking…' : '⏱ Benchmark';
  }

  private renderResults(interpreter: TestRunResult, vm: TestRunResult, budget: number): void {
    this.results.className = 'znxstudio-query-result';
    this.results.replaceChildren();

    const stats = perfStats(interpreter);
    const summary = document.createElement('div');
    summary.className = 'znxstudio-perf-summary';
    summary.textContent =
      `interpreter total ${stats.totalMs}ms · mean ${stats.meanMs.toFixed(1)}ms · slowest ${stats.slowest ?? '—'} (${stats.maxMs}ms)`;
    this.results.appendChild(summary);

    const slow = new Set(overBudget(interpreter, budget).map((t) => t.name));
    const comparison = compareEngines(interpreter, vm);

    const table = document.createElement('table');
    table.className = 'znxstudio-data-table znxstudio-profiler-table';
    const head = document.createElement('tr');
    for (const column of ['test', 'interp (ms)', 'vm (ms)', 'faster', 'Δ (ms)']) {
      const th = document.createElement('th');
      th.textContent = column;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const row of comparison) {
      const tr = document.createElement('tr');
      if (slow.has(row.name)) tr.className = 'znxstudio-perf-over';
      const cells = [
        row.name,
        String(row.interpreterMs),
        Number.isNaN(row.vmMs) ? '—' : String(row.vmMs),
        row.faster,
        row.deltaMs ? String(row.deltaMs) : '0',
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
    this.results.appendChild(table);

    if (slow.size > 0) {
      const note = document.createElement('div');
      note.className = 'znxstudio-perf-budget';
      note.textContent = `⚠ ${slow.size} test${slow.size === 1 ? '' : 's'} over the ${budget}ms budget.`;
      this.results.appendChild(note);
    }
  }

  private showMessage(text: string, error: boolean): void {
    this.results.className = `znxstudio-query-result ${error ? 'is-error' : 'is-info'}`;
    this.results.textContent = text;
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

    // Pure: stats, ranking, budget, engine comparison over synthetic results.
    const interp: TestRunResult = {
      total: 3,
      passed: 3,
      failed: 0,
      tests: [
        { name: 'fast', status: 'passed', durationMs: 2 },
        { name: 'slow', status: 'passed', durationMs: 60 },
        { name: 'mid', status: 'passed', durationMs: 20 },
      ],
    };
    const vmResult: TestRunResult = {
      total: 3,
      passed: 3,
      failed: 0,
      tests: [
        { name: 'fast', status: 'passed', durationMs: 5 },
        { name: 'slow', status: 'passed', durationMs: 40 },
        { name: 'mid', status: 'passed', durationMs: 25 },
      ],
    };
    const stats = perfStats(interp);
    log(`perf stats: total=${stats.total} totalMs=${stats.totalMs} mean=${stats.meanMs.toFixed(1)} slowest=${stats.slowest}(${stats.maxMs})`);
    log(`perf overBudget(50): [${overBudget(interp, 50).map((t) => t.name).join(',')}]`);
    const cmp = compareEngines(interp, vmResult);
    log(`perf compare: ${cmp.map((c) => `${c.name}:${c.faster}(Δ${c.deltaMs})`).join(' ')}`);

    // Real: benchmark math_tests.zx on both engines (5 tests).
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const file = joinPath(tempDir, 'znxstudio-perf.zx');
        await window.znxstudio.fs.writeFile(file, 'test "a"\n    expect round(3.7) to equal 4\nend\ntest "b"\n    expect 2 + 3 to equal 5\nend\ntest "c"\n    expect 4 * 5 to equal 20\nend\n');
        const i = await this.runEngine(info.path, file, 'interpreter');
        const v = await this.runEngine(info.path, file, 'vm');
        if (i && v) {
          const s = perfStats(i);
          const c = compareEngines(i, v);
          log(`perf REAL: interp total=${s.totalMs}ms slowest=${s.slowest}(${s.maxMs}ms) · compared=${c.length} tests, fasterCounts=interp:${c.filter((x) => x.faster === 'interpreter').length}/vm:${c.filter((x) => x.faster === 'vm').length}/tie:${c.filter((x) => x.faster === 'tie').length}`);
        } else {
          log('perf REAL: parse failed');
        }
      } else {
        log('perf REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`perf REAL failed: ${(error as Error).message}`);
    }
  }
}
