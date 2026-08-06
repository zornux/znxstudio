/**
 * Static Zoijs route-table analysis (Phase 6E). `@zoijs/router` routes are a
 * plain `{ "/pattern": Component }` object — either inline in `createRouter({…})`
 * or a `const routes = {…}` passed to it (as the docs site does). This finds
 * those object literals and extracts each route: its pattern, target component,
 * `:params`, whether it is dynamic, and the `"*"` not-found route. Pure; no DOM.
 */
import type { Diagnostic } from '../language/api';
import { matchBrace } from './zoijsComponents';

export interface RouteEntry {
  pattern: string;
  /** Target component identifier, or '(inline)' for an arrow/function value. */
  component: string;
  /** Names of `:segment` params in the pattern. */
  params: string[];
  dynamic: boolean;
  notFound: boolean;
  /** 0-based position of the route key (for navigation). */
  line: number;
  char: number;
  /** Index of the route table this entry belongs to (for per-table dup checks). */
  table: number;
}

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

// A template literal (with nested `${}` that may hold more templates) skipped whole.
function skipTemplate(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\') {
      i += 2;
      continue;
    }
    if (c === '`') return i + 1;
    if (c === '$' && text[i + 1] === '{') {
      i = skipInterp(text, i + 2);
      continue;
    }
    i += 1;
  }
  return text.length;
}

function skipInterp(text: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'") {
      i = skipString(text, i, c);
      continue;
    }
    if (c === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (c === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === '}') {
      if (depth === 0) return i + 1;
      depth -= 1;
      i += 1;
      continue;
    }
    i += 1;
  }
  return text.length;
}

/** From `from`, return the index of the next top-level `,` or the object close. */
function scanValueEnd(text: string, from: number, objClose: number): number {
  let depth = 0;
  let i = from;
  while (i < text.length && i <= objClose) {
    const c = text[i];
    const d = text[i + 1];
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
    if (c === '"' || c === "'") {
      i = skipString(text, i, c);
      continue;
    }
    if (c === '`') {
      i = skipTemplate(text, i);
      continue;
    }
    if (c === '(' || c === '[' || c === '{') {
      depth += 1;
      i += 1;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) return i; // hit the object's closing brace
      depth -= 1;
      i += 1;
      continue;
    }
    if (c === ',' && depth === 0) return i;
    i += 1;
  }
  return Math.min(i, objClose);
}

function routeParams(pattern: string): string[] {
  return pattern
    .split('/')
    .filter((seg) => seg.startsWith(':'))
    .map((seg) => seg.slice(1).replace(/[^\w$].*$/, ''))
    .filter(Boolean);
}

function parseObjectEntries(text: string, braceOpen: number, table: number, lineStarts: number[]): RouteEntry[] {
  const close = matchBrace(text, braceOpen);
  const entries: RouteEntry[] = [];
  let i = braceOpen + 1;

  while (i < close) {
    const c = text[i];
    if (/\s/.test(c) || c === ',') {
      i += 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? close : nl;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const cl = text.indexOf('*/', i + 2);
      i = cl < 0 ? close : cl + 2;
      continue;
    }

    // Read the key.
    let key: string | null = null;
    const keyOffset = i;
    if (c === '"' || c === "'") {
      const end = skipString(text, i, c);
      key = text.slice(i + 1, end - 1);
      i = end;
    } else {
      // A non-string key (identifier/computed/number): not a route we model.
      const rest = text.slice(i);
      const m = /^(\[[^\]]*\]|[A-Za-z_$][\w$]*|\d+)/.exec(rest);
      i += m ? m[0].length : 1;
    }

    // Expect `:`.
    while (i < close && /\s/.test(text[i])) i += 1;
    if (text[i] !== ':') {
      // Not a `key: value` pair (shorthand/spread/method) — skip to next comma.
      i = scanValueEnd(text, i, close);
      if (text[i] === ',') i += 1;
      continue;
    }
    i += 1; // past ':'
    while (i < close && /\s/.test(text[i])) i += 1;

    const valEnd = scanValueEnd(text, i, close);
    const value = text.slice(i, valEnd).trim();
    i = valEnd;
    if (text[i] === ',') i += 1;

    if (key !== null) {
      const pos = positionAt(lineStarts, keyOffset);
      const params = routeParams(key);
      entries.push({
        pattern: key,
        component: /^[A-Za-z_$][\w$]*$/.test(value) ? value : '(inline)',
        params,
        dynamic: params.length > 0,
        notFound: key === '*',
        line: pos.line,
        char: pos.character,
        table,
      });
    }
  }
  return entries;
}

const CREATE_ROUTER = /(?<!\.)\bcreateRouter\s*\(/g;
const CONST_OBJECT = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\{/g;

function isPathShaped(entry: RouteEntry): boolean {
  return entry.pattern.startsWith('/') || entry.pattern === '*';
}

export function scanRoutes(text: string): RouteEntry[] {
  const lineStarts = computeLineStarts(text);

  // Map const-object names to their `{` offset.
  const constBrace = new Map<string, number>();
  CONST_OBJECT.lastIndex = 0;
  let cm: RegExpExecArray | null;
  while ((cm = CONST_OBJECT.exec(text))) {
    const brace = text.indexOf('{', cm.index + cm[0].length - 1);
    if (brace >= 0) constBrace.set(cm[1], brace);
  }

  // Braces that are createRouter's first argument (inline object, or a const it names).
  const routerBraces = new Set<number>();
  CREATE_ROUTER.lastIndex = 0;
  let rm: RegExpExecArray | null;
  while ((rm = CREATE_ROUTER.exec(text))) {
    let j = rm.index + rm[0].length;
    while (j < text.length && /\s/.test(text[j])) j += 1;
    if (text[j] === '{') {
      routerBraces.add(j);
    } else {
      const id = /^[A-Za-z_$][\w$]*/.exec(text.slice(j));
      if (id && constBrace.has(id[0])) routerBraces.add(constBrace.get(id[0])!);
    }
  }

  // Candidate braces: everything createRouter references + every const object.
  const candidates = new Set<number>([...routerBraces, ...constBrace.values()]);
  const entries: RouteEntry[] = [];
  let table = 0;
  for (const brace of [...candidates].sort((a, b) => a - b)) {
    const parsed = parseObjectEntries(text, brace, table, lineStarts);
    // A route table = createRouter's arg, or an object with a path-shaped key.
    if (routerBraces.has(brace) || parsed.some(isPathShaped)) {
      entries.push(...parsed);
      table += 1;
    }
  }
  entries.sort((a, b) => a.line - b.line || a.char - b.char);
  return entries;
}

/** Duplicate-pattern diagnostic (per table) — the one router check TS can't do. */
export function analyzeRoutes(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const entry of scanRoutes(text)) {
    const key = `${entry.table}:${entry.pattern}`;
    if (seen.has(key)) {
      diagnostics.push({
        range: {
          start: { line: entry.line, character: entry.char },
          end: { line: entry.line, character: entry.char + entry.pattern.length + 2 },
        },
        severity: 'warning',
        source: 'zoijs',
        code: 'ZOIJS-DUPLICATE-ROUTE',
        message: `Duplicate route pattern '${entry.pattern}' — the later one shadows the earlier.`,
        hint: 'Each route pattern should appear once per router.',
      });
    }
    seen.add(key);
  }
  return diagnostics;
}
