/**
 * Bidirectional synchronization between the visual designer's document model
 * and Zornux mobile source code. The parser reads `.zx` source into a
 * DesignerDocument; the emitter writes a DesignerDocument back to clean,
 * human-readable Zornux source.
 */

import type { ComponentNode, EventHandler, ScreenModel, StateDeclaration } from './designerDocument';
import { DesignerDocument, generateId } from './designerDocument';
import { getDescriptor, COMPONENT_CATALOG } from './componentModel';

const INDENT = '    '; // 4-space Zornux convention

// ---------------------------------------------------------------------------
// Known component keywords → kind mapping
// ---------------------------------------------------------------------------

const KEYWORD_TO_KIND = new Map<string, string>();
for (const desc of COMPONENT_CATALOG) {
  KEYWORD_TO_KIND.set(desc.zxKeyword, desc.kind);
}

// ---------------------------------------------------------------------------
// Parser: Zornux source → DesignerDocument
// ---------------------------------------------------------------------------

interface ParseContext {
  lines: string[];
  pos: number;
}

function trimmedAt(ctx: ParseContext): string {
  return ctx.pos < ctx.lines.length ? ctx.lines[ctx.pos].trim() : '';
}

function indentLevel(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n++;
    else if (ch === '\t') n += 4;
    else break;
  }
  return n;
}

function parseQuotedString(raw: string): string {
  const match = raw.match(/^"((?:[^"\\]|\\.)*)"$/);
  if (!match) return raw;
  let value = '';
  for (let index = 0; index < match[1].length; index++) {
    const character = match[1][index];
    if (character !== '\\' || index + 1 >= match[1].length) {
      value += character;
      continue;
    }
    const escaped = match[1][++index];
    value += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
  }
  return value;
}

function parseInlineAttrs(rest: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    attrs[m[1]] = m[2] !== undefined ? parseQuotedString(`"${m[2]}"`) : m[3];
  }
  return attrs;
}

function parseComponentBlock(ctx: ParseContext, baseIndent: number): ComponentNode | null {
  if (ctx.pos >= ctx.lines.length) return null;
  const line = ctx.lines[ctx.pos];
  const trimmed = line.trim();
  if (!trimmed || trimmed === 'end') return null;

  const startLine = ctx.pos;

  // Match: keyword "value" attrs... OR keyword value attrs... OR keyword attrs...
  const keywordMatch = trimmed.match(/^(\w+)\s*(.*)/);
  if (!keywordMatch) { ctx.pos++; return null; }

  const keyword = keywordMatch[1];
  const rest = keywordMatch[2];
  const kind = KEYWORD_TO_KIND.get(keyword);

  if (!kind) { ctx.pos++; return null; }

  const descriptor = getDescriptor(kind);
  const properties: Record<string, string | number | boolean> = {};

  if (descriptor) {
    for (const p of descriptor.properties) {
      properties[p.key] = p.defaultValue;
    }
  }

  // Extract primary value (quoted or bare identifier)
  let primaryValue = '';
  let attrRest = rest;
  if (rest.startsWith('"')) {
    let endQuote = -1;
    for (let index = 1; index < rest.length; index++) {
      if (rest[index] === '"' && rest[index - 1] !== '\\') { endQuote = index; break; }
    }
    if (endQuote > 0) {
      primaryValue = parseQuotedString(rest.substring(0, endQuote + 1));
      attrRest = rest.substring(endQuote + 1).trim();
    }
  } else {
    const parts = rest.split(/\s+/);
    if (parts.length > 0 && parts[0] && !parts[0].includes('=')) {
      primaryValue = parts[0];
      attrRest = parts.slice(1).join(' ');
    }
  }

  // Set primary value on the appropriate property
  if (primaryValue && descriptor) {
    const contentProp = descriptor.properties.find((p) => p.group === 'content' && p.zxAttr === '');
    if (contentProp) properties[contentProp.key] = primaryValue;
  }

  // Parse inline attributes
  const inlineAttrs = parseInlineAttrs(attrRest);
  if (descriptor) {
    for (const prop of descriptor.properties) {
      if (prop.zxAttr && inlineAttrs[prop.zxAttr] !== undefined) {
        const raw = inlineAttrs[prop.zxAttr];
        if (prop.type === 'number') properties[prop.key] = Number(raw) || 0;
        else if (prop.type === 'boolean') properties[prop.key] = raw === 'true';
        else properties[prop.key] = raw;
      }
    }
  }

  ctx.pos++;

  // Parse children, events, and nested content
  const children: ComponentNode[] = [];
  const events: EventHandler[] = [];

  while (ctx.pos < ctx.lines.length) {
    const childLine = ctx.lines[ctx.pos];
    const childTrimmed = childLine.trim();
    const childIndent = indentLevel(childLine);

    if (childTrimmed === 'end' && childIndent <= baseIndent + 4) {
      ctx.pos++;
      break;
    }

    if (childIndent <= baseIndent && childTrimmed !== '') break;

    if (childTrimmed.startsWith('when ')) {
      const eventMatch = childTrimmed.match(/^when\s+(\w+)(?:\s+to\s+(\w+))?$/);
      if (eventMatch) {
        const eventKeyword = eventMatch[1];
        ctx.pos++;
        const bodyLines: string[] = [];
        while (ctx.pos < ctx.lines.length) {
          const eLine = ctx.lines[ctx.pos].trim();
          if (eLine === 'end') { ctx.pos++; break; }
          bodyLines.push(ctx.lines[ctx.pos].trim());
          ctx.pos++;
        }
        const matchedEvent = descriptor?.events.find((e) => e.zxKeyword === eventKeyword);
        events.push({
          eventKey: matchedEvent?.key ?? eventKeyword,
          body: bodyLines.join('\n'),
        });
        continue;
      }
    }

    // Try parsing as a child component
    const child = parseComponentBlock(ctx, childIndent >= baseIndent + 4 ? baseIndent + 4 : childIndent);
    if (child) {
      children.push(child);
    } else {
      ctx.pos++;
    }
  }

  const node: ComponentNode = {
    id: generateId(),
    kind,
    properties,
    events,
    children,
    parentId: null,
    sourceRange: { start: startLine, end: ctx.pos - 1 },
  };
  for (const child of children) child.parentId = node.id;
  return node;
}

function parseScreen(ctx: ParseContext): ScreenModel | null {
  const line = ctx.lines[ctx.pos].trim();
  const match = line.match(/^screen\s+(\w+)/);
  if (!match) return null;

  const name = match[1];
  ctx.pos++;

  const states: StateDeclaration[] = [];
  const rootChildren: ComponentNode[] = [];

  while (ctx.pos < ctx.lines.length) {
    const current = ctx.lines[ctx.pos].trim();

    if (current === 'end') {
      ctx.pos++;
      break;
    }

    // State declarations
    const stateMatch = current.match(/^state\s+(\w+)\s*=\s*(.+)$/);
    if (stateMatch) {
      states.push({
        name: stateMatch[1],
        initialValue: parseQuotedString(stateMatch[2].trim()),
      });
      ctx.pos++;
      continue;
    }

    // Component children
    const child = parseComponentBlock(ctx, 4);
    if (child) {
      rootChildren.push(child);
    } else {
      ctx.pos++;
    }
  }

  return { name, states, rootChildren };
}

export function parseSource(source: string): DesignerDocument {
  const doc = new DesignerDocument();
  const lines = source.split('\n');
  const ctx: ParseContext = { lines, pos: 0 };

  let appName = '';
  let startScreen = '';
  const screens: ScreenModel[] = [];

  while (ctx.pos < ctx.lines.length) {
    const trimmed = trimmedAt(ctx);

    // mobile app "Name"
    const appMatch = trimmed.match(/^mobile\s+app\s+("(?:[^"\\]|\\.)*")/);
    if (appMatch) {
      appName = parseQuotedString(appMatch[1]);
      ctx.pos++;
      continue;
    }

    // screen Name
    if (trimmed.startsWith('screen ')) {
      const screen = parseScreen(ctx);
      if (screen) screens.push(screen);
      continue;
    }

    // start with ScreenName
    const startMatch = trimmed.match(/^start\s+with\s+(\w+)/);
    if (startMatch) {
      startScreen = startMatch[1];
      ctx.pos++;
      continue;
    }

    ctx.pos++;
  }

  doc.loadFromParsed(appName, startScreen || (screens[0]?.name ?? ''), screens);
  return doc;
}

// ---------------------------------------------------------------------------
// Emitter: DesignerDocument → Zornux source
// ---------------------------------------------------------------------------

function emitPropertyValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return `"${escapeZornuxString(value)}"`;
}

function escapeZornuxString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}

function emitNode(node: ComponentNode, depth: number): string[] {
  const descriptor = getDescriptor(node.kind);
  if (!descriptor) return [];

  const prefix = INDENT.repeat(depth);
  const lines: string[] = [];

  // Build the opening line: keyword [primaryValue] [attrs...]
  let opening = `${prefix}${descriptor.zxKeyword}`;

  // Primary value (content prop with zxAttr === '')
  const contentProp = descriptor.properties.find((p) => p.group === 'content' && p.zxAttr === '');
  if (contentProp) {
    const val = node.properties[contentProp.key];
    if (val !== undefined && val !== '' && val !== contentProp.defaultValue) {
      if (typeof val === 'string' && /^[a-z_]\w*$/i.test(val) && !val.includes(' ')) {
        opening += ` ${val}`;
      } else {
        opening += ` "${escapeZornuxString(String(val))}"`;
      }
    } else if (val !== undefined && val !== '') {
      if (typeof val === 'string' && /^[a-z_]\w*$/i.test(val)) {
        opening += ` ${val}`;
      } else {
        opening += ` "${escapeZornuxString(String(val))}"`;
      }
    }
  }

  // Inline attributes (non-default, non-content properties)
  const attrs: string[] = [];
  for (const prop of descriptor.properties) {
    if (prop.zxAttr === '' || prop.zxAttr === '') continue;
    const val = node.properties[prop.key];
    if (val === undefined || val === prop.defaultValue) continue;
    if (typeof val === 'string' && val === '') continue;
    attrs.push(`${prop.zxAttr}=${emitPropertyValue(val)}`);
  }
  if (attrs.length > 0) opening += ' ' + attrs.join(' ');
  lines.push(opening);

  const isBlock = descriptor.isContainer || node.events.length > 0 ||
    (node.children.length > 0);

  if (isBlock) {
    // Children
    for (const child of node.children) {
      lines.push(...emitNode(child, depth + 1));
    }

    // Events
    for (const handler of node.events) {
      const eventDesc = descriptor.events.find((e) => e.key === handler.eventKey);
      const keyword = eventDesc?.zxKeyword ?? handler.eventKey;
      const hasValue = eventDesc?.hasValue ?? false;
      const whenLine = hasValue
        ? `${prefix}${INDENT}when ${keyword} to value`
        : `${prefix}${INDENT}when ${keyword}`;
      lines.push(whenLine);
      for (const bodyLine of handler.body.split('\n')) {
        if (bodyLine.trim()) lines.push(`${prefix}${INDENT}${INDENT}${bodyLine.trim()}`);
      }
      lines.push(`${prefix}${INDENT}end`);
    }

    lines.push(`${prefix}end`);
  }

  return lines;
}

function emitScreen(screen: ScreenModel): string[] {
  const lines: string[] = [];
  lines.push(`screen ${screen.name}`);

  for (const state of screen.states) {
    const val = state.initialValue;
    if (val === 'true' || val === 'false' || /^\d+(\.\d+)?$/.test(val)) {
      lines.push(`${INDENT}state ${state.name} = ${val}`);
    } else {
      lines.push(`${INDENT}state ${state.name} = "${escapeZornuxString(val)}"`);
    }
  }

  if (screen.states.length > 0 && screen.rootChildren.length > 0) {
    lines.push('');
  }

  for (const child of screen.rootChildren) {
    lines.push(...emitNode(child, 1));
  }

  lines.push('end');
  return lines;
}

export function emitSource(doc: DesignerDocument): string {
  const lines: string[] = [];

  lines.push(`mobile app "${escapeZornuxString(doc.appName)}"`);
  lines.push('');

  for (let i = 0; i < doc.getScreens().length; i++) {
    const screen = doc.getScreens()[i];
    lines.push(...emitScreen(screen));
    if (i < doc.getScreens().length - 1) lines.push('');
  }

  lines.push('');
  lines.push(`start with ${doc.startScreen}`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Diffing: detect whether source needs updating
// ---------------------------------------------------------------------------

export function sourceNeedsUpdate(currentSource: string, doc: DesignerDocument): boolean {
  const emitted = emitSource(doc);
  return normalizeWhitespace(currentSource) !== normalizeWhitespace(emitted);
}

/** Refresh source locations after emitting without replacing stable designer IDs. */
export function updateSourceRanges(doc: DesignerDocument, source: string): void {
  const parsed = parseSource(source);
  const copyTree = (target: ComponentNode[], next: ComponentNode[]): void => {
    for (let index = 0; index < Math.min(target.length, next.length); index++) {
      if (target[index].kind !== next[index].kind) continue;
      target[index].sourceRange = next[index].sourceRange;
      copyTree(target[index].children, next[index].children);
    }
  };
  for (const screen of doc.getScreens()) {
    const parsedScreen = parsed.getScreens().find((candidate) => candidate.name === screen.name);
    if (parsedScreen) copyTree(screen.rootChildren, parsedScreen.rootChildren);
  }
}

/** Reinsert full-line source comments that the visual model does not own. */
export function preserveSourceComments(original: string, emitted: string): string {
  const originalLines = original.split(/\r?\n/);
  const output = emitted.split('\n');
  const emittedCommentCounts = new Map<string, number>();
  for (const line of output) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) emittedCommentCounts.set(trimmed, (emittedCommentCounts.get(trimmed) ?? 0) + 1);
  }
  const seenComments = new Map<string, number>();
  let searchFrom = 0;
  for (let index = 0; index < originalLines.length; index++) {
    const comment = originalLines[index].trim();
    if (!comment.startsWith('#')) continue;
    const seen = (seenComments.get(comment) ?? 0) + 1;
    seenComments.set(comment, seen);
    if (seen <= (emittedCommentCounts.get(comment) ?? 0)) continue;

    let anchor = '';
    for (let next = index + 1; next < originalLines.length; next++) {
      const candidate = originalLines[next].trim();
      if (candidate && !candidate.startsWith('#')) { anchor = candidate; break; }
    }
    let insertion = output.length - 1;
    if (anchor) {
      let found = output.findIndex((line, outputIndex) => outputIndex >= searchFrom && line.trim() === anchor);
      if (found < 0) {
        const keyword = anchor.split(/\s+/)[0];
        found = output.findIndex((line, outputIndex) => outputIndex >= searchFrom && line.trim().split(/\s+/)[0] === keyword);
      }
      if (found >= 0) {
        insertion = found;
        searchFrom = found + 1;
      }
    }
    const anchorIndent = output[insertion]?.match(/^\s*/)?.[0] ?? '';
    output.splice(insertion, 0, `${anchorIndent}${comment}`);
  }
  return output.join('\n');
}

function normalizeWhitespace(s: string): string {
  return s.split('\n').map((l) => l.trimEnd()).filter((l) => l.length > 0).join('\n');
}
