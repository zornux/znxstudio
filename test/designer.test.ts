import { describe, test, expect } from './harness';
import {
  COMPONENT_CATALOG,
  CATEGORY_ORDER,
  getDescriptor,
  descriptorsByCategory,
  searchComponents,
} from '../src/renderer/designer/componentModel';
import { UndoRedoStack } from '../src/renderer/designer/undoRedo';
import {
  DesignerDocument,
  resetIdCounter,
} from '../src/renderer/designer/designerDocument';
import { parseSource, emitSource, sourceNeedsUpdate } from '../src/renderer/designer/sourceSync';

// ---------------------------------------------------------------------------
// Component model
// ---------------------------------------------------------------------------

describe('ComponentModel', () => {
  test('catalog has at least 20 components', () => {
    expect(COMPONENT_CATALOG.length).toBeGreaterThan(19);
  });

  test('every component has a unique kind', () => {
    const kinds = COMPONENT_CATALOG.map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  test('every component has a valid category', () => {
    for (const c of COMPONENT_CATALOG) {
      expect(CATEGORY_ORDER).toContain(c.category);
    }
  });

  test('getDescriptor returns the right component', () => {
    const btn = getDescriptor('button');
    expect(btn).toBeTruthy();
    expect(btn!.label).toBe('Button');
    expect(btn!.isContainer).toBe(false);
  });

  test('getDescriptor returns undefined for unknown kind', () => {
    expect(getDescriptor('nonexistent')).toBeFalsy();
  });

  test('descriptorsByCategory returns correct components', () => {
    const layouts = descriptorsByCategory('layout');
    expect(layouts.length).toBeGreaterThan(3);
    for (const d of layouts) {
      expect(d.category).toBe('layout');
    }
  });

  test('containers have isContainer=true', () => {
    const column = getDescriptor('column');
    expect(column!.isContainer).toBe(true);
    const row = getDescriptor('row');
    expect(row!.isContainer).toBe(true);
    const card = getDescriptor('card');
    expect(card!.isContainer).toBe(true);
  });

  test('non-containers have isContainer=false', () => {
    const text = getDescriptor('text');
    expect(text!.isContainer).toBe(false);
    const input = getDescriptor('input');
    expect(input!.isContainer).toBe(false);
  });

  test('searchComponents finds by label', () => {
    const results = searchComponents('Button');
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((r) => r.kind === 'button')).toBe(true);
  });

  test('searchComponents finds by hint', () => {
    const results = searchComponents('toggle');
    expect(results.length).toBeGreaterThan(0);
  });

  test('searchComponents returns all for empty query', () => {
    const results = searchComponents('');
    expect(results.length).toBe(COMPONENT_CATALOG.length);
  });

  test('every component has properties with default values', () => {
    for (const c of COMPONENT_CATALOG) {
      for (const p of c.properties) {
        expect(p.defaultValue !== undefined).toBe(true);
      }
    }
  });

  test('event descriptors have zxKeyword', () => {
    for (const c of COMPONENT_CATALOG) {
      for (const e of c.events) {
        expect(e.zxKeyword.length).toBeGreaterThan(0);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Undo/redo stack
// ---------------------------------------------------------------------------

describe('UndoRedoStack', () => {
  test('push executes the action', () => {
    const stack = new UndoRedoStack();
    let value = 0;
    stack.push({
      label: 'increment',
      execute: () => { value = 1; },
      undo: () => { value = 0; },
    });
    expect(value).toBe(1);
  });

  test('undo reverses the action', () => {
    const stack = new UndoRedoStack();
    let value = 0;
    stack.push({
      label: 'set',
      execute: () => { value = 42; },
      undo: () => { value = 0; },
    });
    expect(value).toBe(42);
    stack.undo();
    expect(value).toBe(0);
  });

  test('redo re-executes after undo', () => {
    const stack = new UndoRedoStack();
    let value = 0;
    stack.push({
      label: 'set',
      execute: () => { value = 42; },
      undo: () => { value = 0; },
    });
    stack.undo();
    stack.redo();
    expect(value).toBe(42);
  });

  test('push clears redo history', () => {
    const stack = new UndoRedoStack();
    let value = 0;
    stack.push({
      label: 'a',
      execute: () => { value = 1; },
      undo: () => { value = 0; },
    });
    stack.undo();
    expect(stack.canRedo()).toBe(true);
    stack.push({
      label: 'b',
      execute: () => { value = 2; },
      undo: () => { value = 0; },
    });
    expect(stack.canRedo()).toBe(false);
  });

  test('canUndo and canRedo reflect state', () => {
    const stack = new UndoRedoStack();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
    stack.push({ label: 'x', execute: () => {}, undo: () => {} });
    expect(stack.canUndo()).toBe(true);
    expect(stack.canRedo()).toBe(false);
    stack.undo();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(true);
  });

  test('labels reflect current state', () => {
    const stack = new UndoRedoStack();
    expect(stack.undoLabel()).toBeNull();
    stack.push({ label: 'action A', execute: () => {}, undo: () => {} });
    expect(stack.undoLabel()).toBe('action A');
    stack.undo();
    expect(stack.redoLabel()).toBe('action A');
  });

  test('clear empties both stacks', () => {
    const stack = new UndoRedoStack();
    stack.push({ label: 'a', execute: () => {}, undo: () => {} });
    stack.push({ label: 'b', execute: () => {}, undo: () => {} });
    stack.undo();
    stack.clear();
    expect(stack.canUndo()).toBe(false);
    expect(stack.canRedo()).toBe(false);
  });

  test('max depth evicts oldest', () => {
    const stack = new UndoRedoStack(3);
    for (let i = 0; i < 5; i++) {
      stack.push({ label: `action ${i}`, execute: () => {}, undo: () => {} });
    }
    let undoCount = 0;
    while (stack.canUndo()) { stack.undo(); undoCount++; }
    expect(undoCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Designer document
// ---------------------------------------------------------------------------

describe('DesignerDocument', () => {
  test('addScreen and getScreens', () => {
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    doc.addScreen('Settings');
    expect(doc.getScreens().length).toBe(2);
    expect(doc.getScreens()[0].name).toBe('Home');
  });

  test('activeScreen defaults to first', () => {
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    doc.addScreen('Settings');
    expect(doc.activeScreenName()).toBe('Home');
  });

  test('setActiveScreen changes active', () => {
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    doc.addScreen('Settings');
    doc.setActiveScreen(1);
    expect(doc.activeScreenName()).toBe('Settings');
  });

  test('createNode assigns default properties', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    const node = doc.createNode('button');
    expect(node.kind).toBe('button');
    expect(node.properties.label).toBe('Button');
    expect(node.properties.style).toBe('primary');
    expect(node.id).toBe('node_1');
  });

  test('addChild and getNode', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const node = doc.createNode('text');
    doc.addChild(null, node);
    expect(doc.getNode(node.id)).toBe(node);
    expect(doc.activeScreen()!.rootChildren).toContain(node);
  });

  test('removeNode removes from parent', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const node = doc.createNode('text');
    doc.addChild(null, node);
    doc.removeNode(node.id);
    expect(doc.getNode(node.id)).toBeNull();
    expect(doc.activeScreen()!.rootChildren.length).toBe(0);
  });

  test('moveNode reparents correctly', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const col = doc.createNode('column');
    const txt = doc.createNode('text');
    doc.addChild(null, col);
    doc.addChild(null, txt);
    expect(doc.activeScreen()!.rootChildren.length).toBe(2);

    doc.moveNode(txt.id, col.id, 0);
    expect(doc.activeScreen()!.rootChildren.length).toBe(1);
    expect(col.children.length).toBe(1);
    expect(col.children[0]).toBe(txt);
    expect(txt.parentId).toBe(col.id);
  });

  test('setProperty updates value', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const node = doc.createNode('text');
    doc.addChild(null, node);
    doc.setProperty(node.id, 'content', 'Hello');
    expect(node.properties.content).toBe('Hello');
  });

  test('setEvent adds event handler', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const node = doc.createNode('button');
    doc.addChild(null, node);
    doc.setEvent(node.id, 'tapped', 'go to Settings');
    expect(node.events.length).toBe(1);
    expect(node.events[0].body).toBe('go to Settings');
  });

  test('removeEvent removes handler', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const node = doc.createNode('button');
    doc.addChild(null, node);
    doc.setEvent(node.id, 'tapped', 'go to Settings');
    doc.removeEvent(node.id, 'tapped');
    expect(node.events.length).toBe(0);
  });

  test('cloneNode creates deep copy', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const col = doc.createNode('column');
    const txt = doc.createNode('text');
    doc.addChild(null, col);
    doc.addChild(col.id, txt);
    doc.setProperty(txt.id, 'content', 'Hello');

    const clone = doc.cloneNode(col);
    expect(clone.id === col.id).toBe(false);
    expect(clone.kind).toBe('column');
    expect(clone.children.length).toBe(1);
    expect(clone.children[0].id === txt.id).toBe(false);
    expect(clone.children[0].properties.content).toBe('Hello');
  });

  test('addState and removeState', () => {
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    doc.addState('count', '0');
    expect(doc.activeScreen()!.states.length).toBe(1);
    expect(doc.activeScreen()!.states[0].name).toBe('count');
    doc.removeState('count');
    expect(doc.activeScreen()!.states.length).toBe(0);
  });

  test('walk visits all nodes depth-first', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const col = doc.createNode('column');
    const txt = doc.createNode('text');
    const btn = doc.createNode('button');
    doc.addChild(null, col);
    doc.addChild(col.id, txt);
    doc.addChild(col.id, btn);

    const visited: string[] = [];
    doc.walk((node) => visited.push(node.kind));
    expect(visited).toEqual(['column', 'text', 'button']);
  });

  test('indexOf returns correct position', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.addScreen('Home');
    const a = doc.createNode('text');
    const b = doc.createNode('button');
    doc.addChild(null, a);
    doc.addChild(null, b);
    expect(doc.indexOf(a.id)).toBe(0);
    expect(doc.indexOf(b.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Source sync
// ---------------------------------------------------------------------------

describe('SourceSync', () => {
  const SAMPLE_SOURCE = [
    'mobile app "TestApp"',
    '',
    'screen Home',
    '    state greeting = "Hello!"',
    '',
    '    column',
    '        text greeting',
    '',
    '        button "Click Me"',
    '            when tapped',
    '                go to Details',
    '            end',
    '        end',
    '    end',
    'end',
    '',
    'screen Details',
    '    column',
    '        text "Detail Page"',
    '    end',
    'end',
    '',
    'start with Home',
    '',
  ].join('\n');

  test('parseSource extracts app name', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    expect(doc.appName).toBe('TestApp');
  });

  test('parseSource extracts start screen', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    expect(doc.startScreen).toBe('Home');
  });

  test('parseSource extracts screens', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const screens = doc.getScreens();
    expect(screens.length).toBe(2);
    expect(screens[0].name).toBe('Home');
    expect(screens[1].name).toBe('Details');
  });

  test('parseSource extracts state declarations', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const home = doc.getScreens()[0];
    expect(home.states.length).toBe(1);
    expect(home.states[0].name).toBe('greeting');
    expect(home.states[0].initialValue).toBe('Hello!');
  });

  test('parseSource extracts component hierarchy', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const home = doc.getScreens()[0];
    expect(home.rootChildren.length).toBe(1);
    expect(home.rootChildren[0].kind).toBe('column');
    expect(home.rootChildren[0].children.length).toBe(2);
    expect(home.rootChildren[0].children[0].kind).toBe('text');
    expect(home.rootChildren[0].children[1].kind).toBe('button');
  });

  test('parseSource extracts event handlers', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const button = doc.getScreens()[0].rootChildren[0].children[1];
    expect(button.events.length).toBe(1);
    expect(button.events[0].eventKey).toBe('tapped');
    expect(button.events[0].body).toContain('go to Details');
  });

  test('emitSource produces valid Zornux source', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const output = emitSource(doc);
    expect(output).toContain('mobile app "TestApp"');
    expect(output).toContain('screen Home');
    expect(output).toContain('screen Details');
    expect(output).toContain('start with Home');
    expect(output).toContain('state greeting');
    expect(output).toContain('column');
    expect(output).toContain('button');
    expect(output).toContain('when tapped');
  });

  test('round-trip: parse then emit preserves structure', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    const output = emitSource(doc);
    resetIdCounter();
    const reparsed = parseSource(output);
    expect(reparsed.appName).toBe('TestApp');
    expect(reparsed.startScreen).toBe('Home');
    expect(reparsed.getScreens().length).toBe(2);
    expect(reparsed.getScreens()[0].states.length).toBe(1);
    expect(reparsed.getScreens()[0].rootChildren.length).toBe(1);
  });

  test('emitSource from empty document', () => {
    const doc = new DesignerDocument();
    doc.appName = 'Empty';
    doc.startScreen = 'Main';
    doc.addScreen('Main');
    const output = emitSource(doc);
    expect(output).toContain('mobile app "Empty"');
    expect(output).toContain('screen Main');
    expect(output).toContain('start with Main');
  });

  test('sourceNeedsUpdate detects changes', () => {
    resetIdCounter();
    const doc = parseSource(SAMPLE_SOURCE);
    doc.setActiveScreenByName('Home');
    const before = emitSource(doc);
    expect(sourceNeedsUpdate(before, doc)).toBe(false);
    doc.addState('newState', '0');
    expect(sourceNeedsUpdate(before, doc)).toBe(true);
  });

  test('parse handles simple text component', () => {
    resetIdCounter();
    const source = 'mobile app "Simple"\n\nscreen Main\n    text "Hello"\nend\n\nstart with Main\n';
    const doc = parseSource(source);
    const screen = doc.getScreens()[0];
    expect(screen.rootChildren.length).toBe(1);
    expect(screen.rootChildren[0].kind).toBe('text');
  });

  test('parse handles nested containers', () => {
    resetIdCounter();
    const source = [
      'mobile app "Nested"',
      '',
      'screen Main',
      '    column',
      '        row',
      '            text "A"',
      '            text "B"',
      '        end',
      '    end',
      'end',
      '',
      'start with Main',
      '',
    ].join('\n');
    const doc = parseSource(source);
    const col = doc.getScreens()[0].rootChildren[0];
    expect(col.kind).toBe('column');
    expect(col.children.length).toBe(1);
    const row = col.children[0];
    expect(row.kind).toBe('row');
    expect(row.children.length).toBe(2);
  });
});
