/**
 * Pure scanner (Phase 6A) that finds `${…}` interpolations that live inside an
 * `html`…`` tagged template literal — the Zoijs binding sites. A small
 * character state machine tracks template-literal nesting and `${}` depth so it
 * correctly handles nested `html`` (e.g. inside `each(...)`), strings, and
 * comments. No DOM. Used by the reactivity diagnostic.
 */
export interface HtmlBinding {
  /** The interpolation source, e.g. `() => count.get()` (without the `${` `}`). */
  expr: string;
  /** 0-based offset of the `$` in `${`. */
  start: number;
  /** 0-based offset just past the closing `}`. */
  end: number;
}

type Frame =
  | { kind: 'tmpl'; html: boolean }
  | { kind: 'expr'; exprStart: number; dollarStart: number; htmlEnclosing: boolean; braceDepth: number };

function precededByHtmlTag(text: string, backtick: number): boolean {
  let j = backtick - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  if (j < 3) return false;
  if (text.slice(j - 3, j + 1) !== 'html') return false;
  const before = text[j - 4];
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

export function scanHtmlBindings(text: string): HtmlBinding[] {
  const out: HtmlBinding[] = [];
  const stack: Frame[] = [];
  const n = text.length;
  let i = 0;

  while (i < n) {
    const top = stack[stack.length - 1];
    const inTemplate = top?.kind === 'tmpl';

    if (inTemplate) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        i += 1;
        continue;
      }
      if (c === '$' && text[i + 1] === '{') {
        stack.push({ kind: 'expr', exprStart: i + 2, dollarStart: i, htmlEnclosing: top.html, braceDepth: 0 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }

    // In JS code (root, or inside an interpolation expression).
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? n : nl;
      continue;
    }
    if (c === '/' && d === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i, c);
      continue;
    }
    if (c === '`') {
      stack.push({ kind: 'tmpl', html: precededByHtmlTag(text, i) });
      i += 1;
      continue;
    }
    if (c === '{' && top?.kind === 'expr') {
      top.braceDepth += 1;
      i += 1;
      continue;
    }
    if (c === '}' && top?.kind === 'expr') {
      if (top.braceDepth > 0) {
        top.braceDepth -= 1;
        i += 1;
        continue;
      }
      stack.pop();
      if (top.htmlEnclosing) {
        out.push({ expr: text.slice(top.exprStart, i), start: top.dollarStart, end: i + 1 });
      }
      i += 1;
      continue;
    }
    i += 1;
  }

  return out;
}

/**
 * Is `offset` inside an `html`…`` tagged template region (including inside a
 * `${…}` interpolation nested in one)? Used to make component completion
 * context-aware. Runs the same nesting machine up to `offset`.
 */
export function isInHtmlTemplate(text: string, offset: number): boolean {
  const stack: Frame[] = [];
  const limit = Math.min(offset, text.length);
  let i = 0;
  while (i < limit) {
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
        stack.push({ kind: 'expr', exprStart: i + 2, dollarStart: i, htmlEnclosing: top.html, braceDepth: 0 });
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '/' && d === '/') {
      const nl = text.indexOf('\n', i);
      i = nl < 0 ? limit : nl;
      continue;
    }
    if (c === '/' && d === '*') {
      const cl = text.indexOf('*/', i + 2);
      i = cl < 0 ? limit : cl + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      i = skipString(text, i, c);
      continue;
    }
    if (c === '`') {
      stack.push({ kind: 'tmpl', html: precededByHtmlTag(text, i) });
      i += 1;
      continue;
    }
    if (c === '{' && top?.kind === 'expr') {
      top.braceDepth += 1;
      i += 1;
      continue;
    }
    if (c === '}' && top?.kind === 'expr') {
      if (top.braceDepth > 0) top.braceDepth -= 1;
      else stack.pop();
      i += 1;
      continue;
    }
    i += 1;
  }
  return stack.some((f) => f.kind === 'tmpl' && f.html);
}

function skipString(text: string, start: number, quote: string): number {
  let i = start + 1;
  const n = text.length;
  while (i < n) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return n;
}
