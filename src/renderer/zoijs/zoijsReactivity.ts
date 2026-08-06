/**
 * Static reactive-graph analysis for Zoijs (Phase 6D). Zoijs reactivity is
 * `createState` (a source), `computed(() => …)` (a derived value), and
 * `effect(() => …)` (a side effect) — a dependency is expressed by reading a
 * reactive value's `.get()`, and a state is written via `.set(…)`. This extracts
 * that graph statically (Zoijs has no runtime devtools to hook): which values
 * exist, what each computed/effect reads, what each effect writes, and how many
 * markup bindings read/write each value. Pure; no DOM.
 */
import { scanHtmlBindings } from './zoijsBindings';

export interface ReactiveValue {
  name: string;
  kind: 'state' | 'computed';
  /** 0-based position of the name (for navigation). */
  line: number;
  char: number;
  /** State: the `createState(…)` initializer text. Computed: 'computed'. */
  detail: string;
  /** Computed only: reactive names it reads via `.get()`. */
  reads: string[];
}

export interface ReactiveEffect {
  index: number; // 1-based, in source order
  line: number;
  reads: string[];
  writes: string[];
}

export interface ReactiveGraph {
  values: ReactiveValue[];
  effects: ReactiveEffect[];
  /** reactive name → count of markup bindings that read it (`.get()`). */
  bindingReads: Record<string, number>;
  /** reactive name → count of markup bindings that write it (`.set()`, e.g. handlers). */
  bindingWrites: Record<string, number>;
}

const STATE_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?<!\.)createState\s*\(/g;
const COMPUTED_DECL = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?<!\.)computed\s*\(/g;
const EFFECT_CALL = /(?<!\.)\beffect\s*\(/g;
const GET_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*get\s*\(\s*\)/g;
const SET_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*set\s*\(/g;

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function positionAt(lineStarts: number[], offset: number): { line: number; character: number } {
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - lineStarts[lo] };
}

function skipString(text: string, start: number, quote: string): number {
  let i = start + 1;
  while (i < text.length) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return text.length;
}

/**
 * Given the index of an opening `(`, return the index of its matching `)`,
 * skipping strings, template literals (+ their `${}`), and comments. Returns the
 * end of text if unbalanced.
 */
export function matchParen(text: string, open: number): number {
  type Frame = { kind: 'tmpl' } | { kind: 'expr'; parenDepth: number };
  const stack: Frame[] = [];
  let depth = 0;
  let i = open;
  const n = text.length;
  while (i < n) {
    const top = stack[stack.length - 1];
    const c = text[i];
    const d = text[i + 1];
    if (top?.kind === 'tmpl') {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        i += 1;
        continue;
      }
      if (c === '$' && d === '{') {
        stack.push({ kind: 'expr', parenDepth: 0 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '/' && d === '*') {
      const cl = text.indexOf('*/', i + 2);
      i = cl < 0 ? n : cl + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i, c);
      continue;
    }
    if (c === '`') {
      stack.push({ kind: 'tmpl' });
      i += 1;
      continue;
    }
    if (c === '{' && top?.kind === 'expr') {
      // An object/block inside the interpolation — track so a `}` doesn't pop it early.
      stack.push({ kind: 'expr', parenDepth: 0 });
      i += 1;
      continue;
    }
    if (c === '}' && top?.kind === 'expr') {
      stack.pop();
      i += 1;
      continue;
    }
    if (c === '(') {
      if (top?.kind === 'expr') top.parenDepth += 1;
      else depth += 1;
      i += 1;
      continue;
    }
    if (c === ')') {
      if (top?.kind === 'expr') {
        top.parenDepth -= 1;
        i += 1;
        continue;
      }
      depth -= 1;
      if (depth === 0) return i;
      i += 1;
      continue;
    }
    i += 1;
  }
  return n - 1;
}

function namesMatching(span: string, regex: RegExp, known: Set<string>): string[] {
  const found = new Set<string>();
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(span))) if (known.has(m[1])) found.add(m[1]);
  return [...found];
}

/** The argument text of a `name(` call whose `(` is at parenOpen. */
function callArg(text: string, parenOpen: number): string {
  const close = matchParen(text, parenOpen);
  return text.slice(parenOpen + 1, close);
}

export function analyzeReactiveGraph(text: string): ReactiveGraph {
  const lineStarts = computeLineStarts(text);

  interface Raw {
    name: string;
    kind: 'state' | 'computed';
    nameOffset: number;
    argOffset: number; // index of the '(' after createState/computed
    detail: string;
  }
  const raws: Raw[] = [];

  const collectDecl = (regex: RegExp, kind: 'state' | 'computed') => {
    regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text))) {
      const nameOffset = m.index + m[0].indexOf(m[1]);
      const parenOffset = m.index + m[0].length - 1; // regex ends with '('
      const detail = kind === 'state' ? callArg(text, parenOffset).trim().replace(/\s+/g, ' ') : 'computed';
      raws.push({ name: m[1], kind, nameOffset, argOffset: parenOffset, detail });
    }
  };
  collectDecl(STATE_DECL, 'state');
  collectDecl(COMPUTED_DECL, 'computed');

  const known = new Set(raws.map((r) => r.name));

  const values: ReactiveValue[] = raws.map((r) => {
    const pos = positionAt(lineStarts, r.nameOffset);
    const reads =
      r.kind === 'computed'
        ? namesMatching(callArg(text, r.argOffset), GET_CALL, known).filter((n) => n !== r.name)
        : [];
    return { name: r.name, kind: r.kind, line: pos.line, char: pos.character, detail: r.detail || (r.kind === 'state' ? '(empty)' : 'computed'), reads };
  });
  values.sort((a, b) => a.line - b.line || a.char - b.char);

  const effects: ReactiveEffect[] = [];
  EFFECT_CALL.lastIndex = 0;
  let e: RegExpExecArray | null;
  let index = 0;
  while ((e = EFFECT_CALL.exec(text))) {
    const parenOffset = e.index + e[0].length - 1;
    const body = callArg(text, parenOffset);
    index += 1;
    effects.push({
      index,
      line: positionAt(lineStarts, e.index).line,
      reads: namesMatching(body, GET_CALL, known),
      writes: namesMatching(body, SET_CALL, known),
    });
  }

  const bindingReads: Record<string, number> = {};
  const bindingWrites: Record<string, number> = {};
  for (const binding of scanHtmlBindings(text)) {
    for (const name of namesMatching(binding.expr, GET_CALL, known)) bindingReads[name] = (bindingReads[name] ?? 0) + 1;
    for (const name of namesMatching(binding.expr, SET_CALL, known)) bindingWrites[name] = (bindingWrites[name] ?? 0) + 1;
  }

  return { values, effects, bindingReads, bindingWrites };
}
