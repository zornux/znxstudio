/**
 * Component toolbox: a searchable, categorized palette of all available
 * components that can be dragged onto the design canvas.
 */

import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  descriptorsByCategory,
  searchComponents,
  type ComponentDescriptor,
} from './componentModel';
import type { DragDropManager } from './dragDrop';

export class Toolbox {
  readonly element: HTMLDivElement;
  private dragDrop: DragDropManager | null = null;
  private searchInput!: HTMLInputElement;
  private listEl!: HTMLDivElement;
  private collapsedCategories = new Set<string>();

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zd-toolbox';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', 'Component toolbox');

    // Search bar
    const searchBar = document.createElement('div');
    searchBar.className = 'zd-toolbox-search';
    this.searchInput = document.createElement('input');
    this.searchInput.type = 'search';
    this.searchInput.placeholder = 'Search components…';
    this.searchInput.className = 'zd-toolbox-search-input';
    this.searchInput.setAttribute('aria-label', 'Search components');
    this.searchInput.addEventListener('input', () => this.renderList());
    searchBar.appendChild(this.searchInput);
    this.element.appendChild(searchBar);

    // Component list
    this.listEl = document.createElement('div');
    this.listEl.className = 'zd-toolbox-list';
    this.element.appendChild(this.listEl);

    this.renderList();
  }

  bind(dragDrop: DragDropManager): void {
    this.dragDrop = dragDrop;
    this.renderList();
  }

  focus(): void {
    this.searchInput.focus();
  }

  private renderList(): void {
    this.listEl.innerHTML = '';
    const query = this.searchInput.value.trim();

    if (query) {
      const results = searchComponents(query);
      if (results.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'zd-toolbox-empty';
        empty.textContent = 'No matching components';
        this.listEl.appendChild(empty);
        return;
      }
      for (const desc of results) {
        this.listEl.appendChild(this.createComponentItem(desc));
      }
      return;
    }

    for (const category of CATEGORY_ORDER) {
      const components = descriptorsByCategory(category);
      if (components.length === 0) continue;

      const collapsed = this.collapsedCategories.has(category);
      const section = document.createElement('div');
      section.className = 'zd-toolbox-section';

      const header = document.createElement('button');
      header.className = 'zd-toolbox-section-header';
      header.setAttribute('aria-expanded', String(!collapsed));
      header.innerHTML = `<span class="zd-toolbox-chevron">${collapsed ? '▸' : '▾'}</span> ${CATEGORY_LABELS[category]}`;
      header.addEventListener('click', () => {
        if (this.collapsedCategories.has(category)) {
          this.collapsedCategories.delete(category);
        } else {
          this.collapsedCategories.add(category);
        }
        this.renderList();
      });
      section.appendChild(header);

      if (!collapsed) {
        const items = document.createElement('div');
        items.className = 'zd-toolbox-items';
        for (const desc of components) {
          items.appendChild(this.createComponentItem(desc));
        }
        section.appendChild(items);
      }

      this.listEl.appendChild(section);
    }
  }

  private createComponentItem(desc: ComponentDescriptor): HTMLElement {
    const item = document.createElement('div');
    item.className = 'zd-toolbox-item';
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', `${desc.label}: ${desc.previewHint}`);
    item.tabIndex = 0;
    item.draggable = false; // We use mousedown-based DnD

    const icon = document.createElement('span');
    icon.className = 'zd-toolbox-item-icon';
    icon.textContent = desc.icon;
    item.appendChild(icon);

    const info = document.createElement('div');
    info.className = 'zd-toolbox-item-info';

    const label = document.createElement('span');
    label.className = 'zd-toolbox-item-label';
    label.textContent = desc.label;
    info.appendChild(label);

    const hint = document.createElement('span');
    hint.className = 'zd-toolbox-item-hint';
    hint.textContent = desc.previewHint;
    info.appendChild(hint);

    item.appendChild(info);

    // Drag initiation
    item.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.dragDrop) return;
      e.preventDefault();
      this.dragDrop.startDrag(
        { origin: 'toolbox', componentKind: desc.kind },
        e,
        desc.label,
      );
    });

    // Keyboard: Enter/Space to "pick up" and place at current selection
    item.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        item.dispatchEvent(new CustomEvent('zd-toolbox-place', {
          bubbles: true,
          detail: { componentKind: desc.kind },
        }));
      }
    });

    return item;
  }

  dispose(): void {
    this.element.remove();
  }
}
