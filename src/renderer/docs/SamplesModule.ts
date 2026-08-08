import {
  ServiceKeys,
  type CompilerService,
  type EditorService,
  type SettingsService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import {
  buildRunArgs,
  collectSamples,
  exampleRootCandidates,
  filterSamples,
  judgeRun,
  sampleCategories,
  scratchCopyPath,
  type Sample,
  type SampleEngine,
  type SampleRun,
} from './samples';

/** Setting that overrides the auto-discovered examples folder. */
export const SAMPLES_PATH_SETTING = 'docs.samples.path';

/**
 * Sample browser (Phase 18D). Lists the Zornux compiler's own `examples/` tree
 * and runs the programs on the REAL CLI.
 *
 * The examples live in the compiler repository, and ZnxStudio never writes there:
 * "Run" reads the file in place, and "Open" copies it into an OS-temp scratch
 * folder so the copy — not the original — is what you edit.
 */
export class SamplesModule implements IModule {
  readonly id = 'znxstudio.docs.samples';
  readonly displayName = 'Samples';

  private moduleContext!: ModuleContext;
  private editor: EditorService | undefined;
  private settings: SettingsService | undefined;
  private view!: HTMLElement;

  private root: string | null = null;
  private samples: Sample[] = [];
  private query = '';
  private engine: SampleEngine = 'interpreter';
  private selected: Sample | null = null;
  private source = '';
  private lastRun: SampleRun | null = null;
  private running = false;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-samples';
    context.layout.addPanelView({ id: 'samples', title: 'Samples', element: this.view });
    context.commands.register(CommandIds.DocsSamplesShow, () => this.reveal(), 'Docs: Browse Samples');

    this.render();
    void this.discover();
    void selfTestCoordinator.run('samples', () => this.maybeSelfTest());
  }

  /* ----- discovery ----- */

  /**
   * Locate `examples/`: an explicit setting wins, otherwise climb from the
   * resolved compiler executable. A packaged install has no examples beside it,
   * and the panel says so rather than showing an empty list.
   */
  private async discover(): Promise<void> {
    const configured = this.settings?.get<string>(SAMPLES_PATH_SETTING, '') ?? '';
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;

    const candidates = configured ? [configured] : info?.path ? exampleRootCandidates(info.path) : [];
    for (const candidate of candidates) {
      const files = await this.listPrograms(candidate);
      if (files.length) {
        this.root = candidate;
        this.samples = collectSamples(candidate, files);
        this.render();
        return;
      }
    }
    this.root = null;
    this.samples = [];
    this.render();
  }

  private async listPrograms(root: string): Promise<string[]> {
    try {
      const files = await window.znxstudio.search.files(root);
      return files.filter((file) => file.toLowerCase().endsWith('.zx'));
    } catch {
      return [];
    }
  }

  /* ----- actions ----- */

  private absolute(sample: Sample): string {
    return `${this.root!.replace(/[\\/]+$/, '')}/${sample.path}`.replace(/\//g, '\\');
  }

  private async select(sample: Sample): Promise<void> {
    this.selected = sample;
    this.lastRun = null;
    try {
      this.source = await window.znxstudio.fs.readFile(this.absolute(sample));
    } catch {
      this.source = '';
      this.moduleContext.layout.showToast(`Could not read ${sample.path}.`, 'error');
    }
    this.render();
  }

  /** Run the sample where it lives. Running reads; nothing is written. */
  private async run(): Promise<void> {
    const sample = this.selected;
    if (!sample || this.running || !this.root) return;
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.moduleContext.layout.showToast('Zornux compiler unavailable.', 'error');
      return;
    }

    this.running = true;
    this.render();

    const file = this.absolute(sample);
    const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
    const command = `"${info.path}" ${buildRunArgs(file, this.engine).map(quote).join(' ')}`;
    const { code, output } = await captureTask(command, file.replace(/[\\/][^\\/]*$/, ''));

    this.running = false;
    this.lastRun = judgeRun(sample, code, output);
    this.render();
  }

  /**
   * Copy the sample into a scratch folder and open the copy. The compiler
   * repository stays untouched — editing a sample in place would dirty it.
   */
  private async openCopy(): Promise<void> {
    const sample = this.selected;
    if (!sample) return;
    try {
      const info = await window.znxstudio.app.getInfo();
      const target = scratchCopyPath(`${info.tempDir}\\znxstudio-samples`, sample);
      await window.znxstudio.fs.writeFile(target, this.source);
      await this.editor?.openFile(target);
      this.moduleContext.layout.showToast(`Opened a copy at ${target} — the original is read-only.`, 'info');
    } catch (error) {
      this.moduleContext.layout.showToast(`Could not copy the sample: ${(error as Error).message}`, 'error');
    }
  }

  /* ----- UI ----- */

  private async reveal(): Promise<void> {
    this.moduleContext.layout.showPanelView('samples');
    if (!this.samples.length) await this.discover();
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    if (!this.root) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-samples-empty';
      empty.textContent =
        `No examples folder found beside the Zornux compiler. Set "${SAMPLES_PATH_SETTING}" to the compiler's examples/ directory.`;
      this.view.appendChild(empty);
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-samples-toolbar';

    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Filter samples…';
    search.value = this.query;
    search.addEventListener('input', () => {
      this.query = search.value;
      this.renderList(list);
    });
    toolbar.appendChild(search);

    const engine = document.createElement('select');
    engine.setAttribute('aria-label', 'Execution engine');
    for (const [value, label] of [
      ['interpreter', 'interpreter (run)'],
      ['vm', 'bytecode VM (vm-run)'],
    ] as [SampleEngine, string][]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      option.selected = this.engine === value;
      engine.appendChild(option);
    }
    engine.addEventListener('change', () => {
      this.engine = engine.value as SampleEngine;
    });
    toolbar.appendChild(engine);

    const count = document.createElement('span');
    count.className = 'znxstudio-samples-count';
    count.textContent = `${this.samples.length} programs · ${sampleCategories(this.samples).length} categories`;
    toolbar.appendChild(count);
    this.view.appendChild(toolbar);

    const columns = document.createElement('div');
    columns.className = 'znxstudio-samples-columns';
    const list = document.createElement('div');
    list.className = 'znxstudio-samples-list';
    const detail = document.createElement('div');
    detail.className = 'znxstudio-samples-detail';
    columns.append(list, detail);
    this.view.appendChild(columns);

    this.renderList(list);
    this.renderDetail(detail);
  }

  private renderList(host: HTMLElement): void {
    host.replaceChildren();
    const visible = filterSamples(this.samples, this.query);
    for (const category of sampleCategories(visible)) {
      const heading = document.createElement('div');
      heading.className = 'znxstudio-samples-category';
      heading.textContent = category;
      host.appendChild(heading);

      for (const sample of visible.filter((s) => s.category === category)) {
        const entry = document.createElement('button');
        entry.className = `znxstudio-samples-item${this.selected?.path === sample.path ? ' is-selected' : ''}`;
        entry.textContent = sample.expectFailure ? `${sample.title} ⚠` : sample.title;
        if (sample.expectFailure) entry.title = 'This program is meant to fail — it pins a compiler diagnostic.';
        entry.addEventListener('click', () => void this.select(sample));
        host.appendChild(entry);
      }
    }
  }

  private renderDetail(host: HTMLElement): void {
    host.replaceChildren();
    const sample = this.selected;
    if (!sample) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-samples-empty';
      hint.textContent = "Pick a sample. These are the compiler's own examples — the same programs its test suite runs.";
      host.appendChild(hint);
      return;
    }

    const title = document.createElement('div');
    title.className = 'znxstudio-samples-title';
    title.textContent = sample.path;
    host.appendChild(title);

    if (sample.expectFailure) {
      const warning = document.createElement('div');
      warning.className = 'znxstudio-samples-note';
      warning.textContent = 'This sample is expected to FAIL: it exists to pin a compiler diagnostic, not to demonstrate working code.';
      host.appendChild(warning);
    }

    const actions = document.createElement('div');
    actions.className = 'znxstudio-samples-actions';
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = this.running ? 'Running…' : '▶ Run';
    run.disabled = this.running;
    run.addEventListener('click', () => void this.run());
    const open = document.createElement('button');
    open.className = 'znxstudio-btn-small';
    open.textContent = 'Open a copy';
    open.title = 'The examples folder is read-only; this opens an editable copy in a scratch folder.';
    open.addEventListener('click', () => void this.openCopy());
    actions.append(run, open);
    host.appendChild(actions);

    const source = document.createElement('pre');
    source.className = 'znxstudio-samples-source';
    source.textContent = this.source;
    host.appendChild(source);

    if (this.lastRun) {
      const verdict = document.createElement('div');
      verdict.className = `znxstudio-samples-verdict ${this.lastRun.asExpected ? 'is-ok' : 'is-bad'}`;
      verdict.textContent = sample.expectFailure
        ? this.lastRun.asExpected
          ? `Rejected as expected (exit ${this.lastRun.code}).`
          : `Unexpectedly succeeded (exit ${this.lastRun.code}) — this program was supposed to fail.`
        : this.lastRun.asExpected
          ? `Ran cleanly (exit ${this.lastRun.code}).`
          : `Failed (exit ${this.lastRun.code}).`;
      host.appendChild(verdict);

      const output = document.createElement('pre');
      output.className = 'znxstudio-samples-output';
      output.textContent = this.lastRun.output.trim() || '(no output)';
      host.appendChild(output);
    }
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      await this.discover();
      if (!this.root) {
        log('samples REAL: no examples folder found — skipped');
        return;
      }
      log(`samples REAL discover: root=${this.root} programs=${this.samples.length} categories=${sampleCategories(this.samples).length}`);

      const hello = this.samples.find((s) => s.path === 'hello.zx');
      if (hello) {
        await this.select(hello);
        await this.run();
        log(
          `samples REAL run hello.zx (${this.engine}): exit=${this.lastRun?.code} asExpected=${this.lastRun?.asExpected} ` +
            `output=${JSON.stringify(this.lastRun?.output.trim())}`,
        );
      }

      const invalid = this.samples.find((s) => s.expectFailure);
      if (invalid) {
        await this.select(invalid);
        await this.run();
        log(
          `samples REAL run ${invalid.path}: exit=${this.lastRun?.code} asExpected=${this.lastRun?.asExpected} ` +
            '(a NON-zero exit is the expected result for examples/invalid)',
        );
      }
    } catch (error) {
      log(`samples REAL failed: ${(error as Error).message}`);
    }
  }
}
