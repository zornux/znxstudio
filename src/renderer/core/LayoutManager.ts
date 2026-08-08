/**
 * Owns the workbench DOM skeleton and hands out stable mount points (activity
 * bar, sidebar, editor area, tabbed bottom panel, status bar). Modules never
 * build top-level layout themselves — they render into the regions this exposes.
 */

import { DEFAULT_LAYOUT, layoutClasses, layoutVariables, type LayoutState } from '../layout/layoutModel';
import type { PanelDescriptor } from '../layout/panels';
import { normalizeToastMessage } from './toastCopy';
import {
  type ActivityCuration,
  type ActivityLayout,
  curateActivityBar,
  hideItem,
  movePinned,
  pinItem,
  unhideItem,
  unpinItem,
} from '../layout/activityBar';

export type MenuEntry =
  | { label: string; onClick: () => void; disabled?: boolean; shortcut?: string }
  /** A checkable item (SB-3). Toggling keeps the menu open and re-renders it. */
  | { label: string; checked: boolean; onToggle: () => void }
  /** A nested submenu (VS Code-style ›). Opens a flyout of `submenu()` to the side. */
  | { label: string; submenu: () => MenuEntry[] }
  | { header: string }
  | { separator: true };

export interface ActivityItem {
  id: string;
  label: string;
  icon: string;
  onSelect: () => void;
}

export interface PanelView {
  id: string;
  title: string;
  element: HTMLElement;
}

type ToastKind = 'info' | 'success' | 'error';

export class LayoutManager {
  private root!: HTMLElement;
  private el!: Record<string, HTMLElement>;
  private panelVisible = true;
  private readonly panelTabs = new Map<string, { tab: HTMLElement; view: HTMLElement; title: string }>();
  private layoutState: LayoutState = DEFAULT_LAYOUT;
  private readonly resizeHandlers: ((region: 'sidebar' | 'panel', extent: number) => void)[] = [];
  private readonly panelVisibilityHandlers: ((visible: boolean) => void)[] = [];
  private readonly panelAddedHandlers: ((id: string) => void)[] = [];
  private activePanel: string | null = null;
  /** Registered activity items (insertion order preserved), UX-1 curation state, active id, open menu. */
  private readonly activityItems = new Map<string, ActivityItem>();
  private activityCuration: ActivityCuration = { pinned: [], hidden: [] };
  private activeActivityId: string | null = null;
  private menuEl: HTMLElement | null = null;
  /** Open nested submenus (parent anchor + flyout), innermost last. */
  private subMenus: Array<{ anchor: HTMLElement; menu: HTMLElement }> = [];
  /** UX-2 bottom-panel container: overflow "+" button + close/open/active events. */
  private overflowButton: HTMLElement | null = null;
  private readonly panelCloseHandlers: ((id: string) => void)[] = [];
  private readonly panelOpenHandlers: (() => void)[] = [];
  private readonly panelActiveHandlers: ((id: string) => void)[] = [];
  private readonly activitySelectHandlers: ((id: string, wasActive: boolean) => void)[] = [];
  /** UX-3 menu bar: named buttons in the title bar that open dropdown menus. */
  private readonly menuButtons = new Map<string, HTMLElement>();
  private readonly menuBarEntries: Array<{ button: HTMLElement; build: () => MenuEntry[] }> = [];
  private activeMenuButton: HTMLElement | null = null;

  mount(root: HTMLElement): void {
    this.root = root;
    this.activityCuration = this.loadCuration();
    root.classList.add('znxstudio-workbench');
    root.innerHTML = `
      <div class="znxstudio-titlebar" role="banner">
        <span class="znxstudio-titlebar-brand znxstudio-wordmark" aria-label="ZnxStudio">
          <span class="znxstudio-wordmark-core" aria-hidden="true">Znx</span><span class="znxstudio-wordmark-studio" aria-hidden="true">Studio</span><span class="znxstudio-wordmark-accent" aria-hidden="true"></span>
        </span>
        <div class="znxstudio-menubar" data-role="menubar" role="menubar" aria-label="Main Menu"></div>
      </div>
      <div class="znxstudio-body">
        <div class="znxstudio-activitybar" data-role="activitybar" role="tablist" aria-orientation="vertical" aria-label="Workspaces"></div>
        <div class="znxstudio-sidebar" data-role="sidebar" role="complementary" aria-labelledby="znxstudio-sidebar-title">
          <div class="znxstudio-sidebar-header">
            <span class="znxstudio-sidebar-title" data-role="sidebar-title" id="znxstudio-sidebar-title" role="heading" aria-level="2">Explorer</span>
            <div class="znxstudio-sidebar-toolbar" data-role="sidebar-toolbar" role="toolbar"></div>
          </div>
          <div class="znxstudio-sidebar-body" data-role="sidebar-body"></div>
        </div>
        <div class="znxstudio-splitter znxstudio-splitter--sidebar" data-role="sidebar-splitter" role="separator" aria-orientation="vertical" aria-label="Resize the side bar" title="Drag to resize the side bar"></div>
        <div class="znxstudio-editor-region" role="main" aria-label="Editor">
          <div class="znxstudio-editor-area" data-role="editor-area"></div>
          <div class="znxstudio-splitter znxstudio-splitter--panel" data-role="panel-splitter" role="separator" aria-orientation="horizontal" aria-label="Resize the panel" title="Drag to resize the panel"></div>
          <div class="znxstudio-panel" data-role="panel" aria-label="Panel">
            <div class="znxstudio-panel-header">
              <div class="znxstudio-panel-tabs" data-role="panel-tabs" role="tablist" aria-label="Panel Views"></div>
              <div class="znxstudio-panel-actions" role="toolbar" aria-label="Panel layout">
                <button type="button" data-role="panel-maximize" title="Maximize or restore panel" aria-label="Maximize or restore panel">⌃</button>
                <button type="button" data-role="panel-hide" title="Hide panel" aria-label="Hide panel">×</button>
              </div>
            </div>
            <div class="znxstudio-panel-views" data-role="panel-views"></div>
          </div>
        </div>
      </div>
      <div class="znxstudio-statusbar" role="contentinfo" aria-label="Status Bar">
        <div class="znxstudio-status-left" data-role="status-left"></div>
        <div class="znxstudio-status-right" data-role="status-right"></div>
      </div>
      <div class="znxstudio-toasts" data-role="toasts" role="status" aria-live="polite" aria-atomic="false"></div>
    `;

    this.applyMotionPreference();

    const pick = (role: string): HTMLElement => {
      const node = root.querySelector<HTMLElement>(`[data-role="${role}"]`);
      if (!node) throw new Error(`Layout region missing: ${role}`);
      return node;
    };

    this.el = {
      menubar: pick('menubar'),
      activitybar: pick('activitybar'),
      sidebar: pick('sidebar'),
      sidebarTitle: pick('sidebar-title'),
      sidebarToolbar: pick('sidebar-toolbar'),
      sidebarBody: pick('sidebar-body'),
      sidebarSplitter: pick('sidebar-splitter'),
      editorArea: pick('editor-area'),
      panel: pick('panel'),
      panelSplitter: pick('panel-splitter'),
      panelTabs: pick('panel-tabs'),
      panelViews: pick('panel-views'),
      statusLeft: pick('status-left'),
      statusRight: pick('status-right'),
      toasts: pick('toasts'),
    };

    this.wireSplitter(this.el.sidebarSplitter, 'sidebar');
    this.wireSplitter(this.el.panelSplitter, 'panel');
    pick('panel-maximize').addEventListener('click', () => this.requestPanelMaximize());
    pick('panel-hide').addEventListener('click', () => this.requestPanelHide());
    this.installResponsive();
  }

  /* ----- Layout (Phase 17A) ----- */

  /** Render a layout: classes describe the arrangement, variables carry the sizes. */
  applyLayout(state: LayoutState): void {
    this.layoutState = state;
    // Keep the imperative panel toggle in step with the declarative state, or
    // showPanelView would reveal a panel the layout says is hidden.
    this.panelVisible = state.panel.visible;
    this.el.panel.classList.toggle('is-hidden', !state.panel.visible);
    for (const className of [...this.root.classList]) {
      if (className !== 'znxstudio-workbench') this.root.classList.remove(className);
    }
    this.root.classList.add(...layoutClasses(state));
    for (const [name, value] of Object.entries(layoutVariables(state))) this.root.style.setProperty(name, value);
  }

  /** Fires while a splitter is dragged, with the region's new pixel extent. */
  onDidResize(handler: (region: 'sidebar' | 'panel', extent: number) => void): void {
    this.resizeHandlers.push(handler);
  }

  /**
   * Turn a splitter into a drag handle. The extent is measured from the pointer
   * against the region's own edge, so it stays correct whichever side the region
   * is docked on — a right-docked sidebar grows as the pointer moves LEFT.
   */
  private wireSplitter(handle: HTMLElement, region: 'sidebar' | 'panel'): void {
    handle.tabIndex = 0;
    handle.addEventListener('keydown', (event) => {
      const horizontal = region === 'panel' && this.layoutState.panel.position === 'bottom';
      const decrement = horizontal ? event.key === 'ArrowUp' : event.key === 'ArrowLeft';
      const increment = horizontal ? event.key === 'ArrowDown' : event.key === 'ArrowRight';
      if (!decrement && !increment) return;
      event.preventDefault();
      const current = region === 'sidebar' ? this.layoutState.sidebar.width : horizontal ? this.layoutState.panel.height : this.layoutState.panel.width;
      const direction = decrement ? -1 : 1;
      const physicalDirection = region === 'sidebar' && this.layoutState.sidebar.side === 'right' ? -direction : direction;
      for (const handler of this.resizeHandlers) handler(region, current + physicalDirection * (event.shiftKey ? 40 : 10));
    });
    handle.addEventListener('pointerdown', (event: PointerEvent) => {
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      this.root.classList.add('is-resizing');

      const move = (moveEvent: PointerEvent): void => {
        const extent = this.measure(region, moveEvent);
        for (const handler of this.resizeHandlers) handler(region, extent);
      };
      const up = (): void => {
        handle.releasePointerCapture(event.pointerId);
        this.root.classList.remove('is-resizing');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  }

  private measure(region: 'sidebar' | 'panel', event: PointerEvent): number {
    const state = this.layoutState;
    if (region === 'sidebar') {
      const bounds = this.el.sidebar.getBoundingClientRect();
      return state.sidebar.side === 'left' ? event.clientX - bounds.left : bounds.right - event.clientX;
    }
    const bounds = this.el.panel.getBoundingClientRect();
    return state.panel.position === 'bottom' ? bounds.bottom - event.clientY : bounds.right - event.clientX;
  }

  /* ----- Panels (Phase 17B) ----- */

  /** Every panel view a module has registered, in registration order. */
  panelDescriptors(): PanelDescriptor[] {
    return [...this.panelTabs.entries()].map(([id, entry]) => ({ id, title: entry.title }));
  }

  /**
   * Show exactly these panels, as tabs, in this order. A panel not listed is
   * HIDDEN, never unregistered — its module keeps its element and keeps updating it.
   */
  applyPanelOrder(visibleIds: string[]): void {
    for (const [id, entry] of this.panelTabs) {
      const visible = visibleIds.includes(id);
      entry.tab.classList.toggle('is-hidden', !visible);
      if (!visible && this.activePanel === id) this.activePanel = null;
    }
    // Re-append in the requested order; the DOM keeps the rest where they are.
    for (const id of visibleIds) {
      const entry = this.panelTabs.get(id);
      if (entry) this.el.panelTabs.appendChild(entry.tab);
    }
    if (this.overflowButton) this.el.panelTabs.appendChild(this.overflowButton); // keep "+" last
    if (this.activePanel === null && visibleIds.length) this.showPanelView(visibleIds[0]);
  }

  /* ----- Bottom-panel container affordances (UX-2) ----- */
  /** Fired when a tab's × is clicked — the owner moves the panel to the overflow. */
  onDidRequestClosePanel(handler: (id: string) => void): void {
    this.panelCloseHandlers.push(handler);
  }
  /** Fired when the "+" overflow button is clicked — the owner opens the panel picker. */
  onDidRequestOpenPanel(handler: () => void): void {
    this.panelOpenHandlers.push(handler);
  }
  private readonly panelMaximizeHandlers: (() => void)[] = [];
  private readonly panelHideHandlers: (() => void)[] = [];
  onDidRequestMaximizePanel(handler: () => void): void {
    this.panelMaximizeHandlers.push(handler);
  }
  onDidRequestHidePanel(handler: () => void): void {
    this.panelHideHandlers.push(handler);
  }
  private requestPanelMaximize(): void {
    for (const handler of this.panelMaximizeHandlers) handler();
  }
  private requestPanelHide(): void {
    for (const handler of this.panelHideHandlers) handler();
  }
  /** Fired when the active tab changes — the owner persists it (last-active memory). */
  onDidChangeActivePanel(handler: (id: string) => void): void {
    this.panelActiveHandlers.push(handler);
  }

  private ensureOverflowButton(): void {
    if (!this.overflowButton) {
      const button = document.createElement('button');
      button.className = 'znxstudio-panel-overflow';
      button.textContent = '+';
      button.title = 'Open a panel…';
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        for (const handler of this.panelOpenHandlers) handler();
      });
      this.overflowButton = button;
    }
    this.el.panelTabs.appendChild(this.overflowButton); // moves it to last
  }

  /** A searchable picker of panels (the "+" overflow list). Opens upward from the strip. */
  openPanelPicker(items: { id: string; title: string }[], onPick: (id: string) => void): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'znxstudio-menu znxstudio-panel-picker';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Open a panel');

    const search = document.createElement('input');
    search.className = 'znxstudio-menu-search';
    search.placeholder = 'Search panels…';
    search.setAttribute('aria-label', 'Search panels');
    const list = document.createElement('div');
    list.className = 'znxstudio-panel-picker-results';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Available panels');

    const render = (filter: string): void => {
      list.replaceChildren();
      const needle = filter.trim().toLowerCase();
      const matches = items.filter((item) => item.title.toLowerCase().includes(needle));
      if (!matches.length) {
        const empty = document.createElement('div');
        empty.className = 'znxstudio-menu-header';
        empty.textContent = 'No panels';
        list.appendChild(empty);
        return;
      }
      for (const item of matches) {
        const button = document.createElement('button');
        button.className = 'znxstudio-menu-item';
        button.setAttribute('role', 'option');
        button.textContent = item.title;
        button.addEventListener('click', (event) => {
          event.stopPropagation();
          this.closeMenu();
          onPick(item.id);
        });
        list.appendChild(button);
      }
    };
    search.addEventListener('input', () => render(search.value));
    search.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowDown') return;
      const first = list.querySelector<HTMLButtonElement>('.znxstudio-menu-item');
      if (!first) return;
      event.preventDefault();
      first.focus();
    });
    render('');

    menu.append(search, list);
    const rect = this.overflowButton?.getBoundingClientRect();
    menu.style.left = `${rect ? rect.left : 120}px`;
    menu.style.bottom = `${rect ? window.innerHeight - rect.top + 6 : 40}px`;
    this.root.appendChild(menu);
    this.menuEl = menu;
    this.menuReturnFocus = document.activeElement as HTMLElement | null;
    setTimeout(() => document.addEventListener('click', this.onDocumentClick, true), 0);
    document.addEventListener('keydown', this.onMenuKey, true);
    search.focus();
  }

  get editorArea(): HTMLElement {
    return this.el.editorArea;
  }

  /* ----- Sidebar ----- */
  setSideBar(title: string, content: HTMLElement): void {
    this.el.sidebarTitle.textContent = title;
    this.el.sidebarBody.replaceChildren(content);
    // A new view starts with no workspace toolbar; the activator re-adds one.
    this.clearSideBarToolbar();
  }

  /**
   * SB-6: render a workspace's action toolbar in the sidebar header (AI: Chat /
   * Explain / Review …). Cleared automatically whenever the sidebar view changes.
   */
  setSideBarToolbar(actions: { icon: string; label: string; onClick: () => void }[]): void {
    this.el.sidebarToolbar.replaceChildren();
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = 'znxstudio-sidebar-tool';
      button.textContent = action.icon;
      button.title = action.label;
      button.setAttribute('aria-label', action.label);
      button.addEventListener('click', action.onClick);
      this.el.sidebarToolbar.appendChild(button);
    }
  }

  clearSideBarToolbar(): void {
    this.el.sidebarToolbar.replaceChildren();
  }

  setSideBarTitle(title: string): void {
    this.el.sidebarTitle.textContent = title;
  }

  focusSideBar(): void {
    this.el.sidebar.classList.remove('is-collapsed');
  }

  /* ----- Activity bar (UX-1: curated — 5 defaults, the rest in a grouped overflow) ----- */
  addActivityItem(item: ActivityItem): void {
    this.activityItems.set(item.id, item);
    this.renderActivityBar();
  }

  /** Select an activity by id (used by the View menu / Command Palette). */
  selectActivityById(id: string): void {
    const item = this.activityItems.get(id);
    if (item) this.selectActivity(item);
  }

  /** All registered activity items — for the View menu and pickers. */
  activityItemsList(): { id: string; label: string; icon: string }[] {
    return [...this.activityItems.values()].map(({ id, label, icon }) => ({ id, label, icon }));
  }

  private renderActivityBar(): void {
    const bar = this.el.activitybar;
    if (!bar) return;
    bar.replaceChildren();
    const layout = curateActivityBar([...this.activityItems.keys()], this.activityCuration);

    for (const id of layout.pinned) {
      const item = this.activityItems.get(id);
      if (item) bar.appendChild(this.activityButton(item));
    }

    const hasOverflow = layout.overflow.some((group) => group.ids.length > 0) || layout.hidden.length > 0;
    if (hasOverflow) {
      const more = document.createElement('button');
      more.className = 'znxstudio-activity-item znxstudio-activity-more';
      more.title = 'More workspaces…';
      more.setAttribute('aria-label', 'More workspaces');
      more.setAttribute('aria-haspopup', 'menu');
      more.textContent = '⋯';
      more.addEventListener('click', (event) => {
        event.stopPropagation();
        this.toggleOverflowMenu(more, layout);
      });
      bar.appendChild(more);
    }
  }

  private activityButton(item: ActivityItem): HTMLElement {
    const button = document.createElement('button');
    button.className = 'znxstudio-activity-item';
    const active = this.activeActivityId === item.id;
    button.classList.toggle('is-active', active);
    button.title = item.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-label', item.label);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
    // Icon is decorative; the accessible name comes from aria-label.
    const glyph = document.createElement('span');
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = item.icon;
    button.appendChild(glyph);
    button.addEventListener('click', () => this.selectActivity(item));
    button.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      this.openActivityMenu(event.clientX, event.clientY, item.id, true);
    });
    return button;
  }

  /** Notified when an activity item is chosen; `wasActive` = the same item was already selected. */
  onDidSelectActivity(handler: (id: string, wasActive: boolean) => void): void {
    this.activitySelectHandlers.push(handler);
  }

  private selectActivity(item: ActivityItem): void {
    const wasActive = this.activeActivityId === item.id;
    this.activeActivityId = item.id;
    this.closeMenu();
    this.renderActivityBar();
    item.onSelect();
    // The owner (LayoutModule) reveals the side bar (or toggles it on a repeat
    // click) — onSelect only swaps the side bar's CONTENT, not its visibility, so
    // without this a click while the side bar is hidden would do nothing visible.
    for (const handler of this.activitySelectHandlers) handler(item.id, wasActive);
  }

  private toggleOverflowMenu(anchor: HTMLElement, layout: ActivityLayout): void {
    if (this.menuEl) {
      this.closeMenu();
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const entries: MenuEntry[] = [];
    for (const group of layout.overflow) {
      if (!group.ids.length) continue;
      entries.push({ header: group.group });
      for (const id of group.ids) {
        const item = this.activityItems.get(id);
        if (item) entries.push({ label: `${item.icon}  ${item.label}`, onClick: () => this.selectActivity(item) });
      }
    }
    if (layout.hidden.length) {
      entries.push({ separator: true }, { header: 'Hidden' });
      for (const id of layout.hidden) {
        const item = this.activityItems.get(id);
        if (item) entries.push({ label: `${item.icon}  ${item.label}  (show)`, onClick: () => this.updateCuration(unhideItem(this.activityCuration, id)) });
      }
    }
    entries.push({ separator: true }, { label: '↺  Reset Activity Bar', onClick: () => this.updateCuration({ pinned: [], hidden: [] }) });
    this.openMenu(rect.right + 6, rect.top, entries);
  }

  private openActivityMenu(x: number, y: number, id: string, pinned: boolean): void {
    const entries: MenuEntry[] = pinned
      ? [
          { label: 'Unpin from Activity Bar', onClick: () => this.updateCuration(unpinItem(this.activityCuration, id)) },
          { label: 'Move Up', onClick: () => this.updateCuration(movePinned(this.activityCuration, id, -1)) },
          { label: 'Move Down', onClick: () => this.updateCuration(movePinned(this.activityCuration, id, 1)) },
        ]
      : [{ label: 'Pin to Activity Bar', onClick: () => this.updateCuration(pinItem(this.activityCuration, id)) }];
    entries.push({ separator: true }, { label: 'Hide', onClick: () => this.updateCuration(hideItem(this.activityCuration, id)) });
    this.openMenu(x, y, entries);
  }

  private updateCuration(next: ActivityCuration): void {
    this.activityCuration = next;
    this.saveCuration();
    this.closeMenu();
    this.renderActivityBar();
  }

  private loadCuration(): ActivityCuration {
    try {
      const raw = localStorage.getItem('znxstudio.activitybar');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<ActivityCuration>;
        if (Array.isArray(parsed.pinned) && Array.isArray(parsed.hidden)) {
          return { pinned: parsed.pinned.filter((v) => typeof v === 'string'), hidden: parsed.hidden.filter((v) => typeof v === 'string') };
        }
      }
    } catch {
      /* corrupt/absent — fall back to defaults */
    }
    return { pinned: [], hidden: [] };
  }

  private saveCuration(): void {
    try {
      localStorage.setItem('znxstudio.activitybar', JSON.stringify(this.activityCuration));
    } catch {
      /* storage unavailable — curation stays in-memory for the session */
    }
  }

  /* ----- Menu bar (UX-3: the View menu / central launcher) ----- */
  /** Add a named dropdown to the title-bar menu bar. `build` runs on each open, so it reflects live state. */
  addMenu(label: string, build: () => MenuEntry[]): void {
    const button = document.createElement('button');
    button.className = 'znxstudio-menubar-item';
    button.textContent = label;
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-haspopup', 'true');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      this.openMenuBar(button, build);
    });
    button.addEventListener('mouseenter', () => {
      if (this.menuEl && this.activeMenuButton && this.activeMenuButton !== button) {
        this.openMenuBar(button, build);
      }
    });
    this.el.menubar.appendChild(button);
    this.menuButtons.set(label, button);
    this.menuBarEntries.push({ button, build });
  }

  /** Open a named menu-bar menu (used by a command / keyboard shortcut). */
  triggerMenu(label: string): void {
    this.menuButtons.get(label)?.click();
  }

  private openMenuBar(button: HTMLElement, build: () => MenuEntry[]): void {
    if (this.menuEl && this.activeMenuButton === button) {
      this.closeMenu();
      return;
    }
    if (this.menuEl) this.closeMenu(false);
    const rect = button.getBoundingClientRect();
    this.openMenu(rect.left, rect.bottom + 2, build);
    this.activeMenuButton = button;
    this.menuReturnFocus = button;
    button.setAttribute('aria-expanded', 'true');
  }

  private switchMenuBarItem(delta: -1 | 1): void {
    if (!this.activeMenuButton || this.menuBarEntries.length === 0) return;
    const index = this.menuBarEntries.findIndex((entry) => entry.button === this.activeMenuButton);
    if (index < 0) return;
    const next = this.menuBarEntries[(index + delta + this.menuBarEntries.length) % this.menuBarEntries.length];
    this.openMenuBar(next.button, next.build);
  }

  /**
   * A floating menu at (x, y). `source` may be a static list or a BUILDER — a
   * builder lets checkable items re-render the menu in place after a toggle so it
   * stays open (SB-3). Public so modules can open sub-menus (e.g. View → Panels).
   */
  openFloatingMenu(x: number, y: number, build: () => MenuEntry[]): void {
    this.openMenu(x, y, build);
  }

  /** The menu bar's screen rect, for anchoring a View sub-menu beneath it. */
  menuBarRect(): DOMRect {
    return this.el.menubar.getBoundingClientRect();
  }

  /* ----- lightweight floating menu (activity overflow + context menus) ----- */
  private openMenu(x: number, y: number, source: MenuEntry[] | (() => MenuEntry[])): void {
    this.closeMenu();
    const build = typeof source === 'function' ? source : () => source;
    const menu = document.createElement('div');
    menu.className = 'znxstudio-menu';
    menu.setAttribute('role', 'menu');

    const rerender = () => {
      menu.replaceChildren();
      for (const entry of build()) menu.appendChild(this.menuEntryNode(entry, rerender));
    };
    rerender();

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    this.root.appendChild(menu);
    this.menuEl = menu;
    this.clampMenuToViewport(menu, x, y);
    // Move focus into the menu (first item) so it is immediately keyboard-navigable, remembering where
    // focus was so it can be restored on close.
    this.menuReturnFocus = document.activeElement as HTMLElement | null;
    this.menuItems()[0]?.focus();
    // Defer so the click that opened the menu doesn't immediately close it.
    setTimeout(() => document.addEventListener('click', this.onDocumentClick, true), 0);
    document.addEventListener('keydown', this.onMenuKey, true);
  }

  // Keep a floating menu fully on-screen: when it would overflow the right or bottom edge (a right-click
  // near the viewport edge), shift it back inside so no item is clipped or unreachable.
  private clampMenuToViewport(menu: HTMLElement, x: number, y: number): void {
    const rect = menu.getBoundingClientRect();
    const margin = 4;
    let left = x;
    let top = y;
    if (left + rect.width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - rect.width - margin);
    }
    if (top + rect.height > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private menuEntryNode(entry: MenuEntry, rerender: () => void): HTMLElement {
    if ('header' in entry) {
      const header = document.createElement('div');
      header.className = 'znxstudio-menu-header';
      header.setAttribute('role', 'presentation');
      header.textContent = entry.header;
      return header;
    }
    if ('separator' in entry) {
      const separator = document.createElement('div');
      separator.className = 'znxstudio-menu-separator';
      separator.setAttribute('role', 'separator');
      return separator;
    }
    if ('checked' in entry) {
      // A checkable item: toggles WITHOUT closing, and re-renders so the mark updates.
      const button = document.createElement('button');
      button.className = 'znxstudio-menu-item znxstudio-menu-check';
      button.setAttribute('role', 'menuitemcheckbox');
      button.setAttribute('aria-checked', entry.checked ? 'true' : 'false');
      button.innerHTML = `<span class="znxstudio-menu-check-mark">${entry.checked ? '✓' : ''}</span>`;
      button.appendChild(document.createTextNode(entry.label));
      button.addEventListener('mouseenter', () => this.closeSubMenusBelow(button));
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        entry.onToggle();
        rerender();
      });
      return button;
    }
    if ('submenu' in entry) {
      // A parent item: a › chevron and a flyout of nested entries opened on
      // hover or click (VS Code-style).
      const button = document.createElement('button');
      button.className = 'znxstudio-menu-item znxstudio-menu-parent';
      button.setAttribute('role', 'menuitem');
      button.setAttribute('aria-haspopup', 'true');
      button.setAttribute('aria-expanded', 'false');
      const label = document.createElement('span');
      label.textContent = entry.label;
      const chevron = document.createElement('span');
      chevron.className = 'znxstudio-menu-chevron';
      chevron.textContent = '›';
      chevron.setAttribute('aria-hidden', 'true');
      button.append(label, chevron);
      const open = (): void => this.openSubMenu(button, entry.submenu);
      button.addEventListener('mouseenter', open);
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        open();
      });
      return button;
    }
    const button = document.createElement('button');
    button.className = 'znxstudio-menu-item';
    button.setAttribute('role', 'menuitem');
    button.disabled = Boolean(entry.disabled);
    button.setAttribute('aria-disabled', entry.disabled ? 'true' : 'false');
    const label = document.createElement('span');
    label.className = 'znxstudio-menu-label';
    label.textContent = entry.label;
    button.appendChild(label);
    if (entry.shortcut) {
      const shortcut = document.createElement('kbd');
      shortcut.className = 'znxstudio-menu-shortcut';
      shortcut.textContent = entry.shortcut;
      shortcut.setAttribute('aria-hidden', 'true');
      button.appendChild(shortcut);
    }
    // Moving onto a non-parent item collapses any open sibling submenu.
    button.addEventListener('mouseenter', () => this.closeSubMenusBelow(button));
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (entry.disabled) return;
      this.closeMenu();
      entry.onClick();
    });
    return button;
  }

  /**
   * Open a nested flyout for a parent item, positioned to its right (flipped to
   * the left near the viewport edge). Only one submenu chain is open at a time,
   * so opening replaces any sibling flyout.
   */
  private openSubMenu(anchor: HTMLElement, build: () => MenuEntry[]): void {
    if (this.subMenus.some((s) => s.anchor === anchor)) return; // already open
    this.closeSubMenusBelow(anchor);

    const menu = document.createElement('div');
    menu.className = 'znxstudio-menu znxstudio-submenu';
    menu.setAttribute('role', 'menu');
    for (const entry of build()) menu.appendChild(this.menuEntryNode(entry, () => undefined));
    this.root.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    const size = menu.getBoundingClientRect();
    const margin = 4;
    let left = rect.right - 2;
    if (left + size.width > window.innerWidth - margin) left = Math.max(margin, rect.left - size.width + 2);
    let top = rect.top;
    if (top + size.height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - size.height - margin);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;

    anchor.setAttribute('aria-expanded', 'true');
    this.subMenus.push({ anchor, menu });
  }

  /**
   * Close submenus that don't belong to `anchor`'s own open chain — i.e. all
   * flyouts opened at or below the level of the menu containing `anchor`. Called
   * when the pointer moves to a sibling so stale flyouts collapse.
   */
  private closeSubMenusBelow(anchor: HTMLElement): void {
    const parentMenu = anchor.closest('.znxstudio-menu');
    while (this.subMenus.length > 0) {
      const top = this.subMenus[this.subMenus.length - 1];
      // Keep the chain that leads to this anchor's own submenu, if any.
      if (top.anchor === anchor || top.menu === parentMenu) break;
      // Stop once we reach a flyout that actually contains the anchor.
      if (top.menu.contains(anchor)) break;
      top.menu.remove();
      top.anchor.setAttribute('aria-expanded', 'false');
      this.subMenus.pop();
    }
  }

  private closeSubMenus(): void {
    for (const { anchor, menu } of this.subMenus) {
      menu.remove();
      anchor.setAttribute('aria-expanded', 'false');
    }
    this.subMenus = [];
  }

  /** Close the innermost open submenu and return its anchor (to refocus). */
  private popSubMenu(): HTMLElement | null {
    const top = this.subMenus.pop();
    if (!top) return null;
    top.menu.remove();
    top.anchor.setAttribute('aria-expanded', 'false');
    return top.anchor;
  }

  private menuReturnFocus: HTMLElement | null = null;

  private closeMenu(restoreFocus = true): void {
    if (!this.menuEl) return;
    this.closeSubMenus();
    this.menuEl.remove();
    this.menuEl = null;
    for (const button of this.menuButtons.values()) button.setAttribute('aria-expanded', 'false');
    this.activeMenuButton = null;
    document.removeEventListener('click', this.onDocumentClick, true);
    document.removeEventListener('keydown', this.onMenuKey, true);
    // Return focus to whatever opened the menu (the menu bar / activity button / focused element).
    const restore = this.menuReturnFocus;
    this.menuReturnFocus = null;
    if (restoreFocus) restore?.focus?.();
  }

  /** The list currently taking keyboard focus: the innermost open submenu, else the root menu. */
  private activeMenuEl(): HTMLElement | null {
    return this.subMenus.length > 0 ? this.subMenus[this.subMenus.length - 1].menu : this.menuEl;
  }

  private menuItems(): HTMLElement[] {
    const host = this.activeMenuEl();
    return host
      ? [...host.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"]), [role="menuitemcheckbox"]:not([aria-disabled="true"]), [role="option"]:not([aria-disabled="true"])')]
      : [];
  }

  private readonly onDocumentClick = (event: MouseEvent): void => {
    if (!this.menuEl) return;
    const target = event.target as Node;
    const inside =
      this.menuEl.contains(target) ||
      this.subMenus.some((s) => s.menu.contains(target)) ||
      Boolean(this.activeMenuButton?.contains(target));
    if (!inside) this.closeMenu();
  };

  // Keyboard navigation for the open floating menu (WAI-ARIA menu pattern): Up/Down move between items
  // (wrapping), Home/End jump to the ends, Right opens a submenu, Left/Escape steps back out. Items are
  // <button>s, so Enter/Space activate them natively.
  private readonly onMenuKey = (event: KeyboardEvent): void => {
    if (!this.menuEl) return;
    if (event.key === 'Escape') {
      // Escape closes the innermost submenu first, then the whole menu.
      if (this.subMenus.length > 0) this.popSubMenu()?.focus();
      else this.closeMenu();
      return;
    }
    const items = this.menuItems();
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focusAt = (i: number): void => items[(i + items.length) % items.length]?.focus();
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusAt(index + 1); break;
      case 'ArrowUp': event.preventDefault(); focusAt(index - 1); break;
      case 'Home': event.preventDefault(); focusAt(0); break;
      case 'End': event.preventDefault(); focusAt(items.length - 1); break;
      case 'ArrowRight': {
        const active = document.activeElement as HTMLElement | null;
        if (active?.getAttribute('aria-haspopup') === 'true') {
          event.preventDefault();
          active.click(); // open its submenu
          this.menuItems()[0]?.focus();
        } else if (this.subMenus.length === 0 && this.activeMenuButton) {
          event.preventDefault();
          this.switchMenuBarItem(1);
        }
        break;
      }
      case 'ArrowLeft': {
        if (this.subMenus.length > 0) {
          event.preventDefault();
          this.popSubMenu()?.focus();
        } else if (this.activeMenuButton) {
          event.preventDefault();
          this.switchMenuBarItem(-1);
        }
        break;
      }
      default: break;
    }
  };

  /* ----- Status bar ----- */
  addStatusItem(side: 'left' | 'right', element: HTMLElement): void {
    (side === 'left' ? this.el.statusLeft : this.el.statusRight).appendChild(element);
  }

  /* ----- Bottom panel (tabbed) ----- */
  addPanelView(view: PanelView): void {
    const tab = document.createElement('div');
    tab.className = 'znxstudio-panel-tab';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-label', view.title);
    tab.setAttribute('aria-selected', 'false');
    tab.tabIndex = 0;

    const label = document.createElement('span');
    label.className = 'znxstudio-panel-tab-label';
    label.textContent = view.title;
    label.addEventListener('click', () => this.showPanelView(view.id));
    // Keyboard: Enter/Space activates the focused tab.
    tab.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.showPanelView(view.id);
      }
    });

    const close = document.createElement('button');
    close.className = 'znxstudio-panel-tab-close';
    close.textContent = '×';
    close.title = `Close ${view.title}`;
    close.setAttribute('aria-label', `Close ${view.title}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      for (const handler of this.panelCloseHandlers) handler(view.id);
    });
    tab.append(label, close);

    const container = document.createElement('div');
    container.className = 'znxstudio-panel-view';
    container.setAttribute('role', 'tabpanel');
    container.setAttribute('aria-label', view.title);
    container.appendChild(view.element);

    this.el.panelTabs.appendChild(tab);
    this.el.panelViews.appendChild(container);
    this.panelTabs.set(view.id, { tab, view: container, title: view.title });
    this.ensureOverflowButton();

    // Registration only contributes the view; it must not activate it. The
    // layout owner applies persisted/default preferences below, while a user
    // action can explicitly reveal an optional panel such as Terminal.
    for (const handler of this.panelAddedHandlers) handler(view.id);
  }

  /** Fires when a module registers a panel view. */
  onDidAddPanelView(handler: (id: string) => void): void {
    this.panelAddedHandlers.push(handler);
  }

  showPanelView(id: string): void {
    if (!this.panelTabs.has(id)) return;
    this.activePanel = id;
    for (const [viewId, { tab, view }] of this.panelTabs) {
      const active = viewId === id;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      view.classList.toggle('is-active', active);
    }
    this.togglePanel(true);
    for (const handler of this.panelActiveHandlers) handler(id);
  }

  togglePanel(force?: boolean): void {
    this.panelVisible = force ?? !this.panelVisible;
    this.el.panel.classList.toggle('is-hidden', !this.panelVisible);
    // The root class is what the layout model drives; keep them agreeing.
    this.root.classList.toggle('panel-hidden', !this.panelVisible);
    for (const handler of this.panelVisibilityHandlers) handler(this.panelVisible);
  }

  /** Fires when a module shows or hides the panel imperatively (showPanelView). */
  onDidTogglePanel(handler: (visible: boolean) => void): void {
    this.panelVisibilityHandlers.push(handler);
  }

  /* ----- Accessibility + responsiveness (UX-7) ----- */

  /**
   * Honor the OS "reduce motion" setting: stamp `data-motion` on the root so CSS
   * can drop transitions/animations. Re-evaluated when the preference changes.
   */
  private applyMotionPreference(): void {
    const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    const apply = () => this.root.setAttribute('data-motion', query?.matches ? 'reduced' : 'full');
    apply();
    query?.addEventListener?.('change', apply);
  }

  /**
   * Toggle `is-narrow` on the workbench when the window gets tight, so CSS can
   * compact the chrome (icon-only, thinner gutters) instead of overflowing.
   */
  private installResponsive(): void {
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? window.innerWidth;
      this.root.classList.toggle('is-narrow', width < 900);
      this.root.classList.toggle('is-compact', width < 640);
    });
    observer.observe(this.root);
  }

  /* ----- Toasts ----- */
  private readonly toastTimers = new Map<HTMLElement, ReturnType<typeof setTimeout>[]>();

  showToast(message: string, kind: ToastKind = 'info'): void {
    // One shared copy convention (WS30): consistent terminal punctuation, so state
    // and error toasts read the same. Dedup + rendering both use the normalized text.
    const text = normalizeToastMessage(message);

    // Dedup: don't stack an identical toast; refresh the existing one's dismissal timer instead.
    const duplicate = [...this.el.toasts.children].find(
      (node): node is HTMLElement =>
        node instanceof HTMLElement && node.dataset.kind === kind && node.dataset.message === text,
    );
    if (duplicate) {
      this.scheduleToastDismiss(duplicate, kind);
      return;
    }

    const toast = document.createElement('div');
    toast.className = `znxstudio-toast znxstudio-toast--${kind}`;
    toast.dataset.kind = kind;
    toast.dataset.message = text;
    // Errors are urgent — announce them assertively (role="alert") rather than through the polite region.
    if (kind === 'error') toast.setAttribute('role', 'alert');

    // A severity marker so meaning is never carried by color alone.
    const icon = document.createElement('span');
    icon.className = 'znxstudio-toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = kind === 'error' ? '⚠' : kind === 'success' ? '✓' : 'ℹ';

    const label = document.createElement('span');
    label.className = 'znxstudio-toast-message';
    label.textContent = text;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'znxstudio-toast-close';
    close.setAttribute('aria-label', 'Dismiss notification');
    close.title = 'Dismiss';
    close.textContent = '✕';
    close.addEventListener('click', () => this.dismissToast(toast));

    toast.append(icon, label, close);
    this.el.toasts.appendChild(toast);
    this.scheduleToastDismiss(toast, kind);
  }

  // Info/success fade after a readable delay; errors persist until dismissed so a critical message is
  // never lost before it can be read (the ✕ dismisses any toast by mouse or keyboard).
  private scheduleToastDismiss(toast: HTMLElement, kind: ToastKind): void {
    for (const timer of this.toastTimers.get(toast) ?? []) clearTimeout(timer);
    if (kind === 'error') {
      this.toastTimers.delete(toast);
      return;
    }
    const leave = setTimeout(() => toast.classList.add('is-leaving'), 4200);
    const remove = setTimeout(() => this.dismissToast(toast), 4600);
    this.toastTimers.set(toast, [leave, remove]);
  }

  private dismissToast(toast: HTMLElement): void {
    for (const timer of this.toastTimers.get(toast) ?? []) clearTimeout(timer);
    this.toastTimers.delete(toast);
    toast.remove();
  }
}
