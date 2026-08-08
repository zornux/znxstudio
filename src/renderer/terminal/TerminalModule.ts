import '@xterm/xterm/css/xterm.css';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ServiceKeys, type QuickPickService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { Disposable } from '../core/Module';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { resizeSplit } from './split';
import type { ShellProfile, Unsubscribe } from '../../shared/types';

/** One terminal: an xterm instance bound to a main-process PTY. */
interface TerminalPane {
  id: string;
  term: Terminal;
  fit: FitAddon;
  el: HTMLElement;
  inputDisposable: Disposable | null;
  unData: Unsubscribe | null;
  unExit: Unsubscribe | null;
  exited: boolean;
  /** Which shell this pane launched — persisted so layouts restore the same shells. */
  shellId?: string;
  /** Relative size within its split (flex-grow weight); the divider adjusts it. */
  flexGrow: number;
}

/** A tab: one or more panes split side by side or stacked, sharing a label. */
interface TerminalGroup {
  id: string;
  label: string;
  container: HTMLElement;
  panes: TerminalPane[];
  activePaneId: string | null;
  /** `horizontal` = panes side by side; `vertical` = panes stacked top/bottom. */
  orientation: 'horizontal' | 'vertical';
}

type SplitDirection = 'horizontal' | 'vertical';

/** localStorage key holding the persisted terminal layout. */
const LAYOUT_KEY = 'znxstudio.terminal.layout';

/** Persisted shape of a pane: which shell and its relative size. */
interface SavedPane {
  shellId?: string;
  flexGrow: number;
}
/** Persisted shape of a tab: label, split orientation, and its panes. */
interface SavedGroup {
  label: string;
  orientation: SplitDirection;
  panes: SavedPane[];
}
/** The whole terminal layout persisted across restarts (structure, not sessions). */
interface SavedLayout {
  groups: SavedGroup[];
  activeIndex: number;
}

/** Minimal view-model the tab strip renders from (decoupled from xterm). */
interface TabMeta {
  id: string;
  label: string;
  exited: boolean;
}

/**
 * Integrated terminal. Hosts any number of tabs — like VS Code — each a group of
 * one or more side-by-side panes, and each pane a native PTY in the main process.
 * The user picks which installed shell to launch (bash, PowerShell, cmd, Git
 * Bash, …), can split a tab into panes, rename tabs, and manage them from a
 * right-click menu. The session cwd tracks the workspace root at spawn time.
 */
export class TerminalModule implements IModule {
  readonly id = 'znxstudio.terminal';
  readonly displayName = 'Integrated Terminal';

  private context!: ModuleContext;
  private status: StatusService | undefined;
  private workspace: WorkspaceService | undefined;
  private quickPick: QuickPickService | undefined;
  private container!: HTMLElement;
  private tabStrip!: HTMLElement;
  private body!: HTMLElement;

  private readonly groups: TerminalGroup[] = [];
  private activeGroupId: string | null = null;
  /** Tab whose name is being edited inline (double-click to rename), if any. */
  private editingId: string | null = null;
  private counter = 0;
  private groupCounter = 0;
  private cwd: string | undefined;
  private shells: ShellProfile[] = [];
  private observer: ResizeObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private available = true;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private pendingInitialCwd: string | undefined;
  /** True while restoring a persisted layout, so intermediate steps don't save. */
  private restoring = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    this.quickPick = context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);

    this.container = document.createElement('div');
    this.container.className = 'znxstudio-terminal';
    this.tabStrip = document.createElement('div');
    this.tabStrip.className = 'znxstudio-term-tabs';
    this.body = document.createElement('div');
    this.body.className = 'znxstudio-term-body';
    this.container.append(this.tabStrip, this.body);

    context.layout.addPanelView({ id: 'terminal', title: 'Terminal', element: this.container });
    // Registering contributes Terminal to the searchable panel catalog only.
    // A shell is created lazily after the user explicitly reveals the panel.
    context.layout.onDidChangeActivePanel((id) => {
      if (id === 'terminal') void this.ensureInitialized();
    });

    context.commands.register(
      CommandIds.TerminalToggle,
      () => this.revealTerminal(),
      'Terminal: Toggle',
    );
    context.commands.register(CommandIds.TerminalNew, () => void this.requestNewTerminal(), 'Terminal: New Terminal');
    context.commands.register(
      CommandIds.TerminalNewProfile,
      () => void this.revealAndPickShell(),
      'Terminal: New Terminal (Select Shell)…',
    );
    context.commands.register(
      CommandIds.TerminalNewAt,
      (cwd?: string) => {
        void this.newTerminalAt(typeof cwd === 'string' ? cwd : undefined);
      },
      'Terminal: New Terminal Here',
    );
    context.commands.register(CommandIds.TerminalSplit, () => void this.splitActive('horizontal'), 'Terminal: Split Terminal Right');
    context.commands.register(CommandIds.TerminalSplitDown, () => void this.splitActive('vertical'), 'Terminal: Split Terminal Down');
    context.commands.register(CommandIds.TerminalKill, () => this.closeGroup(this.activeGroupId), 'Terminal: Kill Active Terminal');
    context.commands.register(CommandIds.TerminalKillOthers, () => this.killOthers(this.activeGroupId), 'Terminal: Kill Other Terminals');
    context.commands.register(CommandIds.TerminalNext, () => this.cycleTab(), 'Terminal: Focus Next Terminal');

    this.cwd = this.workspace?.currentFolder() ?? undefined;
    // New terminals adopt the latest workspace root; existing ones keep running.
    this.workspace?.onDidChangeWorkspace((info) => (this.cwd = info?.root ?? undefined));

    this.observer = new ResizeObserver(() => this.syncActiveSizes());
    this.observer.observe(this.body);
    this.themeObserver = new MutationObserver(() => this.applyTerminalTheme());
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    void selfTestCoordinator.run('terminal', () => this.maybeSelfTest());
  }

  private ensureInitialized(): Promise<void> {
    if (this.initialized) return Promise.resolve();
    if (!this.initPromise) {
      this.initPromise = this.init().then(() => {
        this.initialized = true;
      });
    }
    return this.initPromise;
  }

  private revealTerminal(): void {
    this.context.layout.showPanelView('terminal');
  }

  private async requestNewTerminal(): Promise<void> {
    const alreadyInitialized = this.initialized;
    this.revealTerminal();
    await this.ensureInitialized();
    if (alreadyInitialized) await this.newTerminal();
  }

  private async revealAndPickShell(): Promise<void> {
    this.revealTerminal();
    await this.ensureInitialized();
    await this.pickShell();
  }

  private async newTerminalAt(cwd?: string): Promise<void> {
    const alreadyInitialized = this.initialized;
    if (!alreadyInitialized && !this.initPromise) this.pendingInitialCwd = cwd;
    this.revealTerminal();
    await this.ensureInitialized();
    if (alreadyInitialized) await this.newTerminal(undefined, cwd);
  }

  deactivate(): void {
    this.observer?.disconnect();
    this.themeObserver?.disconnect();
  }

  /**
   * Discover shells, then restore the persisted layout (tabs, splits, sizes,
   * shells) — or open a single default terminal on a first run. The shell
   * *processes* are not restored (they die with the app); only the structure is.
   */
  private async init(): Promise<void> {
    try {
      this.shells = await window.znxstudio.terminal.shells();
    } catch {
      this.shells = [];
    }
    this.renderTabStrip();
    // Let the workspace root resolve first, so the initial terminal opens in the project
    // folder (like VS Code) rather than $HOME — a pty can't be re-homed once spawned.
    await this.ensureWorkspaceReady();
    const saved = this.loadLayout();
    if (saved && saved.groups.length > 0) {
      await this.restoreLayout(saved);
    } else {
      await this.newTerminal(undefined, this.pendingInitialCwd);
    }
    this.pendingInitialCwd = undefined;
  }

  /** Recreate tabs/panes from a persisted layout with fresh shell sessions. */
  private async restoreLayout(saved: SavedLayout): Promise<void> {
    this.restoring = true;
    try {
      for (const savedGroup of saved.groups) {
        const container = document.createElement('div');
        container.className = 'znxstudio-term-group';
        this.body.appendChild(container);
        const group: TerminalGroup = {
          id: `group-${++this.groupCounter}`,
          label: savedGroup.label,
          container,
          panes: [],
          activePaneId: null,
          orientation: savedGroup.orientation === 'vertical' ? 'vertical' : 'horizontal',
        };
        this.groups.push(group);
        this.setActiveGroup(group.id); // make the container visible so panes fit
        const panes = savedGroup.panes.length > 0 ? savedGroup.panes : [{ flexGrow: 1 }];
        for (const savedPane of panes) {
          await this.spawnPane(group, savedPane.shellId);
          const pane = group.panes[group.panes.length - 1];
          pane.flexGrow = savedPane.flexGrow > 0 ? savedPane.flexGrow : 1;
        }
        this.layoutGroup(group);
      }
      const index = Math.min(Math.max(0, saved.activeIndex), this.groups.length - 1);
      this.setActiveGroup(this.groups[index]?.id ?? null);
    } finally {
      this.restoring = false;
    }
    this.renderTabStrip();
    this.saveLayout();
  }

  private shellLabel(shellId?: string): string {
    return this.shells.find((s) => s.id === shellId)?.label ?? this.shells[0]?.label ?? 'Terminal';
  }

  /** Open a new tab (group) with a single pane. `shellId` → the chosen shell; `cwd` overrides the workspace root. */
  private async newTerminal(shellId?: string, cwd?: string): Promise<void> {
    if (!this.available && this.groups.length > 0) return;

    const container = document.createElement('div');
    container.className = 'znxstudio-term-group';
    this.body.appendChild(container);
    const group: TerminalGroup = {
      id: `group-${++this.groupCounter}`,
      label: this.shellLabel(shellId),
      container,
      panes: [],
      activePaneId: null,
      orientation: 'horizontal',
    };
    this.groups.push(group);
    this.setActiveGroup(group.id);
    await this.spawnPane(group, shellId, cwd);
    this.renderTabStrip();
    this.saveLayout();
  }

  /**
   * Split the active tab: add a pane beside (`horizontal`) or below (`vertical`)
   * the current ones. Splitting sets the whole tab's orientation, so a tab's
   * panes are all in one direction.
   */
  private async splitActive(direction: SplitDirection = 'horizontal'): Promise<void> {
    const group = this.activeGroup();
    if (!group) {
      await this.newTerminal();
      return;
    }
    group.orientation = direction;
    await this.spawnPane(group);
    this.layoutGroup(group);
    this.renderTabStrip();
    this.saveLayout();
  }

  /** Create a pane inside `group`, wire it to a PTY, and make it the active pane. */
  /**
   * The folder a new terminal should open in — the Explorer's primary (workspace) root,
   * resolved LIVE at spawn time. Resolving lazily (rather than trusting a value cached at
   * activate) keeps the terminal aligned with the Explorer even when the Workspace service
   * registered after this module activated, so `cd`-ing into the project's subfolders works
   * the way it does in VS Code. Falls back to the cached root, then the shell default.
   */
  private explorerRoot(): string | undefined {
    if (!this.workspace) this.workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    return this.workspace?.currentFolder() ?? this.cwd;
  }

  /**
   * Wait (briefly) for the Workspace service to resolve its primary root before the FIRST
   * terminal spawns, so it opens in the project folder instead of $HOME. The workspace
   * restores asynchronously at startup and can settle after this module activates, and a
   * pty's cwd can't change once spawned — so racing it would strand the terminal in $HOME.
   * Resolves immediately once a root is known; a short timeout keeps a no-folder startup from
   * stalling (the terminal then opens in the shell's default dir).
   */
  private async ensureWorkspaceReady(timeoutMs = 2500): Promise<void> {
    // The Workspace SERVICE itself registers during startup — often AFTER this module
    // activates and runs init() — so we can't just wait on its change event (there'd be
    // nothing to subscribe to yet). Poll for the service to appear and then resolve a
    // primary root. Resolves the instant a root is known; the timeout keeps a no-folder
    // startup from stalling (the terminal then opens in the shell's default dir).
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      if (!this.workspace) this.workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
      if (this.workspace?.currentFolder()) return;
      if (Date.now() >= deadline) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  private async spawnPane(group: TerminalGroup, shellId?: string, cwd?: string): Promise<void> {
    const term = new Terminal({
      fontSize: 14,
      lineHeight: 1.2,
      fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
      cursorBlink: true,
      theme: this.terminalTheme(),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);

    const el = document.createElement('div');
    el.className = 'znxstudio-term-pane';
    group.container.appendChild(el);
    term.open(el);

    const id = `term-${++this.counter}`;
    const pane: TerminalPane = {
      id,
      term,
      fit,
      el,
      inputDisposable: term.onData((data) => window.znxstudio.terminal.input(id, data)),
      unData: window.znxstudio.terminal.onData((event) => {
        if (event.id === id) term.write(event.data);
      }),
      unExit: window.znxstudio.terminal.onExit((event) => {
        if (event.id === id) this.onExit(group, id);
      }),
      exited: false,
      shellId,
      flexGrow: 1,
    };
    // Clicking a pane focuses it and makes it the group's active pane.
    el.addEventListener('mousedown', () => this.setActivePane(group, id));
    group.panes.push(pane);
    this.layoutGroup(group);
    this.setActivePane(group, id);

    try {
      fit.fit();
      await window.znxstudio.terminal.create({ id, cwd: cwd ?? this.explorerRoot(), cols: term.cols, rows: term.rows, shellId });
      this.available = true;
      this.setStatus(`⌂ Terminal: ${this.groups.length}`, 'Integrated terminal is running');
    } catch {
      this.available = false;
      term.write('\r\n\x1b[31mIntegrated terminal unavailable.\x1b[0m ');
      term.write('The native PTY module failed to load on this platform.\r\n');
      this.setStatus('⌂ Terminal: off', 'Native PTY module unavailable');
    }
  }

  private onExit(group: TerminalGroup, paneId: string): void {
    const pane = group.panes.find((p) => p.id === paneId);
    if (!pane || pane.exited) return;
    pane.exited = true;
    pane.term.write('\r\n\x1b[90m[process exited]\x1b[0m\r\n');
    this.renderTabStrip();
  }

  private activeGroup(): TerminalGroup | undefined {
    return this.groups.find((g) => g.id === this.activeGroupId);
  }

  /** A group is "exited" (struck through) only once all its panes have exited. */
  private groupExited(group: TerminalGroup): boolean {
    return group.panes.length > 0 && group.panes.every((p) => p.exited);
  }

  /**
   * Lay out a group's panes: apply each pane's flex-grow weight and interleave a
   * draggable divider between adjacent panes. Rebuilt on every change; the pane
   * elements (with their live xterm) are re-parented, not recreated.
   */
  private layoutGroup(group: TerminalGroup): void {
    group.container.classList.toggle('is-split', group.panes.length > 1);
    group.container.classList.toggle('is-vertical', group.orientation === 'vertical');

    const children: HTMLElement[] = [];
    group.panes.forEach((pane, index) => {
      pane.el.style.flexGrow = String(pane.flexGrow);
      pane.el.style.flexBasis = '0';
      children.push(pane.el);
      if (index < group.panes.length - 1) children.push(this.makeDivider(group, index));
    });
    group.container.replaceChildren(...children);
  }

  /** A draggable handle between pane `index` and `index + 1` in a split group. */
  private makeDivider(group: TerminalGroup, index: number): HTMLElement {
    const divider = document.createElement('div');
    divider.className = 'znxstudio-term-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-orientation', group.orientation === 'vertical' ? 'horizontal' : 'vertical');
    divider.setAttribute('aria-label', 'Resize terminal panes');
    divider.tabIndex = 0;
    divider.addEventListener('mousedown', (event) => this.beginDrag(group, index, event));
    divider.addEventListener('keydown', (event) => {
      const vertical = group.orientation === 'vertical';
      const decrease = vertical ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
      const increase = vertical ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
      if (!decrease && !increase) return;
      event.preventDefault();
      const before = group.panes[index];
      const after = group.panes[index + 1];
      const resized = resizeSplit(
        before.el.getBoundingClientRect()[vertical ? 'height' : 'width'],
        after.el.getBoundingClientRect()[vertical ? 'height' : 'width'],
        before.flexGrow,
        after.flexGrow,
        (decrease ? -1 : 1) * (event.shiftKey ? 40 : 10),
      );
      before.flexGrow = resized.before;
      after.flexGrow = resized.after;
      this.layoutGroup(group);
      this.saveLayout();
    });
    return divider;
  }

  private terminalTheme(): { background: string; foreground: string; cursor: string; selectionBackground: string } {
    const styles = getComputedStyle(document.documentElement);
    return {
      background: styles.getPropertyValue('--z-bg-panel').trim() || '#1d1e22',
      foreground: styles.getPropertyValue('--z-fg').trim() || '#d7d9de',
      cursor: styles.getPropertyValue('--z-fg').trim() || '#d7d9de',
      selectionBackground: styles.getPropertyValue('--z-accent').trim() || '#2f6fe0',
    };
  }

  private applyTerminalTheme(): void {
    const theme = this.terminalTheme();
    for (const group of this.groups) for (const pane of group.panes) pane.term.options.theme = theme;
  }

  /** Resize the two panes flanking a divider as the pointer drags it. */
  private beginDrag(group: TerminalGroup, index: number, event: MouseEvent): void {
    const before = group.panes[index];
    const after = group.panes[index + 1];
    if (!before || !after) return;
    event.preventDefault();

    const vertical = group.orientation === 'vertical';
    const start = vertical ? event.clientY : event.clientX;
    const beforeRect = before.el.getBoundingClientRect();
    const afterRect = after.el.getBoundingClientRect();
    const sizeBefore = vertical ? beforeRect.height : beforeRect.width;
    const sizeAfter = vertical ? afterRect.height : afterRect.width;

    let raf = 0;
    const scheduleFit = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        this.fitPane(before);
        this.fitPane(after);
      });
    };
    const onMove = (move: MouseEvent): void => {
      const pos = vertical ? move.clientY : move.clientX;
      const next = resizeSplit(sizeBefore, sizeAfter, before.flexGrow, after.flexGrow, pos - start);
      before.flexGrow = next.before;
      after.flexGrow = next.after;
      before.el.style.flexGrow = String(before.flexGrow);
      after.el.style.flexGrow = String(after.flexGrow);
      scheduleFit();
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('is-resizing');
      this.fitPane(before);
      this.fitPane(after);
      this.saveLayout();
    };
    document.body.classList.add('is-resizing');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  private setActiveGroup(id: string | null): void {
    this.activeGroupId = id;
    for (const group of this.groups) {
      const isActive = group.id === id;
      group.container.style.display = isActive ? 'flex' : 'none';
      if (isActive) {
        for (const pane of group.panes) this.fitPane(pane);
        const active = group.panes.find((p) => p.id === group.activePaneId) ?? group.panes[0];
        active?.term.focus();
      }
    }
    this.renderTabStrip();
  }

  private setActivePane(group: TerminalGroup, paneId: string): void {
    group.activePaneId = paneId;
    for (const pane of group.panes) pane.el.classList.toggle('is-active-pane', pane.id === paneId);
    group.panes.find((p) => p.id === paneId)?.term.focus();
  }

  private cycleTab(): void {
    if (this.groups.length < 2) return;
    const index = this.groups.findIndex((g) => g.id === this.activeGroupId);
    const next = this.groups[(index + 1) % this.groups.length];
    this.setActiveGroup(next.id);
    this.saveLayout();
  }

  /** Close a single pane; if it was the group's last, close the whole tab. */
  private closePane(group: TerminalGroup, paneId: string): void {
    const index = group.panes.findIndex((p) => p.id === paneId);
    if (index < 0) return;
    const [pane] = group.panes.splice(index, 1);
    this.teardownPane(pane);
    if (group.panes.length === 0) {
      this.closeGroup(group.id);
      return;
    }
    this.layoutGroup(group);
    const neighbour = group.panes[index] ?? group.panes[index - 1] ?? null;
    if (neighbour) this.setActivePane(group, neighbour.id);
    this.renderTabStrip();
    this.saveLayout();
  }

  /** Close a whole tab (group) and all its panes. */
  private closeGroup(id: string | null): void {
    if (!id) return;
    const index = this.groups.findIndex((g) => g.id === id);
    if (index < 0) return;
    const [group] = this.groups.splice(index, 1);
    for (const pane of group.panes) this.teardownPane(pane);
    group.container.remove();

    if (this.activeGroupId === id) {
      const neighbour = this.groups[index] ?? this.groups[index - 1] ?? null;
      this.setActiveGroup(neighbour ? neighbour.id : null);
    } else {
      this.renderTabStrip();
    }
    this.setStatus(
      this.groups.length ? `⌂ Terminal: ${this.groups.length}` : '⌂ Terminal: ready',
      this.groups.length ? 'Integrated terminal is running' : 'No terminals open',
    );
    this.saveLayout();
  }

  /** Close every tab except `keepId`. */
  private killOthers(keepId: string | null): void {
    if (!keepId) return;
    for (const group of [...this.groups]) {
      if (group.id !== keepId) this.closeGroup(group.id);
    }
    this.setActiveGroup(keepId);
    this.saveLayout();
  }

  private teardownPane(pane: TerminalPane): void {
    pane.inputDisposable?.dispose();
    pane.unData?.();
    pane.unExit?.();
    window.znxstudio.terminal.dispose(pane.id);
    pane.term.dispose();
    pane.el.remove();
  }

  /* ----- rename ----- */
  private beginRename(id: string): void {
    this.editingId = id;
    this.renderTabStrip();
  }

  private cancelRename(): void {
    if (!this.editingId) return;
    this.editingId = null;
    this.renderTabStrip();
  }

  /**
   * Apply a renamed tab label. Guarded so the blur that follows an Enter-commit
   * (the input is removed, firing blur) doesn't rename a second time. A blank
   * name is ignored, keeping the shell's original label.
   */
  private commitRename(id: string, value: string): void {
    if (this.editingId !== id) return;
    this.editingId = null;
    const group = this.groups.find((g) => g.id === id);
    const name = value.trim();
    if (group && name) group.label = name;
    this.renderTabStrip();
    this.saveLayout();
  }

  /* ----- tab strip ----- */
  private renderTabStrip(): void {
    const model: TabMeta[] = this.groups.map((g) => ({ id: g.id, label: g.label, exited: this.groupExited(g) }));
    buildTabStrip(this.tabStrip, model, this.activeGroupId, this.editingId, {
      onSelect: (id) => {
        this.setActiveGroup(id);
        this.saveLayout();
      },
      onClose: (id) => this.closeGroup(id),
      onNew: () => void this.newTerminal(),
      onSplit: () => void this.splitActive('horizontal'),
      onSplitDown: () => void this.splitActive('vertical'),
      onPick: () => void this.pickShell(),
      onBeginRename: (id) => this.beginRename(id),
      onCommitRename: (id, value) => this.commitRename(id, value),
      onCancelRename: () => this.cancelRename(),
      onContextMenu: (id, x, y) => this.openTabMenu(id, x, y),
    });
    this.syncBody();
  }

  /**
   * Keep the body showing EXACTLY the group containers, or the empty state when
   * there are none — never both. (A stale full-height empty-state element left
   * over a restored layout would hide the real terminals.) The containers hold
   * live xterm panes, so we only touch the DOM when the set actually changed.
   */
  private syncBody(): void {
    if (this.groups.length === 0) {
      if (!this.body.querySelector('.znxstudio-term-empty')) {
        this.body.replaceChildren(this.buildEmptyState());
      }
      return;
    }
    const containers = this.groups.map((g) => g.container);
    const current = [...this.body.children];
    const same = current.length === containers.length && containers.every((c, i) => current[i] === c);
    if (!same) this.body.replaceChildren(...containers);
  }

  private buildEmptyState(): HTMLElement {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-term-empty';
    const text = document.createElement('p');
    text.className = 'znxstudio-muted';
    text.textContent = 'No terminals open.';
    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'New Terminal';
    button.addEventListener('click', () => void this.newTerminal());
    empty.append(text, button);
    return empty;
  }

  /** Right-click a tab → Rename / Kill / Kill Others. */
  private openTabMenu(id: string, x: number, y: number): void {
    this.setActiveGroup(id);
    openContextMenu(x, y, [
      { label: 'Rename…', action: () => this.beginRename(id) },
      { label: 'Split Right', action: () => void this.splitActive('horizontal') },
      { label: 'Split Down', action: () => void this.splitActive('vertical') },
      { label: 'Kill', action: () => this.closeGroup(id) },
      { label: 'Kill Others', action: () => this.killOthers(id), disabled: this.groups.length < 2 },
    ]);
  }

  /**
   * Let the user choose which installed shell to launch, via the shared
   * command-palette-style quick-pick. Falls back to a default terminal if the
   * picker or discovery is unavailable.
   */
  private async pickShell(): Promise<void> {
    if (this.shells.length === 0 || !this.quickPick) {
      await this.newTerminal();
      return;
    }
    const shellId = await this.quickPick.pick(
      this.shells.map((shell) => ({ label: shell.label, description: shell.file, value: shell.id })),
      { placeholder: 'Select a shell to launch' },
    );
    if (shellId) await this.newTerminal(shellId);
  }

  private fitPane(pane: TerminalPane): void {
    try {
      pane.fit.fit();
      window.znxstudio.terminal.resize(pane.id, pane.term.cols, pane.term.rows);
    } catch {
      /* pane may be hidden; ignore */
    }
  }

  private syncActiveSizes(): void {
    const group = this.activeGroup();
    if (!group) return;
    for (const pane of group.panes) this.fitPane(pane);
  }

  /* ----- layout persistence (structure only; sessions are always fresh) ----- */
  private snapshot(): SavedLayout {
    return {
      groups: this.groups.map((group) => ({
        label: group.label,
        orientation: group.orientation,
        panes: group.panes.map((pane) => ({ shellId: pane.shellId, flexGrow: pane.flexGrow })),
      })),
      activeIndex: Math.max(0, this.groups.findIndex((g) => g.id === this.activeGroupId)),
    };
  }

  private saveLayout(): void {
    if (this.restoring) return;
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.snapshot()));
    } catch {
      /* storage unavailable — layout stays in-memory for the session */
    }
  }

  private loadLayout(): SavedLayout | null {
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedLayout;
      if (!parsed || !Array.isArray(parsed.groups)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private setStatus(text: string, tooltip: string): void {
    this.status?.setItem('terminal', {
      text,
      tooltip,
      command: CommandIds.TerminalToggle,
      side: 'right',
      priority: 25,
    });
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
    await this.ensureInitialized();
    const log = (message: string): void => console.info(`[selftest] ${message}`);

    // Shell discovery over IPC returns concrete, launchable profiles.
    const shells = await window.znxstudio.terminal.shells();
    const wellFormed = shells.every((s) => s.id && s.label && s.file && Array.isArray(s.args));
    log(`terminal shells: count=${shells.length} wellFormed=${wellFormed} ids=${shells.map((s) => s.id).join(',')}`);

    // Body invariant: with terminals open, the body shows ONLY group containers —
    // never a stale full-height empty-state element over them (the bug that hid
    // restored terminals behind "No terminals open").
    const noEmptyOverlay = !this.body.querySelector('.znxstudio-term-empty');
    const onlyGroups =
      this.groups.length > 0 &&
      this.body.children.length === this.groups.length &&
      [...this.body.children].every((c) => c.classList.contains('znxstudio-term-group'));
    log(
      `terminal body: groups=${this.groups.length} bodyChildren=${this.body.children.length} ` +
        `noEmptyOverlay=${noEmptyOverlay} onlyGroups=${onlyGroups} (expect body shows only the terminals)`,
    );

    // Live split: the active tab starts with one pane. A horizontal split adds a
    // second pane side by side; a vertical split stacks (is-vertical). Both keep
    // the tab count unchanged. Close the extra pane after each to restore.
    const group = this.activeGroup();
    const tabsBefore = this.groups.length;
    const before = group?.panes.length ?? 0;
    await this.splitActive('horizontal');
    const afterH = this.activeGroup()?.panes.length ?? 0;
    const horizontal = this.activeGroup()?.container.classList.contains('is-vertical') === false;
    // A split inserts exactly one draggable divider between its two panes;
    // dragging it re-weights the panes' flex-grow.
    const dividers = this.activeGroup()?.container.querySelectorAll('.znxstudio-term-divider').length ?? 0;
    let dragResized = false;
    if (group && group.panes.length === 2) {
      const growBefore = group.panes[0].flexGrow;
      const divider = group.container.querySelector('.znxstudio-term-divider') as HTMLElement | null;
      divider?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 200, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 260, clientY: 100 }));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      dragResized = group.panes[0].flexGrow !== growBefore;
    }
    if (group && group.panes.length > 1) this.closePane(group, group.panes[group.panes.length - 1].id);
    await this.splitActive('vertical');
    const afterV = this.activeGroup()?.panes.length ?? 0;
    const vertical = this.activeGroup()?.container.classList.contains('is-vertical') ?? false;
    if (group && group.panes.length > 1) this.closePane(group, group.panes[group.panes.length - 1].id);
    log(
      `terminal split: panesBefore=${before} afterH=${afterH} horizontal=${horizontal} ` +
        `afterV=${afterV} vertical=${vertical} dividers=${dividers} dragResized=${dragResized} ` +
        `tabsUnchanged=${tabsBefore === this.groups.length} (expect 1→2 both ways, 1 divider, drag resizes)`,
    );

    // Persistence: the current structure round-trips through localStorage.
    this.saveLayout();
    const reloaded = this.loadLayout();
    const persisted =
      reloaded?.groups.length === this.groups.length && (reloaded?.groups[0]?.panes.length ?? 0) >= 1;
    log(
      `terminal persist: saved=${Boolean(reloaded)} groups=${reloaded?.groups.length} ` +
        `activeIndex=${reloaded?.activeIndex} match=${persisted} (expect a saved layout matching live tabs)`,
    );

    // Tab-strip view: renders a tab per model entry, marks active/exited, and
    // wires select/close/new/split/rename/context-menu — no live PTY needed.
    const strip = document.createElement('div');
    const model: TabMeta[] = [
      { id: 'a', label: 'PowerShell', exited: false },
      { id: 'b', label: 'bash', exited: true },
    ];
    let closed = '';
    let created = 0;
    let split = 0;
    let splitDown = 0;
    let began = '';
    let renamed = '';
    let menu = '';
    const handlers = {
      onSelect: () => undefined,
      onClose: (id: string) => (closed = id),
      onNew: () => (created += 1),
      onSplit: () => (split += 1),
      onSplitDown: () => (splitDown += 1),
      onPick: () => undefined,
      onBeginRename: (id: string) => (began = id),
      onCommitRename: (id: string, value: string) => (renamed = `${id}=${value}`),
      onCancelRename: () => undefined,
      onContextMenu: (id: string) => (menu = id),
    };
    buildTabStrip(strip, model, 'a', null, handlers);
    const tabButtons = strip.querySelectorAll('.znxstudio-term-tab');
    const activeTab = strip.querySelector('.znxstudio-term-tab.is-active') as HTMLElement | null;
    const exitedTab = strip.querySelector('.znxstudio-term-tab.is-exited') as HTMLElement | null;
    (strip.querySelector('.znxstudio-term-tab .znxstudio-term-tab-close') as HTMLButtonElement | null)?.click();
    (strip.querySelector('.znxstudio-term-new') as HTMLButtonElement | null)?.click();
    (strip.querySelector('.znxstudio-term-split:not(.znxstudio-term-split-down)') as HTMLButtonElement | null)?.click();
    (strip.querySelector('.znxstudio-term-split-down') as HTMLButtonElement | null)?.click();
    (strip.querySelector('.znxstudio-term-tab') as HTMLElement | null)?.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true }),
    );
    (strip.querySelector('.znxstudio-term-tab .znxstudio-term-tab-name') as HTMLElement | null)?.dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    buildTabStrip(strip, model, 'a', 'a', handlers);
    const renameInput = strip.querySelector('.znxstudio-term-tab-rename') as HTMLInputElement | null;
    if (renameInput) {
      renameInput.value = 'build';
      renameInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    }
    log(
      `terminal tabs: rendered=${tabButtons.length} active=${activeTab?.textContent?.includes('PowerShell')} ` +
        `exitedMarked=${Boolean(exitedTab)} closeFired=${closed === 'a'} newFired=${created === 1} ` +
        `splitFired=${split === 1} splitDownFired=${splitDown === 1} menuFired=${menu === 'a'} ` +
        `renameBegan=${began === 'a'} renameCommitted=${renamed === 'a=build'} ` +
        `(expect close+new+split+splitDown+menu+rename wired)`,
    );
  }
}

/**
 * Render the tab strip into `host` from a plain model. Pure DOM (no xterm), so
 * the layout and wiring are unit-testable and the module state stays in one
 * place. Rebuilt wholesale on every change — the tab count is tiny.
 */
function buildTabStrip(
  host: HTMLElement,
  model: TabMeta[],
  activeId: string | null,
  editingId: string | null,
  handlers: {
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNew: () => void;
    onSplit: () => void;
    onSplitDown: () => void;
    onPick: () => void;
    onBeginRename: (id: string) => void;
    onCommitRename: (id: string, value: string) => void;
    onCancelRename: () => void;
    onContextMenu: (id: string, x: number, y: number) => void;
  },
): void {
  host.replaceChildren();

  const list = document.createElement('div');
  list.className = 'znxstudio-term-tablist';
  let editInput: HTMLInputElement | null = null;
  for (const meta of model) {
    const tab = document.createElement('div');
    tab.className = 'znxstudio-term-tab';
    if (meta.id === activeId) tab.classList.add('is-active');
    if (meta.exited) tab.classList.add('is-exited');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(meta.id === activeId));
    tab.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      handlers.onContextMenu(meta.id, event.clientX, event.clientY);
    });

    if (meta.id === editingId) {
      // Inline rename: an input replaces the label; Enter commits, Escape/blur
      // cancels or commits. stopPropagation keeps clicks from re-selecting.
      const input = document.createElement('input');
      input.className = 'znxstudio-term-tab-rename';
      input.value = meta.label;
      input.setAttribute('aria-label', 'Rename terminal');
      input.addEventListener('click', (event) => event.stopPropagation());
      input.addEventListener('keydown', (event) => {
        event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          handlers.onCommitRename(meta.id, input.value);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          handlers.onCancelRename();
        }
      });
      input.addEventListener('blur', () => handlers.onCommitRename(meta.id, input.value));
      tab.appendChild(input);
      editInput = input;
      list.appendChild(tab);
      continue;
    }

    const name = document.createElement('span');
    name.className = 'znxstudio-term-tab-name';
    name.textContent = meta.label;
    tab.appendChild(name);
    tab.addEventListener('click', () => handlers.onSelect(meta.id));
    // Double-click a tab (VS Code-style) to rename it.
    tab.addEventListener('dblclick', (event) => {
      event.preventDefault();
      handlers.onBeginRename(meta.id);
    });

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'znxstudio-term-tab-close';
    close.textContent = '×';
    close.title = 'Close terminal';
    close.setAttribute('aria-label', `Close ${meta.label} terminal`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      handlers.onClose(meta.id);
    });
    tab.appendChild(close);
    list.appendChild(tab);
  }
  host.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'znxstudio-term-actions';
  const split = document.createElement('button');
  split.type = 'button';
  split.className = 'znxstudio-term-split';
  split.textContent = '◫';
  split.title = 'Split Terminal Right';
  split.setAttribute('aria-label', 'Split Terminal Right');
  split.addEventListener('click', () => handlers.onSplit());
  const splitDown = document.createElement('button');
  splitDown.type = 'button';
  splitDown.className = 'znxstudio-term-split znxstudio-term-split-down';
  splitDown.textContent = '⊟';
  splitDown.title = 'Split Terminal Down';
  splitDown.setAttribute('aria-label', 'Split Terminal Down');
  splitDown.addEventListener('click', () => handlers.onSplitDown());
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'znxstudio-term-new';
  add.textContent = '+';
  add.title = 'New Terminal';
  add.setAttribute('aria-label', 'New Terminal');
  add.addEventListener('click', () => handlers.onNew());
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'znxstudio-term-new-caret';
  caret.textContent = '▾';
  caret.title = 'Select shell…';
  caret.setAttribute('aria-label', 'Select shell');
  caret.addEventListener('click', () => handlers.onPick());
  actions.append(split, splitDown, add, caret);
  host.appendChild(actions);

  if (editInput) {
    editInput.focus();
    editInput.select();
  }
}

/** A lightweight context menu anchored at (x, y). Dismisses on outside/Escape. */
function openContextMenu(
  x: number,
  y: number,
  items: Array<{ label: string; action: () => void; disabled?: boolean }>,
): void {
  const menu = document.createElement('div');
  menu.className = 'znxstudio-context-menu';
  menu.setAttribute('role', 'menu');

  const close = (): void => {
    menu.remove();
    document.removeEventListener('mousedown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  };
  const onOutside = (event: MouseEvent): void => {
    if (!menu.contains(event.target as Node)) close();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') close();
  };

  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'znxstudio-context-menu-item';
    button.textContent = item.label;
    button.setAttribute('role', 'menuitem');
    if (item.disabled) {
      button.disabled = true;
    } else {
      button.addEventListener('click', () => {
        close();
        item.action();
      });
    }
    menu.appendChild(button);
  }

  document.body.appendChild(menu);
  // Position after mounting so measured size keeps the menu on-screen.
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
  menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}
