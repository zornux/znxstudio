import { describe, expect, test } from './harness';
import {
  breadcrumbFilePath,
  symbolTrailAt,
  symbolsAtDepth,
} from '../src/renderer/editor/breadcrumbs';
import type { DocumentSymbol } from '../src/renderer/language/api';

function symbol(
  name: string,
  kind: string,
  startLine: number,
  endLine: number,
  children?: DocumentSymbol[],
): DocumentSymbol {
  const range = { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } };
  const selectionRange = { start: { line: startLine, character: 6 }, end: { line: startLine, character: 12 } };
  return { name, kind, range, selectionRange, children };
}

const TREE: DocumentSymbol[] = [
  symbol('Dog', 'class', 2, 9, [symbol('bark', 'function', 5, 8)]),
  symbol('GuideDog', 'class', 11, 18, [symbol('assist', 'function', 14, 17)]),
];

describe('symbolTrailAt', () => {
  test('returns the containing symbol at the top level', () => {
    const trail = symbolTrailAt(TREE, { line: 3, character: 0 });
    expect(trail).toHaveLength(1);
    expect(trail[0].name).toBe('Dog');
    expect(trail[0].line).toBe(2);
    expect(trail[0].character).toBe(6);
  });

  test('descends into nested symbols', () => {
    const trail = symbolTrailAt(TREE, { line: 6, character: 2 });
    expect(trail.map((t) => t.name)).toEqual(['Dog', 'bark']);
  });

  test('empty when the caret is outside every symbol', () => {
    expect(symbolTrailAt(TREE, { line: 20, character: 0 })).toHaveLength(0);
  });

  test('picks the correct sibling', () => {
    expect(symbolTrailAt(TREE, { line: 15, character: 0 }).map((t) => t.name)).toEqual([
      'GuideDog',
      'assist',
    ]);
  });
});

describe('symbolsAtDepth', () => {
  test('depth 0 is the top-level list', () => {
    const trail = symbolTrailAt(TREE, { line: 6, character: 0 });
    expect(symbolsAtDepth(TREE, trail, 0).map((s) => s.name)).toEqual(['Dog', 'GuideDog']);
  });

  test('depth 1 is the parent symbol children', () => {
    const trail = symbolTrailAt(TREE, { line: 6, character: 0 });
    expect(symbolsAtDepth(TREE, trail, 1).map((s) => s.name)).toEqual(['bark']);
  });
});

describe('breadcrumbFilePath', () => {
  test('returns workspace-relative segments', () => {
    expect(breadcrumbFilePath('C:\\proj', 'C:\\proj\\src\\app.zx')).toEqual(['src', 'app.zx']);
  });

  test('is slash- and case-insensitive on the root', () => {
    expect(breadcrumbFilePath('C:/Proj/', 'c:\\proj\\a\\b.zx')).toEqual(['a', 'b.zx']);
  });

  test('falls back to the basename outside the root', () => {
    expect(breadcrumbFilePath('C:\\other', 'C:\\proj\\app.zx')).toEqual(['app.zx']);
  });

  test('null root yields just the basename', () => {
    expect(breadcrumbFilePath(null, 'C:\\proj\\app.zx')).toEqual(['app.zx']);
  });
});
