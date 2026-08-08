import {
  ServiceKeys,
  type ApiReferenceService,
  type CompilerService,
  type DocsService,
  type OutputService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import { captureTask } from '../database/runCapture';
import {
  DEFAULT_DOC_OPTIONS,
  buildDocArgs,
  coverageLine,
  docCoverage,
  docSections,
  indexFile,
  pageTitle,
  parseDocResult,
  type DocCoverage,
  type DocOptions,
  type DocResult,
  type DocSummary,
} from './apiReference';

/**
 * API reference (Phase 18B). Runs the REAL `zornux doc --json` and browses its
 * output in the 18A viewer.
 *
 * The generated tree goes to an OS-temp folder, never into the project: a
 * command that documents your code should not also dirty your working tree. The
 * "Save to project" action is the one place output lands in the workspace, and
 * it says where before it runs.
 *
 * `zornux doc` reports 0 modules for a path that does not exist (exit 0), so the
 * target folder is checked here first — otherwise a typo would read as "this
 * project has no public API surface".
 */
export class ApiReferenceModule implements IModule, ApiReferenceService {
  readonly id = 'znxstudio.docs.apiReference';
  readonly displayName = 'API Reference';

  private moduleContext!: ModuleContext;
  private docs: DocsService | undefined;
  private workspace: WorkspaceService | undefined;
  private output: OutputService | undefined;
  private view!: HTMLElement;

  private options: DocOptions = { ...DEFAULT_DOC_OPTIONS };
  private result: DocResult | null = null;
  private outputRoot = '';
  private running = false;
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.docs = context.services.tryGet<DocsService>(ServiceKeys.Docs);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.output = context.services.tryGet<OutputService>(ServiceKeys.Output);
    context.services.register(ServiceKeys.ApiReference, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-apidocs';
    context.layout.addPanelView({ id: 'apidocs', title: 'API Reference', element: this.view });

    context.commands.register(CommandIds.DocsGenerateApi, () => this.generate(), 'Docs: Generate API Reference');
    context.commands.register(CommandIds.DocsSaveApi, () => this.saveToProject(), 'Docs: Save API Reference to Project');

    this.render();
    void selfTestCoordinator.run('api-reference', () => this.maybeSelfTest());
  }

  /* ----- ApiReferenceService ----- */

  summary(): DocSummary | null {
    return this.result?.ok ? this.result.summary : null;
  }

  coverage(): DocCoverage | null {
    const summary = this.summary();
    return summary ? docCoverage(summary.diagnostics) : null;
  }

  async generate(target?: string, options?: Partial<DocOptions>): Promise<DocResult | null> {
    if (this.running) return null;
    const root = target ?? this.workspace?.currentFolder();
    if (!root) {
      this.moduleContext.layout.showToast('Open a folder to document.', 'info');
      return null;
    }
    if (options) this.options = { ...this.options, ...options };

    const outputRoot = await this.temporaryOutput(root);
    if (!outputRoot) return null;
    return this.run(root, outputRoot, false);
  }

  /* ----- running the real CLI ----- */

  /** A per-project scratch folder under the OS temp dir. Never the workspace. */
  private async temporaryOutput(root: string): Promise<string | null> {
    try {
      const info = await window.znxstudio.app.getInfo();
      const slug = (root.split(/[\\/]/).filter(Boolean).pop() ?? 'project').replace(/[^\w.-]+/g, '-');
      return joinPath(joinPath(info.tempDir, 'znxstudio-apidocs'), slug);
    } catch {
      this.moduleContext.layout.showToast('Could not locate a scratch folder for the generated docs.', 'error');
      return null;
    }
  }

  /** Pre-check the path: rc.4 reported a missing path as success; rc.8 fixed that, but the guard is cheap and gives a clearer message before spawning. */
  private async pathExists(root: string): Promise<boolean> {
    try {
      await window.znxstudio.fs.readDirectory(root);
      return true;
    } catch {
      return false;
    }
  }

  private async run(root: string, outputRoot: string, intoProject: boolean): Promise<DocResult | null> {
    const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.moduleContext.layout.showToast('Zornux compiler unavailable.', 'error');
      return null;
    }
    if (!(await this.pathExists(root))) {
      this.moduleContext.layout.showToast(`"${root}" does not exist — nothing to document.`, 'error');
      return null;
    }

    this.running = true;
    this.render();

    const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
    const command = `"${info.path}" ${buildDocArgs(root, outputRoot, this.options).map(quote).join(' ')}`;
    const { output } = await captureTask(command, root);
    const result = parseDocResult(output);

    this.running = false;
    this.result = result;
    this.outputRoot = outputRoot;

    if (!result.ok) {
      const first = result.failures[0];
      this.moduleContext.layout.showToast(
        first ? `${first.code}: ${first.message}` : 'The documentation generator failed.',
        'error',
      );
      this.output?.appendLine(`[api reference] ${command}`);
      this.output?.appendLine(output.trim());
    } else if (intoProject && result.summary.written) {
      this.moduleContext.layout.showToast(`Documentation written to ${outputRoot}.`, 'info');
    } else if (!result.summary.written) {
      // `--fail-on-missing-comments` tripped: `files[]` lists pages that do NOT exist.
      this.moduleContext.layout.showToast('Nothing was written: a public symbol has no documentation comment.', 'error');
    }

    this.render();
    this.changeEmitter.fire();
    return result;
  }

  /**
   * Write the reference into the project's own `docs/api`. This is the only
   * action that touches the workspace, and it names the folder first.
   */
  private async saveToProject(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root) {
      this.moduleContext.layout.showToast('Open a folder first.', 'info');
      return;
    }
    const target = joinPath(joinPath(root, 'docs'), 'api');
    await this.run(root, target, true);
  }

  /* ----- UI ----- */

  private async openIndex(): Promise<void> {
    const summary = this.summary();
    if (!summary || !this.docs) return;
    if (summary.format === 'html') {
      // The viewer renders Markdown. Saying so beats rendering HTML as text.
      this.moduleContext.layout.showToast(`HTML written to ${summary.output}. Switch to Markdown to read it in the viewer.`, 'info');
      return;
    }
    const entry = indexFile(summary);
    if (!entry) {
      this.moduleContext.layout.showToast('The generator wrote no index page.', 'error');
      return;
    }
    await this.docs.openFile({ label: summary.project, root: this.outputRoot }, entry);
  }

  private async openPage(file: string): Promise<void> {
    const summary = this.summary();
    if (!summary || !this.docs || summary.format === 'html') return;
    await this.docs.openFile({ label: summary.project, root: this.outputRoot }, file);
  }

  private render(): void {
    if (!this.view) return;
    this.view.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-apidocs-toolbar';

    const generate = document.createElement('button');
    generate.className = 'znxstudio-btn-small';
    generate.textContent = this.running ? 'Generating…' : 'Generate';
    generate.disabled = this.running;
    generate.addEventListener('click', () => void this.generate());
    toolbar.appendChild(generate);

    for (const [label, key] of [
      ['Private', 'includePrivate'],
      ['Tests', 'includeTests'],
      ['Packages', 'includePackages'],
      ['Fail on missing', 'failOnMissingComments'],
    ] as [string, keyof DocOptions][]) {
      const wrapper = document.createElement('label');
      wrapper.className = 'znxstudio-apidocs-toggle';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(this.options[key]);
      box.disabled = this.running;
      box.addEventListener('change', () => {
        this.options = { ...this.options, [key]: box.checked };
      });
      const text = document.createElement('span');
      text.textContent = label;
      wrapper.append(box, text);
      toolbar.appendChild(wrapper);
    }

    const format = document.createElement('select');
    format.className = 'znxstudio-apidocs-format';
    format.setAttribute('aria-label', 'Output format');
    for (const value of ['markdown', 'html'] as const) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = this.options.format === value;
      format.appendChild(option);
    }
    format.addEventListener('change', () => {
      this.options = { ...this.options, format: format.value as DocOptions['format'] };
    });
    toolbar.appendChild(format);

    const save = document.createElement('button');
    save.className = 'znxstudio-btn-small';
    save.textContent = 'Save to project';
    save.title = 'Write the reference into docs/api inside the workspace.';
    save.disabled = this.running;
    save.addEventListener('click', () => void this.saveToProject());
    toolbar.appendChild(save);
    this.view.appendChild(toolbar);

    if (!this.result) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-apidocs-empty';
      empty.textContent =
        'Generate an API reference from the documentation comments (#) above your public declarations. Output goes to a scratch folder, not your project.';
      this.view.appendChild(empty);
      return;
    }

    if (!this.result.ok) {
      const failure = document.createElement('div');
      failure.className = 'znxstudio-apidocs-failure';
      failure.textContent = 'The documentation generator produced nothing:';
      this.view.appendChild(failure);
      const list = document.createElement('ul');
      for (const problem of this.result.failures) {
        const item = document.createElement('li');
        item.textContent = `${problem.code} ${problem.message}${problem.help ? ` — ${problem.help}` : ''}`;
        list.appendChild(item);
      }
      this.view.appendChild(list);
      return;
    }

    const summary = this.result.summary;
    const coverage = docCoverage(summary.diagnostics);

    const header = document.createElement('div');
    header.className = `znxstudio-apidocs-summary ${summary.written ? '' : 'is-unwritten'}`;
    header.textContent = `${summary.project} ${summary.version} — ${coverageLine(summary, coverage)}`;
    this.view.appendChild(header);

    if (summary.modules === 0) {
      const note = document.createElement('div');
      note.className = 'znxstudio-apidocs-note';
      note.textContent =
        'No public symbols. Only `public` declarations inside a `module` are documented by default — tick "Private" to include the rest.';
      this.view.appendChild(note);
    }

    if (summary.format === 'markdown' && summary.written) {
      const index = document.createElement('button');
      index.className = 'znxstudio-btn-small';
      index.textContent = 'Open index';
      index.addEventListener('click', () => void this.openIndex());
      this.view.appendChild(index);
    }

    for (const section of docSections(summary.files)) {
      const heading = document.createElement('div');
      heading.className = 'znxstudio-apidocs-section';
      heading.textContent = section.name;
      this.view.appendChild(heading);

      const list = document.createElement('ul');
      list.className = 'znxstudio-apidocs-pages';
      for (const file of section.files) {
        const item = document.createElement('li');
        const link = document.createElement('button');
        link.className = 'znxstudio-apidocs-page';
        link.textContent = pageTitle(file);
        link.disabled = summary.format === 'html' || !summary.written;
        link.addEventListener('click', () => void this.openPage(file));
        item.appendChild(link);
        list.appendChild(item);
      }
      this.view.appendChild(list);
    }

    if (coverage.undocumented.length || coverage.invalidTags.length) {
      const heading = document.createElement('div');
      heading.className = 'znxstudio-apidocs-section';
      heading.textContent = 'Coverage';
      this.view.appendChild(heading);

      const note = document.createElement('div');
      note.className = 'znxstudio-apidocs-note';
      // The generator reports no file or line for these, so there is nothing to
      // jump to. Claiming otherwise would be a link that goes nowhere.
      note.textContent = 'The generator reports these by symbol name only — it does not say which file or line.';
      this.view.appendChild(note);

      const list = document.createElement('ul');
      list.className = 'znxstudio-apidocs-coverage';
      for (const symbol of coverage.undocumented) {
        const item = document.createElement('li');
        item.textContent = `ZX1601  ${symbol} — no documentation comment`;
        list.appendChild(item);
      }
      for (const tag of coverage.invalidTags) {
        const item = document.createElement('li');
        item.textContent = `ZX1602  ${tag}`;
        list.appendChild(item);
      }
      this.view.appendChild(list);
    }
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
      return;
    }
    if (!enabled || !tempDir) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const compiler = this.moduleContext.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (!info?.available || !info.path) {
        log('api reference REAL: compiler unavailable — skipped');
        return;
      }

      // A real, documented library — written to OS temp, never a repo.
      const source = `${tempDir}\\znxstudio-apidocs-src`;
      await window.znxstudio.fs.writeFile(
        `${source}\\shop.zx`,
        [
          'module Shop',
          '',
          '# Calculates sales tax from a product price.',
          '# param price The pre-tax product price.',
          '# returns The tax owed on that price.',
          'public function calculate_tax with price',
          '    give back price * 0.1',
          'end',
          '',
          'public function undocumented_helper with value',
          '    give back value',
          'end',
          '',
        ].join('\n'),
      );

      const output = `${tempDir}\\znxstudio-apidocs-out`;
      this.options = { ...DEFAULT_DOC_OPTIONS };
      const generated = await this.run(source, output, false);
      if (generated?.ok) {
        const summary = generated.summary;
        const coverage = docCoverage(summary.diagnostics);
        log(
          `api reference REAL doc: modules=${summary.modules} written=${summary.written} files=${summary.files.length} ` +
            `[${summary.files.join(', ')}]`,
        );
        log(`api reference REAL coverage: undocumented=[${coverage.undocumented.join(', ')}] wouldFail=${coverage.wouldFail}`);
        const page = await window.znxstudio.fs.readFile(`${output}\\modules\\Shop.md`);
        log(`api reference REAL page: Shop.md has "Parameters"=${page.includes('**Parameters**')} "Returns"=${page.includes('**Returns**')}`);
      }

      // `--fail-on-missing-comments`: escalates to Error and writes NOTHING.
      this.options = { ...DEFAULT_DOC_OPTIONS, failOnMissingComments: true };
      const strict = await this.run(source, `${output}-strict`, false);
      if (strict?.ok) {
        const severity = strict.summary.diagnostics.find((d) => d.code === 'ZX1601')?.severity;
        log(
          `api reference REAL strict: written=${strict.summary.written} ZX1601=${severity} ` +
            `files listed=${strict.summary.files.length} (listed but NOT on disk — expect written=false, Error)`,
        );
      }

      // A bad --format is a failure. rc.8 reports it as an `ok:false` envelope
      // (pre-rc.8 it was a bare diagnostics array); the reader handles both.
      const quote = (arg: string) => (arg.includes(' ') ? `"${arg}"` : arg);
      const bad = `"${info.path}" ${['doc', source, '--output', output, '--format', 'pdf', '--json'].map(quote).join(' ')}`;
      const badResult = parseDocResult((await captureTask(bad, tempDir)).output);
      log(
        `api reference REAL bad format: ok=${badResult.ok} ` +
          (badResult.ok ? '' : `first=${badResult.failures[0]?.code} (ok:false envelope on rc.8; a bare array on older binaries)`),
      );

      // A path that does not exist: rc.8's doc-path fix now reports `ok:false`
      // (rc.4 lied with `ok:true modules:0`, which is why ZnxStudio still pre-checks
      // the path before spawning). Either way the reader must not read it as clean.
      const missing = parseDocResult((await captureTask(`"${info.path}" doc no_such_folder_zz --output ${quote(`${output}-missing`)} --json`, tempDir)).output);
      log(
        `api reference REAL missing path: ok=${missing.ok} modules=${missing.ok ? missing.summary.modules : '?'} ` +
          '(rc.8 ⇒ ok:false; ZnxStudio also pre-checks the path)',
      );

      this.options = { ...DEFAULT_DOC_OPTIONS };
    } catch (error) {
      log(`api reference REAL failed: ${(error as Error).message}`);
    }
  }
}
