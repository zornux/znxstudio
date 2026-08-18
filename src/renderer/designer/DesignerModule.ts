/**
 * Android Visual Designer module — the primary entry point that wires together
 * the toolbox, canvas, properties panel, hierarchy tree, device preview, undo/
 * redo stack, drag-drop manager, and bidirectional source synchronization.
 *
 * Registers an activity bar item (only visible for zornux-mobile workspaces),
 * overlays the design surface via EditorService.showView(), and keeps the
 * Zornux source file in sync with visual changes.
 */

import type { IModule, ModuleContext, Disposable } from '../core/Module';
import {
  ServiceKeys,
  type EditorService,
  type WorkspaceService,
  type OutputService,
} from '../core/Contracts';
import { CommandIds } from '../commands/CommandIds';
import { DesignerDocument } from './designerDocument';
import { UndoRedoStack, type DesignerAction } from './undoRedo';
import { DragDropManager, type DropResult } from './dragDrop';
import { DeviceFrame } from './devicePreview';
import { DesignCanvas } from './canvas';
import { Toolbox } from './toolbox';
import { PropertiesPanel } from './properties';
import { HierarchyTree } from './hierarchy';
import { parseSource, emitSource, sourceNeedsUpdate } from './sourceSync';
import { getDescriptor } from './componentModel';

export class DesignerModule implements IModule {
  readonly id = 'znxstudio.designer';
  readonly displayName = 'Android Designer';

  private context!: ModuleContext;
  private doc = new DesignerDocument();
  private readonly undoStack = new UndoRedoStack();
  private readonly dragDrop = new DragDropManager();
  private readonly deviceFrame = new DeviceFrame();
  private readonly canvas = new DesignCanvas();
  private readonly toolbox = new Toolbox();
  private readonly properties = new PropertiesPanel();
  private readonly hierarchy = new HierarchyTree();

  private designerRoot: HTMLDivElement | null = null;
  private visible = false;
  private clipboard: ReturnType<DesignerDocument['cloneNode']>[] = [];
  private syncPaused = false;
  private activityRegistered = false;
  private detachObserver: (() => void) | null = null;

  activate(context: ModuleContext): void {
    this.context = context;

    // Register commands
    context.commands.register(CommandIds.DesignerOpen, () => this.openDesigner(), 'Zornux: Open Visual Designer');
    context.commands.register(CommandIds.DesignerClose, () => this.closeDesigner(), 'Zornux: Close Visual Designer');
    context.commands.register(CommandIds.DesignerUndo, () => this.undo(), 'Designer: Undo');
    context.commands.register(CommandIds.DesignerRedo, () => this.redo(), 'Designer: Redo');
    context.commands.register(CommandIds.DesignerDelete, () => this.deleteSelected(), 'Designer: Delete');
    context.commands.register(CommandIds.DesignerCopy, () => this.copySelected(), 'Designer: Copy');
    context.commands.register(CommandIds.DesignerPaste, () => this.pasteClipboard(), 'Designer: Paste');
    context.commands.register(CommandIds.DesignerDuplicate, () => this.duplicateSelected(), 'Designer: Duplicate');
    context.commands.register(CommandIds.DesignerSelectAll, () => this.canvas.selectAll(), 'Designer: Select All');
    context.commands.register(CommandIds.DesignerAddScreen, () => this.addScreen(), 'Designer: Add Screen');
    context.commands.register(CommandIds.DesignerToggleSource, () => this.toggleDesigner(), 'Designer: Toggle Source');

    // Enablement: designer commands only for mobile workspaces.
    const designerCommands = [
      CommandIds.DesignerOpen, CommandIds.DesignerClose, CommandIds.DesignerUndo,
      CommandIds.DesignerRedo, CommandIds.DesignerDelete, CommandIds.DesignerCopy,
      CommandIds.DesignerPaste, CommandIds.DesignerDuplicate, CommandIds.DesignerSelectAll,
      CommandIds.DesignerAddScreen, CommandIds.DesignerToggleSource,
    ];
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (designerCommands.includes(id as typeof designerCommands[number])) {
          return this.isMobileWorkspace();
        }
        return undefined;
      }),
    );

    // Wire up subsystems
    this.toolbox.bind(this.dragDrop);
    this.canvas.bind(this.doc, this.dragDrop);
    this.properties.bind(this.doc);
    this.hierarchy.bind(this.doc);

    // Drag-drop → document
    this.dragDrop.onDrop((result) => this.handleDrop(result));

    // Canvas selection → properties + hierarchy sync
    this.canvas.onSelectionChange((sel) => {
      this.properties.setNode(sel.primaryId);
      this.hierarchy.setSelected(sel.primaryId);
      if (sel.primaryId) this.revealInSource(sel.primaryId);
    });

    // Hierarchy selection → canvas + properties
    this.hierarchy.onSelect((nodeId) => {
      this.canvas.select(nodeId);
      this.canvas.scrollToNode(nodeId);
      this.properties.setNode(nodeId);
      this.revealInSource(nodeId);
    });

    // Canvas node drag → DnD manager
    this.canvas.onNodeDragStart(({ nodeId, event }) => {
      const node = this.doc.getNode(nodeId);
      const desc = node ? getDescriptor(node.kind) : undefined;
      this.dragDrop.startDrag(
        { origin: 'canvas', nodeId },
        event,
        desc?.label ?? node?.kind ?? 'Component',
      );
    });

    // Property changes → undo stack + document
    this.properties.onPropertyChange((change) => {
      this.undoStack.push({
        label: `Change ${change.key}`,
        execute: () => {
          this.doc.setProperty(change.nodeId, change.key, change.value);
          this.syncToSource();
        },
        undo: () => {
          this.doc.setProperty(change.nodeId, change.key, change.previousValue);
          this.syncToSource();
          this.properties.refresh();
        },
      });
    });

    // Event changes → undo stack
    this.properties.onEventChange((change) => {
      this.undoStack.push({
        label: `Edit ${change.eventKey} handler`,
        execute: () => {
          this.doc.setEvent(change.nodeId, change.eventKey, change.body);
          this.syncToSource();
        },
        undo: () => {
          if (change.previousBody !== null) {
            this.doc.setEvent(change.nodeId, change.eventKey, change.previousBody);
          } else {
            this.doc.removeEvent(change.nodeId, change.eventKey);
          }
          this.syncToSource();
          this.properties.refresh();
        },
      });
    });

    this.properties.onEventAdd(({ nodeId, eventKey }) => {
      this.undoStack.push({
        label: `Add ${eventKey} handler`,
        execute: () => {
          this.doc.setEvent(nodeId, eventKey, '');
          this.syncToSource();
          this.properties.refresh();
        },
        undo: () => {
          this.doc.removeEvent(nodeId, eventKey);
          this.syncToSource();
          this.properties.refresh();
        },
      });
    });

    this.properties.onEventRemove(({ nodeId, eventKey }) => {
      const node = this.doc.getNode(nodeId);
      const existing = node?.events.find((e) => e.eventKey === eventKey);
      const previousBody = existing?.body ?? '';
      this.undoStack.push({
        label: `Remove ${eventKey} handler`,
        execute: () => {
          this.doc.removeEvent(nodeId, eventKey);
          this.syncToSource();
          this.properties.refresh();
        },
        undo: () => {
          this.doc.setEvent(nodeId, eventKey, previousBody);
          this.syncToSource();
          this.properties.refresh();
        },
      });
    });

    // Canvas delete request
    this.canvas.element.addEventListener('zd-delete-request', ((e: CustomEvent) => {
      const nodeIds: string[] = e.detail.nodeIds;
      this.deleteNodes(nodeIds);
    }) as EventListener);

    // Toolbox keyboard placement
    this.toolbox.element.addEventListener('zd-toolbox-place', ((e: CustomEvent) => {
      this.handleKeyboardPlace(e.detail.componentKind);
    }) as EventListener);

    // Canvas & hierarchy context menus
    this.canvas.onContextMenu((info) => this.showContextMenu(info.nodeId, info.x, info.y));
    this.hierarchy.onContextMenu((info) => this.showContextMenu(info.nodeId, info.x, info.y));

    // Listen for workspace changes to show/hide the activity bar item
    const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (workspace) {
      workspace.onDidChangeFolders(() => {
        context.commands.notifyEnablementChanged();
        this.updateActivityItem();
      });
      this.updateActivityItem();
    }

    // Listen for active file changes to auto-parse .zx mobile files
    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) {
      editor.onDidChangeActiveFile((path) => {
        if (path && path.endsWith('.zx') && this.visible) {
          this.loadFromFile(path);
        }
      });
    }
  }

  // ---- Workspace gate ----

  private isMobileWorkspace(): boolean {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    return workspace?.folders().some((folder) => folder.detectedType === 'zornux-mobile') ?? false;
  }

  // ---- Activity bar ----

  private updateActivityItem(): void {
    const isMobile = this.isMobileWorkspace();

    if (isMobile && !this.activityRegistered) {
      this.context.layout.addActivityItem({
        id: 'znxstudio.designer',
        label: 'Android Visual Designer',
        icon: '▣',
        onSelect: () => this.toggleDesigner(),
        pinByDefault: true,
      });
      this.activityRegistered = true;
    }

    if (!isMobile) {
      if (this.visible) this.closeDesigner();
      if (this.activityRegistered) {
        this.context.layout.removeActivityItem('znxstudio.designer');
        this.activityRegistered = false;
      }
    }
  }

  // ---- Open / Close / Toggle ----

  private toggleDesigner(): void {
    if (this.visible) {
      this.closeDesigner();
    } else {
      this.openDesigner();
    }
  }

  private openDesigner(): void {
    if (this.visible) return;
    if (!this.isMobileWorkspace()) return;

    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;

    // Build the designer layout
    this.designerRoot = document.createElement('div');
    this.designerRoot.className = 'zd-root';

    // Left panel: Toolbox + Hierarchy
    const leftPanel = document.createElement('div');
    leftPanel.className = 'zd-left-panel';

    const toolboxSection = document.createElement('div');
    toolboxSection.className = 'zd-left-section zd-left-toolbox';
    toolboxSection.appendChild(this.toolbox.element);
    leftPanel.appendChild(toolboxSection);

    const hierarchySection = document.createElement('div');
    hierarchySection.className = 'zd-left-section zd-left-hierarchy';
    const hierHeader = document.createElement('div');
    hierHeader.className = 'zd-section-header';
    hierHeader.textContent = 'Hierarchy';
    hierarchySection.appendChild(hierHeader);
    hierarchySection.appendChild(this.hierarchy.element);
    leftPanel.appendChild(hierarchySection);

    this.designerRoot.appendChild(leftPanel);

    // Center: Device frame + Canvas
    const centerPanel = document.createElement('div');
    centerPanel.className = 'zd-center-panel';

    // Screen tabs
    const screenTabs = document.createElement('div');
    screenTabs.className = 'zd-screen-tabs';
    this.renderScreenTabs(screenTabs);
    centerPanel.appendChild(screenTabs);

    // Device frame wrapping the canvas
    this.deviceFrame.viewport.innerHTML = '';
    this.deviceFrame.viewport.appendChild(this.canvas.element);
    centerPanel.appendChild(this.deviceFrame.element);

    this.designerRoot.appendChild(centerPanel);

    // Right panel: Properties
    const rightPanel = document.createElement('div');
    rightPanel.className = 'zd-right-panel';
    const propsHeader = document.createElement('div');
    propsHeader.className = 'zd-section-header';
    propsHeader.textContent = 'Properties';
    rightPanel.appendChild(propsHeader);
    rightPanel.appendChild(this.properties.element);
    this.designerRoot.appendChild(rightPanel);

    // Show in the editor area
    editor.showView(this.designerRoot);
    this.visible = true;

    // Detect external dismissal (Esc / ✕ button removes our root from the DOM).
    this.observeDetach();

    // Sidebar: show toolbox
    this.context.layout.setSideBar('Designer', this.buildSideBarContent());

    // Try to load the current file
    const currentFile = editor.currentFile();
    if (currentFile?.endsWith('.zx')) {
      this.loadFromFile(currentFile);
    }

    // Re-render screen tabs on doc changes
    this.doc.onDidChange(() => {
      this.renderScreenTabs(screenTabs);
    });
  }

  private closeDesigner(): void {
    if (!this.visible) return;

    this.detachObserver?.();
    this.detachObserver = null;

    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) editor.hideView();

    this.visible = false;
    this.designerRoot = null;
  }

  private observeDetach(): void {
    if (!this.designerRoot) return;
    const root = this.designerRoot;
    const observer = new MutationObserver(() => {
      if (!root.isConnected) {
        this.detachObserver?.();
        this.detachObserver = null;
        this.visible = false;
        this.designerRoot = null;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    this.detachObserver = () => observer.disconnect();
  }

  // ---- Sidebar ----

  private buildSideBarContent(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'zd-sidebar';

    // Quick actions
    const actions = document.createElement('div');
    actions.className = 'zd-sidebar-actions';

    const undoBtn = this.createActionButton('Undo', '↩', () => this.undo());
    const redoBtn = this.createActionButton('Redo', '↪', () => this.redo());
    const addScreenBtn = this.createActionButton('Add Screen', '+📱', () => this.addScreen());
    const closeBtn = this.createActionButton('Close Designer', '✕', () => this.closeDesigner());

    actions.appendChild(undoBtn);
    actions.appendChild(redoBtn);
    actions.appendChild(addScreenBtn);
    actions.appendChild(closeBtn);
    container.appendChild(actions);

    // States section
    const statesHeader = document.createElement('div');
    statesHeader.className = 'zd-sidebar-section-header';
    statesHeader.textContent = 'Screen States';
    container.appendChild(statesHeader);

    const statesContainer = document.createElement('div');
    statesContainer.className = 'zd-sidebar-states';
    this.renderStatesSection(statesContainer);
    container.appendChild(statesContainer);

    this.doc.onDidChange(() => this.renderStatesSection(statesContainer));

    return container;
  }

  private renderStatesSection(container: HTMLElement): void {
    container.innerHTML = '';
    const screen = this.doc.activeScreen();
    if (!screen) return;

    for (const state of screen.states) {
      const row = document.createElement('div');
      row.className = 'zd-state-row';
      const nameSpan = document.createElement('span');
      nameSpan.className = 'zd-state-name';
      nameSpan.textContent = state.name;
      const valSpan = document.createElement('span');
      valSpan.className = 'zd-state-value';
      valSpan.textContent = state.initialValue;
      row.append(nameSpan, ' = ', valSpan);
      container.appendChild(row);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'zd-sidebar-btn';
    addBtn.textContent = '+ Add state';
    addBtn.addEventListener('click', () => this.addState());
    container.appendChild(addBtn);
  }

  private createActionButton(label: string, icon: string, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'zd-action-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.textContent = icon;
    btn.addEventListener('click', onClick);
    return btn;
  }

  // ---- Screen tabs ----

  private renderScreenTabs(container: HTMLElement): void {
    container.innerHTML = '';
    const screens = this.doc.getScreens();
    for (let i = 0; i < screens.length; i++) {
      const tab = document.createElement('button');
      tab.className = 'zd-screen-tab';
      tab.classList.toggle('zd-screen-tab-active', i === screens.indexOf(this.doc.activeScreen()!));
      tab.textContent = screens[i].name;
      tab.addEventListener('click', () => {
        this.doc.setActiveScreen(i);
        this.canvas.clearSelection();
        this.properties.setNode(null);
      });
      container.appendChild(tab);
    }

    const addTab = document.createElement('button');
    addTab.className = 'zd-screen-tab zd-screen-tab-add';
    addTab.textContent = '+';
    addTab.title = 'Add screen';
    addTab.setAttribute('aria-label', 'Add screen');
    addTab.addEventListener('click', () => this.addScreen());
    container.appendChild(addTab);
  }

  // ---- Source sync ----

  private async loadFromFile(path: string): Promise<void> {
    try {
      const content = await window.znxstudio.fs.readFile(path);
      if (!content.includes('mobile app')) return;
      this.syncPaused = true;
      const parsed = parseSource(content);
      this.doc.loadFromParsed(parsed.appName, parsed.startScreen, [...parsed.getScreens()]);
      this.doc.sourcePath = path;
      this.undoStack.clear();
      this.syncPaused = false;
    } catch {
      // File not readable or not a mobile file
    }
  }

  private syncToSource(): void {
    if (this.syncPaused || !this.doc.sourcePath) return;
    const source = emitSource(this.doc);
    window.znxstudio.fs.writeFile(this.doc.sourcePath, source).catch(() => {});
  }

  private revealInSource(nodeId: string): void {
    const node = this.doc.getNode(nodeId);
    if (!node?.sourceRange || !this.doc.sourcePath) return;
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) {
      editor.revealPosition(node.sourceRange.start, 0);
    }
  }

  // ---- Drop handling ----

  private handleDrop(result: DropResult): void {
    if (result.source.origin === 'toolbox') {
      const node = this.doc.createNode(result.source.componentKind);
      this.undoStack.push({
        label: `Add ${getDescriptor(node.kind)?.label ?? node.kind}`,
        execute: () => {
          this.doc.addChild(result.target.parentId, node, result.target.index);
          this.syncToSource();
        },
        undo: () => {
          this.doc.removeNode(node.id);
          this.syncToSource();
        },
      });
      this.canvas.select(node.id);
    } else if (result.source.origin === 'canvas') {
      const node = this.doc.getNode(result.source.nodeId);
      if (!node) return;
      const oldParentId = node.parentId;
      const oldIndex = this.doc.indexOf(node.id);
      this.undoStack.push({
        label: `Move ${getDescriptor(node.kind)?.label ?? node.kind}`,
        execute: () => {
          this.doc.moveNode(node.id, result.target.parentId, result.target.index);
          this.syncToSource();
        },
        undo: () => {
          this.doc.moveNode(node.id, oldParentId, oldIndex);
          this.syncToSource();
        },
      });
    }
  }

  private handleKeyboardPlace(componentKind: string): void {
    const parentId = this.canvas.getSelection().primaryId;
    const parent = parentId ? this.doc.getNode(parentId) : null;
    const desc = parent ? getDescriptor(parent.kind) : undefined;
    const targetParent = desc?.isContainer ? parentId : null;
    const screen = this.doc.activeScreen();
    const index = targetParent
      ? (parent?.children.length ?? 0)
      : (screen?.rootChildren.length ?? 0);

    const node = this.doc.createNode(componentKind);
    this.undoStack.push({
      label: `Add ${getDescriptor(node.kind)?.label ?? node.kind}`,
      execute: () => {
        this.doc.addChild(targetParent, node, index);
        this.syncToSource();
      },
      undo: () => {
        this.doc.removeNode(node.id);
        this.syncToSource();
      },
    });
    this.canvas.select(node.id);
  }

  // ---- Edit operations ----

  private undo(): void {
    this.undoStack.undo();
  }

  private redo(): void {
    this.undoStack.redo();
  }

  private deleteSelected(): void {
    const ids = [...this.canvas.getSelection().selectedIds];
    if (ids.length === 0) return;
    this.deleteNodes(ids);
  }

  private deleteNodes(nodeIds: string[]): void {
    const snapshots: Array<{ node: ReturnType<DesignerDocument['getNode']>; parentId: string | null; index: number }> = [];
    for (const id of nodeIds) {
      const node = this.doc.getNode(id);
      if (!node) continue;
      snapshots.push({
        node: this.doc.cloneNode(node),
        parentId: node.parentId,
        index: this.doc.indexOf(id),
      });
    }

    this.undoStack.push({
      label: `Delete ${nodeIds.length} component${nodeIds.length > 1 ? 's' : ''}`,
      execute: () => {
        for (const id of nodeIds) this.doc.removeNode(id);
        this.canvas.clearSelection();
        this.properties.setNode(null);
        this.syncToSource();
      },
      undo: () => {
        for (const snap of snapshots.reverse()) {
          if (snap.node) {
            this.doc.addChild(snap.parentId, snap.node, snap.index);
          }
        }
        this.syncToSource();
      },
    });
  }

  private copySelected(): void {
    this.clipboard = [];
    for (const id of this.canvas.getSelection().selectedIds) {
      const node = this.doc.getNode(id);
      if (node) this.clipboard.push(this.doc.cloneNode(node));
    }
  }

  private pasteClipboard(): void {
    if (this.clipboard.length === 0) return;
    const parentId = this.canvas.getSelection().primaryId;
    const parent = parentId ? this.doc.getNode(parentId) : null;
    const desc = parent ? getDescriptor(parent.kind) : undefined;
    const targetParent = desc?.isContainer ? parentId : null;

    const clones = this.clipboard.map((n) => this.doc.cloneNode(n));
    this.undoStack.push({
      label: `Paste ${clones.length} component${clones.length > 1 ? 's' : ''}`,
      execute: () => {
        for (const clone of clones) {
          this.doc.addChild(targetParent, clone);
        }
        this.syncToSource();
      },
      undo: () => {
        for (const clone of clones) {
          this.doc.removeNode(clone.id);
        }
        this.syncToSource();
      },
    });
  }

  private duplicateSelected(): void {
    const id = this.canvas.getSelection().primaryId;
    if (!id) return;
    const node = this.doc.getNode(id);
    if (!node) return;

    const clone = this.doc.cloneNode(node);
    const index = this.doc.indexOf(id) + 1;
    this.undoStack.push({
      label: `Duplicate ${getDescriptor(node.kind)?.label ?? node.kind}`,
      execute: () => {
        this.doc.addChild(node.parentId, clone, index);
        this.syncToSource();
      },
      undo: () => {
        this.doc.removeNode(clone.id);
        this.syncToSource();
      },
    });
    this.canvas.select(clone.id);
  }

  // ---- Screen management ----

  private addScreen(): void {
    const screens = this.doc.getScreens();
    let name = 'NewScreen';
    let suffix = 1;
    while (screens.some((s) => s.name === name)) {
      name = `NewScreen${suffix++}`;
    }

    const screenIndex = screens.length;
    this.undoStack.push({
      label: `Add screen ${name}`,
      execute: () => {
        this.doc.addScreen(name);
        this.doc.setActiveScreen(screenIndex);
        this.syncToSource();
      },
      undo: () => {
        this.doc.removeScreen(screenIndex);
        this.syncToSource();
      },
    });
  }

  private addState(): void {
    const screen = this.doc.activeScreen();
    if (!screen) return;
    let name = 'newState';
    let suffix = 1;
    while (screen.states.some((s) => s.name === name)) {
      name = `newState${suffix++}`;
    }

    this.undoStack.push({
      label: `Add state ${name}`,
      execute: () => {
        this.doc.addState(name, '""');
        this.syncToSource();
      },
      undo: () => {
        this.doc.removeState(name);
        this.syncToSource();
      },
    });
  }

  // ---- Context menu ----

  private showContextMenu(nodeId: string, x: number, y: number): void {
    const node = this.doc.getNode(nodeId);
    if (!node) return;

    const menu = document.createElement('div');
    menu.className = 'zd-context-menu';
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    const items: Array<{ label: string; action: () => void; shortcut?: string }> = [
      { label: 'Copy', action: () => this.copySelected(), shortcut: 'Ctrl+C' },
      { label: 'Paste', action: () => this.pasteClipboard(), shortcut: 'Ctrl+V' },
      { label: 'Duplicate', action: () => this.duplicateSelected(), shortcut: 'Ctrl+D' },
      { label: 'Delete', action: () => this.deleteSelected(), shortcut: 'Del' },
    ];

    const desc = getDescriptor(node.kind);
    if (desc?.isContainer) {
      items.unshift({ label: 'Add child…', action: () => this.toolbox.focus() });
    }

    for (const item of items) {
      const el = document.createElement('button');
      el.className = 'zd-context-item';
      el.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="zd-context-shortcut">${item.shortcut}</span>` : ''}`;
      el.addEventListener('click', () => {
        menu.remove();
        item.action();
      });
      menu.appendChild(el);
    }

    document.body.appendChild(menu);

    const dismiss = (e: Event) => {
      if (!menu.contains(e.target as Node)) {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
        document.removeEventListener('keydown', escHandler);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        menu.remove();
        document.removeEventListener('mousedown', dismiss);
        document.removeEventListener('keydown', escHandler);
      }
    };
    setTimeout(() => {
      document.addEventListener('mousedown', dismiss);
      document.addEventListener('keydown', escHandler);
    }, 0);
  }

  deactivate(): void {
    this.closeDesigner();
    this.doc.dispose();
    this.undoStack.dispose();
    this.dragDrop.dispose();
    this.deviceFrame.dispose();
    this.canvas.dispose();
    this.toolbox.dispose();
    this.properties.dispose();
    this.hierarchy.dispose();
  }
}
