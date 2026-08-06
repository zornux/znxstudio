/**
 * Template IntelliSense for Zoijs `html`…`` markup (Phase 6C). Monaco's TS
 * worker treats the tagged template as an opaque string, so HTML tag/attribute/
 * event completion inside it is entirely ours. The heart is `templateContextAt`
 * — a char state-machine that reports, at a cursor offset, whether we are in
 * plain markup, typing a tag name, in attribute position (and for which tag),
 * inside an attribute value, or inside a `${…}` interpolation (JS). Pure; no DOM.
 */
import type { ZoijsCompletion } from './zoijsCompletions';

export const HTML_TAGS: readonly string[] = [
  'a', 'article', 'aside', 'b', 'button', 'code', 'div', 'em', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'header', 'hr', 'i', 'img', 'input', 'label', 'li', 'main', 'nav', 'ol', 'option', 'p',
  'pre', 'section', 'select', 'small', 'span', 'strong', 'table', 'tbody', 'td', 'textarea', 'th',
  'thead', 'time', 'tr', 'ul',
];

const VOID_TAGS = new Set(['img', 'input', 'hr', 'br', 'meta', 'link']);

interface AttrSpec {
  name: string;
  kind: 'value' | 'boolean' | 'event' | 'ref';
}

const GLOBAL_ATTRS: readonly AttrSpec[] = [
  { name: 'class', kind: 'value' },
  { name: 'id', kind: 'value' },
  { name: 'style', kind: 'value' },
  { name: 'title', kind: 'value' },
  { name: 'role', kind: 'value' },
  { name: 'hidden', kind: 'boolean' },
  { name: 'ref', kind: 'ref' },
];

const EVENT_ATTRS: readonly AttrSpec[] = [
  'onclick', 'oninput', 'onchange', 'onsubmit', 'onkeydown', 'onkeyup', 'onblur', 'onfocus',
  'onmouseenter', 'onmouseleave', 'onmousedown', 'onmouseup',
].map((name) => ({ name, kind: 'event' as const }));

const TAG_ATTRS: Record<string, AttrSpec[]> = {
  a: [{ name: 'href', kind: 'value' }, { name: 'target', kind: 'value' }, { name: 'download', kind: 'boolean' }],
  img: [{ name: 'src', kind: 'value' }, { name: 'alt', kind: 'value' }, { name: 'width', kind: 'value' }, { name: 'height', kind: 'value' }],
  input: [
    { name: 'type', kind: 'value' }, { name: 'value', kind: 'value' }, { name: 'placeholder', kind: 'value' },
    { name: 'name', kind: 'value' }, { name: 'checked', kind: 'boolean' }, { name: 'disabled', kind: 'boolean' },
    { name: 'required', kind: 'boolean' }, { name: 'readonly', kind: 'boolean' },
  ],
  button: [{ name: 'type', kind: 'value' }, { name: 'disabled', kind: 'boolean' }],
  label: [{ name: 'for', kind: 'value' }],
  option: [{ name: 'value', kind: 'value' }, { name: 'selected', kind: 'boolean' }],
  select: [{ name: 'name', kind: 'value' }, { name: 'disabled', kind: 'boolean' }],
  textarea: [{ name: 'placeholder', kind: 'value' }, { name: 'rows', kind: 'value' }, { name: 'name', kind: 'value' }],
  form: [{ name: 'action', kind: 'value' }, { name: 'method', kind: 'value' }],
};

/* ------------------------------------------------------------- context scan */

export type TemplateContext =
  | { region: 'none' }
  | { region: 'expr' }
  | { region: 'markup-text' }
  | { region: 'markup-value' }
  | { region: 'markup-tag'; partial: string }
  | { region: 'markup-attr'; tag: string };

interface TagState {
  name: string;
  sawSpace: boolean;
  closing: boolean;
  quote: string | null;
}
type Frame = { kind: 'tmpl'; html: boolean; tag: TagState | null } | { kind: 'expr'; braceDepth: number };

function precededByHtmlTag(text: string, backtick: number): boolean {
  let j = backtick - 1;
  while (j >= 0 && /\s/.test(text[j])) j -= 1;
  if (j < 3) return false;
  if (text.slice(j - 3, j + 1) !== 'html') return false;
  const before = text[j - 4];
  return before === undefined || !/[A-Za-z0-9_$]/.test(before);
}

function skipString(text: string, start: number, quote: string, limit: number): number {
  let i = start + 1;
  while (i < limit) {
    if (text[i] === '\\') {
      i += 2;
      continue;
    }
    if (text[i] === quote) return i + 1;
    i += 1;
  }
  return limit;
}

export function templateContextAt(text: string, offset: number): TemplateContext {
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
        stack.push({ kind: 'expr', braceDepth: 0 });
        i += 2;
        continue;
      }
      if (top.html) updateTag(top, c);
      i += 1;
      continue;
    }

    // Code level (root or inside an interpolation expression).
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
      i = skipString(text, i, c, limit);
      continue;
    }
    if (c === '`') {
      stack.push({ kind: 'tmpl', html: precededByHtmlTag(text, i), tag: null });
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

  const top = stack[stack.length - 1];
  if (top?.kind === 'expr') {
    return stack.some((f) => f.kind === 'tmpl' && f.html) ? { region: 'expr' } : { region: 'none' };
  }
  if (top?.kind === 'tmpl' && top.html) {
    const tag = top.tag;
    if (!tag || tag.closing) return { region: 'markup-text' };
    if (tag.quote) return { region: 'markup-value' };
    if (!tag.sawSpace) return { region: 'markup-tag', partial: tag.name };
    return { region: 'markup-attr', tag: tag.name };
  }
  return { region: 'none' };
}

/** Advance the current html frame's tag-tracking state by one markup char. */
function updateTag(frame: { tag: TagState | null }, c: string): void {
  const tag = frame.tag;
  if (tag && tag.quote) {
    if (c === tag.quote) tag.quote = null;
    return;
  }
  if (c === '<') {
    frame.tag = { name: '', sawSpace: false, closing: false, quote: null };
    return;
  }
  if (!tag) return;
  if (c === '/' && tag.name === '' && !tag.sawSpace) {
    tag.closing = true;
    return;
  }
  if (tag.closing) {
    if (c === '>') frame.tag = null;
    return;
  }
  if (c === '>') {
    frame.tag = null;
    return;
  }
  if (/\s/.test(c)) {
    if (tag.name) tag.sawSpace = true;
    return;
  }
  if (!tag.sawSpace) {
    if (/[A-Za-z0-9-]/.test(c)) tag.name += c;
    return;
  }
  if (c === '"' || c === "'") tag.quote = c;
}

/* ---------------------------------------------------------------- builders */

export function htmlTagCompletions(): ZoijsCompletion[] {
  return HTML_TAGS.map((tag) => ({
    label: tag,
    kind: 'html-tag',
    detail: VOID_TAGS.has(tag) ? '<> void element' : '<> element',
    insertText: tag,
  }));
}

export function htmlAttributeCompletions(tagName?: string): ZoijsCompletion[] {
  const specs = [...GLOBAL_ATTRS, ...EVENT_ATTRS, ...(tagName ? TAG_ATTRS[tagName] ?? [] : [])];
  const seen = new Set<string>();
  const items: ZoijsCompletion[] = [];
  for (const spec of specs) {
    if (seen.has(spec.name)) continue;
    seen.add(spec.name);
    items.push(attributeCompletion(spec));
  }
  return items;
}

function attributeCompletion(spec: AttrSpec): ZoijsCompletion {
  switch (spec.kind) {
    case 'event':
      return { label: spec.name, kind: 'html-attribute', detail: 'event handler', insertText: `${spec.name}=\${$0}`, snippet: true };
    case 'ref':
      return { label: spec.name, kind: 'html-attribute', detail: 'callback ref', insertText: `${spec.name}=\${$0}`, snippet: true };
    case 'boolean':
      return { label: spec.name, kind: 'html-attribute', detail: 'boolean attribute', insertText: spec.name };
    default:
      return { label: spec.name, kind: 'html-attribute', detail: 'attribute', insertText: `${spec.name}="$0"`, snippet: true };
  }
}
