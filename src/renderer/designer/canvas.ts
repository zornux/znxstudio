/**
 * Design surface: renders the component tree inside the device viewport,
 * handles selection, multi-select, resize handles, context menus, and
 * coordinates with the DragDropManager for drop zones.
 */

import { Emitter, type Event } from '../core/Emitter';
import type { ComponentNode } from './designerDocument';
import type { DesignerDocument } from './designerDocument';
import { getDescriptor } from './componentModel';
import type { DragDropManager, DragSource } from './dragDrop';

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

export interface SelectionState {
  selectedIds: Set<string>;
  primaryId: string | null;
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export class DesignCanvas {
  readonly element: HTMLDivElement;
  private doc: DesignerDocument | null = null;
  private dragDrop: DragDropManager | null = null;
  private readonly nodeElements = new Map<string, HTMLElement>();
  private readonly dropZoneDisposers: (() => void)[] = [];
  private selection: SelectionState = { selectedIds: new Set(), primaryId: null };

  private readonly _onSelectionChange = new Emitter<SelectionState>();
  readonly onSelectionChange: Event<SelectionState> = this._onSelectionChange.event;

  private readonly _onContextMenu = new Emitter<{ nodeId: string; x: number; y: number }>();
  readonly onContextMenu: Event<{ nodeId: string; x: number; y: number }> = this._onContextMenu.event;

  private readonly _onNodeDragStart = new Emitter<{ nodeId: string; event: MouseEvent }>();
  readonly onNodeDragStart: Event<{ nodeId: string; event: MouseEvent }> = this._onNodeDragStart.event;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zd-canvas';
    this.element.setAttribute('role', 'application');
    this.element.setAttribute('aria-label', 'Design canvas');
    this.element.tabIndex = 0;

    this.element.addEventListener('click', (e) => {
      if (e.target === this.element) this.clearSelection();
    });

    this.element.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  bind(doc: DesignerDocument, dragDrop: DragDropManager): void {
    this.doc = doc;
    this.dragDrop = dragDrop;
    doc.onDidChange(() => this.render());
    this.render();
  }

  // ---- Selection ----

  getSelection(): SelectionState {
    return this.selection;
  }

  select(nodeId: string, additive = false): void {
    if (additive) {
      if (this.selection.selectedIds.has(nodeId)) {
        this.selection.selectedIds.delete(nodeId);
        if (this.selection.primaryId === nodeId) {
          this.selection.primaryId = this.selection.selectedIds.size > 0
            ? [...this.selection.selectedIds][0] : null;
        }
      } else {
        this.selection.selectedIds.add(nodeId);
        this.selection.primaryId = nodeId;
      }
    } else {
      this.selection.selectedIds.clear();
      this.selection.selectedIds.add(nodeId);
      this.selection.primaryId = nodeId;
    }
    this.applySelectionStyles();
    this._onSelectionChange.fire(this.selection);
  }

  clearSelection(): void {
    this.selection.selectedIds.clear();
    this.selection.primaryId = null;
    this.applySelectionStyles();
    this._onSelectionChange.fire(this.selection);
  }

  selectAll(): void {
    if (!this.doc) return;
    this.doc.walk((node) => this.selection.selectedIds.add(node.id));
    if (this.selection.selectedIds.size > 0 && !this.selection.primaryId) {
      this.selection.primaryId = [...this.selection.selectedIds][0];
    }
    this.applySelectionStyles();
    this._onSelectionChange.fire(this.selection);
  }

  // ---- Rendering ----

  render(): void {
    if (!this.doc) return;
    this.clearDropZones();
    this.nodeElements.clear();
    this.element.innerHTML = '';

    const screen = this.doc.activeScreen();
    if (!screen) {
      const empty = document.createElement('div');
      empty.className = 'zd-canvas-empty';
      empty.textContent = 'No screen selected. Create a screen to start designing.';
      this.element.appendChild(empty);
      return;
    }

    if (screen.rootChildren.length === 0) {
      const placeholder = this.createRootDropPlaceholder();
      this.element.appendChild(placeholder);
      return;
    }

    for (const child of screen.rootChildren) {
      this.element.appendChild(this.renderNode(child, 0));
    }

    // Add a trailing drop zone at the root level
    this.element.appendChild(this.createDropIndicator(null, screen.rootChildren.length));

    this.applySelectionStyles();
  }

  private renderNode(node: ComponentNode, depth: number): HTMLElement {
    const descriptor = getDescriptor(node.kind);
    const wrapper = document.createElement('div');
    wrapper.className = `zd-node zd-node-${node.kind}`;
    wrapper.dataset.nodeId = node.id;
    wrapper.setAttribute('role', 'treeitem');
    wrapper.setAttribute('aria-label', `${descriptor?.label ?? node.kind} component`);
    wrapper.tabIndex = -1;

    // Component visual
    const visual = this.renderComponentVisual(node, descriptor);
    wrapper.appendChild(visual);

    // Selection and interaction
    wrapper.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      this.select(node.id, e.ctrlKey || e.metaKey);

      // Start canvas drag after a small threshold
      const startX = e.clientX;
      const startY = e.clientY;
      const moveCheck = (me: MouseEvent) => {
        if (Math.abs(me.clientX - startX) > 4 || Math.abs(me.clientY - startY) > 4) {
          document.removeEventListener('mousemove', moveCheck);
          document.removeEventListener('mouseup', upCheck);
          this._onNodeDragStart.fire({ nodeId: node.id, event: me });
        }
      };
      const upCheck = () => {
        document.removeEventListener('mousemove', moveCheck);
        document.removeEventListener('mouseup', upCheck);
      };
      document.addEventListener('mousemove', moveCheck);
      document.addEventListener('mouseup', upCheck);
    });

    wrapper.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!this.selection.selectedIds.has(node.id)) {
        this.select(node.id);
      }
      this._onContextMenu.fire({ nodeId: node.id, x: e.clientX, y: e.clientY });
    });

    // Container children + drop zones
    if (descriptor?.isContainer) {
      const childContainer = document.createElement('div');
      childContainer.className = 'zd-node-children';

      if (node.children.length === 0) {
        const emptyDrop = document.createElement('div');
        emptyDrop.className = 'zd-drop-zone zd-drop-empty';
        emptyDrop.textContent = `Drop components here`;
        this.registerNodeDropZone(emptyDrop, node.id, 0);
        childContainer.appendChild(emptyDrop);
      } else {
        for (let i = 0; i < node.children.length; i++) {
          childContainer.appendChild(this.createDropIndicator(node.id, i));
          childContainer.appendChild(this.renderNode(node.children[i], depth + 1));
        }
        childContainer.appendChild(this.createDropIndicator(node.id, node.children.length));
      }

      wrapper.appendChild(childContainer);
    }

    this.nodeElements.set(node.id, wrapper);
    return wrapper;
  }

  private renderComponentVisual(node: ComponentNode, descriptor: ReturnType<typeof getDescriptor>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'zd-component-visual';

    const kindLabel = document.createElement('span');
    kindLabel.className = 'zd-component-kind';
    kindLabel.textContent = descriptor?.icon ?? '?';
    el.appendChild(kindLabel);

    const preview = document.createElement('div');
    preview.className = 'zd-component-preview';

    switch (node.kind) {
      case 'text': {
        const content = String(node.properties.content ?? 'Text');
        const size = String(node.properties.size ?? 'body');
        preview.textContent = content;
        preview.classList.add(`zd-preview-text-${size}`);
        break;
      }
      case 'button': {
        const btn = document.createElement('div');
        btn.className = `zd-preview-button zd-preview-button-${node.properties.style ?? 'primary'}`;
        btn.textContent = String(node.properties.label ?? 'Button');
        preview.appendChild(btn);
        break;
      }
      case 'input': {
        const inp = document.createElement('div');
        inp.className = 'zd-preview-input';
        inp.textContent = String(node.properties.placeholder ?? 'Enter text');
        preview.appendChild(inp);
        break;
      }
      case 'checkbox': {
        const cb = document.createElement('div');
        cb.className = 'zd-preview-checkbox';
        const cbBox = document.createElement('span');
        cbBox.className = 'zd-cb-box';
        cbBox.textContent = '☐';
        cb.append(cbBox, ' ', String(node.properties.label ?? ''));
        preview.appendChild(cb);
        break;
      }
      case 'switch': {
        const sw = document.createElement('div');
        sw.className = 'zd-preview-switch';
        const swTrack = document.createElement('span');
        swTrack.className = 'zd-sw-track';
        sw.append(swTrack, ' ', String(node.properties.label ?? ''));
        preview.appendChild(sw);
        break;
      }
      case 'image': {
        const img = document.createElement('div');
        img.className = 'zd-preview-image';
        img.textContent = `🖼 ${String(node.properties.source || 'image')}`;
        preview.appendChild(img);
        break;
      }
      case 'card': {
        preview.classList.add('zd-preview-card');
        preview.textContent = 'Card';
        break;
      }
      case 'progress': {
        const bar = document.createElement('div');
        bar.className = 'zd-preview-progress';
        bar.innerHTML = '<div class="zd-progress-track"><div class="zd-progress-fill"></div></div>';
        preview.appendChild(bar);
        break;
      }
      case 'divider': {
        preview.classList.add('zd-preview-divider');
        break;
      }
      case 'spacer': {
        preview.classList.add('zd-preview-spacer');
        preview.textContent = `↕ ${node.properties.size ?? 16}dp`;
        break;
      }
      case 'column':
      case 'row':
      case 'stack':
      case 'grid':
      case 'scrollview': {
        preview.classList.add(`zd-preview-layout`);
        preview.classList.add(`zd-preview-${node.kind}`);
        break;
      }
      case 'list': {
        const list = document.createElement('div');
        list.className = 'zd-preview-list';
        for (let i = 0; i < 3; i++) {
          const item = document.createElement('div');
          item.className = 'zd-preview-list-item';
          item.textContent = `Item ${i + 1}`;
          list.appendChild(item);
        }
        preview.appendChild(list);
        break;
      }
      case 'navbar': {
        const bar = document.createElement('div');
        bar.className = 'zd-preview-navbar';
        bar.textContent = String(node.properties.title ?? 'Title');
        preview.appendChild(bar);
        break;
      }
      case 'fab': {
        const fab = document.createElement('div');
        fab.className = 'zd-preview-fab';
        fab.textContent = '+';
        preview.appendChild(fab);
        break;
      }
      default: {
        preview.textContent = descriptor?.label ?? node.kind;
      }
    }

    el.appendChild(preview);

    // Event indicator
    if (node.events.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'zd-event-badge';
      badge.textContent = `⚡${node.events.length}`;
      badge.title = node.events.map((e) => e.eventKey).join(', ');
      el.appendChild(badge);
    }

    return el;
  }

  // ---- Drop zones ----

  private createDropIndicator(parentId: string | null, index: number): HTMLElement {
    const indicator = document.createElement('div');
    indicator.className = 'zd-drop-zone zd-drop-indicator';
    this.registerNodeDropZone(indicator, parentId, index);
    return indicator;
  }

  private createRootDropPlaceholder(): HTMLElement {
    const placeholder = document.createElement('div');
    placeholder.className = 'zd-drop-zone zd-drop-root-placeholder';
    placeholder.textContent = 'Drag a component here to start building';
    this.registerNodeDropZone(placeholder, null, 0);
    return placeholder;
  }

  private registerNodeDropZone(element: HTMLElement, parentId: string | null, index: number): void {
    if (!this.dragDrop) return;
    const accepts = (source: DragSource): boolean => {
      if (source.origin === 'canvas' && parentId !== null) {
        // Prevent dropping into own descendants
        const node = this.doc?.getNode(source.nodeId);
        if (node && this.isDescendantOf(parentId, source.nodeId)) return false;
      }
      // Check if parent accepts children
      if (parentId !== null) {
        const parent = this.doc?.getNode(parentId);
        if (parent) {
          const desc = getDescriptor(parent.kind);
          if (desc && !desc.isContainer) return false;
        }
      }
      return true;
    };
    const dispose = this.dragDrop.registerDropZone(element, parentId, index, accepts);
    this.dropZoneDisposers.push(dispose);
  }

  private clearDropZones(): void {
    for (const dispose of this.dropZoneDisposers) dispose();
    this.dropZoneDisposers.length = 0;
  }

  // ---- Helpers ----

  private isDescendantOf(nodeId: string, ancestorId: string): boolean {
    if (!this.doc) return false;
    let current = this.doc.getNode(nodeId);
    while (current) {
      if (current.id === ancestorId) return true;
      current = current.parentId ? this.doc.getNode(current.parentId) : null;
    }
    return false;
  }

  private applySelectionStyles(): void {
    for (const [id, el] of this.nodeElements) {
      el.classList.toggle('zd-node-selected', this.selection.selectedIds.has(id));
      el.classList.toggle('zd-node-primary', this.selection.primaryId === id);
    }
  }

  scrollToNode(nodeId: string): void {
    const el = this.nodeElements.get(nodeId);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  highlightNode(nodeId: string): void {
    const el = this.nodeElements.get(nodeId);
    if (!el) return;
    el.classList.add('zd-node-flash');
    setTimeout(() => el.classList.remove('zd-node-flash'), 600);
  }

  // ---- Keyboard ----

  private onKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      this.clearSelection();
      e.preventDefault();
    }
    if (e.key === 'a' && (e.ctrlKey || e.metaKey)) {
      this.selectAll();
      e.preventDefault();
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selection.primaryId) {
        // Deletion is handled by the DesignerModule (pushes undo action)
        this.element.dispatchEvent(new CustomEvent('zd-delete-request', {
          detail: { nodeIds: [...this.selection.selectedIds] },
        }));
        e.preventDefault();
      }
    }
  }

  dispose(): void {
    this.clearDropZones();
    this._onSelectionChange.dispose();
    this._onContextMenu.dispose();
    this._onNodeDragStart.dispose();
    this.element.remove();
  }
}
