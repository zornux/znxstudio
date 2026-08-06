import { ServiceKeys, type EditorService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { analyzeCoverage, type CoverageReport } from './coverage';

const MAX_FILES = 400;

/**
 * Test Coverage (Phase 9D). Zornux has no line coverage, so this reports FUNCTION
 * coverage by reachability — which declared functions are exercised by tests
 * (directly or transitively). Reads the workspace's .zx files (7A/7J search),
 * analyzes purely, and shows a percent bar + the uncovered functions. No new IPC.
 */
export class CoverageModule implements IModule {
  readonly id = 'znxstudio.coverage';
  readonly displayName = 'Coverage';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private report: CoverageReport | null = null;
  private computing = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-coverage';
    context.layout.addPanelView({ id: 'coverage', title: 'Coverage', element: this.panel });

    context.commands.register(CommandIds.CoverageShow, () => this.context.layout.showPanelView('coverage'), 'Test: Show Coverage');
    context.commands.register(CommandIds.CoverageCompute, () => void this.compute(), 'Test: Compute Coverage');

    this.workspace.onDidChangeWorkspace(() => {
      this.report = null;
      this.render();
    });

    this.render();
    void selfTestCoordinator.run('coverage', () => this.maybeSelfTest());
  }

  private async compute(): Promise<void> {
    if (this.computing) return;
    const root = this.workspace.currentFolder();
    if (!root) {
      this.report = null;
      this.render();
      return;
    }
    this.computing = true;
    this.render();

    const paths = (await window.znxstudio.search.files(root)).filter((p) => p.toLowerCase().endsWith('.zx')).slice(0, MAX_FILES);
    const files: { file: string; text: string }[] = [];
    for (const path of paths) {
      try {
        files.push({ file: path, text: await window.znxstudio.fs.readFile(path) });
      } catch {
        /* skip unreadable */
      }
    }
    this.report = analyzeCoverage(files);
    this.computing = false;
    this.render();
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    if (!this.report || this.report.total === 0) {
      this.status.removeItem('editor.coverage');
      return;
    }
    this.status.setItem('editor.coverage', {
      text: `🧭 ${this.report.percent}%`,
      tooltip: `Test coverage: ${this.report.covered}/${this.report.total} functions`,
      command: CommandIds.CoverageShow,
      side: 'right',
      priority: 29,
    });
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-coverage-toolbar';
    const compute = document.createElement('button');
    compute.className = 'znxstudio-btn-small';
    compute.textContent = this.computing ? 'Computing…' : '⟳ Compute Coverage';
    compute.disabled = this.computing;
    compute.addEventListener('click', () => void this.compute());
    toolbar.appendChild(compute);
    this.panel.appendChild(toolbar);

    if (!this.report) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-coverage-empty';
      hint.textContent = 'Compute function coverage from the workspace tests.';
      this.panel.appendChild(hint);
      return;
    }
    if (this.report.total === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-coverage-empty';
      empty.textContent = 'No top-level functions found.';
      this.panel.appendChild(empty);
      return;
    }

    const summary = document.createElement('div');
    summary.className = 'znxstudio-coverage-summary';
    summary.textContent = `${this.report.percent}% — ${this.report.covered}/${this.report.total} functions covered by tests`;
    this.panel.appendChild(summary);

    const bar = document.createElement('div');
    bar.className = 'znxstudio-coverage-bar';
    const fill = document.createElement('div');
    fill.className = 'znxstudio-coverage-fill';
    fill.style.width = `${this.report.percent}%`;
    fill.classList.add(this.report.percent >= 80 ? 'is-high' : this.report.percent >= 50 ? 'is-mid' : 'is-low');
    bar.appendChild(fill);
    this.panel.appendChild(bar);

    const uncovered = this.report.functions.filter((f) => !f.covered);
    if (uncovered.length === 0) {
      const ok = document.createElement('div');
      ok.className = 'znxstudio-coverage-ok';
      ok.textContent = '✓ Every function is exercised by a test.';
      this.panel.appendChild(ok);
      return;
    }

    const heading = document.createElement('div');
    heading.className = 'znxstudio-coverage-heading';
    heading.textContent = `Uncovered (${uncovered.length})`;
    this.panel.appendChild(heading);
    for (const fn of uncovered) {
      const row = document.createElement('div');
      row.className = 'znxstudio-coverage-row';
      row.innerHTML = '<span class="znxstudio-coverage-dot">○</span>';
      const name = document.createElement('span');
      name.className = 'znxstudio-coverage-name';
      name.textContent = fn.name;
      const loc = document.createElement('span');
      loc.className = 'znxstudio-coverage-loc';
      loc.textContent = `${this.basename(fn.file)}:${fn.line + 1}`;
      row.append(name, loc);
      row.addEventListener('click', () => void this.open(fn.file, fn.line));
      this.panel.appendChild(row);
    }
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
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Pure: direct + transitive coverage; an uncovered function.
    const files = [
      { file: 'a.zx', text: 'function add with a, b\n    give back a + b\nend\nfunction helper with x\n    give back add(x, 1)\nend\nfunction unused with y\n    give back y\nend\n' },
      { file: 'b.zx', text: 'test "uses helper"\n    expect helper(2) to equal 3\nend\n' },
    ];
    const report = analyzeCoverage(files);
    log(`coverage crafted: ${report.percent}% covered=${report.covered}/${report.total} uncovered=[${report.functions.filter((f) => !f.covered).map((f) => f.name).join(',')}] (add is transitive via helper)`);

    // Real: coverage across xojin/examples/tests.
    try {
      const dir = 'C:\\Studio Apps\\xojin\\examples\\tests';
      const names = ['web_tests.zx', 'security_tests.zx', 'math_tests.zx', 'text_tests.zx'];
      const real: { file: string; text: string }[] = [];
      for (const name of names) {
        try {
          real.push({ file: `${dir}\\${name}`, text: await window.znxstudio.fs.readFile(`${dir}\\${name}`) });
        } catch {
          /* skip */
        }
      }
      const realReport = analyzeCoverage(real);
      log(`coverage REAL examples/tests: ${realReport.percent}% covered=${realReport.covered}/${realReport.total} functions=[${realReport.functions.map((f) => `${f.name}${f.covered ? '✓' : '○'}`).join(',')}]`);
    } catch (error) {
      log(`coverage REAL failed: ${(error as Error).message}`);
    }
  }
}
