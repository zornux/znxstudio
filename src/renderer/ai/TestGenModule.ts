import {
  ServiceKeys,
  type AiService,
  type CompilerService,
  type EditorService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureTask } from '../database/runCapture';
import { buildTestArgs, parseTestResult, type TestRunResult } from '../testing/testModel';
import { findDeclaration } from './docs';
import {
  buildTestGenMessages,
  composeTestProgram,
  countTests,
  extractTestBlocks,
  isRunnableSource,
} from './testgen';

/**
 * AI Test Generation (Phase 10F). Generates real Zornux `test "…" … end` blocks
 * for the active file (optionally focused on the declaration at the cursor) via
 * the vendor-neutral AiService, then RUNS them against the real `zornux test`
 * CLI — writing the composed program to an OS-temp file so repos stay clean
 * (reuses the Phase 9 runner helpers). Copy or run; nothing is written to repos.
 */
export class TestGenModule implements IModule {
  readonly id = 'znxstudio.ai.testgen';
  readonly displayName = 'AI Test Generation';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private panel!: HTMLElement;
  private source = '';
  private testSource = '';
  private sourceFile: string | null = null;
  private runResult: TestRunResult | null = null;
  private phase: 'idle' | 'generating' | 'running' = 'idle';

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-testgen';
    context.layout.addPanelView({ id: 'ai-testgen', title: 'AI Tests', element: this.panel });

    context.commands.register(CommandIds.AiTestGen, () => this.generate(), 'AI: Generate Tests');

    this.render();
    void selfTestCoordinator.run('ai-testgen', () => this.maybeSelfTest());
  }

  private async generate(): Promise<void> {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to generate tests.', 'info');
      return;
    }
    const text = this.editor.activeText();
    if (!text || !text.trim()) {
      this.context.layout.showToast('Open a file to generate tests for.', 'info');
      return;
    }

    this.source = text;
    this.sourceFile = this.editor.currentFile();
    this.testSource = '';
    this.runResult = null;
    this.phase = 'generating';
    this.render();
    this.context.layout.showPanelView('ai-testgen');

    const cursor = this.editor.cursorPosition();
    const target = cursor ? findDeclaration(text, cursor.line)?.name : undefined;
    const { system, messages } = buildTestGenMessages(text, this.baseName(this.sourceFile), target);
    const result = await this.ai.complete(messages, { system, temperature: 0.2, maxTokens: 1500 });
    this.phase = 'idle';

    if (!result.ok) {
      this.render();
      this.context.layout.showToast(`Test generation failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    this.testSource = extractTestBlocks(result.text);
    if (!this.testSource) {
      this.context.layout.showToast('The model returned no test blocks.', 'info');
    }
    this.render();
  }

  /* ----- run generated tests against the real compiler (repo-safe temp) ----- */
  private async run(): Promise<void> {
    if (!this.testSource) return;
    if (!isRunnableSource(this.source)) {
      this.context.layout.showToast('This file declares a service/publish block — generated tests are shown but not auto-run.', 'info');
      return;
    }
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.context.layout.showToast('Zornux compiler unavailable — cannot run tests.', 'error');
      return;
    }
    let tempDir = '';
    try {
      tempDir = (await window.znxstudio.app.getInfo()).tempDir;
    } catch {
      tempDir = '';
    }
    if (!tempDir) return;

    this.phase = 'running';
    this.render();
    const file = `${tempDir}\\znxstudio-aigen-tests.zx`;
    const program = composeTestProgram(this.source, this.testSource);
    await window.znxstudio.fs.writeFile(file, program);
    const { output } = await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir);
    this.runResult = parseTestResult(output);
    this.phase = 'idle';
    this.render();
    if (this.runResult) {
      const kind = this.runResult.failed > 0 ? 'error' : 'success';
      this.context.layout.showToast(`Generated tests: ${this.runResult.passed}/${this.runResult.total} passed.`, kind);
    } else {
      this.context.layout.showToast('Could not parse the test run — the generated tests may not compile.', 'error');
    }
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-testgen-toolbar';
    const gen = document.createElement('button');
    gen.className = 'znxstudio-btn-small';
    gen.textContent = this.phase === 'generating' ? 'Generating…' : '🧪 Generate';
    gen.disabled = this.phase !== 'idle';
    gen.addEventListener('click', () => void this.generate());
    toolbar.appendChild(gen);

    if (this.testSource) {
      const run = document.createElement('button');
      run.className = 'znxstudio-btn-small';
      run.textContent = this.phase === 'running' ? 'Running…' : '▶ Run';
      run.disabled = this.phase !== 'idle';
      run.addEventListener('click', () => void this.run());
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(this.testSource);
        this.context.layout.showToast('Tests copied.', 'success');
      });
      const count = document.createElement('span');
      count.className = 'znxstudio-testgen-count';
      count.textContent = `${countTests(this.testSource)} test${countTests(this.testSource) === 1 ? '' : 's'}`;
      toolbar.append(run, copy, count);
    }

    const provider = document.createElement('span');
    provider.className = 'znxstudio-testgen-provider';
    provider.textContent = this.sourceFile ? `${this.baseName(this.sourceFile)} · ${this.ai.providerLabel()}` : this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.appendChild(provider);
    this.panel.appendChild(toolbar);

    if (this.runResult) this.panel.appendChild(this.resultBanner(this.runResult));

    const body = document.createElement('div');
    body.className = 'znxstudio-testgen-body';
    if (this.phase === 'generating') {
      body.textContent = `Generating tests with ${this.ai.providerLabel()}…`;
      body.classList.add('is-muted');
    } else if (!this.testSource) {
      body.textContent = 'Generate Zornux tests for the active file. Place the cursor in a function to focus on it. Generated tests run against the real compiler in a temp file.';
      body.classList.add('is-muted');
    } else {
      const pre = document.createElement('pre');
      pre.className = 'znxstudio-testgen-code';
      pre.textContent = this.testSource;
      body.appendChild(pre);
    }
    this.panel.appendChild(body);
  }

  private resultBanner(result: TestRunResult): HTMLElement {
    const banner = document.createElement('div');
    banner.className = `znxstudio-testgen-result ${result.failed > 0 ? 'is-fail' : 'is-pass'}`;
    banner.textContent = `${result.passed}/${result.total} passed${result.failed ? ` · ${result.failed} failed` : ''}`;
    for (const t of result.tests) {
      if (t.status === 'passed') continue;
      const row = document.createElement('div');
      row.className = 'znxstudio-testgen-fail';
      row.textContent = `✗ ${t.name}${t.message ? ` — ${t.message}` : ''}`;
      banner.appendChild(row);
    }
    return banner;
  }

  private baseName(path: string | null): string | null {
    return path ? path.split(/[\\/]/).pop() ?? path : null;
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

    // NOTE: `add` is a reserved word in Zornux — the fixture uses `combine`.
    const reply = 'Sure! Here are tests:\n```zornux\ntest "combines"\n    expect combine(2, 3) to equal 5\nend\n\ntest "combines zero"\n    expect combine(0, 0) to equal 0\nend\n```\nHope that helps.';
    const extracted = extractTestBlocks(reply);
    log(`testgen extract: tests=${countTests(extracted)} startsWithTest=${extracted.startsWith('test "')} noFence=${!extracted.includes('```')} noProse=${!extracted.includes('Hope')}`);
    const program = composeTestProgram('function combine with a, b\n    give back a + b\nend', extracted);
    log(`testgen compose: hasSource=${program.includes('give back a + b')} hasTests=${program.includes('expect combine')} runnable=${isRunnableSource(program)}`);
    log(`testgen prompt: ${JSON.stringify(buildTestGenMessages('x', 'm.zx', 'add').messages[0].content.slice(0, 40))}`);

    // REAL run of GENERATED-SHAPED tests against the real compiler (repo-safe temp).
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const file = `${tempDir}\\znxstudio-aigen-selftest.zx`;
        await window.znxstudio.fs.writeFile(file, composeTestProgram('function combine with a, b\n    give back a + b\nend', extracted));
        const { output } = await captureTask(`"${info.path}" test "${file}" ${buildTestArgs({ engine: 'interpreter', failFast: false })}`, tempDir);
        const parsed = parseTestResult(output);
        log(`testgen REAL run: total=${parsed?.total} passed=${parsed?.passed} failed=${parsed?.failed} (real compiler on composed program)`);
        if (this.ai.isEnabled()) {
          log(`testgen REAL gen+run available (provider=${this.ai.providerId()}) — generation exercised via UI`);
        } else {
          log('testgen REAL generation: no provider configured — run path proven with generated-shaped tests');
        }
      } else {
        log('testgen REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`testgen REAL failed: ${(error as Error).message}`);
    }
  }
}
