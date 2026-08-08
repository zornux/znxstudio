import { ServiceKeys, type EditorService, type KeybindingService, type LayoutService, type SettingsService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import type { MenuEntry } from '../core/LayoutManager';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { WORKSPACES, workspaceCommandId, type WorkspaceDef } from './workspaces';
import { i18n, t } from '../i18n';
import {
  DEFAULT_LAYOUT,
  LAYOUT_LIMITS,
  isZen,
  layoutsEqual,
  maximizePanel,
  movePanel,
  moveSideBar,
  parseLayout,
  resizePanel,
  resizeSideBar,
  toggleActivityBar,
  togglePanel,
  toggleSideBar,
  toggleStatusBar,
  zenLayout,
  type LayoutState,
} from './layoutModel';
import {
  closePanel,
  DEFAULT_PANEL_PREFERENCES,
  inStrip,
  openPanel,
  overflowPanels,
  parsePanelPreferences,
  resetPanelPreferences,
  resolveActivePanel,
  setActivePanel,
  stripPanels,
  type PanelPreferences,
} from './panels';
import { formatRecentWorkspaces, pruneRecentWorkspaces } from '../editor/unsavedGuard';

const LAYOUT_SETTING = 'znxstudio.layout';
const PANELS_SETTING = 'znxstudio.layout.panels';
const OPTIONAL_TERMINAL_MIGRATION = 'znxstudio.layout.optionalTerminal.v1';
/** Where the layout is stashed when zen mode is entered, so leaving restores it. */
const ZEN_SNAPSHOT_SETTING = 'znxstudio.layout.preZen';

/**
 * Workbench layout (Phase 17A/17B/17C). Owns the `LayoutState`, applies it to the
 * shell, persists it, and exposes it as a service so profiles (17F) can swap it.
 *
 * Zen mode is a saved snapshot plus a derived state, not a mode flag: leaving zen
 * restores exactly the arrangement the user had, including sizes.
 */
export class LayoutModule implements IModule, LayoutService {
  readonly id = 'znxstudio.layout';
  readonly displayName = 'Layout';

  private context!: ModuleContext;
  private settings: SettingsService | undefined;
  private current: LayoutState = DEFAULT_LAYOUT;
  private panelPreferences: PanelPreferences = DEFAULT_PANEL_PREFERENCES;
  private readonly changeEmitter = new Emitter<LayoutState>();
  readonly onDidChangeLayout = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    context.services.register<LayoutService>(ServiceKeys.Layout, this);

    this.current = parseLayout(this.settings?.get<unknown>(LAYOUT_SETTING, DEFAULT_LAYOUT));
    this.panelPreferences = parsePanelPreferences(this.settings?.get<unknown>(PANELS_SETTING, DEFAULT_PANEL_PREFERENCES));
    // Terminal used to be a default panel, and activating it automatically put
    // it in `opened`. Remove that legacy auto-open once so it becomes genuinely
    // opt-in; future explicit opens continue to persist normally.
    if (!this.settings?.get<boolean>(OPTIONAL_TERMINAL_MIGRATION, false)) {
      this.panelPreferences = {
        ...this.panelPreferences,
        opened: (this.panelPreferences.opened ?? []).filter((id) => id !== 'terminal'),
        active: this.panelPreferences.active === 'terminal' ? null : this.panelPreferences.active,
      };
      this.settings?.set(PANELS_SETTING, this.panelPreferences);
      this.settings?.set(OPTIONAL_TERMINAL_MIGRATION, true);
    }

    const register = (id: string, run: () => void, title: string) => context.commands.register(id, run, title);
    register(CommandIds.LayoutToggleSideBar, () => this.update(toggleSideBar(this.current)), 'View: Toggle Side Bar');
    register(CommandIds.LayoutTogglePanel, () => this.update(togglePanel(this.current)), 'View: Toggle Panel');
    register(CommandIds.LayoutToggleStatusBar, () => this.update(toggleStatusBar(this.current)), 'View: Toggle Status Bar');
    register(CommandIds.LayoutToggleActivityBar, () => this.update(toggleActivityBar(this.current)), 'View: Toggle Activity Bar');
    register(CommandIds.LayoutMaximizePanel, () => this.update(maximizePanel(this.current)), 'View: Maximize Panel');
    register(CommandIds.LayoutSideBarLeft, () => this.update(moveSideBar(this.current, 'left')), 'View: Move Side Bar Left');
    register(CommandIds.LayoutSideBarRight, () => this.update(moveSideBar(this.current, 'right')), 'View: Move Side Bar Right');
    register(CommandIds.LayoutPanelBottom, () => this.update(movePanel(this.current, 'bottom')), 'View: Move Panel to Bottom');
    register(CommandIds.LayoutPanelRight, () => this.update(movePanel(this.current, 'right')), 'View: Move Panel to Right');
    register(CommandIds.LayoutToggleZen, () => this.toggleZen(), 'View: Toggle Zen Mode');
    register(CommandIds.LayoutReset, () => this.update(DEFAULT_LAYOUT), 'View: Reset Layout');
    register(CommandIds.LayoutPanelsShow, () => this.showPanelManager(), 'View: Manage Panels');
    // Window management (17C) lives in the main process; the renderer asks.
    register(CommandIds.WindowToggleFullScreen, () => void this.toggleFullScreen(), 'Window: Toggle Full Screen');
    register(CommandIds.WindowToggleMaximize, () => void window.znxstudio.window.toggleMaximize(), 'Window: Toggle Maximize');
    register(CommandIds.WindowMinimize, () => void window.znxstudio.window.minimize(), 'Window: Minimize');

    context.layout.applyLayout(this.current);
    this.updateZenExit(); // a persisted zen layout (restart in zen) still needs its way out
    context.layout.onDidResize((region, extent) => this.onResize(region, extent));
    // This module activates before any panel is contributed, so the preferences
    // are (re)applied each time a module registers one. Each panel also gets a
    // "Show Panel: <title>" command (SB-7) so EVERY panel is discoverable from the
    // Command Palette + Search Everywhere — nothing is menu-only.
    context.layout.onDidAddPanelView((id) => {
      this.applyPanelPreferences();
      this.registerPanelCommand(id);
    });
    for (const panel of context.layout.panelDescriptors()) this.registerPanelCommand(panel.id);
    // UX-2 bottom-panel container: close a tab (→ overflow), open one from the
    // searchable "+" picker, and remember the last active tab.
    context.layout.onDidRequestClosePanel((id) => this.setPanelPreferences(closePanel(this.panelPreferences, id)));
    context.layout.onDidRequestOpenPanel(() => this.openPanelPicker());
    context.layout.onDidRequestMaximizePanel(() => this.update(maximizePanel(this.current)));
    context.layout.onDidRequestHidePanel(() => this.update(togglePanel(this.current, false)));
    context.layout.onDidChangeActivePanel((id) => {
      // Revealing a panel also OPENS it: a module calling showPanelView on a
      // panel that's in overflow (e.g. Run → Output) must actually surface it.
      // Without openPanel, applyPanelPreferences would drop it from the strip and
      // immediately revert, so the output would flash and vanish.
      if (this.panelPreferences.active !== id) {
        this.setPanelPreferences(setActivePanel(openPanel(this.panelPreferences, id), id));
      }
    });

    // Clicking an activity-bar icon reveals the side bar (it only swaps content on
    // its own); clicking the already-active icon toggles the side bar, like VS Code.
    context.layout.onDidSelectActivity((_id, wasActive) => {
      const visible = this.current.sidebar.visible;
      if (wasActive && visible) this.update(toggleSideBar(this.current, false));
      else if (!visible) this.update(toggleSideBar(this.current, true));
    });

    // The title-bar menu bar — the app's single menu, replacing Electron's default
    // OS menu (removed in main). Conventional top-level grouping so features are
    // discoverable without all competing at one level (progressive disclosure):
    // File · Edit · Selection · View · Go · Run · Terminal · Tools · AI · Help.
    context.layout.addMenu('File', () => this.buildFileMenu());
    context.layout.addMenu('Edit', () => this.buildEditMenu());
    context.layout.addMenu('Selection', () => this.buildSelectionMenu());
    // The View menu — a central launcher for panels + workspaces.
    context.layout.addMenu('View', () => this.buildViewMenu());
    context.layout.addMenu('Go', () => this.buildGoMenu());
    context.layout.addMenu('Run', () => this.buildRunMenu());
    context.layout.addMenu('Terminal', () => this.buildTerminalMenu());
    context.layout.addMenu('Tools', () => this.buildToolsMenu());
    context.layout.addMenu('AI', () => this.buildAiMenu());
    context.layout.addMenu('Help', () => this.buildHelpMenu());
    register(CommandIds.ViewMenu, () => context.layout.triggerMenu('View'), 'View: Open View Menu');
    // Prune deleted/moved projects from the recent list on startup.
    void this.pruneRecents();

    // SB-4: each workspace is a palette-searchable command that sets up its
    // environment (primary view + panels + focus).
    for (const workspace of WORKSPACES) {
      register(workspaceCommandId(workspace.id), () => this.activateWorkspace(workspace), `Workspace: ${workspace.label}`);
    }

    this.applyPanelPreferences();

    void selfTestCoordinator.run('layout', () => this.maybeSelfTest());
  }

  /* ----- LayoutService ----- */
  layout(): LayoutState {
    return this.current;
  }

  panels(): PanelPreferences {
    return this.panelPreferences;
  }

  setLayout(next: LayoutState): void {
    this.update(next);
  }

  setPanelPreferences(next: PanelPreferences): void {
    this.panelPreferences = next;
    this.settings?.set(PANELS_SETTING, next);
    this.applyPanelPreferences();
  }

  /* ----- internals ----- */
  private update(next: LayoutState): void {
    if (layoutsEqual(this.current, next)) return;
    this.current = next;
    this.settings?.set(LAYOUT_SETTING, next);
    this.context.layout.applyLayout(next);
    this.updateZenExit();
    this.changeEmitter.fire(next);
  }

  /** Real OS fullscreen, read back rather than assumed — a compositor may refuse. */
  private async toggleFullScreen(): Promise<void> {
    const before = await window.znxstudio.window.getState();
    const after = await window.znxstudio.window.setFullScreen(!before.fullScreen);
    if (after.fullScreen === before.fullScreen) {
      this.context.layout.showToast('The window manager refused to change full screen.', 'error');
    }
  }

  /** A drag on a splitter. Clamped by the model, so a wild drag cannot break the shell. */
  private onResize(region: 'sidebar' | 'panel', extent: number): void {
    this.update(region === 'sidebar' ? resizeSideBar(this.current, extent) : resizePanel(this.current, extent));
  }

  /**
   * Enter zen by saving the current arrangement; leave by restoring it. Storing
   * the snapshot (rather than a boolean) means an app restart in zen mode can
   * still get the user's real layout back.
   */
  private toggleZen(): void {
    if (isZen(this.current)) {
      const saved = this.settings?.get<unknown>(ZEN_SNAPSHOT_SETTING, null);
      this.update(saved ? parseLayout(saved) : DEFAULT_LAYOUT);
      return;
    }
    this.settings?.set(ZEN_SNAPSHOT_SETTING, this.current);
    this.update(zenLayout(this.current));
  }

  /**
   * Zen mode hides every chrome affordance (title bar, activity bar, side bar,
   * status bar), so it must offer its own always-visible way out — otherwise a
   * user who doesn't know the Ctrl/Cmd+K Z chord is trapped. A floating button
   * (outside the workbench so zen's `display:none` can't hide it) plus double-Esc
   * both restore the previous layout.
   */
  private zenExit: HTMLElement | null = null;
  private lastEsc = 0;

  private readonly onZenKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      this.lastEsc = 0;
      return;
    }
    if (event.timeStamp - this.lastEsc < 600) {
      this.lastEsc = 0;
      this.toggleZen();
    } else {
      this.lastEsc = event.timeStamp;
    }
  };

  private updateZenExit(): void {
    const active = isZen(this.current);
    if (active && !this.zenExit) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'znxstudio-zen-exit';
      button.textContent = '⤢ Exit Zen Mode';
      button.title = 'Exit Zen Mode (press Esc twice)';
      button.addEventListener('click', () => this.toggleZen());
      document.body.appendChild(button);
      this.zenExit = button;
      document.addEventListener('keydown', this.onZenKey, true);
      this.context.layout.showToast('Zen Mode — press Esc twice or click “Exit Zen Mode” to return.', 'info');
    } else if (!active && this.zenExit) {
      this.zenExit.remove();
      this.zenExit = null;
      this.lastEsc = 0;
      document.removeEventListener('keydown', this.onZenKey, true);
    }
  }

  private applyPanelPreferences(): void {
    const descriptors = this.context.layout.panelDescriptors();
    const strip = stripPanels(descriptors, this.panelPreferences);
    this.context.layout.applyPanelOrder(strip.map((panel) => panel.id));
    // Restore the last active tab if it's in the strip; else the first tab.
    const active = resolveActivePanel(strip, this.panelPreferences, this.panelPreferences.active ?? null);
    if (active) this.context.layout.showPanelView(active);
  }

  /** The searchable "+" overflow picker: open a panel that isn't currently a tab. */
  private openPanelPicker(): void {
    const descriptors = this.context.layout.panelDescriptors();
    const overflow = overflowPanels(descriptors, this.panelPreferences).map((panel) => ({ id: panel.id, title: panel.title }));
    this.pickAndOpenPanel(overflow);
  }

  /** Open ANY registered panel from a searchable picker (used by the View menu). */
  private openAnyPanel(): void {
    const items = this.context.layout.panelDescriptors().map((panel) => ({ id: panel.id, title: panel.title }));
    this.pickAndOpenPanel(items);
  }

  private pickAndOpenPanel(items: { id: string; title: string }[]): void {
    this.context.layout.openPanelPicker(items, (id) => {
      this.setPanelPreferences(setActivePanel(openPanel(this.panelPreferences, id), id));
      this.context.layout.showPanelView(id);
    });
  }

  /** Run a registered command by id, no-op if it isn't registered (module absent). */
  private runCommand(id: string, ...args: unknown[]): void {
    if (this.context.commands.has(id)) void this.context.commands.execute(id, ...args);
  }

  /** The File menu — VS Code-like: new, open, recent (submenu), save, close, settings, exit. */
  private buildFileMenu(): MenuEntry[] {
    // Opportunistically prune projects that were deleted/moved so the next open
    // is honest. (Fire-and-forget; the current submenu uses the last-clean list.)
    void this.pruneRecents();
    const cmd = (label: string, id: string): MenuEntry => ({ label, onClick: () => this.runCommand(id) });
    return [
      cmd('New Project…', CommandIds.WizardNewProject),
      { label: 'New Window', onClick: () => void window.znxstudio.app.newWindow() },
      { separator: true },
      { label: 'Open File…', onClick: () => void this.openFileFromDialog() },
      cmd('Open Folder…', CommandIds.WorkspaceOpenFolder),
      { label: 'Open Recent', submenu: () => this.recentSubmenu() },
      { separator: true },
      cmd('Save', CommandIds.FileSave),
      { label: 'Save All', onClick: () => void this.saveAllDocuments() },
      { separator: true },
      cmd('Close Editor', CommandIds.EditorClose),
      { separator: true },
      cmd('Preferences: Settings', CommandIds.SettingsOpen),
      { separator: true },
      { label: 'Exit', onClick: () => void window.znxstudio.window.close() },
    ];
  }

  /** The Edit menu — clipboard/history acting on the focused editor or input. */
  private buildEditMenu(): MenuEntry[] {
    const exec = (label: string, command: string): MenuEntry => ({
      label,
      onClick: () => {
        try {
          document.execCommand(command);
        } catch {
          /* not available for the focused element — Ctrl-shortcuts still work */
        }
      },
    });
    return [
      exec('Undo', 'undo'),
      exec('Redo', 'redo'),
      { separator: true },
      exec('Cut', 'cut'),
      exec('Copy', 'copy'),
      exec('Paste', 'paste'),
      { separator: true },
      exec('Select All', 'selectAll'),
      { separator: true },
      { label: 'Find in File', onClick: () => this.runCommand(CommandIds.QuickOpen) },
    ];
  }

  /** A command-backed menu item; a no-op (and harmless) if the command is unregistered. */
  private menuItem(label: string, id: string): MenuEntry {
    const keybindings = this.context.services.tryGet<KeybindingService>(ServiceKeys.Keybindings);
    return {
      label,
      shortcut: keybindings?.keysFor(id) ?? undefined,
      disabled: !this.context.commands.has(id) || !this.context.commands.isEnabled(id),
      onClick: () => this.runCommand(id),
    };
  }

  /** The Selection menu — multi-cursor and folding (Ctrl-A "Select All" lives in Edit). */
  private buildSelectionMenu(): MenuEntry[] {
    const m = (label: string, id: string) => this.menuItem(label, id);
    return [
      m('Add Cursor Above', CommandIds.MultiCursorAddAbove),
      m('Add Cursor Below', CommandIds.MultiCursorAddBelow),
      m('Add Next Occurrence', CommandIds.MultiCursorAddNext),
      m('Select All Occurrences', CommandIds.MultiCursorSelectAll),
      m('Add Cursors to Line Ends', CommandIds.MultiCursorPerLine),
      { separator: true },
      m('Clear Multiple Cursors', CommandIds.MultiCursorClear),
      { separator: true },
      m('Fold All', CommandIds.FoldAll),
      m('Fold at Cursor', CommandIds.FoldAtCursor),
    ];
  }

  /** The Go menu — navigation (Go to File / Everywhere / Find in Files). */
  private buildGoMenu(): MenuEntry[] {
    return [
      this.menuItem('Go to File…', CommandIds.QuickOpen),
      this.menuItem('Search Everywhere…', CommandIds.SearchEverywhere),
      { separator: true },
      this.menuItem('Find in Files', CommandIds.SearchShow),
    ];
  }

  /** The Run menu — run/debug/build, with Debug, Test and Performance as submenus. */
  private buildRunMenu(): MenuEntry[] {
    const m = (label: string, id: string) => this.menuItem(label, id);
    return [
      m('Start Debugging', CommandIds.DebugStart),
      m('Run Without Debugging', CommandIds.RunStart),
      m('Stop', CommandIds.DebugStop),
      { separator: true },
      m('Build', CommandIds.BuildStart),
      m('Rebuild', CommandIds.BuildRebuild),
      m('Run Script…', CommandIds.RunScript),
      { separator: true },
      {
        label: 'Debug',
        submenu: () => [
          m('Continue', CommandIds.DebugContinue),
          m('Step Over', CommandIds.DebugStepOver),
          m('Step Into', CommandIds.DebugStepIn),
          m('Step Out', CommandIds.DebugStepOut),
          m('Pause', CommandIds.DebugPause),
          { separator: true },
          m('Attach…', CommandIds.DebugAttach),
        ],
      },
      {
        label: 'Test',
        submenu: () => [
          m('Run All Tests', CommandIds.TestRunAll),
          m('Test Explorer', CommandIds.TestExplorerShow),
          m('Coverage', CommandIds.CoverageShow),
          m('Test Performance', CommandIds.TestPerfShow),
          m('Mocks', CommandIds.MockingShow),
          m('Continuous Testing', CommandIds.ContinuousShow),
        ],
      },
      {
        label: 'Performance',
        submenu: () => [
          m('Profiler', CommandIds.ViewProfiler),
          m('CPU', CommandIds.PerfCpuShow),
          m('Memory', CommandIds.PerfMemoryShow),
          m('Timeline', CommandIds.PerfTimelineShow),
          m('Hotspots', CommandIds.PerfHotspotsShow),
          m('Allocations', CommandIds.PerfAllocationsShow),
        ],
      },
    ];
  }

  /** The Terminal menu. */
  private buildTerminalMenu(): MenuEntry[] {
    const m = (label: string, id: string) => this.menuItem(label, id);
    return [
      m('New Terminal', CommandIds.TerminalNew),
      m('Split Terminal', CommandIds.TerminalSplit),
      { separator: true },
      m('Kill Terminal', CommandIds.TerminalKill),
      { separator: true },
      m('Toggle Terminal', CommandIds.TerminalToggle),
      m('Next Terminal', CommandIds.TerminalNext),
    ];
  }

  /** The Tools menu — advanced/ecosystem tooling that shouldn't compete at top level. */
  private buildToolsMenu(): MenuEntry[] {
    const m = (label: string, id: string) => this.menuItem(label, id);
    return [
      {
        label: 'Source Control',
        submenu: () => [
          m('Open Source Control', CommandIds.ScmShow),
          m('Commit…', CommandIds.ScmCommit),
          m('Stage All Changes', CommandIds.ScmStageAll),
          { separator: true },
          m('History', CommandIds.HistoryShow),
          m('Pull Requests', CommandIds.PrShow),
        ],
      },
      { separator: true },
      m('ORM Explorer', CommandIds.OrmExplorerShow),
      m('Remote Development', CommandIds.RemoteShow),
      m('Generate Dev Container', CommandIds.DevContainerGen),
    ];
  }

  /** The AI menu — one intentional surface for ZnxStudio's AI capabilities. */
  private buildAiMenu(): MenuEntry[] {
    const m = (label: string, id: string) => this.menuItem(label, id);
    return [
      m('Ask Znx', CommandIds.AiChatShow),
      m('New Chat', CommandIds.AiChatClear),
      { separator: true },
      m('Review Code', CommandIds.AiReview),
      m('Debug with AI', CommandIds.AiExplainError),
      m('Generate Tests', CommandIds.AiTestGen),
      m('Generate Documentation', CommandIds.AiDocFile),
      m('Document Symbol', CommandIds.AiDocSymbol),
      m('Analyze Architecture', CommandIds.AiArchitecture),
      m('Refactor with AI', CommandIds.AiRefactor),
      { separator: true },
      m('Configure AI…', CommandIds.AiConfigure),
    ];
  }

  /** The Help menu — version + docs. */
  private buildHelpMenu(): MenuEntry[] {
    return [
      { label: 'ZnxStudio Documentation', onClick: () => this.runCommand(CommandIds.DocsOpenWorkspaceReadme) },
      { separator: true },
      { label: 'About ZnxStudio', onClick: () => void this.showAbout() },
    ];
  }

  private recentWorkspaces(): string[] {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const value = settings?.get<string[]>('workbench.recentWorkspaces', []);
    return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : [];
  }

  /** File → Open Recent submenu: recently-opened folders + a clear action. */
  private recentSubmenu(): MenuEntry[] {
    const recent = this.recentWorkspaces();
    if (recent.length === 0) return [{ header: 'No recent projects' }];
    const entries: MenuEntry[] = formatRecentWorkspaces(recent, 12).map((entry) => ({
      label: entry.dir ? `${entry.name} — ${entry.dir}` : entry.name,
      onClick: () => this.runCommand(CommandIds.WorkspaceOpenFolder, entry.path),
    }));
    entries.push({ separator: true });
    entries.push({ label: 'Clear Recently Opened', onClick: () => this.clearRecents() });
    return entries;
  }

  private clearRecents(): void {
    this.context.services.tryGet<SettingsService>(ServiceKeys.Settings)?.set('workbench.recentWorkspaces', []);
  }

  /**
   * Drop recent projects whose folder was deleted or moved, so they stop
   * appearing in File → Open Recent. Checks each path's existence over IPC and
   * rewrites the stored list only when something actually changed.
   */
  private async pruneRecents(): Promise<void> {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    if (!settings) return;
    const list = this.recentWorkspaces();
    if (list.length === 0) return;
    const checks = await Promise.all(
      list.map(async (path) => [path, await window.znxstudio.fs.directoryExists(path)] as const),
    );
    const existing = new Set(checks.filter(([, ok]) => ok).map(([path]) => path));
    const pruned = pruneRecentWorkspaces(list, existing);
    if (pruned.length !== list.length) settings.set('workbench.recentWorkspaces', pruned);
  }

  private async openFileFromDialog(): Promise<void> {
    const path = await window.znxstudio.dialog.openFile();
    if (!path) return;
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    try {
      await editor?.openFile(path);
    } catch {
      this.context.layout.showToast('Could not open that file — open its folder first.', 'error');
    }
  }

  private async saveAllDocuments(): Promise<void> {
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    await documents?.saveAllDirty();
  }

  private async showAbout(): Promise<void> {
    let version = '';
    try {
      version = (await window.znxstudio.app.getInfo()).version;
    } catch {
      /* ignore */
    }
    this.context.layout.showToast(`ZnxStudio${version ? ` ${version}` : ''} — the enterprise IDE for Zornux & Zoijs.`, 'info');
  }

  /** The View menu (UX-3): appearance toggles, an Open Panel picker, and every workspace by group. */
  private buildViewMenu(): MenuEntry[] {
    const command = (label: string, id: string): MenuEntry => this.menuItem(label, id);
    const entries: MenuEntry[] = [
      { header: t('view.appearance') },
      command(t('view.toggleSideBar'), CommandIds.LayoutToggleSideBar),
      command(t('view.togglePanel'), CommandIds.LayoutTogglePanel),
      command(t('view.toggleActivityBar'), CommandIds.LayoutToggleActivityBar),
      command(t('view.toggleStatusBar'), CommandIds.LayoutToggleStatusBar),
      command(t('view.toggleZen'), CommandIds.LayoutToggleZen),
      { separator: true },
      { label: t('view.workspaces'), onClick: () => this.openWorkspacesMenu() },
      { label: t('view.panels'), onClick: () => this.openPanelsMenu() },
      { label: t('view.openPanel'), onClick: () => this.openAnyPanel() },
      command(t('view.managePanels'), CommandIds.LayoutPanelsShow),
      { separator: true },
      command(t('view.resetLayout'), CommandIds.LayoutReset),
    ];
    return entries;
  }

  /** View → Workspaces (SB-4): pick a purpose-built environment. */
  private openWorkspacesMenu(): void {
    const rect = this.context.layout.menuBarRect();
    this.context.layout.openFloatingMenu(rect.left, rect.bottom + 2, () => {
      const entries: MenuEntry[] = [{ header: t('view.workspaces') }];
      for (const workspace of WORKSPACES) {
        entries.push({ label: workspace.label, onClick: () => this.activateWorkspace(workspace) });
      }
      return entries;
    });
  }

  /**
   * Activate a workspace (SB-4): reveal its primary view, open the panels that
   * matter for the task, and focus the most relevant one. Opening is additive and
   * ignores panels that aren't registered, so it can never break the layout.
   */
  private activateWorkspace(def: WorkspaceDef): void {
    // selectActivityById swaps the sidebar (which clears any prior toolbar), so
    // the workspace toolbar is set AFTER, not before.
    if (def.activity) this.context.layout.selectActivityById(def.activity);
    this.context.layout.setSideBarToolbar(
      (def.toolbar ?? []).map((action) => ({
        icon: action.icon,
        label: action.label,
        onClick: () => {
          if (this.context.commands.has(action.command)) void this.context.commands.execute(action.command);
        },
      })),
    );

    let prefs = this.panelPreferences;
    for (const id of def.panels) prefs = openPanel(prefs, id);
    if (def.focus) prefs = setActivePanel(prefs, def.focus);
    this.setPanelPreferences(prefs);

    // Reveal + focus the workspace's key panel (only if it actually registered).
    if (def.focus && this.context.layout.panelDescriptors().some((panel) => panel.id === def.focus)) {
      this.context.layout.showPanelView(def.focus);
    }
  }

  /** SB-7: a palette-searchable "Show Panel: <title>" command for one panel. */
  private registerPanelCommand(id: string): void {
    if (id.startsWith('selftest-')) return; // internal probes only
    const commandId = `znxstudio.panel.show.${id}`;
    if (this.context.commands.has(commandId)) return;
    const title = this.context.layout.panelDescriptors().find((panel) => panel.id === id)?.title ?? id;
    this.context.commands.register(
      commandId,
      () => {
        this.setPanelPreferences(setActivePanel(openPanel(this.panelPreferences, id), id));
        this.context.layout.showPanelView(id);
      },
      `Show Panel: ${title}`,
    );
  }

  /** View → Panels (SB-3): a checkable menu that toggles every panel on/off. */
  private openPanelsMenu(): void {
    const rect = this.context.layout.menuBarRect();
    this.context.layout.openFloatingMenu(rect.left, rect.bottom + 2, () => this.buildPanelsMenu());
  }

  private buildPanelsMenu(): MenuEntry[] {
    const descriptors = this.context.layout.panelDescriptors();
    const entries: MenuEntry[] = [{ header: t('view.panels') }];
    for (const panel of descriptors) {
      entries.push({
        label: panel.title,
        checked: inStrip(this.panelPreferences, panel.id),
        onToggle: () => {
          const shown = inStrip(this.panelPreferences, panel.id);
          this.setPanelPreferences(
            shown ? closePanel(this.panelPreferences, panel.id) : openPanel(this.panelPreferences, panel.id),
          );
          if (!shown) this.context.layout.showPanelView(panel.id);
        },
      });
    }
    return entries;
  }

  /**
   * Manage Panels (UX): a compact, centered overlay — panels grouped into
   * collapsible categories, each row a modern toggle with a drag handle to
   * reorder, enabled rows highlighted. Replaces the full-width raw checkbox list.
   */
  private showPanelManager(): void {
    const collapsed = new Set<string>();

    const backdrop = document.createElement('div');
    backdrop.className = 'znxstudio-pm-backdrop';
    const card = document.createElement('div');
    card.className = 'znxstudio-pm-card';
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'Manage Panels');
    backdrop.appendChild(card);

    const dismiss = (): void => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss();
    };
    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) dismiss();
    });

    const makeRow = (panel: { id: string; title: string }, orderedIds: string[]): HTMLElement => {
      const enabled = inStrip(this.panelPreferences, panel.id);
      const row = document.createElement('div');
      row.className = `znxstudio-pm-row${enabled ? ' is-enabled' : ''}`;
      row.draggable = true;

      const handle = document.createElement('span');
      handle.className = 'znxstudio-pm-handle';
      handle.textContent = '⋮⋮';
      handle.title = 'Drag to reorder';

      const label = document.createElement('span');
      label.className = 'znxstudio-pm-label';
      label.textContent = panel.title;

      const toggle = document.createElement('button');
      toggle.className = 'znxstudio-pm-switch';
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-checked', enabled ? 'true' : 'false');
      toggle.setAttribute('aria-label', `Toggle ${panel.title}`);

      const flip = (): void => {
        this.setPanelPreferences(
          enabled ? closePanel(this.panelPreferences, panel.id) : openPanel(this.panelPreferences, panel.id),
        );
        if (!enabled) this.context.layout.showPanelView(panel.id);
        render();
      };
      toggle.addEventListener('click', flip);
      label.addEventListener('click', flip);

      row.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('text/plain', panel.id);
        row.classList.add('is-dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', (event) => {
        event.preventDefault();
        row.classList.add('is-drop-target');
      });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        const dragged = event.dataTransfer?.getData('text/plain');
        if (dragged && dragged !== panel.id) {
          const ids = orderedIds.filter((id) => id !== dragged);
          ids.splice(Math.max(0, ids.indexOf(panel.id)), 0, dragged);
          this.setPanelPreferences({ ...this.panelPreferences, order: ids });
          render();
        }
      });

      row.append(handle, label, toggle);
      return row;
    };

    const render = (): void => {
      card.replaceChildren();

      const header = document.createElement('div');
      header.className = 'znxstudio-pm-header';
      const title = document.createElement('span');
      title.className = 'znxstudio-pm-title';
      title.textContent = 'Manage Panels';
      const close = document.createElement('button');
      close.className = 'znxstudio-pm-close';
      close.textContent = '×';
      close.title = 'Close';
      close.addEventListener('click', dismiss);
      header.append(title, close);
      card.appendChild(header);

      const body = document.createElement('div');
      body.className = 'znxstudio-pm-body';

      const ordered = orderedDescriptors(this.context, this.panelPreferences);
      const orderedIds = ordered.map((panel) => panel.id);
      const buckets = new Map<string, { id: string; title: string }[]>();
      for (const name of [...PANEL_CATEGORIES.map((category) => category.name), 'Other']) buckets.set(name, []);
      for (const panel of ordered) buckets.get(categorizePanel(panel.title))?.push(panel);

      for (const [name, panels] of buckets) {
        if (!panels.length) continue;
        const isCollapsed = collapsed.has(name);
        const section = document.createElement('div');
        section.className = 'znxstudio-pm-section';

        const sectionHeader = document.createElement('button');
        sectionHeader.className = 'znxstudio-pm-section-header';
        sectionHeader.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        const enabledCount = panels.filter((panel) => inStrip(this.panelPreferences, panel.id)).length;
        sectionHeader.innerHTML =
          `<span class="znxstudio-pm-caret">${isCollapsed ? '▸' : '▾'}</span>` +
          `<span class="znxstudio-pm-section-name">${name}</span>` +
          `<span class="znxstudio-pm-count">${enabledCount}/${panels.length}</span>`;
        sectionHeader.addEventListener('click', () => {
          if (isCollapsed) collapsed.delete(name);
          else collapsed.add(name);
          render();
        });
        section.appendChild(sectionHeader);

        if (!isCollapsed) for (const panel of panels) section.appendChild(makeRow(panel, orderedIds));
        body.appendChild(section);
      }
      card.appendChild(body);

      const footer = document.createElement('div');
      footer.className = 'znxstudio-pm-footer';
      const reset = document.createElement('button');
      reset.className = 'znxstudio-pm-reset';
      reset.textContent = '⟲ Reset to defaults';
      reset.addEventListener('click', () => {
        this.setPanelPreferences(resetPanelPreferences());
        render();
      });
      footer.appendChild(reset);
      card.appendChild(footer);
    };

    render();
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
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

    const root = document.querySelector<HTMLElement>('.znxstudio-workbench');
    const classesOf = () => (root ? [...root.classList].filter((c) => c !== 'znxstudio-workbench').sort().join(' ') : 'no root');

    const before = this.current;
    this.update(moveSideBar(this.current, 'right'));
    log(`layout REAL DOM: sidebar right → classes=[${classesOf()}]`);

    this.update(movePanel(this.current, 'right'));
    log(`layout REAL DOM: panel right → classes=[${classesOf()}]`);

    this.update(resizeSideBar(this.current, 99999));
    const width = root ? getComputedStyle(root).getPropertyValue('--znxstudio-sidebar-width').trim() : '?';
    log(`layout REAL DOM: sidebar clamped to ${this.current.sidebar.width}px (max ${LAYOUT_LIMITS.sidebarWidth.max}) css=${width}`);

    this.toggleZen();
    log(`layout REAL DOM: zen=${isZen(this.current)} classes=[${classesOf()}]`);
    this.toggleZen();
    log(`layout REAL DOM: leaving zen restored sidebar.side=${this.current.sidebar.side} width=${this.current.sidebar.width}`);

    // The self-test holds the self-test slot, and the modules that contribute
    // panels activate behind it — so register two throwaway panels here and
    // exercise the real tab strip (UX-2 container) against them.
    this.context.layout.addPanelView({ id: 'selftest-a', title: 'A', element: document.createElement('div') });
    this.context.layout.addPanelView({ id: 'selftest-b', title: 'B', element: document.createElement('div') });
    const panels = this.context.layout.panelDescriptors();
    log(`layout panels registered: ${panels.length} [${panels.map((p) => p.id).join(', ')}]`);

    // UX-2: non-default panels start in the "+" overflow — the strip stays curated.
    const stripDefault = document.querySelectorAll('.znxstudio-panel-tab:not(.is-hidden)').length;
    const hasOverflowButton = Boolean(document.querySelector('.znxstudio-panel-overflow'));
    log(`bottompanel REAL DOM: default strip tabs=${stripDefault} of ${panels.length} registered, overflow "+"=${hasOverflowButton} (the long tail is in the overflow)`);

    // Open one from the overflow → it becomes a tab; close it → back to overflow.
    this.setPanelPreferences(openPanel(this.panelPreferences, 'selftest-a'));
    const afterOpen = document.querySelectorAll('.znxstudio-panel-tab:not(.is-hidden)').length;
    this.setPanelPreferences(closePanel(this.panelPreferences, 'selftest-a'));
    const afterClose = document.querySelectorAll('.znxstudio-panel-tab:not(.is-hidden)').length;
    log(`bottompanel REAL DOM: open "A" → tabs=${afterOpen}, close "A" → tabs=${afterClose} (open/close moves it between strip and overflow)`);

    // Revealing an overflow panel via showPanelView must OPEN it (Run → Output):
    // put 'selftest-a' back in overflow, then show it and confirm it becomes the
    // active, VISIBLE tab instead of flashing and reverting to another panel.
    this.setPanelPreferences(closePanel(this.panelPreferences, 'selftest-a'));
    this.context.layout.showPanelView('selftest-a');
    const activeVisibleTab = Boolean(document.querySelector('.znxstudio-panel-tab.is-active:not(.is-hidden)'));
    log(
      `bottompanel reveal REAL: showPanelView(overflow) → active=${this.panelPreferences.active} ` +
        `activeVisibleTab=${activeVisibleTab} (reveal opens the panel; no flash-and-revert)`,
    );

    this.setPanelPreferences(resetPanelPreferences());

    // UX-1: Activity Bar curation. The self-test runs mid-activation, so fill in
    // any of the five defaults whose module hasn't registered yet (without
    // clobbering ones that have), plus a non-default item that must land in the
    // grouped "More" overflow. Result: exactly the defaults pin, the rest group.
    const already = new Set(this.context.layout.activityItemsList().map((item) => item.id));
    for (const id of ['explorer', 'search', 'scm', 'run-debug', 'extensions']) {
      if (!already.has(id)) this.context.layout.addActivityItem({ id, label: id, icon: '•', onSelect: () => {} });
    }
    this.context.layout.addActivityItem({ id: 'selftest-ws', label: 'Self Test WS', icon: '★', onSelect: () => {} });
    const pinnedButtons = document.querySelectorAll('.znxstudio-activitybar .znxstudio-activity-item:not(.znxstudio-activity-more)').length;
    const more = document.querySelector('.znxstudio-activitybar .znxstudio-activity-more') as HTMLElement | null;
    more?.click();
    const menu = document.querySelector('.znxstudio-menu');
    const groups = menu ? menu.querySelectorAll('.znxstudio-menu-header').length : 0;
    log(
      `activitybar REAL DOM: pinned=${pinnedButtons} (expect 5 defaults) more=${Boolean(more)} overflowMenu=${Boolean(menu)} groups=${groups} ` +
        `(non-default items grouped into the overflow)`,
    );
    more?.click(); // close the overflow menu

    // UX-3: the View menu — a central launcher in the title-bar menu bar.
    const viewButton = [...document.querySelectorAll('.znxstudio-menubar-item')].find((b) => b.textContent === 'View') as
      | HTMLElement
      | undefined;
    viewButton?.click();
    const viewMenu = document.querySelector('.znxstudio-menu');
    const viewItems = viewMenu ? viewMenu.querySelectorAll('.znxstudio-menu-item').length : 0;
    const viewHeaders = viewMenu ? viewMenu.querySelectorAll('.znxstudio-menu-header').length : 0;
    log(`viewmenu REAL DOM: button=${Boolean(viewButton)} open=${Boolean(viewMenu)} items=${viewItems} headers=${viewHeaders} (launcher for panels + workspaces)`);
    viewButton?.click(); // close

    // File menu: "Open Recent" is a nested submenu (VS Code-style ›). Seed a
    // recent so the submenu has a real item, open File, then the parent.
    this.context.services.tryGet<SettingsService>(ServiceKeys.Settings)?.set('workbench.recentWorkspaces', ['C:\\proj\\demo']);
    const fileButton = [...document.querySelectorAll('.znxstudio-menubar-item')].find((b) => b.textContent === 'File') as
      | HTMLElement
      | undefined;
    fileButton?.click();
    const parentItem = [...document.querySelectorAll('.znxstudio-menu .znxstudio-menu-parent')].find(
      (b) => b.textContent?.startsWith('Open Recent'),
    ) as HTMLElement | undefined;
    const hasPopup = parentItem?.getAttribute('aria-haspopup') === 'true';
    const hasChevron = Boolean(parentItem?.querySelector('.znxstudio-menu-chevron'));
    parentItem?.click(); // open the submenu
    const submenu = document.querySelector('.znxstudio-submenu');
    const submenuItems = submenu ? submenu.querySelectorAll('.znxstudio-menu-item').length : 0;
    const expanded = parentItem?.getAttribute('aria-expanded') === 'true';
    log(
      `filemenu submenu REAL DOM: parent=${Boolean(parentItem)} haspopup=${hasPopup} chevron=${hasChevron} ` +
        `opened=${Boolean(submenu)} items=${submenuItems} expanded=${expanded} (Open Recent › flyout)`,
    );
    fileButton?.click(); // close the File menu (and its submenu)
    document.body.click();

    // SB-3: View → Panels is a checkable menu that toggles every panel.
    viewButton?.click();
    const panelsItem = [...document.querySelectorAll('.znxstudio-menu .znxstudio-menu-item')].find(
      (b) => b.textContent === 'Panels',
    ) as HTMLElement | undefined;
    panelsItem?.click(); // opens the checkable panels menu
    const checks = [...document.querySelectorAll('.znxstudio-menu .znxstudio-menu-check')];
    let toggled = 'n/a';
    if (checks.length) {
      const first = checks[0] as HTMLElement;
      const before = first.getAttribute('aria-checked');
      first.click(); // toggle; the menu stays open and re-renders
      const after = (document.querySelectorAll('.znxstudio-menu .znxstudio-menu-check')[0] as HTMLElement)?.getAttribute('aria-checked');
      toggled = `${before}→${after}`;
    }
    log(`panelsmenu REAL DOM: checkItems=${checks.length} firstToggle=${toggled} (checkable View → Panels)`);
    document.body.click(); // dismiss the floating panels menu

    // SB-4: workspaces are registered as commands and set up their environment.
    const wsCommands = WORKSPACES.filter((w) => this.context.commands.has(workspaceCommandId(w.id))).length;
    const code = WORKSPACES.find((w) => w.id === 'code')!;
    this.activateWorkspace(code);
    const opened = this.panelPreferences.opened ?? [];
    const codeOpened = code.panels.every((id) => opened.includes(id));
    // SB-6: activating a workspace with a toolbar renders it in the sidebar header.
    this.activateWorkspace(WORKSPACES.find((w) => w.id === 'ai')!);
    const toolbarButtons = document.querySelectorAll('.znxstudio-sidebar-toolbar .znxstudio-sidebar-tool').length;
    log(
      `workspaces REAL: commands=${wsCommands}/${WORKSPACES.length} activate(code)→panelsOpened=${codeOpened} active=${this.panelPreferences.active} ` +
        `aiToolbarButtons=${toolbarButtons}`,
    );

    // 20B: i18n — switching to the pseudo-locale re-localizes the rebuilt View menu.
    const prevLocale = i18n.getLocale();
    i18n.setLocale('pseudo');
    viewButton?.click(); // reopen the View menu — its builder pulls strings through t()
    const firstItem = document.querySelector('.znxstudio-menu .znxstudio-menu-item')?.textContent ?? '';
    const externalized = firstItem.startsWith('⟦');
    viewButton?.click();
    i18n.setLocale(prevLocale);
    log(`i18n REAL DOM: locales=[${i18n.locales().join(',')}] pseudoViewItem="${firstItem}" externalized=${externalized}`);

    // UX-7: accessibility landmarks + tab roles + reduced-motion hook.
    const role = (selector: string) => document.querySelector(selector)?.getAttribute('role') ?? 'none';
    const activityTabs = document.querySelectorAll('.znxstudio-activitybar [role="tab"]').length;
    const labelledActivity = document.querySelectorAll('.znxstudio-activitybar [role="tab"][aria-label]').length;
    const motion = document.querySelector('.znxstudio-workbench')?.getAttribute('data-motion');
    log(
      `a11y REAL DOM: activitybar=${role('.znxstudio-activitybar')} panelTabs=${role('.znxstudio-panel-tabs')} ` +
        `main=${role('.znxstudio-editor-region')} status=${role('.znxstudio-statusbar')} toasts=${role('.znxstudio-toasts')} ` +
        `menubar=${role('.znxstudio-menubar')} activityTabRoles=${activityTabs} labelled=${labelledActivity} motion=${motion}`,
    );

    // 17C: the real BrowserWindow, through the main process.
    try {
      const initial = await window.znxstudio.window.getState();
      const entered = await window.znxstudio.window.setFullScreen(true);
      const left = await window.znxstudio.window.setFullScreen(initial.fullScreen);
      log(
        `window REAL fullscreen: ${initial.fullScreen} → ${entered.fullScreen} → ${left.fullScreen} ` +
          `(a real BrowserWindow, not a CSS class)`,
      );
      const maximized = await window.znxstudio.window.toggleMaximize();
      await window.znxstudio.window.toggleMaximize();
      log(`window REAL maximize: toggled to ${maximized.maximized} and back`);
    } catch (error) {
      log(`window REAL failed: ${(error as Error).message}`);
    }

    this.update(before);
    log(`layout restored: ${layoutsEqual(this.current, before)}`);
  }
}

/**
 * Panel categories for the Manage Panels view, in display order. Matched by panel
 * title (case-insensitive substring), so it's robust to internal id naming. The
 * first matching category wins; anything unmatched falls into "Other".
 */
const PANEL_CATEGORIES: { name: string; keywords: string[] }[] = [
  { name: 'AI Tools', keywords: ['ai '] },
  { name: 'Testing & Quality', keywords: ['test', 'coverage', 'mock', 'continuous'] },
  { name: 'Performance & Profiling', keywords: ['metric', 'profiler', 'cpu', 'memory', 'timeline', 'hotspot', 'allocation'] },
  { name: 'Database / Backend', keywords: ['query', 'migration', 'data', 'orm'] },
  { name: 'Security & Insights', keywords: ['secret', 'security', 'dependenc'] },
  { name: 'Core / Workspace', keywords: ['log', 'task', 'todo', 'history', 'remote', 'terminal', 'output', 'problem', 'debug', 'diagnostic', 'pull request', 'search'] },
];

function categorizePanel(title: string): string {
  const needle = ` ${title.toLowerCase()} `;
  for (const category of PANEL_CATEGORIES) {
    if (category.keywords.some((keyword) => needle.includes(keyword))) return category.name;
  }
  return 'Other';
}

function orderedDescriptors(context: ModuleContext, preferences: PanelPreferences) {
  const descriptors = context.layout.panelDescriptors();
  const byId = new Map(descriptors.map((panel) => [panel.id, panel]));
  const ordered = preferences.order.map((id) => byId.get(id)).filter((panel): panel is NonNullable<typeof panel> => Boolean(panel));
  const rest = descriptors.filter((panel) => !preferences.order.includes(panel.id));
  return [...ordered, ...rest];
}
