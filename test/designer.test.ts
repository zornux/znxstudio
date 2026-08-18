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
import { parseSource, emitSource, preserveSourceComments, sourceNeedsUpdate, updateSourceRanges } from '../src/renderer/designer/sourceSync';
import { containerStyles, nodeLayoutStyles, previewColor, previewSize, visualStyles } from '../src/renderer/designer/propertyStyles';

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

  test('every component has unique property keys and source attributes', () => {
    for (const component of COMPONENT_CATALOG) {
      const keys = component.properties.map((property) => property.key);
      expect(new Set(keys).size).toBe(keys.length);
      const attrs = component.properties.map((property) => property.zxAttr).filter(Boolean);
      expect(new Set(attrs).size).toBe(attrs.length);
    }
  });

  test('every component supports consistent canvas position, size, and alignment metadata', () => {
    for (const component of COMPONENT_CATALOG) {
      const properties = new Map(component.properties.map((property) => [property.key, property]));
      expect(properties.get('positionMode')?.options).toEqual(['flow', 'freeform']);
      expect(properties.get('x')?.type).toBe('number');
      expect(properties.get('y')?.type).toBe('number');
    }
  });

  test('event descriptors have zxKeyword', () => {
    for (const c of COMPONENT_CATALOG) {
      for (const e of c.events) {
        expect(e.zxKeyword.length).toBeGreaterThan(0);
      }
    }
  });

  test('every component exposes professional layout, appearance, interaction, test, and accessibility properties', () => {
    const required = [
      'width', 'height', 'alignment', 'padding', 'backgroundColor', 'borderColor',
      'borderWidth', 'cornerRadius', 'opacity', 'clickable', 'focusable',
      'contentDescription', 'semanticRole', 'testTag',
    ];
    for (const component of COMPONENT_CATALOG) {
      const keys = component.properties.map((property) => property.key);
      for (const key of required) expect(keys).toContain(key);
    }
  });

  test('interactive controls expose click/toggle actions and editable colors', () => {
    const checkbox = getDescriptor('checkbox')!;
    expect(checkbox.properties.find((property) => property.key === 'checked')?.type).toBe('boolean');
    expect(checkbox.properties.find((property) => property.key === 'checkColor')?.type).toBe('color');
    expect(checkbox.properties.find((property) => property.key === 'clickable')?.defaultValue).toBe(true);
    expect(checkbox.events.map((event) => event.key)).toContain('toggled');
    expect(checkbox.events.map((event) => event.key)).toContain('tapped');
    expect(getDescriptor('button')!.properties.find((property) => property.key === 'containerColor')?.type).toBe('color');
    for (const component of COMPONENT_CATALOG) {
      for (const property of component.properties.filter((candidate) => candidate.key === 'color' || candidate.key.endsWith('Color'))) {
        expect(property.type).toBe('color');
      }
    }
    const opacity = getDescriptor('button')!.properties.find((property) => property.key === 'opacity')!;
    expect(opacity.min).toBe(0);
    expect(opacity.max).toBe(1);
  });
});

describe('Designer property styles', () => {
  test('accepts custom and semantic colors for previews', () => {
    expect(previewColor('#12AEEF')).toBe('#12AEEF');
    expect(previewColor('primary')).toBe('#6750A4');
    expect(previewColor('not-a-color')).toBeFalsy();
  });
  test('normalizes mobile and responsive dimensions', () => {
    expect(previewSize('120dp')).toBe('120px');
    expect(previewSize('50%')).toBe('50%');
    expect(previewSize('match')).toBe('100%');
    expect(previewSize('wrap_content')).toBe('auto');
    expect(previewSize('nonsense')).toBeFalsy();
  });

  test('centers a sized button and applies its box model', () => {
    const doc = new DesignerDocument();
    const button = doc.createNode('button', { properties: {
      alignment: 'center', width: '180dp', height: '48dp', padding: 12,
      marginTop: 8, visible: true,
    } });
    expect(nodeLayoutStyles(button).alignSelf).toBe('center');
    expect(nodeLayoutStyles(button).width).toBe('180px');
    expect(nodeLayoutStyles(button).height).toBe('48px');
    expect(nodeLayoutStyles(button).marginTop).toBe('8px');
    expect(visualStyles(button).padding).toBe('12px');
  });

  test('maps container direction, alignment, spacing, and grid columns', () => {
    const doc = new DesignerDocument();
    const row = doc.createNode('row', { properties: {
      spacing: 10, mainAlignment: 'space_between', crossAlignment: 'center',
    } });
    expect(containerStyles(row).flexDirection).toBe('row');
    expect(containerStyles(row).gap).toBe('10px');
    expect(containerStyles(row).justifyContent).toBe('space-between');
    expect(containerStyles(row).alignItems).toBe('center');

    const grid = doc.createNode('grid', { properties: { columns: 3 } });
    expect(containerStyles(grid).gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
  });

  test('maps freeform coordinates into positioned canvas styles', () => {
    const doc = new DesignerDocument();
    const button = doc.createNode('button', { properties: {
      positionMode: 'freeform', x: 72, y: 144,
    } });
    expect(nodeLayoutStyles(button).position).toBe('absolute');
    expect(nodeLayoutStyles(button).left).toBe('72px');
    expect(nodeLayoutStyles(button).top).toBe('144px');
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

  test('every visual component and property round-trips through editable source', () => {
    resetIdCounter();
    const doc = new DesignerDocument();
    doc.appName = 'Round "Trip"';
    doc.startScreen = 'Home';
    doc.addScreen('Home');
    for (const descriptor of COMPONENT_CATALOG) {
      const node = doc.createNode(descriptor.kind);
      for (const property of descriptor.properties) {
        if (property.type === 'boolean') node.properties[property.key] = !Boolean(property.defaultValue);
        else if (property.type === 'number') node.properties[property.key] = Number(property.defaultValue) + 7;
        else if (property.type === 'enum') node.properties[property.key] = property.options?.at(-1) ?? property.defaultValue;
        else node.properties[property.key] = property.zxAttr === ''
          ? `Edited "${property.key}" \\ value`
          : `edited "${property.key}" \\ value`;
      }
      if (descriptor.events[0]) node.events.push({ eventKey: descriptor.events[0].key, body: 'show "edited"' });
      doc.addChild(null, node);
    }

    const reparsed = parseSource(emitSource(doc));
    expect(reparsed.appName).toBe(doc.appName);
    expect(reparsed.activeScreen()!.rootChildren.length).toBe(COMPONENT_CATALOG.length);
    for (let index = 0; index < COMPONENT_CATALOG.length; index++) {
      const expected = doc.activeScreen()!.rootChildren[index];
      const actual = reparsed.activeScreen()!.rootChildren[index];
      expect(actual.kind).toBe(expected.kind);
      expect(actual.properties).toEqual(expected.properties);
      expect(actual.events.map((event) => event.eventKey)).toEqual(expected.events.map((event) => event.eventKey));
    }
  });

  test('edited labels preserve quotes, newlines, and literal escape sequences', () => {
    const doc = new DesignerDocument();
    doc.appName = 'Escapes';
    doc.startScreen = 'Home';
    doc.addScreen('Home');
    const button = doc.createNode('button', { properties: { label: 'Say "hello"\nPath \\new' } });
    doc.addChild(null, button);
    const reparsed = parseSource(emitSource(doc));
    expect(reparsed.activeScreen()!.rootChildren[0].properties.label).toBe(button.properties.label);
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

  test('refreshes source ranges without replacing stable designer node IDs', () => {
    const doc = new DesignerDocument();
    doc.appName = 'Ranges';
    doc.startScreen = 'Home';
    doc.addScreen('Home');
    const column = doc.createNode('column');
    const button = doc.createNode('button', { properties: { label: 'Save' } });
    doc.addChild(null, column);
    doc.addChild(column.id, button);
    const columnId = column.id;
    const buttonId = button.id;

    const source = emitSource(doc);
    updateSourceRanges(doc, source);

    expect(column.id).toBe(columnId);
    expect(button.id).toBe(buttonId);
    expect(column.sourceRange?.start).toBe(3);
    expect(button.sourceRange?.start).toBe(4);
  });

  test('preserves developer comments when visual changes regenerate source', () => {
    const original = 'mobile app "Demo"\n\n# home screen\nscreen Home\n    # primary action\n    button "Save"\nend\n\nstart with Home\n';
    const regenerated = 'mobile app "Demo"\n\nscreen Home\n    button "Updated"\nend\n\nstart with Home\n';
    const merged = preserveSourceComments(original, regenerated);
    expect(merged).toContain('# home screen\nscreen Home');
    expect(merged).toContain('    # primary action\n    button "Updated"');
  });
});
