/**
 * Keybindings (Phase 17D) — the pure model.
 *
 * A binding is a sequence of one or two CHORDS (`Ctrl+K Ctrl+S`). A chord is a
 * set of modifiers plus one key. The model parses, normalises, matches and
 * detects conflicts; it never touches the DOM, so every rule below is testable
 * without a keyboard.
 *
 * Normalisation is the whole game. `ctrl+shift+p`, `Shift+Ctrl+P` and `CTRL+P`
 * with shift must all resolve to one canonical string, or a user override will
 * silently fail to replace the default it was written to replace.
 */

export interface Chord {
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Command on macOS, Windows key elsewhere. */
  meta: boolean;
  /** The physical key, lower-cased: `p`, `f5`, `escape`, `arrowup`, `,`. */
  key: string;
}

export interface Keybinding {
  /** One or two chords. A two-chord binding fires only on the second. */
  chords: Chord[];
  command: string;
  /** Where the binding came from, for the editor and for conflict reporting. */
  source: 'default' | 'user';
}

type ModifierKey = 'ctrl' | 'shift' | 'alt' | 'meta';

/** Modifier order is fixed so a canonical string is unambiguous. */
const MODIFIER_ORDER: ModifierKey[] = ['ctrl', 'shift', 'alt', 'meta'];

const MODIFIER_ALIASES: Record<string, ModifierKey> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  shift: 'shift',
  alt: 'alt',
  option: 'alt',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
};

/** A few keys people write differently than the DOM names them. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  return: 'enter',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
};

function normalizeKey(key: string): string {
  const lower = key.toLowerCase();
  return KEY_ALIASES[lower] ?? lower;
}

/**
 * Resolve the platform-primary modifier token `Mod` (alias `CmdOrCtrl`) to the
 * concrete modifier for this OS: `Meta` (Command) on macOS, `Ctrl` elsewhere.
 * Defaults ship as `Mod+P` so ONE binding table is native everywhere — Cmd+P on a
 * Mac, Ctrl+P on Windows/Linux — instead of a hardcoded Ctrl list that fights
 * macOS conventions. Applied before parsing; unknown tokens pass through.
 */
export function resolvePrimaryModifier(keys: string, isMac: boolean): string {
  return keys.replace(/\b(?:mod|cmdorctrl)\b/gi, isMac ? 'Meta' : 'Ctrl');
}

/**
 * Parse one chord (`Ctrl+Shift+P`). Returns null when it names no key, or two.
 *
 * `+` is both the separator and a key, so the two must be told apart: `Ctrl++`
 * binds the plus key, while `Ctrl+` is a dangling separator and binds nothing.
 * Reading the second as the first would silently create a binding the user never
 * wrote.
 */
export function parseChord(text: string): Chord | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  let body = trimmed;
  let literalPlus = false;
  if (trimmed === '+') {
    return { ctrl: false, shift: false, alt: false, meta: false, key: '+' };
  }
  if (trimmed.endsWith('++')) {
    body = trimmed.slice(0, -2);
    literalPlus = true;
  } else if (trimmed.endsWith('+')) {
    return null; // `Ctrl+` — a separator with nothing after it
  }

  const chord: Chord = { ctrl: false, shift: false, alt: false, meta: false, key: '' };
  for (const part of body.split('+').map((segment) => segment.trim())) {
    if (!part) return null; // an empty segment means a doubled separator
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (modifier) {
      chord[modifier] = true;
      continue;
    }
    if (chord.key) return null; // two keys in one chord
    chord.key = normalizeKey(part);
  }

  if (literalPlus) {
    if (chord.key) return null; // `Ctrl+P++` names two keys
    chord.key = '+';
  }
  return chord.key ? chord : null;
}

/** Parse a whole binding (`Ctrl+K Ctrl+S`). At most two chords; null when malformed. */
export function parseKeybinding(text: string): Chord[] | null {
  const chords: Chord[] = [];
  for (const part of text.trim().split(/\s+/).filter(Boolean)) {
    const chord = parseChord(part);
    if (!chord) return null;
    chords.push(chord);
  }
  if (!chords.length || chords.length > 2) return null;
  return chords;
}

/** The canonical string for a chord. Modifiers always in the same order. */
export function formatChord(chord: Chord): string {
  const parts = MODIFIER_ORDER.filter((modifier) => chord[modifier] === true).map(
    (modifier) => modifier.charAt(0).toUpperCase() + modifier.slice(1),
  );
  parts.push(chord.key === ' ' ? 'Space' : chord.key.length === 1 ? chord.key.toUpperCase() : titleCase(chord.key));
  return parts.join('+');
}

function titleCase(key: string): string {
  if (/^f\d{1,2}$/.test(key)) return key.toUpperCase();
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function formatKeybinding(chords: Chord[]): string {
  return chords.map(formatChord).join(' ');
}

/** The canonical form of any spelling, or null when it does not parse. */
export function normalizeKeybinding(text: string): string | null {
  const chords = parseKeybinding(text);
  return chords ? formatKeybinding(chords) : null;
}

export function chordsEqual(a: Chord, b: Chord): boolean {
  return a.ctrl === b.ctrl && a.shift === b.shift && a.alt === b.alt && a.meta === b.meta && a.key === b.key;
}

/** The chord a keyboard event denotes, or null when the event is a bare modifier press. */
export function chordFromEvent(event: {
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  key: string;
}): Chord | null {
  const key = normalizeKey(event.key);
  if (key === 'control' || key === 'shift' || key === 'alt' || key === 'meta') return null;
  return { ctrl: event.ctrlKey, shift: event.shiftKey, alt: event.altKey, meta: event.metaKey, key };
}

/* -------------------------------------------------------------- matching */

export type MatchResult =
  | { kind: 'none' }
  /** The first chord of a two-chord binding matched; wait for the next key. */
  | { kind: 'pending'; candidates: Keybinding[] }
  | { kind: 'command'; command: string; binding: Keybinding };

/**
 * Match a chord sequence against the bindings. A USER binding always wins over a
 * default for the same keys — that is what an override means. Among equals, the
 * last registered wins, so a later contribution can shadow an earlier one.
 */
export function match(bindings: Keybinding[], pressed: Chord[]): MatchResult {
  const exact = bindings.filter(
    (binding) => binding.chords.length === pressed.length && binding.chords.every((chord, i) => chordsEqual(chord, pressed[i])),
  );
  if (exact.length) {
    const winner = pick(exact);
    return { kind: 'command', command: winner.command, binding: winner };
  }

  // A prefix match means the user is mid-chord; swallow the key and wait.
  const candidates = bindings.filter(
    (binding) => binding.chords.length > pressed.length && pressed.every((chord, i) => chordsEqual(chord, binding.chords[i])),
  );
  return candidates.length ? { kind: 'pending', candidates } : { kind: 'none' };
}

/** User beats default; otherwise the last one registered. */
function pick(bindings: Keybinding[]): Keybinding {
  const user = bindings.filter((binding) => binding.source === 'user');
  const pool = user.length ? user : bindings;
  return pool[pool.length - 1];
}

/* ------------------------------------------------------------- conflicts */

export interface KeybindingConflict {
  keys: string;
  /** The commands fighting over these keys, in resolution order (winner last). */
  commands: string[];
  /** True when a user binding shadows a default — an override, not a mistake. */
  isOverride: boolean;
}

/**
 * Two bindings conflict when they share a key sequence but run different
 * commands. A user binding shadowing a default is reported as an OVERRIDE, not a
 * problem: it is the whole point of user bindings. Two user bindings on the same
 * keys, or two defaults, are a genuine conflict.
 */
export function findConflicts(bindings: Keybinding[]): KeybindingConflict[] {
  const groups = new Map<string, Keybinding[]>();
  for (const binding of bindings) {
    const keys = formatKeybinding(binding.chords);
    const group = groups.get(keys);
    if (group) group.push(binding);
    else groups.set(keys, [binding]);
  }

  const conflicts: KeybindingConflict[] = [];
  for (const [keys, group] of groups) {
    const commands = [...new Set(group.map((binding) => binding.command))];
    if (commands.length < 2) continue;

    const hasUser = group.some((binding) => binding.source === 'user');
    const hasDefault = group.some((binding) => binding.source === 'default');
    conflicts.push({ keys, commands, isOverride: hasUser && hasDefault && group.filter((b) => b.source === 'user').length === 1 });
  }
  return conflicts.sort((a, b) => a.keys.localeCompare(b.keys));
}

/** A two-chord binding whose first chord is a whole binding of its own can never fire. */
export function findShadowedPrefixes(bindings: Keybinding[]): { prefix: string; shadowed: string[] }[] {
  const singles = new Map<string, Keybinding>();
  for (const binding of bindings) {
    if (binding.chords.length === 1) singles.set(formatChord(binding.chords[0]), binding);
  }

  const shadowed = new Map<string, string[]>();
  for (const binding of bindings) {
    if (binding.chords.length < 2) continue;
    const prefix = formatChord(binding.chords[0]);
    if (!singles.has(prefix)) continue;
    const list = shadowed.get(prefix) ?? [];
    list.push(formatKeybinding(binding.chords));
    shadowed.set(prefix, list);
  }
  return [...shadowed.entries()].map(([prefix, list]) => ({ prefix, shadowed: list })).sort((a, b) => a.prefix.localeCompare(b.prefix));
}

/* ----------------------------------------------------------- persistence */

/** A user's overrides, as stored: `{ "Ctrl+P": "znxstudio.quickOpen" }`. */
export type UserKeybindings = Record<string, string>;

/** Parse untrusted overrides. A malformed key or a blank command is dropped. */
export function parseUserKeybindings(value: unknown): Keybinding[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const bindings: Keybinding[] = [];
  for (const [keys, command] of Object.entries(value as Record<string, unknown>)) {
    if (typeof command !== 'string' || !command.trim()) continue;
    const chords = parseKeybinding(keys);
    if (chords) bindings.push({ chords, command: command.trim(), source: 'user' });
  }
  return bindings;
}

export function renderUserKeybindings(bindings: Keybinding[]): UserKeybindings {
  const out: UserKeybindings = {};
  for (const binding of bindings.filter((b) => b.source === 'user')) out[formatKeybinding(binding.chords)] = binding.command;
  return out;
}

/**
 * Defaults plus user overrides, in resolution order (user last, so `match` picks
 * them). Defaults are NOT removed when overridden — the editor shows both, and a
 * user can see exactly what they replaced.
 */
export function resolveBindings(defaults: Keybinding[], user: Keybinding[]): Keybinding[] {
  return [...defaults, ...user];
}
