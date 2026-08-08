import {
  ServiceKeys,
  type AiService,
  type CompilerService,
  type EditorService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { renderAiMarkdown } from './aiMarkdown';
import {
  buildDebugMessages,
  diagnosticToContext,
  extractSnippet,
  pickNearestDiagnostic,
  summarizeContext,
  type DebugContext,
} from './debugassist';

/**
 * AI Debug Assistant (Phase 10G). Explains a real error and suggests a fix via
 * the vendor-neutral AiService. Its primary source of truth is a live `zornux
 * check` on the active buffer — it explains the actual compiler diagnostic
 * nearest the cursor — but it also explains a pasted stack trace / run output
 * when there is a selection. Grounded in the real compiler, not guesses.
 */
export class DebugAssistModule implements IModule {
  readonly id = 'znxstudio.ai.debug';
  readonly displayName = 'AI Debug Assistant';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private panel!: HTMLElement;
  private current: DebugContext | null = null;
  private explanation = '';
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-debugai';
    context.layout.addPanelView({ id: 'ai-debug', title: 'AI Debug', element: this.panel });

    context.commands.register(CommandIds.AiExplainError, () => this.explain(), 'AI: Explain Error');

    this.render();
    void selfTestCoordinator.run('ai-debug', () => this.maybeSelfTest());
  }

  private async explain(): Promise<void> {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to explain errors.', 'info');
      return;
    }
    const text = this.editor.activeText();
    if (!text) {
      this.context.layout.showToast('Open a file to explain an error.', 'info');
      return;
    }

    // A selection is treated as a pasted error / output to explain.
    const selection = this.editor.selectedText();
    let context: DebugContext | null;
    const fileName = this.baseName(this.editor.currentFile());
    if (selection.trim()) {
      context = { kind: 'output', message: selection.trim(), file: fileName };
    } else {
      context = await this.diagnosticContext(text, fileName);
      if (!context) {
        this.context.layout.showToast('No compiler errors to explain in this file. 🎉', 'success');
        return;
      }
    }

    this.current = context;
    this.explanation = '';
    this.running = true;
    this.render();
    this.context.layout.showPanelView('ai-debug');
    if (context.line !== undefined) this.editor.revealPosition(Math.max(0, context.line - 1), 0);

    const { system, messages } = buildDebugMessages(context, fileName);
    const result = await this.ai.complete(messages, { system, temperature: 0.2, maxTokens: 900 });
    this.running = false;
    if (!result.ok) {
      this.render();
      this.context.layout.showToast(`Explain failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    this.explanation = result.text.trim();
    this.render();
  }

  /** Run the real compiler on the buffer and pick the diagnostic nearest the cursor. */
  private async diagnosticContext(text: string, fileName: string | null): Promise<DebugContext | null> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    if (!compiler) return null;
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const result = await compiler.check({
      uri: this.editor.currentUri() ?? 'inmemory://debug',
      path: this.editor.currentFile(),
      source: text,
      isDirty: true,
      workspaceRoot: workspace?.currentFolder() ?? null,
    });
    const errors = result.diagnostics.filter((d) => d.severity === 'error');
    const pool = errors.length ? errors : result.diagnostics;
    const cursor = this.editor.cursorPosition();
    const diagnostic = pickNearestDiagnostic(pool, (cursor?.line ?? 0) + 1);
    return diagnostic ? diagnosticToContext(diagnostic, text, fileName) : null;
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-debugai-toolbar';
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = this.running ? 'Explaining…' : '🩺 Explain Error';
    run.disabled = this.running;
    run.addEventListener('click', () => void this.explain());
    toolbar.appendChild(run);
    if (this.explanation) {
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(this.explanation);
        this.context.layout.showToast('Explanation copied.', 'success');
      });
      toolbar.appendChild(copy);
    }
    const provider = document.createElement('span');
    provider.className = 'znxstudio-debugai-provider';
    provider.textContent = this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.appendChild(provider);
    this.panel.appendChild(toolbar);

    if (this.current) {
      const header = document.createElement('div');
      header.className = `znxstudio-debugai-error is-${this.current.kind}`;
      header.textContent = summarizeContext(this.current);
      this.panel.appendChild(header);
      if (this.current.snippet) {
        const snippet = document.createElement('pre');
        snippet.className = 'znxstudio-debugai-snippet';
        snippet.textContent = this.current.snippet;
        this.panel.appendChild(snippet);
      }
    }

    const body = document.createElement('div');
    body.className = 'znxstudio-debugai-body';
    if (this.running) {
      body.textContent = `Analyzing with ${this.ai.providerLabel()}…`;
      body.classList.add('is-muted');
    } else if (!this.explanation && !this.current) {
      body.textContent = 'Run "AI: Explain Error" to diagnose the compiler error nearest the cursor — or select a stack trace / output to explain it.';
      body.classList.add('is-muted');
    } else if (this.explanation) {
      const md = document.createElement('div');
      md.className = 'znxstudio-debugai-explanation';
      renderAiMarkdown(md, this.explanation);
      body.appendChild(md);
    }
    this.panel.appendChild(body);
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

    const snippet = extractSnippet('function add with a\n    give back a\nend', 1);
    log(`debugai snippet: markerOnL1=${snippet.split('\n')[0].startsWith('>')} hasNums=${snippet.includes('1 |')}`);
    const diags = [
      { code: 'ZX0110', severity: 'error' as const, message: 'reserved word', file: 'm.zx', range: { start: { line: 1, col: 10 }, end: { line: 1, col: 13 } } },
      { code: 'ZX0100', severity: 'error' as const, message: 'other', file: 'm.zx', range: { start: { line: 8, col: 1 }, end: { line: 8, col: 2 } } },
    ];
    const near = pickNearestDiagnostic(diags, 7);
    log(`debugai pickNearest(cursor L7): ${near?.code}@L${near?.range.start.line} (expect ZX0100)`);
    const framed = buildDebugMessages(diagnosticToContext(diags[0], 'function add with a\n    give back a\nend', 'm.zx'), 'm.zx');
    log(`debugai prompt: hasCode=${framed.messages[0].content.includes('ZX0110')} hasSnippet=${framed.messages[0].content.includes('give back a')} asksFix=${framed.messages[0].content.includes('fix')}`);

    // REAL diagnostic — run the actual compiler on a file with a real ZX0110 error.
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (compiler && info?.available && info.path && tempDir) {
        const file = `${tempDir}\\znxstudio-debugai-selftest.zx`;
        const bad = 'function add with a, b\n    give back a + b\nend\n'; // `add` is reserved → ZX0110
        await window.znxstudio.fs.writeFile(file, bad);
        const result = await compiler.check({ uri: `file:///${file.replace(/\\/g, '/')}`, path: file, source: bad, isDirty: false, workspaceRoot: tempDir });
        const nearest = pickNearestDiagnostic(result.diagnostics, 1);
        const ctx = nearest ? diagnosticToContext(nearest, bad, 'selftest.zx') : null;
        log(`debugai REAL check: diags=${result.diagnostics.length} nearest=${nearest?.code} summary=${JSON.stringify(ctx ? summarizeContext(ctx) : '')}`);
        if (this.ai.isEnabled() && ctx) {
          const explained = await this.ai.complete(buildDebugMessages(ctx, 'selftest.zx').messages, { system: 'Be brief.', temperature: 0.2, maxTokens: 200 });
          log(`debugai REAL explain: provider=${this.ai.providerId()} ok=${explained.ok} text=${JSON.stringify((explained.text || explained.error || '').slice(0, 60))}`);
        } else {
          log('debugai REAL explain: no provider configured — diagnostic-grounding path proven with the real compiler');
        }
      } else {
        log('debugai REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`debugai REAL failed: ${(error as Error).message}`);
    }
  }
}
