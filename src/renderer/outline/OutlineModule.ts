import { ServiceKeys, type EditorService, type ExplorerService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { LanguageServiceKeys, type DocumentSymbol } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import type { LanguageRegistry } from '../language/LanguageRegistry';
import { SYMBOL_ICON } from '../ui/symbolIcons';
import { examplePath } from '../core/selftestFixtures';

/**
 * Outline panel. Shows the document symbols for the active document by asking
 * the active language service's symbol provider — it never parses anything
 * itself. Clicking a symbol reveals its range in the editor. Empty/invalid files
 * degrade gracefully (a message, never a crash).
 */
export class OutlineModule implements IModule {
  readonly id = 'znxstudio.outline';
  readonly displayName = 'Outline';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private explorerHost: HTMLElement | null = null;
  private registry!: LanguageRegistry;
  private documents!: DocumentManager;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshGeneration = 0;

  activate(context: ModuleContext): void {
    this.context = context;
    this.registry = context.services.get<LanguageRegistry>(LanguageServiceKeys.Registry);
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-outline';
    context.layout.addPanelView({ id: 'outline', title: 'Outline', element: this.surface });

    // Also surface the outline as an Explorer section (UX-6), without giving up
    // the bottom-panel view. A second host renders the same tree.
    const explorer = context.services.tryGet<ExplorerService>(ServiceKeys.Explorer);
    if (explorer) {
      this.explorerHost = document.createElement('div');
      this.explorerHost.className = 'znxstudio-outline';
      explorer.registerSection({
        id: 'outline',
        title: 'Outline',
        order: 20,
        element: this.explorerHost,
        collapsed: true,
        actions: [{ icon: '⟳', tooltip: 'Refresh Outline', run: () => this.scheduleRefresh(0) }],
      });
    }

    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) context.subscriptions.push(editor.onDidChangeActiveFile(() => this.scheduleRefresh(0)));
    context.subscriptions.push(this.documents.onDidChange((doc) => {
      if (doc.uri === this.documents.getActive()?.uri) this.scheduleRefresh(250);
    }));
    context.subscriptions.push({
      dispose: () => {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshGeneration += 1;
      },
    });

    this.renderMessage('Open a file to see its outline.');

    // Outline is the last of the three Explorer-section contributors to activate
    // (Open Editors, Bookmarks, Outline), so by now the sidebar holds all three.
    void selfTestCoordinator.run('explorersections', () => this.maybeSelfTest());
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

    try {
      const titles = [...document.querySelectorAll('.znxstudio-explorer-cs-title')].map((el) => el.textContent);
      const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
      const examples = await examplePath();
      if (!examples) {
        log('explorersections REAL: skipped (no examples root)');
        return;
      }
      const files = (await window.znxstudio.search.files(examples)).filter((f) =>
        f.endsWith('.zx'),
      );
      let openRows = 0;
      let closedRows = 0;
      if (editor && files.length) {
        await editor.openFile(files[0], { preview: true });
        openRows = document.querySelectorAll('.znxstudio-open-editors-row').length;
        const opened = editor.openEditors();
        if (opened.length) editor.closeEditor(opened[opened.length - 1].uri);
        closedRows = document.querySelectorAll('.znxstudio-open-editors-row').length;
      }
      log(
        `explorersections REAL DOM: sections=[${titles.join(', ')}] openEditorsRow(afterOpen=${openRows}, afterClose=${closedRows})`,
      );
    } catch (error) {
      log(`explorersections self-test failed: ${(error as Error).message}`);
    }
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    const generation = ++this.refreshGeneration;
    const active = this.documents.getActive();
    if (!active) {
      this.renderMessage('Open a file to see its outline.');
      return;
    }

    const service = this.registry.get(active.languageId);
    if (!service || !this.registry.isActive(active.languageId) || !service.documentSymbols) {
      this.renderMessage(`No outline available for ${active.languageId}.`);
      return;
    }

    try {
      const symbols = await service.documentSymbols.provideDocumentSymbols(active.document);
      if (generation !== this.refreshGeneration || this.documents.getActive()?.uri !== active.uri) return;
      if (!symbols.length) {
        this.renderMessage('No symbols found.');
        return;
      }
      // A DOM node lives in one parent, so build a fresh tree per host.
      for (const host of this.targets()) host.replaceChildren(this.renderTree(symbols));
    } catch {
      this.renderMessage('Outline unavailable for this file.');
    }
  }

  /** Every place the outline is shown: the bottom panel + the Explorer section. */
  private targets(): HTMLElement[] {
    return this.explorerHost ? [this.surface, this.explorerHost] : [this.surface];
  }

  private renderMessage(message: string): void {
    for (const host of this.targets()) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-outline-empty';
      empty.textContent = message;
      host.replaceChildren(empty);
    }
  }

  private renderTree(symbols: DocumentSymbol[], isRoot = true): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'znxstudio-tree';
    list.setAttribute('role', isRoot ? 'tree' : 'group');
    for (const symbol of symbols) list.appendChild(this.renderNode(symbol));
    if (isRoot) {
      const first = list.querySelector<HTMLElement>('[role="treeitem"]');
      if (first) first.tabIndex = 0;
      list.addEventListener('keydown', (event) => this.onTreeKey(list, event));
    }
    return list;
  }

  private renderNode(symbol: DocumentSymbol): HTMLElement {
    const item = document.createElement('li');
    item.setAttribute('role', 'treeitem');
    item.tabIndex = -1;
    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    row.title = `${symbol.kind} ${symbol.name}`;
    const icon = document.createElement('span');
    icon.className = 'znxstudio-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = SYMBOL_ICON[symbol.kind] ?? '•';
    const label = document.createElement('span');
    label.textContent = symbol.name;
    row.append(icon, label);
    const reveal = (): void => {
      const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
      editor?.revealPosition(symbol.selectionRange.start.line, symbol.selectionRange.start.character);
    };
    row.addEventListener('click', () => {
      const tree = item.closest<HTMLElement>('[role="tree"]');
      for (const node of tree?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []) node.tabIndex = -1;
      item.tabIndex = 0;
      item.focus({ preventScroll: true });
      reveal();
    });
    item.appendChild(row);

    if (symbol.children?.length) {
      item.setAttribute('aria-expanded', 'true');
      item.appendChild(this.renderTree(symbol.children, false));
    }
    return item;
  }

  private onTreeKey(root: HTMLElement, event: KeyboardEvent): void {
    const items = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]
      .filter((item) => item.offsetParent !== null);
    const current = document.activeElement as HTMLElement | null;
    const index = current ? items.indexOf(current) : -1;
    const focus = (target: HTMLElement | null | undefined): void => {
      if (!target) return;
      for (const item of items) item.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    const parent = current?.parentElement?.closest<HTMLElement>('[role="treeitem"]');
    const child = current?.querySelector<HTMLElement>(':scope > [role="group"] > [role="treeitem"]');

    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focus(items[index + 1]); break;
      case 'ArrowUp': event.preventDefault(); focus(items[index - 1]); break;
      case 'Home': event.preventDefault(); focus(items[0]); break;
      case 'End': event.preventDefault(); focus(items[items.length - 1]); break;
      case 'ArrowRight': event.preventDefault(); focus(child); break;
      case 'ArrowLeft': event.preventDefault(); focus(parent); break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        current?.querySelector<HTMLElement>(':scope > .znxstudio-tree-row')?.click();
        break;
      default: break;
    }
  }
}
