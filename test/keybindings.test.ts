import { describe, expect, test } from './harness';
import {
  chordFromEvent,
  chordsEqual,
  findConflicts,
  findShadowedPrefixes,
  formatChord,
  formatKeybinding,
  match,
  normalizeKeybinding,
  parseChord,
  parseKeybinding,
  parseUserKeybindings,
  renderUserKeybindings,
  resolveBindings,
  resolvePrimaryModifier,
  type Keybinding,
} from '../src/renderer/keybindings/keybindings';

function binding(keys: string, command: string, source: 'default' | 'user' = 'default'): Keybinding {
  const chords = parseKeybinding(keys);
  if (!chords) throw new Error(`bad test binding: ${keys}`);
  return { chords, command, source };
}

describe('parseChord', () => {
  test('reads modifiers and a key', () => {
    expect(parseChord('Ctrl+Shift+P')).toEqual({ ctrl: true, shift: true, alt: false, meta: false, key: 'p' });
  });

  test('modifier aliases all resolve', () => {
    expect(parseChord('Control+P')?.ctrl).toBe(true);
    expect(parseChord('Cmd+P')?.meta).toBe(true);
    expect(parseChord('Command+P')?.meta).toBe(true);
    expect(parseChord('Option+P')?.alt).toBe(true);
  });

  test('key aliases resolve to the DOM names', () => {
    expect(parseChord('Esc')?.key).toBe('escape');
    expect(parseChord('Up')?.key).toBe('arrowup');
    expect(parseChord('Space')?.key).toBe(' ');
    expect(parseChord('Return')?.key).toBe('enter');
  });

  test('a function key keeps its number', () => {
    expect(parseChord('F5')?.key).toBe('f5');
  });

  test('a chord with two keys is malformed', () => {
    expect(parseChord('Ctrl+P+Q')).toBeNull();
  });

  test('a chord with only modifiers is malformed', () => {
    expect(parseChord('Ctrl+Shift')).toBeNull();
    expect(parseChord('')).toBeNull();
  });

  test('a literal plus is a key, not a separator', () => {
    expect(parseChord('Ctrl++')?.key).toBe('+');
    expect(parseChord('+')?.key).toBe('+');
  });
});

describe('parseKeybinding', () => {
  test('a two-chord binding', () => {
    const chords = parseKeybinding('Ctrl+K Ctrl+S');
    expect(chords).toHaveLength(2);
    expect(chords![1].key).toBe('s');
  });

  test('three chords are refused — nobody remembers them', () => {
    expect(parseKeybinding('Ctrl+K Ctrl+S Ctrl+T')).toBeNull();
  });

  test('a malformed chord poisons the whole binding', () => {
    expect(parseKeybinding('Ctrl+K Ctrl+Shift')).toBeNull();
  });

  test('empty input is not a binding', () => {
    expect(parseKeybinding('   ')).toBeNull();
  });
});

describe('normalisation', () => {
  test('every spelling of one chord canonicalises identically', () => {
    const canonical = 'Ctrl+Shift+P';
    expect(normalizeKeybinding('ctrl+shift+p')).toBe(canonical);
    expect(normalizeKeybinding('Shift+Ctrl+P')).toBe(canonical);
    expect(normalizeKeybinding('CONTROL+SHIFT+p')).toBe(canonical);
  });

  test('modifiers always print in a fixed order', () => {
    expect(formatChord({ ctrl: true, shift: true, alt: true, meta: true, key: 'p' })).toBe('Ctrl+Shift+Alt+Meta+P');
  });

  test('special keys print readably', () => {
    expect(normalizeKeybinding('esc')).toBe('Escape');
    expect(normalizeKeybinding('f5')).toBe('F5');
    expect(normalizeKeybinding('space')).toBe('Space');
    expect(normalizeKeybinding('ctrl+up')).toBe('Ctrl+Arrowup');
  });

  test('a two-chord binding round-trips', () => {
    expect(normalizeKeybinding('ctrl+k ctrl+s')).toBe('Ctrl+K Ctrl+S');
  });

  test('nonsense normalises to null, never to a plausible-looking binding', () => {
    expect(normalizeKeybinding('Ctrl+')).toBeNull();
    expect(normalizeKeybinding('')).toBeNull();
  });
});

describe('chordFromEvent', () => {
  test('reads a real keyboard event', () => {
    const chord = chordFromEvent({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'P' });
    expect(chord).toEqual({ ctrl: true, shift: false, alt: false, meta: false, key: 'p' });
  });

  test('a bare modifier press is not a chord — it would fire on every Ctrl', () => {
    expect(chordFromEvent({ ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, key: 'Control' })).toBeNull();
    expect(chordFromEvent({ ctrlKey: false, shiftKey: true, altKey: false, metaKey: false, key: 'Shift' })).toBeNull();
  });

  test('an event chord equals the parsed chord for the same keys', () => {
    const fromEvent = chordFromEvent({ ctrlKey: true, shiftKey: true, altKey: false, metaKey: false, key: 'p' })!;
    expect(chordsEqual(fromEvent, parseChord('Ctrl+Shift+P')!)).toBe(true);
  });
});

describe('match', () => {
  const bindings = [
    binding('Ctrl+P', 'znxstudio.quickOpen'),
    binding('Ctrl+Shift+P', 'znxstudio.palette.show'),
    binding('Ctrl+K Ctrl+S', 'znxstudio.keybindings.show'),
  ];

  test('an exact single chord runs its command', () => {
    const result = match(bindings, [parseChord('Ctrl+P')!]);
    expect(result.kind).toBe('command');
    expect(result.kind === 'command' && result.command).toBe('znxstudio.quickOpen');
  });

  test('an unbound chord matches nothing, so the key reaches the editor', () => {
    expect(match(bindings, [parseChord('Ctrl+J')!]).kind).toBe('none');
  });

  test('the first chord of a two-chord binding is pending, not a miss', () => {
    const result = match(bindings, [parseChord('Ctrl+K')!]);
    expect(result.kind).toBe('pending');
    expect(result.kind === 'pending' && result.candidates).toHaveLength(1);
  });

  test('the second chord completes it', () => {
    const result = match(bindings, [parseChord('Ctrl+K')!, parseChord('Ctrl+S')!]);
    expect(result.kind === 'command' && result.command).toBe('znxstudio.keybindings.show');
  });

  test('a wrong second chord is a miss, not a silent swallow', () => {
    expect(match(bindings, [parseChord('Ctrl+K')!, parseChord('Ctrl+Z')!]).kind).toBe('none');
  });

  test('a user binding beats a default on the same keys — that is what an override is', () => {
    const withOverride = [...bindings, binding('Ctrl+P', 'znxstudio.file.print', 'user')];
    const result = match(withOverride, [parseChord('Ctrl+P')!]);
    expect(result.kind === 'command' && result.command).toBe('znxstudio.file.print');
  });

  test('among two defaults, the last registered wins, so a later module can shadow an earlier one', () => {
    const two = [binding('Ctrl+G', 'first'), binding('Ctrl+G', 'second')];
    const result = match(two, [parseChord('Ctrl+G')!]);
    expect(result.kind === 'command' && result.command).toBe('second');
  });
});

describe('findConflicts', () => {
  test('a user binding shadowing a default is an override, not a conflict', () => {
    const conflicts = findConflicts([binding('Ctrl+P', 'quickOpen'), binding('Ctrl+P', 'print', 'user')]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].isOverride).toBe(true);
    expect(conflicts[0].commands).toEqual(['quickOpen', 'print']);
  });

  test('two defaults on the same keys are a real conflict', () => {
    const conflicts = findConflicts([binding('Ctrl+G', 'a'), binding('Ctrl+G', 'b')]);
    expect(conflicts[0].isOverride).toBe(false);
  });

  test('two user bindings on the same keys are a real conflict', () => {
    const conflicts = findConflicts([binding('Ctrl+G', 'a', 'user'), binding('Ctrl+G', 'b', 'user')]);
    expect(conflicts[0].isOverride).toBe(false);
  });

  test('the same command bound twice is not a conflict', () => {
    expect(findConflicts([binding('Ctrl+G', 'same'), binding('Ctrl+G', 'same', 'user')])).toHaveLength(0);
  });

  test('different keys never conflict', () => {
    expect(findConflicts([binding('Ctrl+G', 'a'), binding('Ctrl+H', 'b')])).toHaveLength(0);
  });
});

describe('findShadowedPrefixes', () => {
  test('a two-chord binding whose prefix is itself bound can never fire', () => {
    const shadowed = findShadowedPrefixes([binding('Ctrl+K', 'kill'), binding('Ctrl+K Ctrl+S', 'save-all')]);
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].prefix).toBe('Ctrl+K');
    expect(shadowed[0].shadowed).toEqual(['Ctrl+K Ctrl+S']);
  });

  test('an unshadowed prefix is fine', () => {
    expect(findShadowedPrefixes([binding('Ctrl+K Ctrl+S', 'save-all')])).toHaveLength(0);
  });
});

describe('user keybinding persistence', () => {
  test('reads overrides from settings', () => {
    const bindings = parseUserKeybindings({ 'ctrl+p': 'znxstudio.quickOpen', 'Ctrl+K Ctrl+S': 'save' });
    expect(bindings).toHaveLength(2);
    expect(bindings.every((b) => b.source === 'user')).toBe(true);
  });

  test('a malformed key or a blank command is dropped, never guessed at', () => {
    expect(parseUserKeybindings({ 'Ctrl+': 'x', 'Ctrl+P': '  ', 'Ctrl+Q': 5 })).toHaveLength(0);
  });

  test('anything that is not an object yields no bindings', () => {
    expect(parseUserKeybindings(['Ctrl+P'])).toHaveLength(0);
    expect(parseUserKeybindings(null)).toHaveLength(0);
  });

  test('render round-trips, canonicalising the keys', () => {
    expect(renderUserKeybindings(parseUserKeybindings({ 'shift+ctrl+p': 'cmd' }))).toEqual({ 'Ctrl+Shift+P': 'cmd' });
  });

  test('render ignores defaults — only a user’s own bindings are stored', () => {
    expect(renderUserKeybindings([binding('Ctrl+P', 'a'), binding('Ctrl+Q', 'b', 'user')])).toEqual({ 'Ctrl+Q': 'b' });
  });
});

describe('resolveBindings', () => {
  test('user bindings come after defaults, so match() picks them', () => {
    const resolved = resolveBindings([binding('Ctrl+P', 'a')], [binding('Ctrl+P', 'b', 'user')]);
    expect(resolved).toHaveLength(2);
    expect(formatKeybinding(resolved[1].chords)).toBe('Ctrl+P');
    expect(match(resolved, [parseChord('Ctrl+P')!]).kind === 'command').toBe(true);
  });

  test('an overridden default is kept, so the editor can show what was replaced', () => {
    expect(resolveBindings([binding('Ctrl+P', 'a')], [binding('Ctrl+P', 'b', 'user')]).map((b) => b.command)).toEqual(['a', 'b']);
  });
});

describe('resolvePrimaryModifier (macOS Cmd vs Ctrl)', () => {
  test('Mod resolves to Meta on macOS, Ctrl elsewhere', () => {
    expect(resolvePrimaryModifier('Mod+P', true)).toBe('Meta+P');
    expect(resolvePrimaryModifier('Mod+P', false)).toBe('Ctrl+P');
  });

  test('the CmdOrCtrl alias resolves the same way', () => {
    expect(resolvePrimaryModifier('CmdOrCtrl+S', true)).toBe('Meta+S');
    expect(resolvePrimaryModifier('CmdOrCtrl+S', false)).toBe('Ctrl+S');
  });

  test('every chord in a two-chord binding is resolved', () => {
    expect(resolvePrimaryModifier('Mod+K Mod+S', true)).toBe('Meta+K Meta+S');
    expect(resolvePrimaryModifier('Mod+K Mod+S', false)).toBe('Ctrl+K Ctrl+S');
  });

  test('other modifiers and keys are untouched, and the result parses', () => {
    const mac = resolvePrimaryModifier('Mod+Shift+P', true);
    expect(mac).toBe('Meta+Shift+P');
    expect(parseKeybinding(mac)).toBeTruthy();
    // A key literally containing "mod" is not clobbered (word-boundary only).
    expect(resolvePrimaryModifier('Ctrl+Comma', false)).toBe('Ctrl+Comma');
  });
});
