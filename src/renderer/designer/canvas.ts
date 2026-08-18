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
import { applyStyles, containerStyles, nodeLayoutStyles, previewColor, previewSize, visualStyles } from './propertyStyles';

// ---------------------------------------------------------------------------
// Selection model
// ---------------------------------------------------------------------------

export interface SelectionState {
  selectedIds: Set<string>;
  primaryId: string | null;
}

export interface NodeResizeEvent {
  nodeId: string;
  width: number;
  height: number;
  previousWidth: string | number | boolean;
  previousHeight: string | number | boolean;
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

  private readonly _onNodeDragStart = new Emitter<{ nodeId: string; event: MouseEvent; grabOffsetX: number; grabOffsetY: number }>();
  readonly onNodeDragStart: Event<{ nodeId: string; event: MouseEvent; grabOffsetX: number; grabOffsetY: number }> = this._onNodeDragStart.event;

  private readonly _onNodeResize = new Emitter<NodeResizeEvent>();
  readonly onNodeResize: Event<NodeResizeEvent> = this._onNodeResize.event;

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

    // Keep the whole design surface available as an append target. Once a
    // screen contained its first component the old implementation left only a
    // 2px trailing indicator, making subsequent drops practically impossible.
    // More specific child/container zones still take precedence in the drag
    // manager, so this acts only as a forgiving root-level fallback.
    this.registerNodeDropZone(this.element, null, screen.rootChildren.length, true);

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
    if (node.properties.contentDescription) wrapper.setAttribute('aria-label', String(node.properties.contentDescription));
    if (node.properties.semanticRole && node.properties.semanticRole !== 'auto') wrapper.setAttribute('role', String(node.properties.semanticRole));
    if (node.properties.testTag) wrapper.dataset.testTag = String(node.properties.testTag);
    if (node.properties.focusable === true) wrapper.tabIndex = 0;
    wrapper.classList.toggle('zd-node-clickable', node.properties.clickable === true);
    applyStyles(wrapper, nodeLayoutStyles(node));
    wrapper.classList.toggle('zd-node-hidden', node.properties.visible === false);

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
      const startRect = wrapper.getBoundingClientRect();
      const scaleX = startRect.width > 0 ? wrapper.offsetWidth / startRect.width : 1;
      const scaleY = startRect.height > 0 ? wrapper.offsetHeight / startRect.height : 1;
      const moveCheck = (me: MouseEvent) => {
        if (Math.abs(me.clientX - startX) > 4 || Math.abs(me.clientY - startY) > 4) {
          document.removeEventListener('mousemove', moveCheck);
          document.removeEventListener('mouseup', upCheck);
          this._onNodeDragStart.fire({
            nodeId: node.id,
            event: me,
            grabOffsetX: Math.max(0, Math.round((startX - startRect.left) * scaleX)),
            grabOffsetY: Math.max(0, Math.round((startY - startRect.top) * scaleY)),
          });
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

    const resizeHandle = document.createElement('span');
    resizeHandle.className = 'zd-resize-handle';
    resizeHandle.title = 'Drag to resize';
    resizeHandle.setAttribute('aria-label', `Resize ${descriptor?.label ?? node.kind}`);
    resizeHandle.addEventListener('mousedown', (event) => this.startResize(node, wrapper, event));
    wrapper.appendChild(resizeHandle);

    // Container children + drop zones
    if (descriptor?.isContainer) {
      const childContainer = document.createElement('div');
      childContainer.className = 'zd-node-children';
      applyStyles(childContainer, containerStyles(node));

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

      // The whole container is an append target; the smaller insertion zones
      // still win hit testing when the pointer is near a specific boundary.
      this.registerNodeDropZone(childContainer, node.id, node.children.length);

      wrapper.appendChild(childContainer);
    }

    this.nodeElements.set(node.id, wrapper);
    return wrapper;
  }

  private renderComponentVisual(node: ComponentNode, descriptor: ReturnType<typeof getDescriptor>): HTMLElement {
    const el = document.createElement('div');
    el.className = 'zd-component-visual';
    applyStyles(el, visualStyles(node));

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
        preview.style.fontSize = `${Math.max(1, Number(node.properties.fontSize) || 14)}px`;
        if (Number(node.properties.lineHeight) > 0) preview.style.lineHeight = `${Number(node.properties.lineHeight)}px`;
        if (Number(node.properties.letterSpacing) !== 0) preview.style.letterSpacing = `${Number(node.properties.letterSpacing)}px`;
        preview.style.textAlign = String(node.properties.textAlign ?? 'start') as CSSStyleDeclaration['textAlign'];
        if (Number(node.properties.maxLines) > 0) {
          preview.style.display = '-webkit-box';
          preview.style.setProperty('-webkit-line-clamp', String(node.properties.maxLines));
          preview.style.setProperty('-webkit-box-orient', 'vertical');
          preview.style.overflow = 'hidden';
        }
        break;
      }
      case 'button': {
        const btn = document.createElement('div');
        btn.className = `zd-preview-button zd-preview-button-${node.properties.style ?? 'primary'}`;
        btn.textContent = `${node.properties.loading === true ? '◌ ' : ''}${node.properties.iconName ? `${String(node.properties.iconName)} ` : ''}${String(node.properties.label ?? 'Button')}`;
        const containerColor = previewColor(node.properties.containerColor);
        const contentColor = previewColor(node.properties.contentColor);
        if (containerColor) btn.style.backgroundColor = containerColor;
        if (contentColor) btn.style.color = contentColor;
        const cr = node.properties.cornerRadius;
        if (cr !== undefined) btn.style.borderRadius = `${Math.max(0, Number(cr))}px`;
        preview.appendChild(btn);
        break;
      }
      case 'input': {
        const inp = document.createElement('div');
        inp.className = 'zd-preview-input';
        const label = node.properties.label ? `${String(node.properties.label)}${node.properties.required === true ? ' *' : ''}: ` : '';
        const icons = `${node.properties.leadingIcon ? `${String(node.properties.leadingIcon)} ` : ''}${node.properties.trailingIcon ? ` ${String(node.properties.trailingIcon)}` : ''}`;
        inp.textContent = `${label}${String(node.properties.placeholder ?? 'Enter text')}${icons}`;
        if (node.properties.inputType === 'multiline') inp.style.minHeight = '64px';
        if (node.properties.isError === true) inp.classList.add('is-error');
        if (node.properties.readOnly === true) inp.classList.add('is-readonly');
        if (node.properties.cornerRadius !== undefined) inp.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        preview.appendChild(inp);
        if (node.properties.supportingText) {
          const supporting = document.createElement('small');
          supporting.className = 'zd-preview-supporting-text';
          supporting.textContent = String(node.properties.supportingText);
          preview.appendChild(supporting);
        }
        break;
      }
      case 'checkbox': {
        const cb = document.createElement('div');
        cb.className = 'zd-preview-checkbox';
        const cbBox = document.createElement('span');
        cbBox.className = 'zd-cb-box';
        cbBox.textContent = node.properties.checked === true ? '☑' : '☐';
        const checkColor = previewColor(node.properties.checkColor);
        if (checkColor) cbBox.style.color = checkColor;
        const labelColor = previewColor(node.properties.labelColor);
        if (labelColor) cb.style.color = labelColor;
        cb.append(cbBox, ' ', String(node.properties.label ?? ''));
        preview.appendChild(cb);
        break;
      }
      case 'switch': {
        const sw = document.createElement('div');
        sw.className = 'zd-preview-switch';
        const swTrack = document.createElement('span');
        swTrack.className = 'zd-sw-track';
        swTrack.classList.toggle('is-checked', node.properties.checked === true);
        const trackColor = previewColor(node.properties.trackColor);
        const thumbColor = previewColor(node.properties.thumbColor);
        if (trackColor) swTrack.style.backgroundColor = trackColor;
        if (thumbColor) swTrack.style.setProperty('--zd-switch-thumb', thumbColor);
        sw.append(swTrack, ' ', String(node.properties.label ?? ''));
        preview.appendChild(sw);
        break;
      }
      case 'image': {
        const img = document.createElement('div');
        img.className = 'zd-preview-image';
        img.textContent = `🖼 ${String(node.properties.source || 'image')}`;
        const imageHeight = previewSize(node.properties.height);
        if (imageHeight) img.style.height = imageHeight;
        img.style.objectFit = String(node.properties.fit ?? 'contain') as CSSStyleDeclaration['objectFit'];
        if (node.properties.cornerRadius !== undefined) img.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        const tint = previewColor(node.properties.tintColor);
        if (tint) img.style.color = tint;
        preview.appendChild(img);
        break;
      }
      case 'icon': {
        preview.textContent = String(node.properties.name ?? 'star');
        preview.style.fontSize = `${Number(node.properties.iconSize) || 24}px`;
        const tint = previewColor(node.properties.tintColor);
        if (tint) preview.style.color = tint;
        break;
      }
      case 'card': {
        preview.classList.add('zd-preview-card');
        preview.textContent = 'Card';
        if (node.properties.cornerRadius !== undefined) preview.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        preview.style.boxShadow = `0 ${Math.max(1, Number(node.properties.elevation) || 0)}px ${Math.max(2, Number(node.properties.elevation) || 0) * 2}px rgba(0,0,0,.18)`;
        break;
      }
      case 'progress': {
        if (node.properties.progressStyle === 'circular') {
          preview.classList.add('zd-preview-progress-circular');
          const indicator = previewColor(node.properties.indicatorColor);
          const track = previewColor(node.properties.trackColor);
          if (track) preview.style.borderColor = track;
          if (indicator) preview.style.borderTopColor = indicator;
        } else {
          const bar = document.createElement('div');
          bar.className = 'zd-preview-progress';
          bar.innerHTML = '<div class="zd-progress-track"><div class="zd-progress-fill"></div></div>';
          if (node.properties.indeterminate === true) bar.classList.add('is-indeterminate');
          const indicator = previewColor(node.properties.indicatorColor);
          const track = previewColor(node.properties.trackColor);
          if (indicator) bar.style.setProperty('--zd-progress-indicator', indicator);
          if (track) bar.style.setProperty('--zd-progress-track', track);
          preview.appendChild(bar);
        }
        break;
      }
      case 'divider': {
        preview.classList.add('zd-preview-divider');
        preview.style.height = `${Math.max(1, Number(node.properties.thickness) || 1)}px`;
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
          if (node.properties.separator === false) item.style.borderBottom = '0';
          list.appendChild(item);
        }
        preview.appendChild(list);
        break;
      }
      case 'slider': {
        const slider = document.createElement('div');
        slider.className = 'zd-preview-slider';
        slider.innerHTML = '<span></span>';
        const active = previewColor(node.properties.activeColor);
        if (active) slider.style.setProperty('--zd-slider-active', active);
        if (node.properties.showValue === true) slider.dataset.value = String(node.properties.value ?? 0);
        preview.appendChild(slider);
        break;
      }
      case 'dropdown': {
        preview.classList.add('zd-preview-control');
        preview.textContent = `${String(node.properties.label ?? 'Select')}  ▾`;
        if (node.properties.cornerRadius !== undefined) preview.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        break;
      }
      case 'navbar': {
        const bar = document.createElement('div');
        bar.className = 'zd-preview-navbar';
        bar.textContent = `${node.properties.showBack === true ? '‹  ' : ''}${String(node.properties.title ?? 'Title')}`;
        if (node.properties.barStyle === 'large') bar.style.fontSize = '28px';
        if (node.properties.barStyle === 'medium') bar.style.fontSize = '22px';
        if (node.properties.cornerRadius !== undefined) bar.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        preview.appendChild(bar);
        break;
      }
      case 'fab': {
        const fab = document.createElement('div');
        fab.className = 'zd-preview-fab';
        fab.textContent = String(node.properties.iconName ?? '+');
        fab.classList.add(`zd-preview-fab-${node.properties.fabSize ?? 'regular'}`);
        if (node.properties.cornerRadius !== undefined) fab.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        preview.appendChild(fab);
        if (node.properties.label) preview.append(` ${String(node.properties.label)}`);
        break;
      }
      case 'bottomnav':
      case 'tabs': {
        preview.classList.add('zd-preview-nav-items');
        for (const item of String(node.properties.items ?? '').split(',').map((v) => v.trim()).filter(Boolean)) {
          const tab = document.createElement('span');
          tab.textContent = item;
          preview.appendChild(tab);
        }
        break;
      }
      case 'chip': {
        preview.classList.add('zd-preview-chip', `zd-preview-chip-${node.properties.chipStyle ?? 'filled'}`);
        preview.textContent = String(node.properties.label ?? 'Chip');
        if (node.properties.selected === true) preview.classList.add('is-selected');
        if (node.properties.cornerRadius !== undefined) preview.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        break;
      }
      case 'badge': {
        preview.classList.add('zd-preview-badge');
        preview.textContent = String(node.properties.content || '•');
        break;
      }
      case 'snackbar': {
        preview.classList.add('zd-preview-snackbar');
        preview.textContent = String(node.properties.message ?? 'Action completed');
        if (node.properties.action) preview.textContent += `   ${String(node.properties.action).toUpperCase()}`;
        if (node.properties.cornerRadius !== undefined) preview.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        break;
      }
      case 'dialog': {
        preview.classList.add('zd-preview-dialog');
        const title = document.createElement('strong');
        title.textContent = String(node.properties.title ?? 'Dialog');
        const actions = document.createElement('small');
        actions.textContent = `${String(node.properties.cancelLabel ?? 'Cancel')}   ${String(node.properties.confirmLabel ?? 'OK')}`;
        preview.append(title, actions);
        if (node.properties.cornerRadius !== undefined) preview.style.borderRadius = `${Math.max(0, Number(node.properties.cornerRadius))}px`;
        break;
      }
      default: {
        preview.textContent = descriptor?.label ?? node.kind;
      }
    }

    el.appendChild(preview);

    const color = String(node.properties.color ?? '');
    const colors: Record<string, string> = {
      primary: 'var(--zd-md-primary)', secondary: 'var(--zd-md-on-surface-muted)',
      accent: 'var(--z-accent)', error: 'var(--z-error)', success: 'var(--z-success)',
    };
    if (colors[color] && node.kind !== 'button') preview.style.color = colors[color];
    if (node.properties.weight === 'bold') preview.style.fontWeight = '700';
    if (node.properties.weight === 'light') preview.style.fontWeight = '300';

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
    this.registerNodeDropZone(placeholder, null, 0, true);
    return placeholder;
  }

  private registerNodeDropZone(element: HTMLElement, parentId: string | null, index: number, freeform = false): void {
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
    const dispose = this.dragDrop.registerDropZone(element, parentId, index, accepts, freeform);
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

  canvasPoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.element.offsetWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? this.element.offsetHeight / rect.height : 1;
    return {
      x: Math.max(0, Math.round((clientX - rect.left) * scaleX - 8)),
      y: Math.max(0, Math.round((clientY - rect.top) * scaleY - 8)),
    };
  }

  private startResize(node: ComponentNode, wrapper: HTMLElement, event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.select(node.id);
    const rect = wrapper.getBoundingClientRect();
    const scaleX = rect.width > 0 ? wrapper.offsetWidth / rect.width : 1;
    const scaleY = rect.height > 0 ? wrapper.offsetHeight / rect.height : 1;
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = wrapper.offsetWidth;
    const startHeight = wrapper.offsetHeight;
    const previousWidth = node.properties.width ?? '';
    const previousHeight = node.properties.height ?? '';
    let width = startWidth;
    let height = startHeight;
    wrapper.classList.add('zd-node-resizing');

    const move = (moveEvent: MouseEvent): void => {
      width = Math.max(24, Math.round(startWidth + (moveEvent.clientX - startX) * scaleX));
      height = Math.max(24, Math.round(startHeight + (moveEvent.clientY - startY) * scaleY));
      wrapper.style.width = `${width}px`;
      wrapper.style.height = `${height}px`;
    };
    const up = (): void => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      wrapper.classList.remove('zd-node-resizing');
      if (width !== startWidth || height !== startHeight) {
        this._onNodeResize.fire({ nodeId: node.id, width, height, previousWidth, previousHeight });
      }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
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
    this._onNodeResize.dispose();
    this.element.remove();
  }
}
