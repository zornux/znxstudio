import { ServiceKeys, type EditorService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys, type DocumentSymbol } from '../language/api';
import type { DocumentManager, ManagedDocument } from '../language/DocumentManager';
import type { LanguageRegistry } from '../language/LanguageRegistry';
import {
  breadcrumbFilePath,
  symbolTrailAt,
  symbolsAtDepth,
  type BreadcrumbSegment,
} from './breadcrumbs';

const KIND_ICON: Record<string, string> = {
  function: '🔧',
  class: '🏛',
  struct: '🧱',
  record: '🧱',
  interface: '📐',
  type: '📐',
  variable: '📦',
  constant: '🔒',
  module: '📥',
  service: '🌐',
  policy: '🛡',
  configuration: '⚙',
};

/** Built-in Monaco folding actions surfaced as ZnxStudio commands. */
const FOLD_ACTIONS = {
  all: 'editor.foldAll',
  unfoldAll: 'editor.unfoldAll',
  fold: 'editor.fold',
  unfold: 'editor.unfold',
  toggle: 'editor.toggleFold',
} as const;

/**
 * Folding & Breadcrumbs (Phase 7D). Renders a symbol-trail breadcrumb bar (file
 * path → containing symbols at the caret, each click-to-navigate with a sibling
 * dropdown) driven by the language service's document symbols, and surfaces
 * Monaco's folding actions as palette commands. Owns no Monaco — it goes through
 * the Editor service and the language platform, exactly like the Outline panel.
 */
export class BreadcrumbsModule implements IModule {
  readonly id = 'znxstudio.breadcrumbs';
  readonly displayName = 'Breadcrumbs';

  private editor!: EditorService;
  private registry!: LanguageRegistry;
  private documents!: DocumentManager;
  private workspace!: WorkspaceService;
  private host!: HTMLElement;
  private symbolsCache: { uri: string; version: number; symbols: DocumentSymbol[] } | null = null;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  activate(context: ModuleContext): void {
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.registry = context.services.get<LanguageRegistry>(LanguageServiceKeys.Registry);
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.host = this.editor.breadcrumbHost();

    const commands = context.commands;
    commands.register(CommandIds.FoldAll, () => this.editor.runEditorAction(FOLD_ACTIONS.all), 'Editor: Fold All');
    commands.register(CommandIds.UnfoldAll, () => this.editor.runEditorAction(FOLD_ACTIONS.unfoldAll), 'Editor: Unfold All');
    commands.register(CommandIds.FoldAtCursor, () => this.editor.runEditorAction(FOLD_ACTIONS.fold), 'Editor: Fold at Cursor');
    commands.register(CommandIds.UnfoldAtCursor, () => this.editor.runEditorAction(FOLD_ACTIONS.unfold), 'Editor: Unfold at Cursor');
    commands.register(CommandIds.ToggleFold, () => this.editor.runEditorAction(FOLD_ACTIONS.toggle), 'Editor: Toggle Fold');

    this.editor.onDidChangeActiveFile(() => this.scheduleRefresh(0));
    this.editor.onDidChangeSelections(() => this.scheduleRefresh(0));
    this.documents.onDidChange((doc) => {
      if (doc.uri === this.documents.getActive()?.uri) this.scheduleRefresh(250);
    });

    void selfTestCoordinator.run('breadcrumbs', () => this.maybeSelfTest());
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(), delay);
  }

  private async refresh(): Promise<void> {
    const active = this.documents.getActive();
    if (!active) {
      this.host.replaceChildren();
      this.host.classList.remove('is-visible');
      return;
    }

    const fileSegments = breadcrumbFilePath(this.workspace.currentFolder(), active.path);
    const symbols = await this.symbolsFor(active);
    const selection = this.editor.getSelections()[0];
    const position = selection
      ? { line: selection.startLine, character: selection.startCharacter }
      : { line: 0, character: 0 };
    const trail = symbols.length ? symbolTrailAt(symbols, position) : [];

    this.host.replaceChildren(this.renderCrumbs(fileSegments, symbols, trail));
    this.host.classList.add('is-visible');
  }

  private async symbolsFor(active: ManagedDocument): Promise<DocumentSymbol[]> {
    const version = active.document.version;
    if (
      this.symbolsCache &&
      this.symbolsCache.uri === active.uri &&
      this.symbolsCache.version === version
    ) {
      return this.symbolsCache.symbols;
    }
    const service = this.registry.get(active.languageId);
    if (!service || !this.registry.isActive(active.languageId) || !service.documentSymbols) return [];
    try {
      const symbols = await service.documentSymbols.provideDocumentSymbols(active.document);
      this.symbolsCache = { uri: active.uri, version, symbols };
      return symbols;
    } catch {
      return [];
    }
  }

  private renderCrumbs(
    fileSegments: string[],
    symbols: DocumentSymbol[],
    trail: BreadcrumbSegment[],
  ): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'znxstudio-breadcrumbs-trail';

    fileSegments.forEach((segment, index) => {
      if (index > 0) bar.appendChild(this.separator());
      const isFile = index === fileSegments.length - 1;
      const crumb = document.createElement('span');
      crumb.className = `znxstudio-crumb znxstudio-crumb--path${isFile ? ' znxstudio-crumb--file' : ''}`;
      crumb.textContent = segment;
      if (isFile) crumb.addEventListener('click', () => this.editor.revealPosition(0, 0));
      bar.appendChild(crumb);
    });

    trail.forEach((segment, depth) => {
      bar.appendChild(this.separator());
      const crumb = document.createElement('span');
      crumb.className = 'znxstudio-crumb znxstudio-crumb--symbol';
      crumb.innerHTML = `<span class="znxstudio-crumb-icon">${KIND_ICON[segment.kind] ?? '•'}</span>`;
      crumb.appendChild(document.createTextNode(segment.name));
      crumb.title = `${segment.kind} ${segment.name}`;
      crumb.addEventListener('click', (event) => {
        event.stopPropagation();
        this.editor.revealPosition(segment.line, segment.character);
        this.openDropdown(crumb, symbols, trail, depth);
      });
      bar.appendChild(crumb);
    });

    return bar;
  }

  private separator(): HTMLElement {
    const sep = document.createElement('span');
    sep.className = 'znxstudio-crumb-sep';
    sep.textContent = '›';
    return sep;
  }

  /** A small sibling picker for the clicked symbol crumb. */
  private openDropdown(
    anchor: HTMLElement,
    symbols: DocumentSymbol[],
    trail: BreadcrumbSegment[],
    depth: number,
  ): void {
    this.host.querySelector('.znxstudio-crumb-menu')?.remove();
    const siblings = symbolsAtDepth(symbols, trail, depth);
    if (siblings.length <= 1) return;

    const menu = document.createElement('div');
    menu.className = 'znxstudio-crumb-menu';
    menu.style.left = `${anchor.offsetLeft}px`;

    for (const sibling of siblings) {
      const item = document.createElement('div');
      item.className = 'znxstudio-crumb-menu-item';
      item.innerHTML = `<span class="znxstudio-crumb-icon">${KIND_ICON[sibling.kind] ?? '•'}</span>`;
      item.appendChild(document.createTextNode(sibling.name));
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        menu.remove();
        this.editor.revealPosition(sibling.selectionRange.start.line, sibling.selectionRange.start.character);
      });
      menu.appendChild(item);
    }

    const dismiss = (event: MouseEvent) => {
      if (!menu.contains(event.target as Node)) {
        menu.remove();
        window.removeEventListener('mousedown', dismiss, true);
      }
    };
    window.addEventListener('mousedown', dismiss, true);
    this.host.appendChild(menu);
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

    // Prove the trail against REAL document symbols of a real xojin file (via the
    // language service's symbol provider — LSP if up, TS fallback otherwise).
    const root = 'C:\\Studio Apps\\xojin';
    const path = `${root}\\examples\\classes.zx`;
    try {
      const managed = await this.documents.open(path);
      const service = this.registry.get(managed.languageId);
      const symbols =
        service?.documentSymbols
          ? await service.documentSymbols.provideDocumentSymbols(managed.document)
          : [];
      log(`breadcrumbs symbols(classes.zx): top=${symbols.length} names=[${symbols.map((s) => s.name).join(',')}]`);

      const first = symbols[0];
      if (first) {
        const topTrail = symbolTrailAt(symbols, {
          line: first.selectionRange.start.line,
          character: first.selectionRange.start.character,
        });
        log(`breadcrumbs trail(top): [${topTrail.map((t) => t.name).join(' › ')}]`);

        const child = first.children?.[0];
        if (child) {
          const childTrail = symbolTrailAt(symbols, {
            line: child.selectionRange.start.line,
            character: child.selectionRange.start.character,
          });
          log(`breadcrumbs trail(nested): [${childTrail.map((t) => t.name).join(' › ')}]`);
        } else {
          log('breadcrumbs trail(nested): first symbol has no children');
        }
      }

      log(`breadcrumbs filePath: [${breadcrumbFilePath(root, path).join(' › ')}]`);
      this.documents.close(managed.uri);
    } catch (error) {
      log(`breadcrumbs self-test failed: ${(error as Error).message}`);
    }
  }
}
