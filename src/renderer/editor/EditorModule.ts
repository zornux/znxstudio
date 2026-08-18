import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type BreakpointGlyph,
  type CursorSelection,
  type EditorDecoration,
  type EditorService,
  type OpenEditor,
  type SettingsService,
  type StatusService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import type { IModule, ModuleContext } from '../core/Module';
import type { MenuEntry } from '../core/LayoutManager';
import { CommandIds } from '../commands/CommandIds';
import { t } from '../i18n';
import { LanguageServiceKeys } from '../language/api';
import type { OffsetEdit } from '../collab/ot';
import type { DocumentManager, ManagedDocument } from '../language/DocumentManager';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { examplePath, tempZx } from '../core/selftestFixtures';
import { showModal } from '../ui/modal';
import { DEFAULT_EDITOR_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../settings/SettingsSchema';
import { diskConflictPreview, resolveSaveAsTarget } from './conflictRecovery';
import {
  parseSession,
  resolveAutosaveMode,
  restorableSession,
  serializeSession,
  type AutosaveMode,
} from './unsavedGuard';
import {
  closeAll,
  closeOthers,
  closeTab,
  EMPTY_TABS,
  makePermanent,
  markDirty,
  openTab,
  setActive as setActiveTab,
  togglePin,
  type EditorTab,
  type TabsState,
} from './editorTabs';

const ACTIVE_EDITOR_COMMANDS = new Set<string>([
  CommandIds.FileSave,
  CommandIds.FileRevert,
  CommandIds.EditorUndo,
  CommandIds.EditorRedo,
  CommandIds.EditorCut,
  CommandIds.EditorCopy,
  CommandIds.EditorPaste,
  CommandIds.EditorSelectAll,
  CommandIds.EditorFind,
  CommandIds.EditorClose,
  CommandIds.EditorPin,
  CommandIds.MultiCursorAddAbove,
  CommandIds.MultiCursorAddBelow,
  CommandIds.MultiCursorAddNext,
  CommandIds.MultiCursorPerLine,
  CommandIds.MultiCursorSelectAll,
  CommandIds.FoldAll,
  CommandIds.UnfoldAll,
  CommandIds.FoldAtCursor,
  CommandIds.UnfoldAtCursor,
  CommandIds.ToggleFold,
  CommandIds.BookmarkToggle,
]);

function normalizeEditorPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

/**
 * Editor Engine. Wraps Monaco and tracks the active file, but delegates all
 * model ownership to the Language Platform's DocumentManager — the editor talks
 * to the platform, never to language logic directly. Live settings sync updates
 * font size / tab size without a reload.
 */
export class EditorModule implements IModule, EditorService {
  readonly id = 'znxstudio.editor';
  readonly displayName = 'Editor Engine';

  private context!: ModuleContext;
  private editor!: monaco.editor.IStandaloneCodeEditor;
  private overlay!: HTMLElement;
  private tabsBar!: HTMLElement;
  private tabsState: TabsState = EMPTY_TABS;
  private breadcrumbs!: HTMLElement;
  private documents!: DocumentManager;
  private settings: SettingsService | undefined;
  private status: StatusService | undefined;
  private active: string | null = null;
  private activeUri: string | null = null;
  private activeName = 'Welcome';
  private readonly decorationOwners = new Map<string, monaco.editor.IEditorDecorationsCollection>();
  private readonly gutterHandlers: ((line: number) => void)[] = [];
  private executionPointer: { uri: string; line: number; kind: 'step' | 'exception' } | null = null;
  private autosaveMode: AutosaveMode = 'off';
  /** Session persist/restore is disabled under the self-test harness. */
  private sessionEnabled = false;
  /** Prevent the debounced writer from replacing a snapshot with a partial restore. */
  private restoringSession = false;
  private persistTimer: ReturnType<typeof setTimeout> | undefined;
  private notifyCommandEnablement: () => void = () => undefined;
  private pathMutationActive = false;

  private readonly activeFileEmitter = new Emitter<string | null>();
  readonly onDidChangeActiveFile = this.activeFileEmitter.event;

  private readonly editorsEmitter = new Emitter<void>();
  readonly onDidChangeEditors = this.editorsEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);

    const area = context.layout.editorArea;
    area.innerHTML = `
      <div class="znxstudio-editor-topbar">
        <div class="znxstudio-editor-tabs" data-role="tabs"></div>
        <div class="znxstudio-editor-actions" data-role="actions" role="toolbar" aria-label="Run and Build"></div>
      </div>
      <div class="znxstudio-breadcrumbs" data-role="breadcrumbs"></div>
      <div class="znxstudio-editor-surface">
        <div class="znxstudio-editor-monaco" data-role="monaco"></div>
        <div class="znxstudio-editor-overlay" data-role="overlay"></div>
      </div>
    `;

    this.tabsBar = area.querySelector<HTMLElement>('[data-role="tabs"]')!;
    this.tabsBar.setAttribute('role', 'tablist');
    this.tabsBar.setAttribute('aria-label', 'Open editors');
    this.breadcrumbs = area.querySelector<HTMLElement>('[data-role="breadcrumbs"]')!;
    this.overlay = area.querySelector<HTMLElement>('[data-role="overlay"]')!;
    this.wireOverlayDismiss(context);
    const host = area.querySelector<HTMLElement>('[data-role="monaco"]')!;

    // SB-5: the editor's Run/Debug/Stop/Build/Rebuild action toolbar. These are
    // actions, not status — they belong by the code, not in the status bar. The
    // commands are registered by the Run/Build + Debug modules; the buttons
    // dispatch at click time (guarded), so ordering doesn't matter.
    this.buildEditorToolbar(area.querySelector<HTMLElement>('[data-role="actions"]')!, context);

    this.editor = monaco.editor.create(host, {
      value: '',
      language: 'plaintext',
      theme: 'znxstudio-dark',
      automaticLayout: true,
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: DEFAULT_EDITOR_FONT_FAMILY,
      lineHeight: 21,
      fontLigatures: true,
      mouseWheelZoom: true, // Ctrl/Cmd + scroll adjusts the editor font size
      minimap: { enabled: true },
      stickyScroll: { enabled: true }, // keep the enclosing scope headers pinned
      scrollBeyondLastLine: false,
      glyphMargin: true, // reserve the breakpoint gutter
    });

    this.renderTabs();

    // Clicks on the breakpoint gutter → notify subscribers (0-based line).
    this.editor.onMouseDown((event) => {
      if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position) {
        const line = event.target.position.lineNumber - 1;
        for (const handler of this.gutterHandlers) handler(line);
      }
    });

    context.services.register(ServiceKeys.Editor, this);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);
    this.status?.setItem('editor.activeFile', { text: t('status.noFile'), side: 'left', priority: 40 });

    this.bindSettings(context);
    this.bindSaving(context);
    this.bindTabCommands(context);
    this.bindEditorCommandEnablement(context);

    // Enable session persistence + restore only outside the self-test harness
    // (which opens its own synthetic tabs). Restore reopens last session's tabs.
    try {
      const info = await window.znxstudio.app.getInfo();
      this.sessionEnabled = info.selftest !== true;
      if (this.sessionEnabled) await this.restoreSession();
    } catch {
      // Startup must remain usable if app metadata or a restored file cannot be read.
      this.sessionEnabled = false;
    }

    void selfTestCoordinator.run('editortabs', () => this.maybeSelfTest());
  }

  private buildEditorToolbar(host: HTMLElement, context: ModuleContext): void {
    const actions: { icon: string; label: string; command: string }[] = [
      { icon: '▶', label: t('action.run'), command: CommandIds.RunStart },
      { icon: '○', label: t('action.debug'), command: CommandIds.DebugStart },
    ];
    const gated: { button: HTMLButtonElement; command: string }[] = [];
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = 'znxstudio-editor-action';
      button.textContent = action.icon;
      button.title = action.label;
      button.setAttribute('aria-label', action.label);
      button.addEventListener('click', () => {
        if (context.commands.has(action.command) && context.commands.isEnabled(action.command)) {
          void this.executeToolbarCommand(context, action.command, action.label);
        }
      });
      host.appendChild(button);
      gated.push({ button, command: action.command });
    }

    const more = document.createElement('button');
    more.className = 'znxstudio-editor-action';
    more.textContent = '⋯';
    more.title = 'More run and build actions';
    more.setAttribute('aria-label', 'More run and build actions');
    more.setAttribute('aria-haspopup', 'menu');
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect();
      const commandItem = (label: string, command: string) => ({
        label,
        disabled: !context.commands.has(command) || !context.commands.isEnabled(command),
        onClick: () => {
          if (context.commands.has(command) && context.commands.isEnabled(command)) {
            void this.executeToolbarCommand(context, command, label);
          }
        },
      });
      context.layout.openFloatingMenu(rect.right - 210, rect.bottom + 2, () => [
        commandItem(t('action.stop'), CommandIds.DebugStop),
        { separator: true },
        commandItem(t('action.build'), CommandIds.BuildStart),
        commandItem(t('action.rebuild'), CommandIds.BuildRebuild),
      ]);
    });
    host.appendChild(more);

    // Reflect command enablement (e.g. run/build/debug disabled in Restricted Mode) and refresh live when
    // it changes — a disabled <button> both greys out and cannot be clicked, so the gate is visible here
    // too, not only in the command palette.
    const refresh = () => {
      for (const { button, command } of gated) button.disabled = !context.commands.isEnabled(command);
    };
    refresh();
    context.subscriptions.push(context.commands.onDidChangeEnablement(refresh));
  }

  private async executeToolbarCommand(context: ModuleContext, command: string, label: string): Promise<void> {
    try {
      await context.commands.execute(command);
    } catch (error) {
      context.layout.showToast(`Could not ${label.toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  }

  private bindTabCommands(context: ModuleContext): void {
    const editorAction = (id: string, action: string, title: string): void => {
      context.commands.register(id, () => this.runEditorAction(action), title);
    };
    editorAction(CommandIds.EditorUndo, 'undo', 'Undo');
    editorAction(CommandIds.EditorRedo, 'redo', 'Redo');
    editorAction(CommandIds.EditorCut, 'editor.action.clipboardCutAction', 'Cut');
    editorAction(CommandIds.EditorCopy, 'editor.action.clipboardCopyAction', 'Copy');
    editorAction(CommandIds.EditorPaste, 'editor.action.clipboardPasteAction', 'Paste');
    editorAction(CommandIds.EditorSelectAll, 'editor.action.selectAll', 'Select All');
    context.commands.register(
      CommandIds.EditorFind,
      () => this.runEditorAction('actions.find'),
      'Find in File',
    );
    context.commands.register(CommandIds.EditorClose, () => this.closeActive(), 'Close Editor');
    context.commands.register(CommandIds.FileRevert, () => this.revertActive(), 'File: Revert File');
    context.commands.register(
      CommandIds.EditorCloseOthers,
      () => void this.confirmCloseSet(this.tabsState.activeUri ? closeOthers(this.tabsState, this.tabsState.activeUri) : this.tabsState),
      'Close Other Editors',
    );
    context.commands.register(
      CommandIds.EditorCloseAll,
      () => void this.confirmCloseSet(closeAll(this.tabsState)),
      'Close All Editors',
    );
    context.commands.register(
      CommandIds.EditorPin,
      () => {
        if (this.tabsState.activeUri) this.applyTabs(togglePin(this.tabsState, this.tabsState.activeUri));
      },
      'Pin / Unpin Editor',
    );
    // Palette-discoverable close for the editor-area overlay (Settings, Welcome, Docs, …) — the same
    // dismiss as the floating ✕ / Esc, so the active view can be closed from the command palette too.
    context.commands.register(CommandIds.ViewClose, () => this.hideView(), 'Close Active View');
  }

  private bindEditorCommandEnablement(context: ModuleContext): void {
    this.notifyCommandEnablement = () => context.commands.notifyEnablementChanged();
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (id === CommandIds.FileSaveAll) return this.tabsState.tabs.some((tab) => tab.dirty);
        if (id === CommandIds.EditorCloseAll) return this.tabsState.tabs.some((tab) => !tab.pinned);
        if (id === CommandIds.EditorCloseOthers) {
          return Boolean(this.tabsState.activeUri &&
            this.tabsState.tabs.some((tab) => tab.uri !== this.tabsState.activeUri && !tab.pinned));
        }
        if (id === CommandIds.MultiCursorClear) return this.active !== null && this.getSelections().length > 1;
        return ACTIVE_EDITOR_COMMANDS.has(id) ? this.active !== null : undefined;
      }),
    );
    context.subscriptions.push(
      this.editor.onDidChangeCursorSelection(() => context.commands.notifyEnablementChanged()),
    );
  }

  currentFile(): string | null {
    return this.active;
  }

  /* ----- open editors surface (UX-6) ----- */
  openEditors(): OpenEditor[] {
    return this.tabsState.tabs.map((tab) => ({
      uri: tab.uri,
      path: tab.path,
      name: tab.name,
      dirty: tab.dirty,
      pinned: tab.pinned,
      preview: tab.preview,
      active: tab.uri === this.tabsState.activeUri,
    }));
  }

  activateEditor(uri: string): void {
    this.activateTab(uri);
  }

  closeEditor(uri: string): void {
    void this.confirmAndClose(uri);
  }

  async prepareEditorsForPath(path: string): Promise<{ commit(): void; cancel(): void } | null> {
    if (this.pathMutationActive) {
      this.context.layout.showToast('Another file operation is already in progress.', 'info');
      return null;
    }
    const normalized = normalizeEditorPath(path);
    const affected = new Set(
      this.tabsState.tabs
        .filter((tab) => {
          const candidate = normalizeEditorPath(tab.path);
          return candidate === normalized || candidate.startsWith(`${normalized}/`);
        })
        .map((tab) => tab.uri),
    );
    await Promise.all([...affected].map((uri) => this.documents.prepareForClose(uri)));
    const dirty = this.tabsState.tabs
      .filter((tab) => affected.has(tab.uri) && tab.dirty)
      .map((tab) => ({ uri: tab.uri, name: tab.name }));
    if (dirty.length > 0 && !(await this.promptSaveBeforeClose(dirty))) {
      for (const uri of affected) this.documents.cancelClosePreparation(uri);
      return null;
    }

    this.pathMutationActive = true;
    const activeAffected = Boolean(this.tabsState.activeUri && affected.has(this.tabsState.activeUri));
    const previousReadOnly = this.editor.getRawOptions().readOnly;
    if (activeAffected) this.editor.updateOptions({ readOnly: true });
    let settled = false;
    const release = (): void => {
      if (settled) return;
      settled = true;
      this.pathMutationActive = false;
      if (activeAffected) this.editor.updateOptions({ readOnly: previousReadOnly });
      for (const uri of affected) this.documents.cancelClosePreparation(uri);
    };
    return {
      cancel: release,
      commit: () => {
        if (settled) return;
        try {
          const remaining = this.tabsState.tabs.filter((tab) => !affected.has(tab.uri));
          const activeRemoved = Boolean(this.tabsState.activeUri && affected.has(this.tabsState.activeUri));
          this.applyTabs({
            tabs: remaining,
            activeUri: activeRemoved ? remaining[0]?.uri ?? null : this.tabsState.activeUri,
          });
          for (const uri of affected) this.documents.close(uri);
        } finally {
          release();
        }
      },
    };
  }

  currentUri(): string | null {
    return this.activeUri;
  }

  cursorPosition(): { line: number; character: number } | null {
    const position = this.editor.getPosition();
    return position ? { line: position.lineNumber - 1, character: position.column - 1 } : null;
  }

  /* ----- multi-cursor primitives (Phase 7C) ----- */
  getSelections(): CursorSelection[] {
    const all = this.editor.getSelections() ?? [];
    const primary = this.editor.getSelection();
    // Return the primary cursor first so consumers can treat selections[0] as it.
    if (primary && all.length > 1) {
      const rest = all.filter((selection) => !selection.equalsSelection(primary));
      return [primary, ...rest].map(toCursorSelection);
    }
    return all.map(toCursorSelection);
  }

  setSelections(selections: CursorSelection[]): void {
    if (selections.length === 0) return;
    this.editor.setSelections(selections.map(fromCursorSelection));
    this.editor.revealRangeInCenterIfOutsideViewport(fromCursorSelection(selections[0]));
    this.editor.focus();
  }

  activeText(): string | null {
    return this.editor.getModel()?.getValue() ?? null;
  }

  selectedCharCount(): number {
    const model = this.editor.getModel();
    if (!model) return 0;
    let total = 0;
    for (const selection of this.editor.getSelections() ?? []) {
      total += model.getValueInRange(selection).length;
    }
    return total;
  }

  runEditorAction(actionId: string): void {
    void this.editor.getAction(actionId)?.run();
    this.editor.focus();
  }

  insertSnippet(body: string): void {
    const controller = this.editor.getContribution('snippetController2') as unknown as
      | { insert(template: string): void }
      | null;
    controller?.insert(body);
    this.editor.focus();
  }

  selectedText(): string {
    const model = this.editor.getModel();
    const selection = this.editor.getSelection();
    return model && selection ? model.getValueInRange(selection) : '';
  }

  applyOffsetEdits(edits: OffsetEdit[]): void {
    const model = this.editor.getModel();
    if (!model || !edits.length) return;
    // Monaco resolves every range against the model as it is now, so a batch of
    // pre-image offsets applies atomically and lands in one undo step.
    model.pushEditOperations(
      [],
      edits.map((edit) => ({
        range: monaco.Range.fromPositions(model.getPositionAt(edit.startOffset), model.getPositionAt(edit.endOffset)),
        text: edit.text,
      })),
      () => null,
    );
  }

  insertText(text: string): void {
    const selection = this.editor.getSelection();
    if (!selection) return;
    this.editor.executeEdits('codegen', [{ range: selection, text, forceMoveMarkers: true }]);
    this.editor.focus();
  }

  onDidChangeSelections(handler: (selections: CursorSelection[]) => void): monaco.IDisposable {
    return this.editor.onDidChangeCursorSelection(() => handler(this.getSelections()));
  }

  setDecorations(owner: string, decorations: EditorDecoration[]): void {
    const model = this.editor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const monacoDecorations: monaco.editor.IModelDeltaDecoration[] = [];

    for (const decoration of decorations) {
      const line = decoration.startLine + 1;
      if (line < 1 || line > lineCount) continue;

      if (decoration.wholeLine) {
        monacoDecorations.push({
          range: new monaco.Range(line, 1, line, 1),
          options: { isWholeLine: true, className: `znxstudio-errorlens-line--${decoration.severity}` },
        });
      }
      if (decoration.inlineMessage) {
        const endColumn = model.getLineMaxColumn(line);
        monacoDecorations.push({
          range: new monaco.Range(line, endColumn, line, endColumn),
          options: {
            after: {
              content: `    ${decoration.inlineMessage}`,
              inlineClassName: `znxstudio-errorlens-text znxstudio-errorlens-text--${decoration.severity}`,
            },
          },
        });
      }
    }
    this.collection(owner).set(monacoDecorations);
  }

  clearDecorations(owner: string): void {
    this.decorationOwners.get(owner)?.clear();
  }

  onDidClickGutter(handler: (line: number) => void): void {
    this.gutterHandlers.push(handler);
  }

  setBreakpointGlyphs(glyphs: BreakpointGlyph[]): void {
    const model = this.editor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const glyph of glyphs) {
      const line = glyph.line + 1;
      if (line < 1 || line > lineCount) continue;
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          glyphMarginClassName: `znxstudio-bp znxstudio-bp--${glyph.state}`,
          glyphMarginHoverMessage: glyph.hover ? { value: glyph.hover } : undefined,
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    this.collection('breakpoints').set(decorations);
  }

  setBookmarkGlyphs(lines: number[]): void {
    const model = this.editor.getModel();
    if (!model) return;
    const lineCount = model.getLineCount();
    const decorations: monaco.editor.IModelDeltaDecoration[] = [];
    for (const zeroBased of lines) {
      const line = zeroBased + 1;
      if (line < 1 || line > lineCount) continue;
      decorations.push({
        range: new monaco.Range(line, 1, line, 1),
        options: {
          linesDecorationsClassName: 'znxstudio-bookmark-glyph',
          overviewRuler: {
            color: 'rgba(230, 184, 0, 0.85)',
            position: monaco.editor.OverviewRulerLane.Left,
          },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      });
    }
    this.collection('bookmarks').set(decorations);
  }

  setExecutionPointer(uri: string | null, line = 0, kind: 'step' | 'exception' = 'step'): void {
    this.executionPointer = uri ? { uri, line, kind } : null;
    this.applyExecutionPointer();
  }

  private applyExecutionPointer(): void {
    const collection = this.collection('exec');
    const model = this.editor.getModel();
    const pointer = this.executionPointer;
    if (!pointer || !model || model.uri.toString() !== pointer.uri) {
      collection.clear();
      return;
    }
    const line = pointer.line + 1;
    if (line < 1 || line > model.getLineCount()) {
      collection.clear();
      return;
    }
    const suffix = pointer.kind === 'exception' ? '--exception' : '';
    collection.set([
      {
        range: new monaco.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: `znxstudio-exec-line ${suffix ? `znxstudio-exec-line${suffix}` : ''}`.trim(),
          linesDecorationsClassName: `znxstudio-exec-arrow ${suffix ? `znxstudio-exec-arrow${suffix}` : ''}`.trim(),
        },
      },
    ]);
  }

  private collection(owner: string): monaco.editor.IEditorDecorationsCollection {
    let collection = this.decorationOwners.get(owner);
    if (!collection) {
      collection = this.editor.createDecorationsCollection();
      this.decorationOwners.set(owner, collection);
    }
    return collection;
  }

  revealPosition(line: number, character: number): void {
    const position = { lineNumber: line + 1, column: character + 1 };
    this.editor.setPosition(position);
    this.editor.revealPositionInCenter(position);
    this.editor.focus();
  }

  async revealLocation(uri: string, line: number, character: number): Promise<void> {
    const path = monaco.Uri.parse(uri).fsPath;
    await this.openFile(path);
    this.revealPosition(line, character);
  }

  breadcrumbHost(): HTMLElement {
    return this.breadcrumbs;
  }

  showView(element: HTMLElement): void {
    // Every editor-area view (settings, docs, welcome, wizards, templates, AI) mounts here. Give the
    // overlay its own close affordance — a floating ✕ and Esc — so an opened view can always be
    // dismissed, instead of only clearing when a file or folder happens to be opened. The button lives
    // outside the scrolling region (the overlay clips; a nested wrapper scrolls) so it stays reachable.
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'znxstudio-editor-overlay-close';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close (Esc)';
    close.textContent = '✕';
    close.addEventListener('click', () => this.hideView());

    const scroll = document.createElement('div');
    scroll.className = 'znxstudio-editor-overlay-scroll';
    scroll.appendChild(element);

    this.overlay.replaceChildren(close, scroll);
    this.overlay.classList.add('is-visible');
  }

  /** Dismiss the overlay (welcome screen, settings, …) — e.g. once a project/folder is opened, or on Esc/✕. */
  hideView(): void {
    this.overlay.classList.remove('is-visible');
    this.overlay.replaceChildren();
  }

  // Esc closes the editor-area overlay, except while a Monaco editor inside it has focus (there Esc
  // is the editor's own — dismissing its find widget, suggestions, etc.).
  private wireOverlayDismiss(context: ModuleContext): void {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.overlay.classList.contains('is-visible')) return;
      if ((event.target as HTMLElement | null)?.closest('.monaco-editor')) return;
      this.hideView();
    };
    document.addEventListener('keydown', onKeyDown);
    context.subscriptions.push({ dispose: () => document.removeEventListener('keydown', onKeyDown) });
  }

  async openFile(path: string, options?: { preview?: boolean }): Promise<void> {
    const managed = await this.documents.open(path);
    this.openManaged(managed, options);
  }

  private openManaged(managed: ManagedDocument, options?: { preview?: boolean }): void {
    const path = managed.path;
    const name = path.split(/[\\/]/).pop() ?? 'Untitled';
    this.tabsState = openTab(
      this.tabsState,
      { uri: managed.uri, path, name },
      { preview: options?.preview ?? false },
    );
    this.showManaged(managed);
    this.renderTabs();
  }

  /** Point the editor at an already-open document and refresh the shell around it. */
  private showManaged(managed: ManagedDocument): void {
    managed.model.updateOptions({ tabSize: this.tabSize() });
    this.editor.setModel(managed.model);
    this.documents.setActive(managed.uri);
    this.tabsState = setActiveTab(this.tabsState, managed.uri);
    this.overlay.classList.remove('is-visible');
    // Decorations belong to the previous model; drop them so consumers repaint.
    for (const collection of this.decorationOwners.values()) collection.clear();
    this.applyExecutionPointer(); // re-show if we're back on the paused file

    this.active = managed.path;
    this.activeUri = managed.uri;
    this.activeName = managed.path.split(/[\\/]/).pop() ?? 'Untitled';
    this.activeFileEmitter.fire(managed.path);
    this.notifyCommandEnablement();
    this.status?.setItem('editor.activeFile', {
      text: this.activeName,
      tooltip: managed.path,
      side: 'left',
      priority: 40,
    });
  }

  /** Show the currently-active tab's document, or clear the editor when none remain. */
  private applyTabs(next: TabsState): void {
    const previousActive = this.tabsState.activeUri;
    this.tabsState = next;
    if (next.activeUri && next.activeUri !== previousActive) {
      const managed = this.documents.getManaged(next.activeUri);
      if (managed) this.showManaged(managed);
    } else if (!next.activeUri) {
      this.editor.setModel(null);
      this.active = null;
      this.activeUri = null;
      this.activeFileEmitter.fire(null);
      this.notifyCommandEnablement();
      this.status?.setItem('editor.activeFile', { text: t('status.noFile'), side: 'left', priority: 40 });
    }
    this.renderTabs();
  }

  private activateTab(uri: string): void {
    const managed = this.documents.getManaged(uri);
    if (managed) this.showManaged(managed);
    this.renderTabs();
  }

  /** Force-close a tab (no dirty prompt). Disposes the model. */
  private closeTabByUri(uri: string): void {
    const next = closeTab(this.tabsState, uri);
    this.documents.close(uri); // fires onDidClose; disposes the model
    this.applyTabs(next);
  }

  /**
   * User-initiated close of ONE tab (× / middle-click / Ctrl+W / context menu).
   * Prompts Save / Don't Save / Cancel when the document has unsaved edits so a
   * close can never silently discard work.
   */
  private async confirmAndClose(uri: string, restoreTabFocus = false): Promise<void> {
    await this.documents.prepareForClose(uri);
    const tab = this.tabsState.tabs.find((t) => t.uri === uri);
    if (tab?.dirty && !(await this.promptSaveBeforeClose([{ uri, name: tab.name }]))) {
      this.documents.cancelClosePreparation(uri);
      return;
    }
    this.closeTabByUri(uri);
    if (restoreTabFocus) this.focusActiveTabOrEditor();
  }

  /**
   * User-initiated close of a SET of tabs (Close Others / Close All). Prompts
   * once for all dirty members, then closes and disposes them.
   */
  private async confirmCloseSet(next: TabsState, restoreTabFocus = false): Promise<boolean> {
    const keep = new Set(next.tabs.map((t) => t.uri));
    let closing = this.tabsState.tabs.filter((t) => !keep.has(t.uri));
    await Promise.all(closing.map((tab) => this.documents.prepareForClose(tab.uri)));
    // Autosaves may have cleaned tabs while the close action was waiting.
    closing = this.tabsState.tabs.filter((t) => !keep.has(t.uri));
    const dirty = closing.filter((t) => t.dirty).map((t) => ({ uri: t.uri, name: t.name }));
    if (dirty.length > 0 && !(await this.promptSaveBeforeClose(dirty))) {
      for (const tab of closing) this.documents.cancelClosePreparation(tab.uri);
      return false;
    }
    this.applyTabs(next);
    for (const t of closing) this.documents.close(t.uri); // dispose the closed models
    if (restoreTabFocus) this.focusActiveTabOrEditor();
    return true;
  }

  private focusActiveTabOrEditor(): void {
    const activeUri = this.tabsState.activeUri;
    const tab = activeUri
      ? [...this.tabsBar.querySelectorAll<HTMLElement>('[role="tab"]')]
          .find((candidate) => candidate.dataset.uri === activeUri)
      : undefined;
    if (tab) tab.focus();
    else this.editor.focus();
  }

  /**
   * The Save / Don't Save / Cancel prompt. Returns true to proceed with the
   * close (having saved when the user chose Save), false to cancel it.
   */
  private async promptSaveBeforeClose(dirty: { uri: string; name: string }[]): Promise<boolean> {
    const one = dirty.length === 1;
    const choice = await showModal({
      title: one ? `Do you want to save the changes to ${dirty[0].name}?` : `Do you want to save changes to ${dirty.length} files?`,
      body: `${dirty.map((d) => d.name).join('\n')}\n\nYour changes will be lost if you don't save them.`,
      buttons: [
        { label: one ? 'Save' : 'Save All', value: 'save', primary: true },
        { label: "Don't Save", value: 'discard' },
        { label: 'Cancel', value: 'cancel' },
      ],
      dismissValue: 'cancel',
    });
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      try {
        for (const d of dirty) {
          if (!(await this.saveWithConflictResolution(d.uri))) return false;
        }
      } catch {
        // The centralized save-error notification explains the failure. Keep
        // the tab/window open so unsaved data cannot be discarded afterward.
        return false;
      }
    }
    return true;
  }

  private closeActive(): void {
    if (this.tabsState.activeUri) void this.confirmAndClose(this.tabsState.activeUri);
  }

  private async revertActive(): Promise<void> {
    const uri = this.tabsState.activeUri;
    if (!uri) return;
    const tab = this.tabsState.tabs.find((candidate) => candidate.uri === uri);
    if (tab?.dirty) {
      const choice = await showModal({
        title: `Revert ${tab.name}?`,
        body: 'Reload this file from disk and permanently discard its unsaved changes?',
        buttons: [
          { label: 'Revert File', value: 'revert', primary: true },
          { label: 'Cancel', value: 'cancel' },
        ],
        dismissValue: 'cancel',
      });
      if (choice !== 'revert') return;
    }
    try {
      await this.documents.revert(uri);
      this.context.layout.showToast(`${tab?.name ?? 'File'} reloaded from disk.`, 'info');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.context.layout.showToast(`Could not reload ${tab?.name ?? 'the file'}: ${detail}`, 'error');
    }
  }

  /* ----- saving + dirty state ----- */
  private bindSaving(context: ModuleContext): void {
    context.commands.register(
      CommandIds.FileSave,
      () => this.saveActiveFormatted(),
      'Save File',
    );
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
      void this.saveActiveFormatted().catch(() => undefined),
    );

    const refresh = (uri: string, dirty: boolean) => {
      if (!this.tabsState.tabs.some((tab) => tab.uri === uri)) return;
      this.tabsState = markDirty(this.tabsState, uri, dirty);
      this.renderTabs();
      this.notifyCommandEnablement();
    };
    context.subscriptions.push(this.documents.onDidChange((doc) => refresh(doc.uri, doc.dirty)));
    context.subscriptions.push(this.documents.onDidSave((doc) => refresh(doc.uri, doc.dirty)));
    context.subscriptions.push(this.documents.onDidSaveError(({ document: doc, error }) => {
      refresh(doc.uri, true);
      const detail = error instanceof Error ? error.message : String(error);
      this.context.layout.showToast(`Could not save ${doc.path}: ${detail}`, 'error');
    }));

    // A document closed elsewhere (crash recovery, external) drops its tab too.
    context.subscriptions.push(this.documents.onDidClose((doc) => {
      if (this.tabsState.tabs.some((tab) => tab.uri === doc.uri)) {
        this.applyTabs(closeTab(this.tabsState, doc.uri));
      }
    }));

    // Autosave triggers driven by focus (Phase 20J WI2): editor blur = focus
    // change; window blur = window change. The delay mode is timer-driven inside
    // the document manager instead.
    this.editor.onDidBlurEditorText(() => {
      if (this.autosaveMode === 'onFocusChange') void this.documents.saveAllDirty().catch(() => undefined);
    });
    const onWindowBlur = () => {
      if (this.autosaveMode === 'onWindowChange') void this.documents.saveAllDirty().catch(() => undefined);
    };
    window.addEventListener('blur', onWindowBlur);
    const onWindowFocus = (): void => void this.checkExternalChanges();
    window.addEventListener('focus', onWindowFocus);
    context.subscriptions.push({
      dispose: () => {
        window.removeEventListener('blur', onWindowBlur);
        window.removeEventListener('focus', onWindowFocus);
      },
    });

    // Window/quit guard (Phase 20J WI2): the main process asks before closing so
    // unsaved work is never lost to a window close or an app quit.
    const offQueryClose = window.znxstudio.window.onQueryClose(() => void this.handleWindowClose());
    context.subscriptions.push({ dispose: offQueryClose });
  }

  /**
   * An explicit save (Ctrl/Cmd+S or the Save command): when `editor.formatOnSave`
   * is on (the default), format the active document with the registered formatter
   * first, then persist. Formatting is best-effort — a formatter that is absent or
   * errors never blocks the save. Autosave triggers deliberately skip this so the
   * document isn't reflowed while the user is still typing.
   */
  private async saveActiveFormatted(): Promise<void> {
    if (this.settings?.get('editor.formatOnSave', true)) {
      try {
        await this.editor.getAction('editor.action.formatDocument')?.run();
      } catch {
        /* best-effort — never block a save on formatting */
      }
    }
    const uri = this.tabsState.activeUri;
    if (uri) await this.saveWithConflictResolution(uri);
  }

  /** Save, then offer safe recovery when the backing file changed or vanished. */
  private async saveWithConflictResolution(uri: string): Promise<boolean> {
    try {
      await this.documents.save(uri);
      return true;
    } catch (error) {
      const managedDoc = this.documents.getManaged(uri);
      if (!managedDoc?.externalConflict) throw error;
      const name = this.tabsState.tabs.find((tab) => tab.uri === uri)?.name ?? managedDoc.path;
      let diskContent: string | null = null;
      try {
        diskContent = await window.znxstudio.fs.readFile(managedDoc.path);
      } catch {
        /* missing file is represented by the explanatory placeholder */
      }
      const comparison = document.createElement('div');
      comparison.className = 'znxstudio-conflict-compare';
      const description = document.createElement('p');
      description.textContent = 'Compare both versions, save your editor content under another name, reload from disk, or overwrite the original file.';
      const versions = document.createElement('div');
      versions.className = 'znxstudio-conflict-versions';
      const versionPane = (label: string, content: string): HTMLElement => {
        const pane = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = label;
        const preview = document.createElement('pre');
        preview.textContent = content;
        pane.append(heading, preview);
        return pane;
      };
      versions.append(
        versionPane('Your editor', managedDoc.model.getValue()),
        versionPane('On disk', diskConflictPreview(diskContent)),
      );
      comparison.append(description, versions);
      const choice = await showModal({
        title: `${name} changed outside ZnxStudio`,
        body: comparison,
        buttons: [
          { label: 'Overwrite', value: 'overwrite', primary: true },
          { label: 'Save As…', value: 'saveAs' },
          { label: 'Reload from Disk', value: 'reload' },
          { label: 'Cancel', value: 'cancel' },
        ],
        dismissValue: 'cancel',
      });
      if (choice === 'cancel') return false;
      if (choice === 'saveAs') {
        const content = managedDoc.model.getValue();
        const savedPath = await window.znxstudio.dialog.saveFile(managedDoc.path, content);
        const target = resolveSaveAsTarget(managedDoc.path, savedPath);
        if (target.kind === 'cancel') return false;
        if (target.kind === 'overwrite') {
          await this.documents.save(uri, { overwriteExternal: true });
          return true;
        }
        const saved = this.documents.openFromContent(target.path, content);
        this.openManaged(saved, { preview: false });
        this.closeTabByUri(uri);
        this.context.layout.showToast(`Saved as ${target.path}.`, 'info');
        return true;
      }
      if (choice === 'reload') {
        try {
          await this.documents.revert(uri);
          return true;
        } catch (reloadError) {
          const detail = reloadError instanceof Error ? reloadError.message : String(reloadError);
          this.context.layout.showToast(`Could not reload ${name}: ${detail}`, 'error');
          return false;
        }
      }
      await this.documents.save(uri, { overwriteExternal: true });
      this.context.layout.showToast(`${name} was overwritten with your editor content.`, 'info');
      return true;
    }
  }

  private async checkExternalChanges(): Promise<void> {
    try {
      const result = await this.documents.checkExternalChanges();
      if (result.reloaded.length > 0) {
        this.context.layout.showToast(
          `${result.reloaded.length} file${result.reloaded.length === 1 ? '' : 's'} reloaded after changing on disk.`,
          'info',
        );
      }
      if (result.conflicts.length > 0 || result.missing.length > 0) {
        const count = result.conflicts.length + result.missing.length;
        this.context.layout.showToast(
          `${count} open file${count === 1 ? '' : 's'} changed or disappeared on disk. Unsaved editor content was preserved.`,
          'error',
        );
      }
    } catch {
      // A focus transition must never interrupt editing when the filesystem is unavailable.
    }
  }

  /** Respond to the main process's pre-close query: prompt for unsaved work, then allow/cancel. */
  private async handleWindowClose(): Promise<void> {
    const open = [...this.tabsState.tabs];
    await Promise.all(open.map((tab) => this.documents.prepareForClose(tab.uri)));
    const dirty = this.tabsState.tabs.filter((tab) => tab.dirty).map((tab) => ({ uri: tab.uri, name: tab.name }));
    if (dirty.length > 0 && !(await this.promptSaveBeforeClose(dirty))) {
      for (const tab of open) this.documents.cancelClosePreparation(tab.uri);
      window.znxstudio.window.cancelClose(); // user cancelled — keep the window open, work intact
      return;
    }
    window.znxstudio.window.confirmClose();
  }

  /* ----- session persist / restore (Phase 20J WI2) ----- */
  private schedulePersistSession(): void {
    if (!this.sessionEnabled || this.restoringSession) return;
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => this.persistSession(), 500);
  }

  private persistSession(): void {
    // Only persist tabs backed by a real open document (excludes synthetic
    // self-test/stress tabs), so a session snapshot always reopens cleanly.
    const editors = this.openEditors().filter((editor) => this.documents.getManaged(editor.uri));
    this.settings?.set('workbench.session', serializeSession(editors));
  }

  private async restoreSession(): Promise<void> {
    const snapshot = parseSession(this.settings?.get('workbench.session', null));
    if (snapshot.tabs.length === 0) return;
    this.restoringSession = true;
    try {
      const opened: string[] = [];
      for (const tab of snapshot.tabs) {
        try {
          await this.openFile(tab.path); // permanent tab
          opened.push(tab.path);
          if (tab.pinned && this.tabsState.tabs.some((t) => t.path === tab.path)) {
            const uri = this.tabsState.tabs.find((t) => t.path === tab.path)?.uri;
            if (uri) this.applyTabs(togglePin(this.tabsState, uri));
          }
        } catch {
          // A file removed since last session is skipped, not an error.
        }
      }
      const restored = restorableSession(snapshot, (path) => opened.includes(path));
      if (restored.activePath) {
        try {
          await this.openFile(restored.activePath);
        } catch {
          // It was opened moments ago, but an external deletion can still race us.
        }
      }
    } finally {
      this.restoringSession = false;
      // Replace the old snapshot now, dropping missing files and preserving any
      // tabs the user opened while the asynchronous restore was in progress.
      this.persistSession();
    }
  }

  /* ----- tab bar rendering + interactions (UX-5) ----- */
  private renderTabs(): void {
    this.tabsBar.replaceChildren();
    for (const tab of this.tabsState.tabs) {
      this.tabsBar.appendChild(this.renderTabElement(tab));
    }
    this.tabsBar.classList.toggle('is-empty', this.tabsState.tabs.length === 0);
    // The Open Editors view (UX-6) mirrors this state; notify it after every change.
    this.editorsEmitter.fire();
    // Persist the session (debounced) so tabs survive a restart (Phase 20J WI2).
    this.schedulePersistSession();
  }

  private renderTabElement(tab: EditorTab): HTMLElement {
    const active = tab.uri === this.tabsState.activeUri;
    const el = document.createElement('div');
    el.className =
      'znxstudio-editor-tab' +
      (active ? ' is-active' : '') +
      (tab.preview ? ' is-preview' : '') +
      (tab.pinned ? ' is-pinned' : '') +
      (tab.dirty ? ' is-dirty' : '');
    el.dataset.uri = tab.uri;
    el.title = tab.path;

    const target = document.createElement('div');
    target.className = 'znxstudio-editor-tab-target';
    target.dataset.uri = tab.uri;
    target.tabIndex = active ? 0 : -1;
    target.setAttribute('role', 'tab');
    target.setAttribute('aria-selected', String(active));
    target.setAttribute(
      'aria-label',
      `${tab.name}${tab.dirty ? ', unsaved changes' : ''}${tab.pinned ? ', pinned' : ''}`,
    );

    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'znxstudio-editor-tab-pin';
      pin.textContent = '●';
      pin.setAttribute('aria-hidden', 'true');
      target.appendChild(pin);
    }

    const label = document.createElement('span');
    label.className = 'znxstudio-editor-tab-label';
    label.textContent = tab.name;
    target.appendChild(label);

    const dirty = document.createElement('span');
    dirty.className = 'znxstudio-editor-tab-dirty';
    dirty.textContent = '●';
    dirty.setAttribute('aria-hidden', 'true');
    target.appendChild(dirty);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'znxstudio-editor-tab-close';
    close.textContent = '×';
    close.title = 'Close';
    close.tabIndex = active ? 0 : -1;
    close.setAttribute('aria-label', `Close ${tab.name}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.confirmAndClose(tab.uri, true);
    });
    el.append(target, close);

    target.addEventListener('click', () => this.activateTab(tab.uri));
    target.addEventListener('keydown', (event) => this.onTabKey(event, tab));
    // Double-click promotes a preview tab to permanent (VS Code muscle memory).
    target.addEventListener('dblclick', () => {
      this.tabsState = makePermanent(this.tabsState, tab.uri);
      this.renderTabs();
    });
    // Middle-click closes; right-click opens the tab context menu.
    el.addEventListener('mousedown', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        void this.confirmAndClose(tab.uri, true);
      }
    });
    target.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openTabContextMenu(tab, event.clientX, event.clientY);
    });
    return el;
  }

  private onTabKey(event: KeyboardEvent, tab: EditorTab): void {
    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = event.currentTarget instanceof HTMLElement
        ? event.currentTarget.getBoundingClientRect()
        : this.tabsBar.getBoundingClientRect();
      this.openTabContextMenu(tab, rect.left + 16, rect.bottom);
      return;
    }
    const tabs = [...this.tabsBar.querySelectorAll<HTMLElement>('[role="tab"]')];
    const current = event.currentTarget as HTMLElement;
    const index = tabs.indexOf(current);
    let target: HTMLElement | undefined;
    if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
    else if (event.key === 'ArrowLeft') target = tabs[(index - 1 + tabs.length) % tabs.length];
    else if (event.key === 'Home') target = tabs[0];
    else if (event.key === 'End') target = tabs[tabs.length - 1];
    else if (event.key === 'Enter' || event.key === ' ') target = current;
    if (!target) return;
    event.preventDefault();
    const uri = target.dataset.uri;
    if (!uri) return;
    this.activateTab(uri);
    this.tabsBar.querySelector<HTMLElement>(`[role="tab"][data-uri="${CSS.escape(uri)}"]`)?.focus();
  }

  private openTabContextMenu(tab: EditorTab, x: number, y: number): void {
    const entries = (): MenuEntry[] => {
      const current = this.tabsState.tabs.find((candidate) => candidate.uri === tab.uri);
      if (!current) return [];
      const canCloseOthers = this.tabsState.tabs.some((candidate) =>
        candidate.uri !== current.uri && !candidate.pinned);
      const canCloseAll = this.tabsState.tabs.some((candidate) => !candidate.pinned);
      const items: MenuEntry[] = [
        { label: 'Close', onClick: () => void this.confirmAndClose(current.uri, true) },
        {
          label: 'Close Others',
          disabled: !canCloseOthers,
          onClick: () => {
            if (this.tabsState.tabs.some((candidate) => candidate.uri !== current.uri && !candidate.pinned)) {
              void this.confirmCloseSet(closeOthers(this.tabsState, current.uri), true);
            }
          },
        },
        {
          label: 'Close All',
          disabled: !canCloseAll,
          onClick: () => {
            if (this.tabsState.tabs.some((candidate) => !candidate.pinned)) {
              void this.confirmCloseSet(closeAll(this.tabsState), true);
            }
          },
        },
        { separator: true },
        {
          label: current.pinned ? 'Unpin' : 'Pin',
          onClick: () => this.applyTabs(togglePin(this.tabsState, current.uri)),
        },
      ];
      if (current.preview) {
        items.push({
          label: 'Keep Open',
          onClick: () => {
            this.tabsState = makePermanent(this.tabsState, current.uri);
            this.renderTabs();
          },
        });
      }
      return items;
    };
    this.context.layout.openFloatingMenu(x, y, entries);
  }

  /* ----- live settings sync ----- */
  private bindSettings(context: ModuleContext): void {
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    if (!this.settings) return;

    this.applySettings();
    context.subscriptions.push(this.settings.onDidChange((event) => {
      if (event.key.startsWith('editor.') || event.key.startsWith('files.')) this.applySettings();
    }));
  }

  private applySettings(): void {
    const fontSize = this.settings?.get('editor.fontSize', DEFAULT_FONT_SIZE) ?? DEFAULT_FONT_SIZE;
    const fontFamily = this.settings?.get(
      'editor.fontFamily',
      DEFAULT_EDITOR_FONT_FAMILY,
    );
    const tabSize = this.tabSize();
    this.editor.updateOptions({ fontSize, fontFamily, lineHeight: Math.round(fontSize * 1.5) });
    for (const model of this.documents.models()) model.updateOptions({ tabSize });

    // Autosave (Phase 20J WI2): track the resolved mode so the focus/window blur
    // triggers below know when to save. The document manager's timer config is
    // owned by LanguagePlatformModule.wireAutosave (single writer).
    this.autosaveMode = resolveAutosaveMode(
      this.settings?.get<string | undefined>('files.autosaveMode', undefined),
      this.settings?.get('files.autosave', false),
    );
  }

  private tabSize(): number {
    return this.settings?.get('editor.tabSize', 2) ?? 2;
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
      // Two openable .zx programs, cross-platform: prefer real Zornux examples,
      // else self-contained temp files so editortoolbar + stress still run on CI
      // (which has no examples checkout) instead of being skipped.
      const root = await examplePath();
      let files = root
        ? (await window.znxstudio.search.files(root)).filter((f) => f.endsWith('.zx'))
        : [];
      if (files.length < 2) {
        const a = await tempZx('editor-a.zx', 'create greeting = "hello"\nshow greeting\n');
        const b = await tempZx('editor-b.zx', 'create total = 1 + 2\nshow total\n');
        files = [a, b].filter(Boolean);
      }
      if (files.length < 2) {
        log(`editortabs REAL DOM: skipped (could not obtain 2 .zx files)`);
        return;
      }
      const [a, b] = files;
      await this.openFile(a, { preview: true });
      const previewCount = this.tabsBar.querySelectorAll('.znxstudio-editor-tab.is-preview').length;
      await this.openFile(b, { preview: true });
      const afterSecondPreview = this.tabsBar.querySelectorAll('.znxstudio-editor-tab').length;
      await this.openFile(a, { preview: false }); // promote + re-open a as permanent
      await this.openFile(b, { preview: false });
      const permanentCount = this.tabsBar.querySelectorAll('.znxstudio-editor-tab').length;

      // Pin the active tab, then close it — pin survives closeOthers.
      if (this.tabsState.activeUri) this.applyTabs(togglePin(this.tabsState, this.tabsState.activeUri));
      const pinned = this.tabsBar.querySelectorAll('.znxstudio-editor-tab.is-pinned').length;
      const activeUri = this.tabsState.activeUri;
      if (activeUri) this.closeTabByUri(activeUri);
      const afterClose = this.tabsBar.querySelectorAll('.znxstudio-editor-tab').length;

      const sticky = this.editor.getOption(monaco.editor.EditorOption.stickyScroll) as { enabled: boolean };
      log(
        `editortabs REAL DOM: previewReuse(${afterSecondPreview}=1) permanentTabs=${permanentCount} ` +
          `previewSeen=${previewCount} pinned=${pinned} afterClose=${afterClose} sticky=${sticky?.enabled} ` +
          `minimap=${this.editor.getOption(monaco.editor.EditorOption.minimap).enabled}`,
      );
      // The toolbar shows Run + Debug directly and folds Stop/Build/Rebuild into a
      // "More" overflow menu; open it so the self-test reports the FULL action set
      // rather than the two visible buttons plus the overflow toggle.
      const MORE_LABEL = 'More run and build actions';
      const actionButtons = [...document.querySelectorAll('.znxstudio-editor-actions .znxstudio-editor-action')];
      const direct = actionButtons.map((b) => b.getAttribute('aria-label') ?? '').filter((a) => a !== MORE_LABEL);
      const moreButton = actionButtons.find((b) => b.getAttribute('aria-label') === MORE_LABEL) as HTMLElement | undefined;
      moreButton?.click();
      const overflow = [...document.querySelectorAll('.znxstudio-menu .znxstudio-menu-item')].map((el) =>
        (el.textContent ?? '').trim(),
      );
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      log(`editortoolbar REAL DOM: actions=[${[...direct, ...overflow].join(', ')}]`);

      // 20E: stress the tab renderer with far more tabs than a human opens.
      const savedTabs = this.tabsState;
      const many: TabsState = {
        tabs: Array.from({ length: 300 }, (_, i) => ({
          uri: `stress:///s${i}.zx`,
          path: `/s${i}.zx`,
          name: `s${i}.zx`,
          dirty: i % 4 === 0,
          pinned: i % 20 === 0,
          preview: false,
        })),
        activeUri: 'stress:///s0.zx',
      };
      this.tabsState = many;
      this.renderTabs();
      const renderedMany = this.tabsBar.querySelectorAll('.znxstudio-editor-tab').length;
      this.tabsState = savedTabs;
      this.renderTabs();
      log(`stress REAL DOM: rendered ${renderedMany}/300 editor tabs then restored to ${this.tabsState.tabs.length}`);
      // Leave a clean slate for the user.
      this.applyTabs(closeAll({ ...this.tabsState, tabs: this.tabsState.tabs.map((t) => ({ ...t, pinned: false })) }));
    } catch (error) {
      log(`editortabs self-test failed: ${(error as Error).message}`);
    }
  }
}

/** Monaco selection (1-based) → 0-based CursorSelection. */
function toCursorSelection(selection: monaco.Selection): CursorSelection {
  return {
    startLine: selection.startLineNumber - 1,
    startCharacter: selection.startColumn - 1,
    endLine: selection.endLineNumber - 1,
    endCharacter: selection.endColumn - 1,
  };
}

/** 0-based CursorSelection → Monaco selection (1-based). */
function fromCursorSelection(selection: CursorSelection): monaco.Selection {
  return new monaco.Selection(
    selection.startLine + 1,
    selection.startCharacter + 1,
    selection.endLine + 1,
    selection.endCharacter + 1,
  );
}
