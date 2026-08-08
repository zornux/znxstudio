import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type EditorService,
  type ExplorerService,
  type InputBoxService,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { normalizeRoot } from '../workspace/workspaceFolders';
import { BookmarkModel } from './bookmarks';

const SETTINGS_KEY = 'znxstudio.bookmarks.byRoot';

/**
 * Bookmarks (Phase 7E). Toggle a mark on any line, jump between marks in the
 * active file, and see every bookmark in a bottom-panel list. Marks are rendered
 * as gutter glyphs by the editor and persisted per workspace root. The module
 * owns no Monaco — it drives the Editor service and a pure BookmarkModel.
 */
export class BookmarksModule implements IModule {
  readonly id = 'znxstudio.bookmarks';
  readonly displayName = 'Bookmarks';

  private context!: ModuleContext;
  private editor!: EditorService;
  private workspace!: WorkspaceService;
  private settings: SettingsService | undefined;
  private status: StatusService | undefined;
  private readonly model = new BookmarkModel();
  private panel!: HTMLElement;
  private explorerHost: HTMLElement | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-bookmarks';
    context.layout.addPanelView({ id: 'bookmarks', title: 'Bookmarks', element: this.panel });

    // Also surface bookmarks as an Explorer section (UX-6), keeping the panel.
    const explorer = context.services.tryGet<ExplorerService>(ServiceKeys.Explorer);
    if (explorer) {
      this.explorerHost = document.createElement('div');
      this.explorerHost.className = 'znxstudio-bookmarks';
      explorer.registerSection({
        id: 'bookmarks',
        title: 'Bookmarks',
        order: 30,
        element: this.explorerHost,
        collapsed: true,
        actions: [{
          icon: '⨉',
          tooltip: 'Clear All Bookmarks',
          commandId: CommandIds.BookmarkClearAll,
          run: () => this.context.commands.executeFromUi(CommandIds.BookmarkClearAll),
        }],
      });
    }

    context.commands.register(CommandIds.BookmarkToggle, () => this.toggle(), 'Bookmarks: Toggle');
    context.commands.register(CommandIds.BookmarkNext, () => this.jump('next'), 'Bookmarks: Next');
    context.commands.register(CommandIds.BookmarkPrevious, () => this.jump('prev'), 'Bookmarks: Previous');
    context.commands.register(CommandIds.BookmarkClearAll, () => this.clearAll(), 'Bookmarks: Clear All');
    context.commands.register(CommandIds.BookmarksShow, () => this.context.layout.showPanelView('bookmarks'), 'Bookmarks: Show');
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        const uri = this.editor.currentUri();
        if (id === CommandIds.BookmarkToggle) return Boolean(uri && this.editor.cursorPosition());
        if (id === CommandIds.BookmarkNext || id === CommandIds.BookmarkPrevious) {
          return Boolean(uri && this.model.lines(uri).length > 0);
        }
        if (id === CommandIds.BookmarkClearAll) return this.model.count() > 0;
        return undefined;
      }),
    );

    this.model.load(this.persisted());
    this.editor.onDidChangeActiveFile(() => this.renderGlyphs());
    this.workspace.onDidChangeWorkspace(() => {
      this.model.load(this.persisted());
      this.renderGlyphs();
      this.renderPanel();
    });

    this.renderGlyphs();
    this.renderPanel();
    void selfTestCoordinator.run('bookmarks', () => this.maybeSelfTest());
  }

  private toggle(): void {
    const uri = this.editor.currentUri();
    const position = this.editor.cursorPosition();
    if (!uri || !position) return;
    this.model.toggle(uri, position.line);
    this.persist();
    this.renderGlyphs();
    this.renderPanel();
  }

  private jump(direction: 'next' | 'prev'): void {
    const uri = this.editor.currentUri();
    const position = this.editor.cursorPosition();
    if (!uri || !position) return;
    const target =
      direction === 'next'
        ? this.model.nextInFile(uri, position.line)
        : this.model.prevInFile(uri, position.line);
    if (target === null) {
      this.context.layout.showToast('No bookmarks in this file.', 'info');
      return;
    }
    this.editor.revealPosition(target, 0);
  }

  private async clearAll(): Promise<void> {
    const count = this.model.count();
    if (count === 0) return;
    const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
    const confirmed = await input.confirm({
      title: 'Clear All Bookmarks?',
      message: `Remove ${count} bookmark${count === 1 ? '' : 's'} from this workspace?`,
      confirmLabel: 'Clear Bookmarks',
      danger: true,
    });
    if (!confirmed) return;
    this.model.clear();
    this.persist();
    this.renderGlyphs();
    this.renderPanel();
    this.context.layout.showToast('All workspace bookmarks cleared.', 'info');
  }

  private renderGlyphs(): void {
    const uri = this.editor.currentUri();
    this.editor.setBookmarkGlyphs(uri ? this.model.lines(uri) : []);
    this.context.commands.notifyEnablementChanged();
    if (this.model.count() === 0) {
      this.status?.removeItem('editor.bookmarks');
      return;
    }
    this.status?.setItem('editor.bookmarks', {
      text: `🔖 ${this.model.count()}`,
      tooltip: 'Bookmarks — click to view',
      command: CommandIds.BookmarksShow,
      side: 'right',
      priority: 22,
    });
  }

  private renderPanel(): void {
    for (const host of this.targets()) this.renderInto(host);
  }

  /** The bookmark list is shown in the bottom panel + the Explorer section. */
  private targets(): HTMLElement[] {
    return this.explorerHost ? [this.panel, this.explorerHost] : [this.panel];
  }

  private renderInto(host: HTMLElement): void {
    const all = this.model.all();
    host.replaceChildren();
    if (all.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-bookmarks-empty';
      empty.textContent = 'No bookmarks. Use “Toggle Bookmark” on any line.';
      host.appendChild(empty);
      return;
    }

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-bookmarks-toolbar';
    const summary = document.createElement('span');
    summary.className = 'znxstudio-bookmarks-summary';
    const fileCount = new Set(all.map((bookmark) => bookmark.uri)).size;
    summary.textContent = `${all.length} bookmark${all.length === 1 ? '' : 's'} in ${fileCount} file${fileCount === 1 ? '' : 's'}`;
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'znxstudio-btn-small';
    clear.textContent = 'Clear all';
    clear.addEventListener('click', () => void this.clearAll());
    toolbar.append(summary, clear);
    host.appendChild(toolbar);

    let lastUri = '';
    for (const bookmark of all) {
      if (bookmark.uri !== lastUri) {
        lastUri = bookmark.uri;
        const header = document.createElement('div');
        header.className = 'znxstudio-bookmarks-file';
        header.textContent = this.basename(bookmark.uri);
        header.title = this.pathOf(bookmark.uri);
        host.appendChild(header);
      }
      const row = document.createElement('div');
      row.className = 'znxstudio-tree-row znxstudio-bookmarks-row';
      const icon = document.createElement('span');
      icon.className = 'znxstudio-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = '🔖';
      row.appendChild(icon);
      row.appendChild(document.createTextNode(`Line ${bookmark.line + 1}`));
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-label', `${this.basename(bookmark.uri)}, line ${bookmark.line + 1}`);
      const reveal = (): void => {
        void this.editor.revealLocation(bookmark.uri, bookmark.line, 0).catch((error: unknown) => {
          this.context.layout.showToast(`Could not open bookmark: ${(error as Error).message}`, 'error');
        });
      };
      row.addEventListener('click', reveal);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          reveal();
        }
      });
      host.appendChild(row);
    }
  }

  private basename(uri: string): string {
    return this.pathOf(uri).split(/[\\/]/).pop() ?? uri;
  }

  private pathOf(uri: string): string {
    try {
      return monaco.Uri.parse(uri).fsPath;
    } catch {
      return uri;
    }
  }

  /* ----- persistence (per primary root, mirrors ProfilesModule) ----- */
  private persisted(): Record<string, number[]> {
    const root = this.workspace.currentFolder();
    if (!root || !this.settings) return {};
    const map = this.settings.get<Record<string, Record<string, number[]>>>(SETTINGS_KEY, {});
    return map[normalizeRoot(root)] ?? {};
  }

  private persist(): void {
    const root = this.workspace.currentFolder();
    if (!root || !this.settings) return;
    const map = { ...this.settings.get<Record<string, Record<string, number[]>>>(SETTINGS_KEY, {}) };
    const snapshot = this.model.serialize();
    if (Object.keys(snapshot).length === 0) {
      delete map[normalizeRoot(root)];
    } else {
      map[normalizeRoot(root)] = snapshot;
    }
    this.settings.set(SETTINGS_KEY, map);
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

    // Pure model behaviour (no repo writes — bookmarks live in settings only).
    const model = new BookmarkModel();
    const uri = 'file:///demo/a.zx';
    log(`bookmarks toggle on=${model.toggle(uri, 4)} off=${model.toggle(uri, 4)}`);
    model.toggle(uri, 2);
    model.toggle(uri, 9);
    model.toggle('file:///demo/b.zx', 0);
    log(`bookmarks lines(a)=[${model.lines(uri).join(',')}] count=${model.count()} files=${model.all().length}`);
    log(`bookmarks nextAfter(2)=${model.nextInFile(uri, 2)} prevBefore(2)=${model.prevInFile(uri, 2)} wrapNext(9)=${model.nextInFile(uri, 9)}`);
    const round = new BookmarkModel();
    round.load(model.serialize());
    log(`bookmarks roundtrip count=${round.count()} lines(a)=[${round.lines(uri).join(',')}]`);
  }
}
