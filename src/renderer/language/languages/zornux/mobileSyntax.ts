import type { ZornuxDiagnostic } from './lexer';
import { COMPONENT_CATALOG } from '../../../designer/componentModel';

const DESCRIPTORS_BY_KEYWORD = new Map(COMPONENT_CATALOG.map((descriptor) => [descriptor.zxKeyword, descriptor]));
const CONTAINERS = new Set(COMPONENT_CATALOG.filter((descriptor) => descriptor.isContainer).map((descriptor) => descriptor.zxKeyword));
const COMPONENTS = new Set(DESCRIPTORS_BY_KEYWORD.keys());

const STYLING_BLOCKS = new Set([
  'style', 'theme', 'tokens', 'animate', 'transition', 'responsive',
  'gradient', 'shadow', 'permissions',
]);
const RESPONSIVE_BREAKPOINTS = new Set(['compact', 'medium', 'expanded']);
const FLAT_BLOCKS = new Set([
  'style', 'theme', 'tokens', 'animate', 'transition',
  'gradient', 'shadow', 'permissions',
]);

export function isMobileZornux(source: string): boolean {
  return /^\s*mobile\s+app\b/m.test(source);
}

function nextContent(lines: string[], from: number): string {
  for (let index = from + 1; index < lines.length; index++) {
    const value = lines[index].trim();
    if (value && !value.startsWith('#')) return value;
  }
  return '';
}

function nextContentAfterStyling(lines: string[], from: number): string {
  let depth = 0;
  for (let index = from + 1; index < lines.length; index++) {
    const value = lines[index].trim();
    if (!value || value.startsWith('#')) continue;
    if (value === 'end') {
      if (depth === 0) return value;
      depth--;
      continue;
    }
    if (depth === 0) {
      const kw = value.split(/\s+/)[0];
      if (STYLING_BLOCKS.has(kw) || (kw === 'dark' && value.startsWith('dark theme'))) {
        depth++;
        continue;
      }
      return value;
    }
  }
  return '';
}

function opensBlock(line: string, lines: string[], index: number): boolean {
  const keyword = line.split(/\s+/)[0];
  if (keyword === 'screen' || keyword === 'when' || CONTAINERS.has(keyword)) return true;
  if (STYLING_BLOCKS.has(keyword)) return true;
  if (keyword === 'dark' && line.startsWith('dark theme')) return true;
  if (RESPONSIVE_BREAKPOINTS.has(keyword)) return true;
  return COMPONENTS.has(keyword) && nextContentAfterStyling(lines, index).startsWith('when ');
}

export function formatMobileZornux(source: string, tabSize: number, insertSpaces: boolean): string {
  if (source.trim() === '') return source;
  const unit = insertSpaces ? ' '.repeat(Math.max(1, tabSize)) : '\t';
  const lines = source.split(/\r?\n/);
  const output: string[] = [];
  let depth = 0;
  let blank = false;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) {
      if (!blank && output.length) output.push('');
      blank = true;
      continue;
    }
    blank = false;
    if (line === 'end') depth = Math.max(0, depth - 1);
    output.push(`${unit.repeat(depth)}${line}`);
    if (opensBlock(line, lines, index)) depth++;
  }
  while (output.at(-1) === '') output.pop();
  return `${output.join('\n')}\n`;
}

export function lintMobileZornux(source: string): ZornuxDiagnostic[] {
  const lines = source.split(/\r?\n/);
  const diagnostics: ZornuxDiagnostic[] = [];
  const screens = new Set<string>();
  const starts: Array<{ name: string; line: number; column: number }> = [];
  const blocks: Array<{ keyword: string; line: number }> = [];
  const report = (line: number, start: number, end: number, code: string, message: string): void => {
    diagnostics.push({
      severity: 'error', code, message,
      range: { start: { line, character: start }, end: { line, character: Math.max(start + 1, end) } },
    });
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    const topBlock = blocks.at(-1)?.keyword;
    if (topBlock && (topBlock === 'when' || topBlock === 'dark theme' || FLAT_BLOCKS.has(topBlock)) && line !== 'end') continue;
    const screen = line.match(/^screen\s+([A-Za-z_]\w*)$/);
    if (screen) screens.add(screen[1]);
    const start = line.match(/^start\s+with\s+([A-Za-z_]\w*)$/);
    if (start) starts.push({ name: start[1], line: index, column: line.lastIndexOf(start[1]) });
    if (line === 'end') {
      if (!blocks.length) report(index, 0, 3, 'zx-mobile-unexpected-end', 'Unexpected end: there is no open mobile block to close.');
      else blocks.pop();
      continue;
    }
    if (screen) {
      blocks.push({ keyword: 'screen', line: index });
      continue;
    }
    if (/^mobile\s+app\s+"(?:[^"\\]|\\.)+"$/.test(line) || start || /^state\s+[A-Za-z_]\w*\s*=\s*.+$/.test(line)) continue;
    const keyword = line.split(/\s+/)[0];
    if (keyword === 'when') {
      blocks.push({ keyword, line: index });
      continue;
    }
    if (STYLING_BLOCKS.has(keyword) || RESPONSIVE_BREAKPOINTS.has(keyword)) {
      blocks.push({ keyword, line: index });
      continue;
    }
    if (keyword === 'dark' && line.startsWith('dark theme')) {
      blocks.push({ keyword: 'dark theme', line: index });
      continue;
    }
    if (keyword === 'go' || keyword === 'use') continue;
    const descriptor = DESCRIPTORS_BY_KEYWORD.get(keyword);
    if (!descriptor) {
      report(index, 0, line.length, 'zx-mobile-unsupported-statement', `The visual designer cannot safely model '${keyword}'.`);
      continue;
    }
    const allowedAttrs = new Set(descriptor.properties.map((property) => property.zxAttr).filter(Boolean));
    const attributePattern = /(\w+)\s*=/g;
    let attribute: RegExpExecArray | null;
    while ((attribute = attributePattern.exec(line)) !== null) {
      if (!allowedAttrs.has(attribute[1])) {
        report(index, attribute.index, attribute.index + attribute[1].length, 'zx-mobile-unsupported-attribute', `The ${descriptor.label} property '${attribute[1]}' is not supported by the visual designer.`);
      }
    }
    if (opensBlock(line, lines, index)) blocks.push({ keyword, line: index });
  }
  for (const block of blocks) {
    report(block.line, 0, lines[block.line].trim().length, 'zx-mobile-unclosed-block', `The ${block.keyword} block is missing an end.`);
  }
  for (const start of starts) {
    if (!screens.has(start.name)) report(start.line, start.column, start.column + start.name.length, 'zx-mobile-unknown-screen', `Unknown start screen '${start.name}'.`);
  }
  if (!/^\s*mobile\s+app\s+"(?:[^"\\]|\\.)+"/m.test(source)) {
    report(0, 0, lines[0]?.length ?? 1, 'zx-mobile-invalid-app', 'Expected mobile app "Name".');
  }
  return diagnostics;
}
