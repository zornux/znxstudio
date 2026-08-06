import {
  ServiceKeys,
  type AiService,
  type EditorService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { renderAiMarkdown } from './aiMarkdown';
import {
  buildFileDocMessages,
  buildSymbolDocMessages,
  cleanDocText,
  extractBlock,
  findDeclaration,
  formatDocComment,
  hasDocCommentAbove,
} from './docs';

/**
 * AI Documentation (Phase 10E). Two generators over the vendor-neutral AiService:
 *  • Document Symbol — writes a Zornux `#` doc comment for the declaration at the
 *    cursor and inserts it directly above (single undo through the editor).
 *  • Generate File Docs — produces a Markdown overview of the whole file into a
 *    panel, copyable to the clipboard.
 */
export class DocsModule implements IModule {
  readonly id = 'znxstudio.ai.docs';
  readonly displayName = 'AI Documentation';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private panel!: HTMLElement;
  private docText = '';
  private docFile: string | null = null;
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-docs';
    context.layout.addPanelView({ id: 'ai-docs', title: 'AI Docs', element: this.panel });

    context.commands.register(CommandIds.AiDocSymbol, () => void this.documentSymbol(), 'AI: Document Symbol');
    context.commands.register(CommandIds.AiDocFile, () => void this.documentFile(), 'AI: Generate File Docs');

    this.render();
    void selfTestCoordinator.run('ai-docs', () => this.maybeSelfTest());
  }

  /* ----- document the symbol at the cursor ----- */
  private async documentSymbol(): Promise<void> {
    if (!this.guardEnabled()) return;
    const text = this.editor.activeText();
    const cursor = this.editor.cursorPosition();
    if (!text || !cursor) {
      this.context.layout.showToast('Place the cursor in a declaration to document.', 'info');
      return;
    }
    const decl = findDeclaration(text, cursor.line);
    if (!decl) {
      this.context.layout.showToast('No function/class/… declaration found at the cursor.', 'info');
      return;
    }
    if (hasDocCommentAbove(text, decl.headerLine)) {
      const proceed = window.confirm(`${decl.kind} ${decl.name} already has a comment above it. Add another?`);
      if (!proceed) return;
    }

    const snippet = extractBlock(text, decl);
    const fileName = this.baseName(this.editor.currentFile());
    const { system, messages } = buildSymbolDocMessages(decl, snippet, fileName);
    this.context.layout.showToast(`Documenting ${decl.name} with ${this.ai.providerLabel()}…`, 'info');
    const result = await this.ai.complete(messages, { system, temperature: 0.1, maxTokens: 400 });
    if (!result.ok) {
      this.context.layout.showToast(`Docs failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    const comment = formatDocComment(result.text, decl.indent);
    if (!cleanDocText(result.text)) {
      this.context.layout.showToast('The model returned no documentation.', 'info');
      return;
    }
    // Insert above the header as a single edit (header shifts down).
    this.editor.setSelections([
      { startLine: decl.headerLine, startCharacter: 0, endLine: decl.headerLine, endCharacter: 0 },
    ]);
    this.editor.insertText(comment);
    this.context.layout.showToast(`Documented ${decl.kind} ${decl.name}.`, 'success');
  }

  /* ----- document the whole file → panel ----- */
  private async documentFile(): Promise<void> {
    if (!this.guardEnabled()) return;
    const text = this.editor.activeText();
    if (!text || !text.trim()) {
      this.context.layout.showToast('Open a file to document.', 'info');
      return;
    }
    this.running = true;
    this.docFile = this.editor.currentFile();
    this.render();
    this.context.layout.showPanelView('ai-docs');

    const fileName = this.baseName(this.docFile);
    const { system, messages } = buildFileDocMessages(text, fileName);
    const result = await this.ai.complete(messages, { system, temperature: 0.2, maxTokens: 2000 });
    this.running = false;
    if (!result.ok) {
      this.render();
      this.context.layout.showToast(`Docs failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    this.docText = result.text.trim();
    this.render();
  }

  private guardEnabled(): boolean {
    if (this.ai.isEnabled()) return true;
    this.context.layout.showToast('AI is off — configure a provider to generate docs.', 'info');
    return false;
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-docs-toolbar';
    const gen = document.createElement('button');
    gen.className = 'znxstudio-btn-small';
    gen.textContent = this.running ? 'Generating…' : '📄 Document File';
    gen.disabled = this.running;
    gen.addEventListener('click', () => void this.documentFile());
    toolbar.appendChild(gen);
    if (this.docText) {
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(this.docText);
        this.context.layout.showToast('Documentation copied.', 'success');
      });
      toolbar.appendChild(copy);
    }
    const provider = document.createElement('span');
    provider.className = 'znxstudio-docs-provider';
    provider.textContent = this.docFile ? `${this.baseName(this.docFile)} · ${this.ai.providerLabel()}` : this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.appendChild(provider);
    this.panel.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'znxstudio-docs-body';
    if (this.running) {
      body.textContent = `Generating documentation with ${this.ai.providerLabel()}…`;
      body.classList.add('is-muted');
    } else if (!this.docText) {
      body.textContent = 'Generate Markdown docs for the active file, or use "AI: Document Symbol" to comment the declaration at the cursor.';
      body.classList.add('is-muted');
    } else {
      const md = document.createElement('div');
      md.className = 'znxstudio-docs-markdown';
      renderAiMarkdown(md, this.docText);
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
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const source = 'module math\n\nfunction add with a, b\n    give back a + b\nend\n';
    const decl = findDeclaration(source, 3); // inside add
    log(`docs findDecl: kind=${decl?.kind} name=${decl?.name} line=${decl?.headerLine} indent="${decl?.indent}"`);
    const block = extractBlock(source, decl!);
    log(`docs extractBlock: lines=${block.split('\n').length} hasEnd=${block.includes('end')}`);
    const comment = formatDocComment('Adds two numbers.\na: first addend\nb: second addend\nReturns the sum.', '    ');
    log(`docs formatComment: ${JSON.stringify(comment.split('\n')[0])} lines=${comment.trim().split('\n').length}`);
    const cleaned = cleanDocText('```\n# Adds numbers\n\n\nreturns sum\n```');
    log(`docs cleanText noHash=${!cleaned.includes('#')} collapsed=${!cleaned.includes('\n\n\n')} val=${JSON.stringify(cleaned)}`);
    log(`docs hasDocAbove(above header line 3)=${hasDocCommentAbove('# doc\nfunction f\n    give back 1\nend', 1)}`);

    // REAL docs — only if a provider is configured; otherwise honest skip.
    try {
      if (this.ai.isEnabled()) {
        const { system, messages } = buildSymbolDocMessages(decl!, block, 'math.zx');
        const result = await this.ai.complete(messages, { system, temperature: 0.1, maxTokens: 200 });
        log(`docs REAL: provider=${this.ai.providerId()} ok=${result.ok} text=${JSON.stringify((cleanDocText(result.text) || result.error || '').slice(0, 60))}`);
      } else {
        log('docs REAL: no provider configured — skipped');
      }
    } catch (error) {
      log(`docs REAL failed: ${(error as Error).message}`);
    }
  }
}
