import { describe, expect, test } from './harness';
import {
  buildReviewMessages,
  countBySeverity,
  findingsToDecorations,
  numberLines,
  parseReviewFindings,
  reviewSeverityToDecoration,
  sortFindings,
} from '../src/renderer/ai/review';

describe('numberLines & prompt', () => {
  test('numbers lines from the given start', () => {
    expect(numberLines('a\nb', 5)).toBe('5: a\n6: b');
  });
  test('review prompt requests strict JSON and shows numbered code', () => {
    const { system, messages } = buildReviewMessages('give back 1', 'm.zx', 3);
    expect(system).toContain('ONLY a JSON array');
    expect(messages[0].content).toContain('3: give back 1');
    expect(messages[0].content).toContain('m.zx');
  });
});

describe('parseReviewFindings', () => {
  test('extracts JSON from noisy fenced output and maps severities', () => {
    const noisy = 'Findings:\n```json\n[{"line": 6, "severity": "Bug", "title": "off by one", "detail": "d"}]\n```';
    const findings = parseReviewFindings(noisy, { minLine: 1, maxLine: 10 });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error'); // "Bug" → error
    expect(findings[0].line).toBe(6);
  });
  test('drops entries without a title', () => {
    const findings = parseReviewFindings('[{"line":2,"title":""},{"line":2,"title":"ok"}]', { minLine: 1, maxLine: 5 });
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toBe('ok');
  });
  test('clamps out-of-range lines and defaults missing severity to info', () => {
    const findings = parseReviewFindings('[{"line":999,"title":"t"}]', { minLine: 1, maxLine: 3 });
    expect(findings[0].line).toBe(3);
    expect(findings[0].severity).toBe('info');
  });
  test('returns [] for non-array or unparseable text', () => {
    expect(parseReviewFindings('no json here', { minLine: 1, maxLine: 1 })).toHaveLength(0);
    expect(parseReviewFindings('{"line":1}', { minLine: 1, maxLine: 1 })).toHaveLength(0);
  });
  test('sorts by line then severity', () => {
    const findings = parseReviewFindings(
      '[{"line":5,"severity":"info","title":"b"},{"line":2,"severity":"suggestion","title":"a"},{"line":2,"severity":"error","title":"c"}]',
      { minLine: 1, maxLine: 10 },
    );
    expect(findings.map((f) => f.title)).toEqual(['c', 'a', 'b']);
  });
});

describe('severity helpers', () => {
  test('counts by severity', () => {
    const findings = sortFindings([
      { line: 1, severity: 'error', title: 'a', detail: '' },
      { line: 2, severity: 'suggestion', title: 'b', detail: '' },
      { line: 3, severity: 'suggestion', title: 'c', detail: '' },
    ]);
    expect(countBySeverity(findings)).toEqual({ error: 1, warning: 0, info: 0, suggestion: 2 });
  });
  test('suggestion maps to a hint decoration', () => {
    expect(reviewSeverityToDecoration('suggestion')).toBe('hint');
    expect(reviewSeverityToDecoration('error')).toBe('error');
  });
  test('decorations are 0-based with an inline message', () => {
    const decos = findingsToDecorations([{ line: 4, severity: 'warning', title: 'watch out', detail: '' }]);
    expect(decos[0].startLine).toBe(3);
    expect(decos[0].inlineMessage).toBe('watch out');
    expect(decos[0].wholeLine).toBe(true);
  });
});
