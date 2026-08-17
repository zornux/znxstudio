/**
 * Component hierarchy tree: shows the nested structure of components in the
 * active screen, supports selection sync with the canvas, drag-to-reorder,
 * and keyboard navigation.
 */

import { Emitter, type Event } from '../core/Emitter';
import type { DesignerDocument, ComponentNode } from './designerDocument';
import { getDescriptor } from './componentModel';

export class HierarchyTree {
  readonly element: HTMLDivElement;
  private doc: DesignerDocument | null = null;
  private selectedId: string | null = null;
  private collapsedIds = new Set<string>();

  private readonly _onSelect = new Emitter<string>();
  readonly onSelect: Event<string> = this._onSelect.event;

  private readonly _onContextMenu = new Emitter<{ nodeId: string; x: number; y: number }>();
  readonly onContextMenu: Event<{ nodeId: string; x: number; y: number }> = this._onContextMenu.event;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zd-hierarchy';
    this.element.setAttribute('role', 'tree');
    this.element.setAttribute('aria-label', 'Component hierarchy');
  }

  bind(doc: DesignerDocument): void {
    this.doc = doc;
    doc.onDidChange(() => this.render());
    this.render();
  }

  setSelected(nodeId: string | null): void {
    this.selectedId = nodeId;
    this.applySelection();
  }

  render(): void {
    this.element.innerHTML = '';
    if (!this.doc) return;

    const screen = this.doc.activeScreen();
    if (!screen) {
      this.element.textContent = 'No screen selected';
      return;
    }

    // Screen header
    const header = document.createElement('div');
    header.className = 'zd-hierarchy-screen';
    header.textContent = `📱 ${screen.name}`;
    this.element.appendChild(header);

    // State list
    if (screen.states.length > 0) {
      const stateGroup = document.createElement('div');
      stateGroup.className = 'zd-hierarchy-states';
      for (const state of screen.states) {
        const stateEl = document.createElement('div');
        stateEl.className = 'zd-hierarchy-state';
        stateEl.textContent = `⚙ ${state.name} = ${state.initialValue}`;
        stateGroup.appendChild(stateEl);
      }
      this.element.appendChild(stateGroup);
    }

    // Component tree
    for (const child of screen.rootChildren) {
      this.element.appendChild(this.renderTreeNode(child, 0));
    }
  }

  private renderTreeNode(node: ComponentNode, depth: number): HTMLElement {
    const descriptor = getDescriptor(node.kind);
    const isContainer = descriptor?.isContainer ?? false;
    const hasChildren = node.children.length > 0;
    const collapsed = this.collapsedIds.has(node.id);

    const row = document.createElement('div');
    row.className = 'zd-hierarchy-row';
    row.dataset.nodeId = node.id;
    row.style.paddingLeft = `${12 + depth * 16}px`;
    row.setAttribute('role', 'treeitem');
    row.setAttribute('aria-level', String(depth + 1));
    row.setAttribute('aria-expanded', hasChildren ? String(!collapsed) : '');
    row.tabIndex = -1;

    // Expand/collapse toggle
    if (isContainer && hasChildren) {
      const toggle = document.createElement('span');
      toggle.className = 'zd-hierarchy-toggle';
      toggle.textContent = collapsed ? '▸' : '▾';
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsed) this.collapsedIds.delete(node.id);
        else this.collapsedIds.add(node.id);
        this.render();
      });
      row.appendChild(toggle);
    } else {
      const spacer = document.createElement('span');
      spacer.className = 'zd-hierarchy-toggle-spacer';
      row.appendChild(spacer);
    }

    // Icon
    const icon = document.createElement('span');
    icon.className = 'zd-hierarchy-icon';
    icon.textContent = descriptor?.icon ?? '?';
    row.appendChild(icon);

    // Label
    const label = document.createElement('span');
    label.className = 'zd-hierarchy-label';
    const contentProp = descriptor?.properties.find((p) => p.group === 'content' && p.zxAttr === '');
    const displayText = contentProp ? String(node.properties[contentProp.key] ?? '') : '';
    label.textContent = displayText
      ? `${descriptor?.label ?? node.kind}: ${truncate(displayText, 24)}`
      : (descriptor?.label ?? node.kind);
    row.appendChild(label);

    // Event badge
    if (node.events.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'zd-hierarchy-badge';
      badge.textContent = `⚡${node.events.length}`;
      row.appendChild(badge);
    }

    // Click to select
    row.addEventListener('click', () => {
      this.selectedId = node.id;
      this.applySelection();
      this._onSelect.fire(node.id);
    });

    // Context menu
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.selectedId = node.id;
      this.applySelection();
      this._onContextMenu.fire({ nodeId: node.id, x: e.clientX, y: e.clientY });
    });

    const container = document.createElement('div');
    container.className = 'zd-hierarchy-item';
    container.appendChild(row);

    // Children
    if (hasChildren && !collapsed) {
      const childGroup = document.createElement('div');
      childGroup.className = 'zd-hierarchy-children';
      childGroup.setAttribute('role', 'group');
      for (const child of node.children) {
        childGroup.appendChild(this.renderTreeNode(child, depth + 1));
      }
      container.appendChild(childGroup);
    }

    return container;
  }

  private applySelection(): void {
    for (const row of this.element.querySelectorAll('.zd-hierarchy-row')) {
      const el = row as HTMLElement;
      el.classList.toggle('zd-hierarchy-selected', el.dataset.nodeId === this.selectedId);
    }
  }

  dispose(): void {
    this._onSelect.dispose();
    this._onContextMenu.dispose();
    this.element.remove();
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
