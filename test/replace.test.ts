import { describe, expect, test } from './harness';
import { buildSearchRegex } from '../src/shared/textSearch';
import { countMatches, expandReplacement, replaceAll, replaceLine } from '../src/shared/textReplace';

describe('expandReplacement', () => {
  test('plain mode escapes $ so it inserts literally', () => {
    expect(expandReplacement('price $5', false)).toBe('price $$5');
    const re = buildSearchRegex('X', {})!;
    expect(replaceAll('X', re, expandReplacement('price $5', false)).text).toBe('price $5');
  });

  test('regex mode passes $1 through', () => {
    expect(expandReplacement('let $1', true)).toBe('let $1');
    const re = buildSearchRegex('create (\\w+)', { isRegex: true })!;
    expect(replaceAll('create alpha = 1', re, expandReplacement('let $1', true)).text).toBe('let alpha = 1');
  });
});

describe('replaceAll', () => {
  test('replaces every match and returns the count', () => {
    const re = buildSearchRegex('create', {})!;
    const result = replaceAll('create x\ncreate y', re, 'make');
    expect(result.count).toBe(2);
    expect(result.text).toBe('make x\nmake y');
  });

  test('no match leaves content untouched', () => {
    const re = buildSearchRegex('zzz', {})!;
    const result = replaceAll('abc', re, 'q');
    expect(result.count).toBe(0);
    expect(result.text).toBe('abc');
  });

  test('case-insensitive by default; case-sensitive when asked', () => {
    expect(replaceAll('Foo foo', buildSearchRegex('foo', {})!, 'bar').count).toBe(2);
    expect(replaceAll('Foo foo', buildSearchRegex('foo', { caseSensitive: true })!, 'bar').count).toBe(1);
  });
});

describe('countMatches / replaceLine', () => {
  test('countMatches is zero-width safe', () => {
    expect(countMatches('abc', buildSearchRegex('x*', { isRegex: true })!)).toBeGreaterThan(0);
  });

  test('replaceLine previews one line', () => {
    const re = buildSearchRegex('port', { wholeWord: true })!;
    expect(replaceLine('on port 80', re, 'PORT')).toBe('on PORT 80');
  });
});

describe('anchored regex: preview count == whole-content replace count (cert fix)', () => {
  // Before the `m` flag, `^import` previewed per-line (3 matches) but replaced
  // against whole content (1 match) — a silent, incorrect Replace All.
  const content = 'import a\nimport b\nimport c\n';

  test('^anchor matches every line in both the per-line preview and the whole-content replace', () => {
    const re = buildSearchRegex('^import', { isRegex: true })!;
    // Per-line preview: each of the 3 lines has one leading `import`.
    const previewCount = content.split('\n').reduce((n, line) => n + countMatches(line, re), 0);
    // Whole-content replace: must find the same 3.
    const result = replaceAll(content, re, 'use');
    expect(result.count).toBe(3);
    expect(previewCount).toBe(3);
    expect(result.text).toBe('use a\nuse b\nuse c\n');
  });

  test('$anchor matches every line-end too', () => {
    const re = buildSearchRegex('\\w$', { isRegex: true })!;
    expect(replaceAll(content, re, 'X').count).toBe(3); // a, b, c at each line end
  });
});
