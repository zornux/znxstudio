/**
 * A small, safe Markdown renderer (Phase 18A).
 *
 * ZnxStudio renders Markdown it did not write: `zornux doc` output, the compiler's
 * own `docs/*.md`, lesson files from a learning pack on disk. So this module
 * NEVER produces HTML text and never touches `innerHTML` — it parses to a token
 * model, and the renderer builds DOM nodes one at a time. A document cannot
 * inject markup, only content.
 *
 * The link rules are the other half of that: only `http(s)` (opened in the
 * user's browser), same-document anchors, and relative paths are honoured.
 * Everything else — `javascript:`, `data:`, `file:`, absolute paths,
 * protocol-relative `//host` — is UNSAFE and renders as plain text, never as a
 * clickable anchor.
 *
 * The grammar covers what the sources above actually emit: ATX headings, fenced
 * code, bullet/ordered lists, block quotes, pipe tables, horizontal rules,
 * paragraphs, and inline code/strong/emphasis/links.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'strong'; children: Inline[] }
  | { kind: 'em'; children: Inline[] }
  | { kind: 'link'; href: string; children: Inline[] };

export type Block =
  | { kind: 'heading'; level: number; children: Inline[] }
  | { kind: 'paragraph'; children: Inline[] }
  | { kind: 'code'; language: string; text: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; children: Inline[] }
  | { kind: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { kind: 'rule' };

/* ------------------------------------------------------------------ links */

export type LinkKind = 'internal' | 'anchor' | 'external' | 'unsafe';

/** Control characters let `java\nscript:` slip past a naive scheme test. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/g;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Decide what a link target is. Anything this cannot vouch for is `unsafe`, and
 * an unsafe target must never become an `<a href>` — the renderer drops it to
 * plain text. Defaulting to unsafe is the point: a target this does not
 * recognise is a target ZnxStudio has no business following.
 */
export function classifyLink(href: string): LinkKind {
  const target = href.replace(CONTROL_CHARACTERS, '').trim();
  if (!target) return 'unsafe';
  if (target.startsWith('#')) return 'anchor';
  if (/^https?:\/\//i.test(target)) return 'external';
  // `//evil.example` inherits the page's scheme; an absolute path escapes the
  // documentation root. Neither is a relative document link.
  if (target.startsWith('//') || target.startsWith('/') || target.startsWith('\\')) return 'unsafe';
  // Catches `javascript:`, `data:`, `file:`, and a Windows drive letter (`C:\…`).
  if (HAS_SCHEME.test(target)) return 'unsafe';
  return 'internal';
}

/** The path part of a link, without its `#anchor`. */
export function linkPath(href: string): string {
  const hash = href.indexOf('#');
  return hash === -1 ? href : href.slice(0, hash);
}

/**
 * Resolve a relative link against the document holding it. Both are POSIX-ish
 * document paths (the viewer keeps documents keyed by forward slash, whatever
 * the OS separator is), and the result is normalised so `../index.md` works.
 *
 * Segments that would climb above the root are dropped rather than preserved:
 * the viewer confines reads to a root, and a link cannot argue its way out.
 */
export function resolveDocPath(fromDocument: string, href: string): string {
  const target = linkPath(href.replace(CONTROL_CHARACTERS, '').trim()).replace(/\\/g, '/');
  const baseDirectory = fromDocument.replace(/\\/g, '/').split('/').slice(0, -1);
  const segments = target.startsWith('/') ? [] : baseDirectory;
  const resolved: string[] = [...segments];
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join('/');
}

/* ----------------------------------------------------------------- inline */

const ESCAPABLE = '\\`*_[]()#+-.!|>';

/** Parse inline markup. Code spans win over everything: backticks protect. */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = [];
  let text = '';
  let index = 0;

  const flush = (): void => {
    if (text) nodes.push({ kind: 'text', text });
    text = '';
  };

  while (index < source.length) {
    const character = source[index];

    if (character === '\\' && index + 1 < source.length && ESCAPABLE.includes(source[index + 1])) {
      text += source[index + 1];
      index += 2;
      continue;
    }

    if (character === '`') {
      const fence = /^`+/.exec(source.slice(index))![0];
      const close = source.indexOf(fence, index + fence.length);
      if (close !== -1) {
        flush();
        nodes.push({ kind: 'code', text: source.slice(index + fence.length, close).trim() });
        index = close + fence.length;
        continue;
      }
    }

    if (character === '[') {
      const link = matchLink(source, index);
      if (link) {
        flush();
        nodes.push({ kind: 'link', href: link.href, children: parseInline(link.label) });
        index = link.end;
        continue;
      }
    }

    if (character === '*' || character === '_') {
      const strong = matchDelimiter(source, index, character.repeat(2));
      if (strong) {
        flush();
        nodes.push({ kind: 'strong', children: parseInline(strong.inner) });
        index = strong.end;
        continue;
      }
      const emphasis = matchDelimiter(source, index, character);
      if (emphasis) {
        flush();
        nodes.push({ kind: 'em', children: parseInline(emphasis.inner) });
        index = emphasis.end;
        continue;
      }
    }

    text += character;
    index += 1;
  }

  flush();
  return nodes;
}

/** `[label](href)`, allowing one level of nested parentheses in the target. */
function matchLink(source: string, start: number): { label: string; href: string; end: number } | null {
  let depth = 0;
  let close = -1;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === '[') depth += 1;
    else if (source[i] === ']') {
      depth -= 1;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1 || source[close + 1] !== '(') return null;

  let parens = 0;
  for (let i = close + 1; i < source.length; i += 1) {
    if (source[i] === '(') parens += 1;
    else if (source[i] === ')') {
      parens -= 1;
      if (parens === 0) {
        const href = source.slice(close + 2, i).trim();
        // A title (`(url "title")`) is not supported; keep only the target.
        return { label: source.slice(start + 1, close), href: href.split(/\s+/)[0] ?? '', end: i + 1 };
      }
    }
  }
  return null;
}

function matchDelimiter(source: string, start: number, delimiter: string): { inner: string; end: number } | null {
  if (!source.startsWith(delimiter, start)) return null;
  const contentStart = start + delimiter.length;
  // An empty span (`**`, `__`) is literal text, not empty emphasis.
  if (source.startsWith(delimiter, contentStart)) return null;
  const close = source.indexOf(delimiter, contentStart);
  if (close === -1 || close === contentStart) return null;
  return { inner: source.slice(contentStart, close), end: close + delimiter.length };
}

/* ----------------------------------------------------------------- blocks */

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.*)$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] ?? '';
      const body: string[] = [];
      index += 1;
      // An unterminated fence runs to the end of the file rather than swallowing
      // the rest of the document into a paragraph.
      while (index < lines.length && !lines[index].trimStart().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ kind: 'code', language, text: body.join('\n') });
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ kind: 'rule' });
      index += 1;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1].length,
        children: parseInline(heading[2].replace(/\s+#+\s*$/, '').trim()),
      });
      index += 1;
      continue;
    }

    if (isTableHeader(lines, index)) {
      const header = splitRow(lines[index]).map(parseInline);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
        rows.push(splitRow(lines[index]).map(parseInline));
        index += 1;
      }
      blocks.push({ kind: 'table', header, rows });
      continue;
    }

    const quote = QUOTE.exec(line);
    if (quote) {
      const body: string[] = [quote[1]];
      index += 1;
      while (index < lines.length && QUOTE.test(lines[index])) {
        body.push(QUOTE.exec(lines[index])![1]);
        index += 1;
      }
      blocks.push({ kind: 'quote', children: parseInline(body.join(' ').trim()) });
      continue;
    }

    const listMatch = BULLET.exec(line) ?? ORDERED.exec(line);
    if (listMatch) {
      const ordered = !BULLET.test(line);
      const items: Inline[][] = [];
      while (index < lines.length) {
        const current = lines[index];
        const match = ordered ? ORDERED.exec(current) : BULLET.exec(current);
        if (!match) break;
        items.push(parseInline(match[1].trim()));
        index += 1;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    if (!paragraph.length) {
      // Defensive: `isBlockStart` agreed with none of the branches above. Consume
      // the line as text so the loop can never spin.
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: 'paragraph', children: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

function isBlockStart(lines: string[], index: number): boolean {
  const line = lines[index];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    ORDERED.test(line) ||
    isTableHeader(lines, index)
  );
}

/** A table needs a `|` header AND the `---|---` divider directly beneath it. */
function isTableHeader(lines: string[], index: number): boolean {
  const line = lines[index];
  const divider = lines[index + 1];
  return Boolean(line?.includes('|') && divider && TABLE_DIVIDER.test(divider) && divider.includes('-'));
}

function splitRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    if (trimmed[i] === '\\' && trimmed[i + 1] === '|') {
      cell += '|';
      i += 1;
      continue;
    }
    if (trimmed[i] === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += trimmed[i];
  }
  cells.push(cell.trim());
  return cells;
}

/* -------------------------------------------------------------- rendering */

export interface MarkdownRenderOptions {
  /** Follow a relative document link. */
  onNavigate?(href: string): void;
  /** Follow an `http(s)` link (the module sends it to the user's browser). */
  onExternal?(href: string): void;
  /** Scroll to a heading anchor within the rendered document. */
  onAnchor?(anchor: string): void;
  /** Run a fenced code block (the tutorial and sample views offer this). */
  onRunCode?(code: string, language: string): void;
  /** Languages `onRunCode` is offered for. */
  runnableLanguages?: string[];
}

/** A GitHub-style slug, so `[#some-heading]` anchors resolve. */
export function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function inlineText(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case 'text':
        case 'code':
          return node.text;
        default:
          return inlineText(node.children);
      }
    })
    .join('');
}

/**
 * Build DOM for a parsed document. Every node is created explicitly; no string
 * of markup is ever handed to the DOM, so document content cannot become markup.
 */
export function renderMarkdown(blocks: Block[], options: MarkdownRenderOptions = {}): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (const block of blocks) fragment.appendChild(renderBlock(block, options));
  return fragment;
}

function renderBlock(block: Block, options: MarkdownRenderOptions): HTMLElement {
  switch (block.kind) {
    case 'heading': {
      const heading = document.createElement(`h${Math.min(block.level, 6)}`);
      heading.id = headingSlug(inlineText(block.children));
      appendInline(heading, block.children, options);
      return heading;
    }
    case 'paragraph': {
      const paragraph = document.createElement('p');
      appendInline(paragraph, block.children, options);
      return paragraph;
    }
    case 'code':
      return renderCode(block.language, block.text, options);
    case 'list': {
      const list = document.createElement(block.ordered ? 'ol' : 'ul');
      for (const item of block.items) {
        const entry = document.createElement('li');
        appendInline(entry, item, options);
        list.appendChild(entry);
      }
      return list;
    }
    case 'quote': {
      const quote = document.createElement('blockquote');
      appendInline(quote, block.children, options);
      return quote;
    }
    case 'table':
      return renderTable(block, options);
    case 'rule':
      return document.createElement('hr');
  }
}

function renderCode(language: string, text: string, options: MarkdownRenderOptions): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'znxstudio-md-code';

  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (language) code.dataset.language = language;
  code.textContent = text;
  pre.appendChild(code);
  wrapper.appendChild(pre);

  const runnable = options.runnableLanguages ?? [];
  if (options.onRunCode && runnable.includes(language.toLowerCase())) {
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small znxstudio-md-run';
    run.textContent = '▶ Run';
    run.addEventListener('click', () => options.onRunCode?.(text, language));
    wrapper.appendChild(run);
  }
  return wrapper;
}

function renderTable(block: Extract<Block, { kind: 'table' }>, options: MarkdownRenderOptions): HTMLElement {
  const table = document.createElement('table');
  table.className = 'znxstudio-md-table';

  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const cell of block.header) {
    const th = document.createElement('th');
    appendInline(th, cell, options);
    headRow.appendChild(th);
  }
  head.appendChild(headRow);
  table.appendChild(head);

  const body = document.createElement('tbody');
  for (const row of block.rows) {
    const tr = document.createElement('tr');
    for (const cell of row) {
      const td = document.createElement('td');
      appendInline(td, cell, options);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

function appendInline(host: HTMLElement, nodes: Inline[], options: MarkdownRenderOptions): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        host.appendChild(document.createTextNode(node.text));
        break;
      case 'code': {
        const code = document.createElement('code');
        code.textContent = node.text;
        host.appendChild(code);
        break;
      }
      case 'strong': {
        const strong = document.createElement('strong');
        appendInline(strong, node.children, options);
        host.appendChild(strong);
        break;
      }
      case 'em': {
        const emphasis = document.createElement('em');
        appendInline(emphasis, node.children, options);
        host.appendChild(emphasis);
        break;
      }
      case 'link':
        host.appendChild(renderLink(node, options));
        break;
    }
  }
}

function renderLink(node: Extract<Inline, { kind: 'link' }>, options: MarkdownRenderOptions): Node {
  const kind = classifyLink(node.href);
  if (kind === 'unsafe') {
    // Render the label, and say why it is not a link. Silently dropping the
    // target would leave the reader thinking the document was written that way.
    const span = document.createElement('span');
    span.className = 'znxstudio-md-unsafe';
    span.title = `Link not followed: "${node.href}" is not an http(s) or relative document link.`;
    appendInline(span, node.children, options);
    return span;
  }

  const anchor = document.createElement('a');
  anchor.href = '#';
  anchor.className = `znxstudio-md-link is-${kind}`;
  appendInline(anchor, node.children, options);
  anchor.addEventListener('click', (event) => {
    event.preventDefault();
    if (kind === 'external') options.onExternal?.(node.href);
    else if (kind === 'anchor') options.onAnchor?.(node.href.slice(1));
    else options.onNavigate?.(node.href);
  });
  return anchor;
}
