/**
 * Properties panel: edits properties and events for the currently selected
 * component. Grouped by category (Content, Layout, Style, Behavior, Events)
 * with appropriate input controls for each property type.
 */

import { Emitter, type Event } from '../core/Emitter';
import type { ComponentNode } from './designerDocument';
import type { DesignerDocument } from './designerDocument';
import { getDescriptor, type PropertyDescriptor, type EventDescriptor } from './componentModel';

// ---------------------------------------------------------------------------
// Change event
// ---------------------------------------------------------------------------

export interface PropertyChange {
  nodeId: string;
  key: string;
  value: string | number | boolean;
  previousValue: string | number | boolean;
}

export interface EventChange {
  nodeId: string;
  eventKey: string;
  body: string;
  previousBody: string | null;
}

// ---------------------------------------------------------------------------
// Properties panel
// ---------------------------------------------------------------------------

export class PropertiesPanel {
  readonly element: HTMLDivElement;
  private doc: DesignerDocument | null = null;
  private currentNodeId: string | null = null;
  private collapsedGroups = new Set<string>();

  private readonly _onPropertyChange = new Emitter<PropertyChange>();
  readonly onPropertyChange: Event<PropertyChange> = this._onPropertyChange.event;

  private readonly _onEventChange = new Emitter<EventChange>();
  readonly onEventChange: Event<EventChange> = this._onEventChange.event;

  private readonly _onEventRemove = new Emitter<{ nodeId: string; eventKey: string }>();
  readonly onEventRemove: Event<{ nodeId: string; eventKey: string }> = this._onEventRemove.event;

  private readonly _onEventAdd = new Emitter<{ nodeId: string; eventKey: string }>();
  readonly onEventAdd: Event<{ nodeId: string; eventKey: string }> = this._onEventAdd.event;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'zd-properties';
    this.element.setAttribute('role', 'region');
    this.element.setAttribute('aria-label', 'Properties');
    this.renderEmpty();
  }

  bind(doc: DesignerDocument): void {
    this.doc = doc;
  }

  setNode(nodeId: string | null): void {
    this.currentNodeId = nodeId;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private render(): void {
    this.element.innerHTML = '';

    if (!this.doc || !this.currentNodeId) {
      this.renderEmpty();
      return;
    }

    const node = this.doc.getNode(this.currentNodeId);
    if (!node) {
      this.renderEmpty();
      return;
    }

    const descriptor = getDescriptor(node.kind);
    if (!descriptor) {
      this.renderEmpty();
      return;
    }

    // Header
    const header = document.createElement('div');
    header.className = 'zd-props-header';
    header.innerHTML = `<span class="zd-props-icon">${descriptor.icon}</span> <span class="zd-props-title">${descriptor.label}</span>`;
    this.element.appendChild(header);

    // ID display
    const idRow = document.createElement('div');
    idRow.className = 'zd-props-id';
    idRow.textContent = node.id;
    this.element.appendChild(idRow);

    // Property groups
    const groups = new Map<string, PropertyDescriptor[]>();
    for (const prop of descriptor.properties) {
      const list = groups.get(prop.group) ?? [];
      list.push(prop);
      groups.set(prop.group, list);
    }

    const groupOrder = ['content', 'layout', 'style', 'behavior'];
    for (const group of groupOrder) {
      const props = groups.get(group);
      if (!props || props.length === 0) continue;
      this.element.appendChild(this.renderPropertyGroup(group, props, node));
    }

    // Events section
    if (descriptor.events.length > 0) {
      this.element.appendChild(this.renderEventsGroup(descriptor.events, node));
    }
  }

  private renderPropertyGroup(group: string, props: PropertyDescriptor[], node: ComponentNode): HTMLElement {
    const section = document.createElement('div');
    section.className = 'zd-props-group';

    const collapsed = this.collapsedGroups.has(group);
    const header = document.createElement('button');
    header.className = 'zd-props-group-header';
    header.textContent = `${collapsed ? '▸' : '▾'} ${groupLabel(group)}`;
    header.setAttribute('aria-expanded', String(!collapsed));
    header.addEventListener('click', () => {
      if (collapsed) this.collapsedGroups.delete(group);
      else this.collapsedGroups.add(group);
      this.render();
    });
    section.appendChild(header);

    if (!collapsed) {
      const body = document.createElement('div');
      body.className = 'zd-props-group-body';
      for (const prop of props) {
        body.appendChild(this.renderPropertyRow(prop, node));
      }
      section.appendChild(body);
    }

    return section;
  }

  private renderPropertyRow(prop: PropertyDescriptor, node: ComponentNode): HTMLElement {
    const row = document.createElement('div');
    row.className = 'zd-props-row';

    const label = document.createElement('label');
    label.className = 'zd-props-label';
    label.textContent = prop.label;
    const inputId = `zd-prop-${node.id}-${prop.key}`;
    label.htmlFor = inputId;
    row.appendChild(label);

    const value = node.properties[prop.key] ?? prop.defaultValue;

    switch (prop.type) {
      case 'text': {
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'text';
        input.className = 'zd-props-input';
        input.value = String(value);
        if (prop.key === 'width' || prop.key === 'height') {
          input.placeholder = 'auto, 120dp, 50%, match';
          input.title = 'Use a number or dp/px for a fixed size, % for a relative size, auto/wrap for content, or match/fill for the available space.';
          input.setAttribute('inputmode', 'text');
        }
        input.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, input.value, value);
        });
        row.appendChild(input);
        break;
      }
      case 'number': {
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'number';
        input.className = 'zd-props-input zd-props-input-number';
        input.value = String(value);
        if (prop.min !== undefined) input.min = String(prop.min);
        if (prop.max !== undefined) input.max = String(prop.max);
        if (prop.step !== undefined) input.step = String(prop.step);
        input.addEventListener('change', () => {
          let next = Number(input.value);
          if (!Number.isFinite(next)) next = Number(prop.defaultValue) || 0;
          if (prop.min !== undefined) next = Math.max(prop.min, next);
          if (prop.max !== undefined) next = Math.min(prop.max, next);
          input.value = String(next);
          this.firePropertyChange(node.id, prop.key, next, value);
        });
        row.appendChild(input);
        break;
      }
      case 'boolean': {
        const cb = document.createElement('input');
        cb.id = inputId;
        cb.type = 'checkbox';
        cb.className = 'zd-props-checkbox';
        cb.checked = Boolean(value);
        cb.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, cb.checked, value);
        });
        row.appendChild(cb);
        break;
      }
      case 'enum': {
        const select = document.createElement('select');
        select.id = inputId;
        select.className = 'zd-props-select';
        for (const opt of prop.options ?? []) {
          const option = document.createElement('option');
          option.value = opt;
          option.textContent = opt.replace(/_/g, ' ');
          option.selected = opt === String(value);
          select.appendChild(option);
        }
        select.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, select.value, value);
        });
        row.appendChild(select);
        break;
      }
      case 'color': {
        const editor = document.createElement('div');
        editor.className = 'zd-props-color-editor';
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'zd-props-color-picker';
        picker.setAttribute('aria-label', `${prop.label} picker`);
        picker.value = colorPickerValue(String(value));
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'text';
        input.className = 'zd-props-input zd-props-color-value';
        input.value = String(value);
        input.placeholder = '#6750A4 or theme token';
        picker.addEventListener('input', () => {
          input.value = picker.value.toUpperCase();
        });
        picker.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, picker.value.toUpperCase(), value);
        });
        input.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, input.value.trim(), value);
        });
        editor.append(picker, input);
        row.appendChild(editor);
        break;
      }
      case 'spacing':
      case 'alignment': {
        // Fall back to text input for complex types
        const input = document.createElement('input');
        input.id = inputId;
        input.type = 'text';
        input.className = 'zd-props-input';
        input.value = String(value);
        input.addEventListener('change', () => {
          this.firePropertyChange(node.id, prop.key, input.value, value);
        });
        row.appendChild(input);
        break;
      }
    }

    return row;
  }

  private renderEventsGroup(descriptors: EventDescriptor[], node: ComponentNode): HTMLElement {
    const section = document.createElement('div');
    section.className = 'zd-props-group';

    const collapsed = this.collapsedGroups.has('events');
    const header = document.createElement('button');
    header.className = 'zd-props-group-header';
    header.textContent = `${collapsed ? '▸' : '▾'} Events`;
    header.setAttribute('aria-expanded', String(!collapsed));
    header.addEventListener('click', () => {
      if (collapsed) this.collapsedGroups.delete('events');
      else this.collapsedGroups.add('events');
      this.render();
    });
    section.appendChild(header);

    if (!collapsed) {
      const body = document.createElement('div');
      body.className = 'zd-props-group-body';

      for (const desc of descriptors) {
        const existing = node.events.find((e) => e.eventKey === desc.key);
        const eventRow = document.createElement('div');
        eventRow.className = 'zd-props-event-row';

        const label = document.createElement('span');
        label.className = 'zd-props-event-label';
        label.textContent = `⚡ ${desc.label}`;
        eventRow.appendChild(label);

        if (existing) {
          const textarea = document.createElement('textarea');
          textarea.className = 'zd-props-event-body';
          textarea.value = existing.body;
          textarea.rows = Math.max(2, existing.body.split('\n').length);
          textarea.placeholder = 'Zornux handler code…';
          textarea.setAttribute('aria-label', `${desc.label} handler`);
          textarea.addEventListener('change', () => {
            this._onEventChange.fire({
              nodeId: node.id,
              eventKey: desc.key,
              body: textarea.value,
              previousBody: existing.body,
            });
          });
          eventRow.appendChild(textarea);

          const removeBtn = document.createElement('button');
          removeBtn.className = 'zd-props-event-remove';
          removeBtn.textContent = '✕';
          removeBtn.title = 'Remove event handler';
          removeBtn.setAttribute('aria-label', `Remove ${desc.label} handler`);
          removeBtn.addEventListener('click', () => {
            this._onEventRemove.fire({ nodeId: node.id, eventKey: desc.key });
          });
          eventRow.appendChild(removeBtn);
        } else {
          const addBtn = document.createElement('button');
          addBtn.className = 'zd-props-event-add';
          addBtn.textContent = '+ Add handler';
          addBtn.setAttribute('aria-label', `Add ${desc.label} handler`);
          addBtn.addEventListener('click', () => {
            this._onEventAdd.fire({ nodeId: node.id, eventKey: desc.key });
          });
          eventRow.appendChild(addBtn);
        }

        body.appendChild(eventRow);
      }

      section.appendChild(body);
    }

    return section;
  }

  private renderEmpty(): void {
    this.element.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'zd-props-empty';
    empty.textContent = 'Select a component to edit its properties';
    this.element.appendChild(empty);
  }

  private firePropertyChange(
    nodeId: string,
    key: string,
    value: string | number | boolean,
    previousValue: string | number | boolean,
  ): void {
    this._onPropertyChange.fire({ nodeId, key, value, previousValue });
  }

  dispose(): void {
    this._onPropertyChange.dispose();
    this._onEventChange.dispose();
    this._onEventRemove.dispose();
    this._onEventAdd.dispose();
    this.element.remove();
  }
}

function colorPickerValue(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const semantic: Record<string, string> = {
    primary: '#6750A4', secondary: '#625B71', accent: '#7D5260',
    error: '#B3261E', success: '#2E7D32', white: '#FFFFFF', black: '#000000',
  };
  return semantic[value.toLowerCase()] ?? '#6750A4';
}

function groupLabel(group: string): string {
  switch (group) {
    case 'content': return 'Content';
    case 'layout': return 'Layout';
    case 'style': return 'Style';
    case 'behavior': return 'Behavior';
    default: return group;
  }
}
