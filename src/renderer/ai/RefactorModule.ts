import {
  ServiceKeys,
  type AiService,
  type CursorSelection,
  type EditorService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  REFACTOR_ACTIONS,
  buildRefactorMessages,
  cleanRefactorOutput,
  diffLines,
  diffStats,
  findRefactorAction,
  type DiffLine,
  type RefactorAction,
} from './refactor';

/**
 * AI Refactoring (Phase 10C). Transforms the selected code via the vendor-neutral
 * AiService: pick a transform (improve names, extract helpers, simplify, add
 * error handling, comment, make idiomatic, or a custom instruction), then review
 * a line-level diff and Apply — the change replaces the selection through the
 * editor's normal edit path, so it is a single undo.
 */
export class RefactorModule implements IModule {
  readonly id = 'znxstudio.ai.refactor';
  readonly displayName = 'AI Refactoring';

  private context!: ModuleContext;
  private ai!: AiService;
  private editor!: EditorService;
  private overlay: HTMLElement | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);

    context.commands.register(CommandIds.AiRefactor, () => this.begin(), 'AI: Refactor Selection');
    void selfTestCoordinator.run('ai-refactor', () => this.maybeSelfTest());
  }

  private begin(): void {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to refactor.', 'info');
      return;
    }
    const code = this.editor.selectedText();
    if (!code.trim()) {
      this.context.layout.showToast('Select the code to refactor first.', 'info');
      return;
    }
    const selections = this.editor.getSelections();
    this.showActionPicker(code, selections);
  }

  /* ----- step 1: choose a transform ----- */
  private showActionPicker(code: string, selections: CursorSelection[]): void {
    const { overlay, box } = this.makeModal('Refactor selection');

    const list = document.createElement('ul');
    list.className = 'znxstudio-ai-actions-list';
    for (const action of REFACTOR_ACTIONS) {
      const item = document.createElement('li');
      item.className = 'znxstudio-ai-action';
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.innerHTML = `<strong>${action.label}</strong><span>${action.description}</span>`;
      const choose = (): void => {
        this.close();
        void this.runAction(action, code, selections);
      };
      item.addEventListener('click', choose);
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          choose();
        }
      });
      list.appendChild(item);
    }
    box.appendChild(list);
    document.body.appendChild(overlay);
    (list.firstElementChild as HTMLElement | null)?.focus();
  }

  private async runAction(
    action: RefactorAction,
    code: string,
    selections: CursorSelection[],
  ): Promise<void> {
    let custom = '';
    if (action.custom) {
      custom = window.prompt('Describe the refactor:') ?? '';
      if (!custom.trim()) return;
    }

    const progress = this.makeModal(`${action.label}…`);
    const status = document.createElement('div');
    status.className = 'znxstudio-ai-diff-status';
    status.textContent = `Asking ${this.ai.providerLabel()}…`;
    progress.box.appendChild(status);
    document.body.appendChild(progress.overlay);

    const fileName = this.baseName(this.editor.currentFile());
    const { system, messages } = buildRefactorMessages(action, code, fileName, custom);
    const result = await this.ai.complete(messages, { system, temperature: 0 });
    this.close();

    if (!result.ok) {
      this.context.layout.showToast(`Refactor failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    const rewritten = cleanRefactorOutput(result.text);
    if (!rewritten || rewritten === code.replace(/\s+$/, '')) {
      this.context.layout.showToast('The model returned no change.', 'info');
      return;
    }
    this.showDiff(action, code, rewritten, selections);
  }

  /* ----- step 2: preview the diff, then apply ----- */
  private showDiff(
    action: RefactorAction,
    before: string,
    after: string,
    selections: CursorSelection[],
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
      this.applyRewrite(after, selections);
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

  private applyRewrite(after: string, selections: CursorSelection[]): void {
    // Restore the original selection so insertText replaces exactly that range,
    // then insert — a single undo step through the editor's normal edit path.
    if (selections.length) this.editor.setSelections(selections);
    this.editor.insertText(after);
  }

  /* ----- modal plumbing (mirrors Quick Open's overlay) ----- */
  private makeModal(title: string): { overlay: HTMLElement; box: HTMLElement } {
    this.close();
    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-ai-modal';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.close();
    });
    overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.close();
    });
    const box = document.createElement('div');
    box.className = 'znxstudio-ai-modal-box';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    const heading = document.createElement('div');
    heading.className = 'znxstudio-ai-modal-title';
    heading.id = `znxstudio-ai-modal-title-${Date.now()}`;
    heading.textContent = title;
    box.setAttribute('aria-labelledby', heading.id);
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

    const action = findRefactorAction('rename')!;
    const framed = buildRefactorMessages(action, 'function f with a\n    give back a\nend', 'm.zx');
    log(`refactor prompt action=${action.id} hasInstruction=${framed.messages[0].content.includes('Rename')} noFences=${framed.system.includes('no Markdown')}`);
    const cleaned = cleanRefactorOutput('```zornux\nfunction total\n    give back 1\nend\n```');
    log(`refactor clean fences ok=${cleaned.startsWith('function total') && !cleaned.includes('```')}`);
    const diff = diffLines('a\nb\nc', 'a\nB\nc\nd');
    log(`refactor diff: ${diff.map((l) => l.type[0]).join('')} stats=${JSON.stringify(diffStats(diff))}`);

    // REAL refactor — only if a provider is configured; otherwise honest skip.
    try {
      if (this.ai.isEnabled()) {
        const result = await this.ai.complete(
          buildRefactorMessages(findRefactorAction('idiomatic')!, 'function f with x\n    give back x\nend', 'm.zx').messages,
          { system: 'Return only code.', temperature: 0, maxTokens: 120 },
        );
        log(`refactor REAL: provider=${this.ai.providerId()} ok=${result.ok} text=${JSON.stringify((result.text || result.error || '').slice(0, 60))}`);
      } else {
        log('refactor REAL: no provider configured — skipped');
      }
    } catch (error) {
      log(`refactor REAL failed: ${(error as Error).message}`);
    }
  }
}
