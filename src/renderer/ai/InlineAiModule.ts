import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type AiService,
  type CursorSelection,
  type EditorService,
  type InputBoxService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { renderAiMarkdown } from './aiMarkdown';
import { diffLines, diffStats, type DiffLine } from './refactor';
import {
  INLINE_ACTIONS,
  buildInlineMessages,
  cleanInlineOutput,
  findInlineAction,
  type InlineAction,
  type InlineActionId,
} from './inlineActions';

const INLINE_LANGUAGES = ['zornux'];

/**
 * Inline AI (Phase 10J). Right-click selected code → AI submenu with Explain,
 * Generate, Rewrite, Simplify, Add Types, Generate Tests. Replacing actions
 * show a diff preview; non-replacing actions render Markdown in a panel.
 * Integrated into the Monaco editor context menu and the command palette.
 */
export class InlineAiModule implements IModule {
  readonly id = 'znxstudio.ai.inline';
  readonly displayName = 'Inline AI';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private panel!: HTMLElement;
  private overlay: HTMLElement | undefined;
  private lastResult = '';
  private generating = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    // Panel for non-replacing results (Explain, Generate Tests)
    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-inlineai';
    context.layout.addPanelView({ id: 'ai-inline', title: 'AI', element: this.panel });

    // Register commands
    context.commands.register(CommandIds.AiInlineExplain, () => this.run('explain'), 'AI: Explain Selection');
    context.commands.register(CommandIds.AiInlineGenerate, () => this.run('generate'), 'AI: Generate Code');
    context.commands.register(CommandIds.AiInlineRewrite, () => this.run('rewrite'), 'AI: Rewrite Selection');
    context.commands.register(CommandIds.AiInlineSimplify, () => this.run('simplify'), 'AI: Simplify Selection');
    context.commands.register(CommandIds.AiInlineAddTypes, () => this.run('addTypes'), 'AI: Add Types');
    context.commands.register(CommandIds.AiInlineAddTests, () => this.run('addTests'), 'AI: Generate Tests for Selection');

    // Register Monaco editor actions for the context menu
    this.registerEditorActions();

    // Enablement: all inline commands need an active file + selection (except generate)
    const selectionCommands = new Set([
      CommandIds.AiInlineExplain,
      CommandIds.AiInlineRewrite,
      CommandIds.AiInlineSimplify,
      CommandIds.AiInlineAddTypes,
      CommandIds.AiInlineAddTests,
    ]);
    context.commands.addEnablementRule((id: string) => {
      if (selectionCommands.has(id as typeof CommandIds.AiInlineExplain)) {
        return this.ai.isEnabled() && (this.editor.selectedCharCount() > 0);
      }
      if (id === CommandIds.AiInlineGenerate) {
        return this.ai.isEnabled() && (this.editor.currentFile() ?? null) !== null;
      }
      return undefined;
    });

    this.renderPanel();
    void selfTestCoordinator.run('ai-inline', () => this.maybeSelfTest());
  }

  private registerEditorActions(): void {
    // Access Monaco editor instance through the global — the EditorModule exposes
    // the underlying IStandaloneCodeEditor for trusted modules.
    const editorInstance = (window as any).__znxstudio_editor as monaco.editor.IStandaloneCodeEditor | undefined;
    if (!editorInstance) return;

    const actions: { id: string; label: string; commandId: string }[] = [
      { id: 'znxstudio.inline.explain', label: 'AI: Explain', commandId: CommandIds.AiInlineExplain },
      { id: 'znxstudio.inline.generate', label: 'AI: Generate', commandId: CommandIds.AiInlineGenerate },
      { id: 'znxstudio.inline.rewrite', label: 'AI: Rewrite', commandId: CommandIds.AiInlineRewrite },
      { id: 'znxstudio.inline.simplify', label: 'AI: Simplify', commandId: CommandIds.AiInlineSimplify },
      { id: 'znxstudio.inline.addTypes', label: 'AI: Add Types', commandId: CommandIds.AiInlineAddTypes },
      { id: 'znxstudio.inline.addTests', label: 'AI: Generate Tests', commandId: CommandIds.AiInlineAddTests },
    ];

    for (const action of actions) {
      editorInstance.addAction({
        id: action.id,
        label: action.label,
        contextMenuGroupId: 'znxstudio_ai',
        contextMenuOrder: actions.indexOf(action) + 1,
        precondition: 'editorHasSelection',
        run: () => this.context.commands.execute(action.commandId),
      });
    }
  }

  private async run(actionId: InlineActionId): Promise<void> {
    if (this.generating) {
      this.context.layout.showToast('An AI action is already running.', 'info');
      return;
    }
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider first.', 'info');
      return;
    }

    const action = findInlineAction(actionId);
    if (!action) return;

    const code = this.editor.selectedText();
    if (!code.trim() && actionId !== 'generate') {
      this.context.layout.showToast('Select code first.', 'info');
      return;
    }

    let instruction = '';
    if (action.needsInstruction) {
      const inputBox = this.context.services.tryGet<InputBoxService>(ServiceKeys.InputBox);
      if (inputBox) {
        instruction = await inputBox.prompt({
          title: action.label,
          label: actionId === 'generate' ? 'Describe what to generate' : 'Describe the change',
          placeholder: actionId === 'generate'
            ? 'e.g. A function that validates email addresses'
            : 'e.g. Make this async with error handling',
          submitLabel: 'Generate',
          validate: (v) => v.trim() ? null : 'Enter an instruction.',
        }) ?? '';
        if (!instruction.trim()) return;
      }
    }

    const selections = this.editor.getSelections();
    const sourceUri = this.editor.currentUri();
    const sourceText = this.editor.activeText() ?? '';
    const fileName = this.baseName(this.editor.currentFile());

    this.generating = true;
    const { system, messages } = buildInlineMessages(action, code, fileName, instruction);

    let result;
    try {
      result = await this.ai.complete(messages, {
        system,
        temperature: action.replaces ? 0 : 0.3,
        maxTokens: action.id === 'explain' ? 800 : 1200,
      });
    } catch (error) {
      this.generating = false;
      this.context.layout.showToast(`${action.label} failed: ${(error as Error).message}`, 'error');
      return;
    }

    this.generating = false;

    if (!result.ok) {
      this.context.layout.showToast(`${action.label} failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }

    if (action.replaces) {
      const cleaned = cleanInlineOutput(result.text);
      if (!cleaned || cleaned === code.replace(/\s+$/, '')) {
        this.context.layout.showToast('The model returned no change.', 'info');
        return;
      }
      if (this.editor.currentUri() !== sourceUri || this.editor.activeText() !== sourceText) {
        this.context.layout.showToast('The source changed. Run the command again.', 'info');
        return;
      }
      this.showDiffPreview(action, code, cleaned, selections, sourceUri, sourceText);
    } else {
      this.lastResult = result.text.trim();
      this.renderPanel();
      this.context.layout.showPanelView('ai-inline');
    }
  }

  private showDiffPreview(
    action: InlineAction,
    before: string,
    after: string,
    selections: CursorSelection[],
    sourceUri: string | null,
    sourceText: string,
  ): void {
    const diff = diffLines(before, after);
    const stats = diffStats(diff);
    const { overlay, box } = this.makeModal(`${action.label} — preview`);
    box.classList.add('is-wide');

    const meta = document.createElement('div');
    meta.className = 'znxstudio-ai-diff-meta';
    meta.innerHTML = `<span class="znxstudio-ai-diff-add">+${stats.added}</span> <span class="znxstudio-ai-diff-del">−${stats.removed}</span> · ${this.ai.providerLabel()}`;
    box.appendChild(meta);

    box.appendChild(this.renderDiff(diff));

    const actions = document.createElement('div');
    actions.className = 'znxstudio-ai-diff-actions';
    const apply = document.createElement('button');
    apply.className = 'znxstudio-btn primary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      if (this.editor.currentUri() !== sourceUri || this.editor.activeText() !== sourceText) {
        this.close();
        this.context.layout.showToast('Source changed. Generate again.', 'info');
        return;
      }
      if (selections.length) this.editor.setSelections(selections);
      this.editor.insertText(after);
      this.close();
      this.context.layout.showToast(`Applied "${action.label}".`, 'success');
    });
    const cancel = document.createElement('button');
    cancel.className = 'znxstudio-btn';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.close());
    actions.append(cancel, apply);
    box.appendChild(actions);

    document.body.appendChild(overlay);
    apply.focus();
  }

  private renderDiff(diff: DiffLine[]): HTMLElement {
    const pre = document.createElement('div');
    pre.className = 'znxstudio-ai-diff';
    for (const line of diff) {
      const row = document.createElement('div');
      row.className = `znxstudio-ai-diff-line is-${line.type}`;
      const gutter = document.createElement('span');
      gutter.className = 'znxstudio-ai-diff-gutter';
      gutter.textContent = line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' ';
      const text = document.createElement('span');
      text.className = 'znxstudio-ai-diff-text';
      text.textContent = line.text.length ? line.text : ' ';
      row.append(gutter, text);
      pre.appendChild(row);
    }
    return pre;
  }

  private renderPanel(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-inlineai-toolbar';
    const title = document.createElement('span');
    title.className = 'znxstudio-inlineai-title';
    title.textContent = 'AI Result';
    toolbar.appendChild(title);

    if (this.lastResult) {
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(this.lastResult);
        this.context.layout.showToast('Result copied.', 'success');
      });
      toolbar.appendChild(copy);
    }

    const provider = document.createElement('span');
    provider.className = 'znxstudio-inlineai-provider';
    provider.textContent = this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.appendChild(provider);
    this.panel.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'znxstudio-inlineai-body';
    if (this.lastResult) {
      const md = document.createElement('div');
      renderAiMarkdown(md, this.lastResult, {
        onInsertCode: (code) => this.editor.insertText(code),
      });
      body.appendChild(md);
    } else {
      body.textContent = 'Select code and run an AI action from the context menu or command palette.';
      body.classList.add('is-muted');
    }
    this.panel.appendChild(body);
  }

  /* ----- modal ----- */
  private makeModal(title: string): { overlay: HTMLElement; box: HTMLElement } {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-ai-modal';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this.close(); });
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    const box = document.createElement('div');
    box.className = 'znxstudio-ai-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('div');
    heading.className = 'znxstudio-ai-modal-title';
    heading.textContent = title;
    box.appendChild(heading);
    overlay.appendChild(box);
    this.overlay = overlay;
    return { overlay, box };
  }

  private close(): void {
    this.overlay?.remove();
    this.overlay = undefined;
  }

  private baseName(path: string | null): string | null {
    return path ? path.split(/[\\/]/).pop() ?? path : null;
  }

  /* ----- self-test ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    const action = findInlineAction('explain')!;
    const framed = buildInlineMessages(action, 'function add with a, b\n    give back a + b\nend', 'm.zx');
    log(`inline explain prompt: hasCode=${framed.messages[0].content.includes('add')} system=${framed.system.includes('Explain')}`);

    const rewrite = findInlineAction('rewrite')!;
    const rwFramed = buildInlineMessages(rewrite, 'let x = 1', 'm.zx', 'Make this a constant');
    log(`inline rewrite prompt: hasInstruction=${rwFramed.messages[0].content.includes('constant')}`);

    const cleaned = cleanInlineOutput('```zornux\nfunction total\n    give back 1\nend\n```');
    log(`inline clean: ok=${cleaned.startsWith('function total')}`);

    log(`inline actions: count=${INLINE_ACTIONS.length} ids=${INLINE_ACTIONS.map((a) => a.id).join(',')}`);
  }
}
