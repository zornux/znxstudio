import { describe, expect, test } from './harness';
import {
  countBySeverity,
  nextDiagnostic,
  previousDiagnostic,
  sortDiagnostics,
  topDiagnosticPerLine,
} from '../src/renderer/errors/errorNavigation';
import type { Diagnostic } from '../src/renderer/language/api';

const d = (line: number, character: number, severity: Diagnostic['severity'] = 'error', message = 'x'): Diagnostic => ({
  range: { start: { line, character }, end: { line, character: character + 1 } },
  severity,
  message,
});

describe('error navigation: sorting', () => {
  test('orders by line then column, without mutating input', () => {
    const input = [d(3, 0), d(1, 5), d(1, 2)];
    const sorted = sortDiagnostics(input);
    expect(sorted.map((x) => `${x.range.start.line}:${x.range.start.character}`)).toEqual([
      '1:2',
      '1:5',
      '3:0',
    ]);
    expect(input[0].range.start.line).toBe(3); // original untouched
  });
});

describe('error navigation: next', () => {
  const diags = [d(1, 0), d(3, 4), d(5, 2)];
  test('finds the first diagnostic strictly after the cursor', () => {
    expect(nextDiagnostic(diags, { line: 1, character: 0 })?.range.start.line).toBe(3);
    expect(nextDiagnostic(diags, { line: 0, character: 0 })?.range.start.line).toBe(1);
    expect(nextDiagnostic(diags, { line: 3, character: 3 })?.range.start.line).toBe(3);
  });
  test('wraps to the first when past the last', () => {
    expect(nextDiagnostic(diags, { line: 9, character: 0 })?.range.start.line).toBe(1);
  });
  test('returns null when empty', () => {
    expect(nextDiagnostic([], { line: 0, character: 0 })).toBeNull();
  });
});

describe('error navigation: previous', () => {
  const diags = [d(1, 0), d(3, 4), d(5, 2)];
  test('finds the last diagnostic strictly before the cursor', () => {
    expect(previousDiagnostic(diags, { line: 5, character: 2 })?.range.start.line).toBe(3);
    expect(previousDiagnostic(diags, { line: 4, character: 0 })?.range.start.line).toBe(3);
  });
  test('wraps to the last when before the first', () => {
    expect(previousDiagnostic(diags, { line: 0, character: 0 })?.range.start.line).toBe(5);
  });
});

describe('error navigation: per-line reduction', () => {
  test('keeps the most severe diagnostic per line', () => {
    const tops = topDiagnosticPerLine([
      d(2, 0, 'warning'),
      d(2, 8, 'error'),
      d(4, 1, 'info'),
    ]);
    expect(tops).toHaveLength(2);
    expect(tops[0].range.start.line).toBe(2);
    expect(tops[0].severity).toBe('error');
    expect(tops[1].range.start.line).toBe(4);
  });

  test('breaks severity ties by earliest column', () => {
    const tops = topDiagnosticPerLine([d(1, 9, 'error', 'later'), d(1, 2, 'error', 'earlier')]);
    expect(tops).toHaveLength(1);
    expect(tops[0].message).toBe('earlier');
  });
});

describe('error navigation: counts', () => {
  test('tallies by severity', () => {
    const counts = countBySeverity([d(1, 0, 'error'), d(2, 0, 'error'), d(3, 0, 'warning'), d(4, 0, 'hint')]);
    expect(counts.errors).toBe(2);
    expect(counts.warnings).toBe(1);
    expect(counts.hints).toBe(1);
    expect(counts.infos).toBe(0);
  });
});
