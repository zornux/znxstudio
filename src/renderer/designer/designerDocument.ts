/**
 * In-memory document model for the visual designer. A DesignerDocument is a
 * tree of ComponentNode instances representing one screen's UI hierarchy, plus
 * screen-level state declarations and the source location mapping needed for
 * bidirectional sync with the Zornux source file.
 */

import { Emitter, type Event } from '../core/Emitter';
import type { ComponentDescriptor } from './componentModel';
import { getDescriptor } from './componentModel';

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

let nextId = 1;
export function resetIdCounter(start = 1): void {
  nextId = start;
}
export function generateId(): string {
  return `node_${nextId++}`;
}

// ---------------------------------------------------------------------------
// Event handler model
// ---------------------------------------------------------------------------

export interface EventHandler {
  eventKey: string;
  /** Raw Zornux statements inside the `when … end` block. */
  body: string;
}

// ---------------------------------------------------------------------------
// Component node
// ---------------------------------------------------------------------------

export interface ComponentNode {
  id: string;
  kind: string;
  properties: Record<string, string | number | boolean>;
  events: EventHandler[];
  children: ComponentNode[];
  /** Parent id, null for screen root children. */
  parentId: string | null;
  /** Source line range (0-based, inclusive) when parsed from source. */
  sourceRange?: { start: number; end: number };
}

// ---------------------------------------------------------------------------
// State declaration
// ---------------------------------------------------------------------------

export interface StateDeclaration {
  name: string;
  initialValue: string;
}

// ---------------------------------------------------------------------------
// Screen model
// ---------------------------------------------------------------------------

export interface ScreenModel {
  name: string;
  states: StateDeclaration[];
  rootChildren: ComponentNode[];
}

// ---------------------------------------------------------------------------
// Designer document
// ---------------------------------------------------------------------------

export type DocumentChangeKind =
  | 'node-added'
  | 'node-removed'
  | 'node-moved'
  | 'property-changed'
  | 'event-changed'
  | 'state-changed'
  | 'screen-changed'
  | 'bulk';

export interface DocumentChange {
  kind: DocumentChangeKind;
  nodeId?: string;
}

export class DesignerDocument {
  private readonly screens: ScreenModel[] = [];
  private activeScreenIndex = 0;
  private readonly nodeIndex = new Map<string, ComponentNode>();

  /** The source file this document was parsed from (or will be written to). */
  sourcePath: string = '';
  appName: string = '';
  startScreen: string = '';

  private readonly _onDidChange = new Emitter<DocumentChange>();
  readonly onDidChange: Event<DocumentChange> = this._onDidChange.event;

  // ---- Screen management ----

  getScreens(): readonly ScreenModel[] {
    return this.screens;
  }

  activeScreen(): ScreenModel | null {
    return this.screens[this.activeScreenIndex] ?? null;
  }

  activeScreenName(): string {
    return this.activeScreen()?.name ?? '';
  }

  setActiveScreen(index: number): void {
    if (index >= 0 && index < this.screens.length) {
      this.activeScreenIndex = index;
      this._onDidChange.fire({ kind: 'screen-changed' });
    }
  }

  setActiveScreenByName(name: string): void {
    const idx = this.screens.findIndex((s) => s.name === name);
    if (idx >= 0) this.setActiveScreen(idx);
  }

  addScreen(name: string): ScreenModel {
    const screen: ScreenModel = { name, states: [], rootChildren: [] };
    this.screens.push(screen);
    if (this.screens.length === 1) this.startScreen = name;
    this._onDidChange.fire({ kind: 'screen-changed' });
    return screen;
  }

  removeScreen(index: number): ScreenModel | null {
    if (index < 0 || index >= this.screens.length) return null;
    const [removed] = this.screens.splice(index, 1);
    for (const child of removed.rootChildren) this.unindexTree(child);
    if (this.activeScreenIndex >= this.screens.length) {
      this.activeScreenIndex = Math.max(0, this.screens.length - 1);
    }
    this._onDidChange.fire({ kind: 'screen-changed' });
    return removed;
  }

  renameScreen(index: number, name: string): void {
    const screen = this.screens[index];
    if (!screen) return;
    if (this.startScreen === screen.name) this.startScreen = name;
    screen.name = name;
    this._onDidChange.fire({ kind: 'screen-changed' });
  }

  // ---- State management ----

  addState(name: string, initialValue: string): void {
    const screen = this.activeScreen();
    if (!screen) return;
    screen.states.push({ name, initialValue });
    this._onDidChange.fire({ kind: 'state-changed' });
  }

  removeState(name: string): void {
    const screen = this.activeScreen();
    if (!screen) return;
    const idx = screen.states.findIndex((s) => s.name === name);
    if (idx >= 0) {
      screen.states.splice(idx, 1);
      this._onDidChange.fire({ kind: 'state-changed' });
    }
  }

  updateState(name: string, initialValue: string): void {
    const screen = this.activeScreen();
    if (!screen) return;
    const state = screen.states.find((s) => s.name === name);
    if (state) {
      state.initialValue = initialValue;
      this._onDidChange.fire({ kind: 'state-changed' });
    }
  }

  // ---- Node CRUD ----

  createNode(kind: string, overrides?: Partial<Pick<ComponentNode, 'properties' | 'events'>>): ComponentNode {
    const descriptor = getDescriptor(kind);
    const props: Record<string, string | number | boolean> = {};
    if (descriptor) {
      for (const p of descriptor.properties) {
        props[p.key] = p.defaultValue;
      }
    }
    if (overrides?.properties) Object.assign(props, overrides.properties);
    const node: ComponentNode = {
      id: generateId(),
      kind,
      properties: props,
      events: overrides?.events ? [...overrides.events] : [],
      children: [],
      parentId: null,
    };
    this.nodeIndex.set(node.id, node);
    return node;
  }

  addChild(parentId: string | null, node: ComponentNode, index?: number): void {
    const siblings = this.childrenOf(parentId);
    if (!siblings) return;
    node.parentId = parentId;
    if (index !== undefined && index >= 0 && index <= siblings.length) {
      siblings.splice(index, 0, node);
    } else {
      siblings.push(node);
    }
    this.indexTree(node);
    this._onDidChange.fire({ kind: 'node-added', nodeId: node.id });
  }

  removeNode(nodeId: string): ComponentNode | null {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return null;
    const siblings = this.childrenOf(node.parentId);
    if (siblings) {
      const idx = siblings.indexOf(node);
      if (idx >= 0) siblings.splice(idx, 1);
    }
    this.unindexTree(node);
    this._onDidChange.fire({ kind: 'node-removed', nodeId });
    return node;
  }

  moveNode(nodeId: string, newParentId: string | null, index: number): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return;
    const oldSiblings = this.childrenOf(node.parentId);
    if (oldSiblings) {
      const idx = oldSiblings.indexOf(node);
      if (idx >= 0) oldSiblings.splice(idx, 1);
    }
    node.parentId = newParentId;
    const newSiblings = this.childrenOf(newParentId);
    if (newSiblings) {
      const clampedIndex = Math.min(index, newSiblings.length);
      newSiblings.splice(clampedIndex, 0, node);
    }
    this._onDidChange.fire({ kind: 'node-moved', nodeId });
  }

  setProperty(nodeId: string, key: string, value: string | number | boolean): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return;
    node.properties[key] = value;
    this._onDidChange.fire({ kind: 'property-changed', nodeId });
  }

  setEvent(nodeId: string, eventKey: string, body: string): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return;
    const existing = node.events.find((e) => e.eventKey === eventKey);
    if (existing) {
      existing.body = body;
    } else {
      node.events.push({ eventKey, body });
    }
    this._onDidChange.fire({ kind: 'event-changed', nodeId });
  }

  removeEvent(nodeId: string, eventKey: string): void {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return;
    const idx = node.events.findIndex((e) => e.eventKey === eventKey);
    if (idx >= 0) {
      node.events.splice(idx, 1);
      this._onDidChange.fire({ kind: 'event-changed', nodeId });
    }
  }

  // ---- Queries ----

  getNode(id: string): ComponentNode | null {
    return this.nodeIndex.get(id) ?? null;
  }

  getDescriptorFor(node: ComponentNode): ComponentDescriptor | undefined {
    return getDescriptor(node.kind);
  }

  parentOf(nodeId: string): ComponentNode | null {
    const node = this.nodeIndex.get(nodeId);
    if (!node || !node.parentId) return null;
    return this.nodeIndex.get(node.parentId) ?? null;
  }

  indexOf(nodeId: string): number {
    const node = this.nodeIndex.get(nodeId);
    if (!node) return -1;
    const siblings = this.childrenOf(node.parentId);
    return siblings ? siblings.indexOf(node) : -1;
  }

  allNodes(): ComponentNode[] {
    return [...this.nodeIndex.values()];
  }

  /** Walk the tree depth-first, calling fn for each node. */
  walk(fn: (node: ComponentNode, depth: number) => void): void {
    const screen = this.activeScreen();
    if (!screen) return;
    const recurse = (children: ComponentNode[], depth: number): void => {
      for (const child of children) {
        fn(child, depth);
        recurse(child.children, depth + 1);
      }
    };
    recurse(screen.rootChildren, 0);
  }

  // ---- Clipboard ----

  cloneNode(node: ComponentNode): ComponentNode {
    const clone: ComponentNode = {
      id: generateId(),
      kind: node.kind,
      properties: { ...node.properties },
      events: node.events.map((e) => ({ ...e })),
      children: node.children.map((c) => this.cloneNode(c)),
      parentId: null,
    };
    this.nodeIndex.set(clone.id, clone);
    for (const child of clone.children) {
      child.parentId = clone.id;
      this.indexTree(child);
    }
    return clone;
  }

  // ---- Bulk load (from parser) ----

  loadFromParsed(
    appName: string,
    startScreen: string,
    screens: ScreenModel[],
  ): void {
    this.nodeIndex.clear();
    this.screens.length = 0;
    this.appName = appName;
    this.startScreen = startScreen;
    for (const screen of screens) {
      this.screens.push(screen);
      for (const child of screen.rootChildren) this.indexTree(child);
    }
    this.activeScreenIndex = 0;
    this._onDidChange.fire({ kind: 'bulk' });
  }

  clear(): void {
    this.nodeIndex.clear();
    this.screens.length = 0;
    this.activeScreenIndex = 0;
    this.appName = '';
    this.startScreen = '';
    this.sourcePath = '';
    this._onDidChange.fire({ kind: 'bulk' });
  }

  // ---- Internals ----

  private childrenOf(parentId: string | null): ComponentNode[] | null {
    if (parentId === null) {
      const screen = this.activeScreen();
      return screen ? screen.rootChildren : null;
    }
    const parent = this.nodeIndex.get(parentId);
    return parent ? parent.children : null;
  }

  private indexTree(node: ComponentNode): void {
    this.nodeIndex.set(node.id, node);
    for (const child of node.children) this.indexTree(child);
  }

  private unindexTree(node: ComponentNode): void {
    this.nodeIndex.delete(node.id);
    for (const child of node.children) this.unindexTree(child);
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
