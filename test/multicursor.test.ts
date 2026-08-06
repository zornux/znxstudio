import { describe, expect, test } from './harness';
import { findOccurrences, formatCursorStatus, wordRangeAt } from '../src/renderer/editor/multiCursor';

describe('wordRangeAt', () => {
  test('returns the identifier under the caret', () => {
    const text = 'let count = count + 1';
    expect(wordRangeAt(text, 0, 6)).toEqual({ startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 9 });
  });

  test('selects the word when the caret sits at its trailing edge', () => {
    // caret at column 9 = just after "count"
    expect(wordRangeAt('let count = 1', 0, 9)).toEqual({ startLine: 0, startCharacter: 4, endLine: 0, endCharacter: 9 });
  });

  test('null when the caret is on whitespace', () => {
    expect(wordRangeAt('a  b', 0, 2)).toBeNull();
  });

  test('null for an out-of-range line', () => {
    expect(wordRangeAt('one', 5, 0)).toBeNull();
  });

  test('resolves on a later line', () => {
    const text = 'let total = count + count'; // line 1 below
    expect(wordRangeAt(`x\n${text}`, 1, 12)).toEqual({ startLine: 1, startCharacter: 12, endLine: 1, endCharacter: 17 });
  });
});

describe('findOccurrences', () => {
  test('finds every whole-word occurrence across lines', () => {
    const text = 'count count\nbacount count';
    const hits = findOccurrences(text, 'count', { caseSensitive: true, wholeWord: true });
    // "bacount" is not a whole word; the trailing "count" is.
    expect(hits).toHaveLength(3);
    expect(hits[0]).toEqual({ startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 5 });
    expect(hits[2]).toEqual({ startLine: 1, startCharacter: 8, endLine: 1, endCharacter: 13 });
  });

  test('is case-sensitive when asked', () => {
    expect(findOccurrences('A a', 'a', { caseSensitive: true })).toHaveLength(1);
    expect(findOccurrences('A a', 'a', {})).toHaveLength(2);
  });

  test('empty target yields no cursors', () => {
    expect(findOccurrences('anything', '')).toHaveLength(0);
  });

  test('multi-line target finds nothing (line-oriented)', () => {
    expect(findOccurrences('a\nb', 'a\nb')).toHaveLength(0);
  });
});

describe('formatCursorStatus', () => {
  test('single caret shows 1-based position only', () => {
    expect(formatCursorStatus({ line: 2, character: 4 }, 1, 0)).toBe('Ln 3, Col 5');
  });

  test('multiple cursors are counted', () => {
    expect(formatCursorStatus({ line: 0, character: 0 }, 3, 0)).toBe('Ln 1, Col 1  (3 cursors)');
  });

  test('selected characters are reported', () => {
    expect(formatCursorStatus({ line: 0, character: 0 }, 1, 5)).toBe('Ln 1, Col 1  (5 selected)');
  });

  test('cursors and selection combine', () => {
    expect(formatCursorStatus({ line: 0, character: 0 }, 3, 12)).toBe('Ln 1, Col 1  (3 cursors, 12 selected)');
  });
});
