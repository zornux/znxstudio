/**
 * Pure Zoijs component detection (Phase 6B). A Zoijs component is a function
 * (declaration or const-arrow) that returns an `html`…`` template. This scans a
 * file for those, extracting each component's params, declared state
 * (`createState`), effect count, and the child components it renders inside its
 * markup. Heuristic but grounded in the real idiom; no DOM.
 */
import { scanHtmlBindings } from './zoijsBindings';

export interface ZoijsComponent {
  name: string;
  exported: boolean;
  params: string[];
  /** 0-based position of the component name (for navigation). */
  nameLine: number;
  nameChar: number;
  /** Names of `createState` values declared in the body. */
  state: string[];
  /** Count of `effect(...)` calls in the body. */
  effects: number;
  /** PascalCase components rendered inside this component's markup. */
  uses: string[];
}

const FUNCTION = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/g;
const ARROW = /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*=>/g;
const STATE_DECL = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*createState\s*\(/g;
const EFFECT_CALL = /\beffect\s*\(/g;
const PASCAL_CALL = /\b([A-Z][\w$]*)\s*\(/g;

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

/** First `{` at code level from `from` (skips ws/comments), or -1 if a non-`{` code char comes first. */
function nextBrace(text: string, from: number): number {
  let i = from;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? text.length : nl;
      continue;
    }
    if (c === '/' && d === '*') {
      const cl = text.indexOf('*/', i + 2);
      i = cl < 0 ? text.length : cl + 2;
      continue;
    }
    return c === '{' ? i : -1;
  }
  return -1;
}

/**
 * Given the index of an opening `{`, return the index of its matching `}`,
 * correctly skipping strings, template literals (and their `${}` interpolations),
 * and comments. Returns the end of text if unbalanced.
 */
export function matchBrace(text: string, open: number): number {
  type Frame = { kind: 'tmpl' } | { kind: 'expr'; depth: number };
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
        stack.push({ kind: 'expr', depth: 0 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    // Code level (root or inside an interpolation expression).
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
    if (c === '{') {
      if (top?.kind === 'expr') top.depth += 1;
      else depth += 1;
      i += 1;
      continue;
    }
    if (c === '}') {
      if (top?.kind === 'expr') {
        if (top.depth > 0) top.depth -= 1;
        else stack.pop();
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

function splitParams(raw: string): string[] {
  return raw
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function bodyMetadata(body: string): { state: string[]; effects: number; uses: string[] } {
  const state: string[] = [];
  let m: RegExpExecArray | null;
  STATE_DECL.lastIndex = 0;
  while ((m = STATE_DECL.exec(body))) state.push(m[1]);

  EFFECT_CALL.lastIndex = 0;
  const effects = (body.match(EFFECT_CALL) ?? []).length;

  // Child components: PascalCase calls inside html`` interpolations.
  const uses = new Set<string>();
  for (const binding of scanHtmlBindings(body)) {
    PASCAL_CALL.lastIndex = 0;
    let u: RegExpExecArray | null;
    while ((u = PASCAL_CALL.exec(binding.expr))) uses.add(u[1]);
  }
  return { state, effects, uses: [...uses] };
}

export function scanZoijsComponents(text: string): ZoijsComponent[] {
  const lineStarts = computeLineStarts(text);
  const components: ZoijsComponent[] = [];
  const seen = new Set<number>();

  const collect = (regex: RegExp) => {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text))) {
      const nameOffset = match.index + match[0].indexOf(match[1]);
      if (seen.has(nameOffset)) continue;
      const headerEnd = match.index + match[0].length;

      // Determine the body span.
      let body = '';
      const brace = nextBrace(text, headerEnd);
      if (brace >= 0) {
        const close = matchBrace(text, brace);
        body = text.slice(brace + 1, close);
      } else {
        // Arrow with an expression body: `=> html\`...\`` or another expression.
        // Take up to the end of the enclosing statement (a heuristic window).
        const semi = text.indexOf(';', headerEnd);
        body = text.slice(headerEnd, semi < 0 ? text.length : semi);
      }

      if (!/html\s*`/.test(body)) continue; // not a component (no html template returned)

      seen.add(nameOffset);
      const pos = positionAt(lineStarts, nameOffset);
      const meta = bodyMetadata(body);
      components.push({
        name: match[1],
        exported: /^\s*export\b/.test(match[0]) || match[0].startsWith('export'),
        params: splitParams(match[2]),
        nameLine: pos.line,
        nameChar: pos.character,
        state: meta.state,
        effects: meta.effects,
        uses: meta.uses,
      });
    }
  };

  collect(FUNCTION);
  collect(ARROW);
  components.sort((a, b) => a.nameLine - b.nameLine || a.nameChar - b.nameChar);
  return components;
}
