import { describe, expect, test } from './harness';
import { fuzzyFilter, fuzzyMatch } from '../src/renderer/productivity/fuzzy';
import { parseTaskTag, TASK_TAG_REGEX } from '../src/renderer/productivity/todoScan';

describe('fuzzyMatch', () => {
  test('matches a subsequence and records positions', () => {
    const m = fuzzyMatch('abc', 'axbxc');
    expect(m === null).toBe(false);
    expect(m!.positions).toEqual([0, 2, 4]);
  });

  test('returns null when a char is missing', () => {
    expect(fuzzyMatch('xyz', 'abc')).toBeNull();
  });

  test('empty query matches anything', () => {
    expect(fuzzyMatch('', 'anything')!.positions).toHaveLength(0);
  });

  test('a consecutive run scores higher than a scattered match', () => {
    const consecutive = fuzzyMatch('app', 'application')!.score;
    const scattered = fuzzyMatch('app', 'axpxplication')!.score;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  test('is case-insensitive', () => {
    expect(fuzzyMatch('ABC', 'aabbcc') === null).toBe(false);
  });
});

describe('fuzzyFilter', () => {
  test('ranks basename matches above deep-path matches', () => {
    const files = ['src/util/config.ts', 'src/config/index.ts', 'src/main.ts'];
    const ranked = fuzzyFilter('config', files, (f) => f).map((r) => r.item);
    expect(ranked[0]).toBe('src/util/config.ts'); // basename hit ranks first
    expect(ranked.includes('src/main.ts')).toBe(false); // no subsequence
  });

  test('drops non-matching items', () => {
    expect(fuzzyFilter('zzz', ['abc', 'def'], (f) => f)).toHaveLength(0);
  });
});

describe('parseTaskTag', () => {
  test('parses a tag + message from a comment', () => {
    expect(parseTaskTag('# TODO: fix the walk')).toEqual({ tag: 'TODO', message: 'fix the walk' });
    expect(parseTaskTag('    // FIXME - broken')).toEqual({ tag: 'FIXME', message: 'broken' });
    expect(parseTaskTag(' * HACK temporary')).toEqual({ tag: 'HACK', message: 'temporary' });
  });

  test('ignores tags inside strings or identifiers', () => {
    expect(parseTaskTag('create x = "TODO later"')).toBeNull();
    expect(parseTaskTag('const aTODOx = 1')).toBeNull();
  });

  test('strips a trailing block-comment close', () => {
    expect(parseTaskTag('/* BUG double free */')).toEqual({ tag: 'BUG', message: 'double free' });
  });

  test('the tag regex names every tag', () => {
    expect(TASK_TAG_REGEX).toContain('TODO');
    expect(TASK_TAG_REGEX).toContain('FIXME');
  });
});
