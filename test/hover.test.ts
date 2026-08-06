import { describe, expect, test } from './harness';
import { dottedExpressionAt } from '../src/renderer/debug/hoverExpression';

describe('hover expression extraction', () => {
  test('extracts a plain identifier and its start column', () => {
    // "  age is less" — 'age' is columns 3..5, word endColumn (exclusive) = 6.
    const result = dottedExpressionAt('  age is less', 6);
    expect(result?.expression).toBe('age');
    expect(result?.startColumn).toBe(3);
  });

  test('extends across a dotted member chain', () => {
    const line = 'show obj.field.x';
    // 'x' ends at column 17 (exclusive).
    const result = dottedExpressionAt(line, line.length + 1);
    expect(result?.expression).toBe('obj.field.x');
    expect(result?.startColumn).toBe(6);
  });

  test('stops the chain at whitespace or operators', () => {
    expect(dottedExpressionAt('a . b', 6)?.expression).toBe('b'); // spaces break it
    expect(dottedExpressionAt('a + b', 6)?.expression).toBe('b');
  });

  test('returns null when there is no identifier', () => {
    expect(dottedExpressionAt('123', 4)).toBeNull();
    expect(dottedExpressionAt('', 1)).toBeNull();
  });
});
