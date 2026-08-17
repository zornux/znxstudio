import { describe, expect, test } from './harness';
import {
  applyFix,
  buildFixContext,
  buildFixMessages,
  extractRegion,
  parseFixResponse,
  stripLineNumbers,
  summarizeFix,
} from '../src/renderer/ai/fixassist';

describe('Fix with AI — context building', () => {
  const source = [
    'function add with a',
    '    give back a',
    'end',
    '',
    'function main',
    '    let result = add(1)',
    '    print result',
    'end',
  ].join('\n');

  test('buildFixContext creates a complete context', () => {
    const ctx = buildFixContext('ZX0110', 'reserved word', 'error', 'test.zx', 1, source);
    expect(ctx.code).toBe('ZX0110');
    expect(ctx.message).toBe('reserved word');
    expect(ctx.severity).toBe('error');
    expect(ctx.file).toBe('test.zx');
    expect(ctx.line).toBe(1);
    expect(ctx.snippet).toContain('function add');
    expect(ctx.snippet).toContain('>');
  });

  test('buildFixContext includes compiler hint when provided', () => {
    const ctx = buildFixContext('ZX0110', 'reserved word', 'error', 'test.zx', 1, source, 'Try a different name');
    expect(ctx.hint).toBe('Try a different name');
  });
});

describe('Fix with AI — prompt building', () => {
  test('buildFixMessages produces system + user messages', () => {
    const ctx = buildFixContext('ZX0110', 'reserved word', 'error', 'test.zx', 1, 'function add\nend');
    const { system, messages } = buildFixMessages(ctx);
    expect(system).toContain('FIXED');
    expect(system).toContain('EXPLANATION');
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('ZX0110');
    expect(messages[0].content).toContain('reserved word');
    expect(messages[0].content).toContain('line 1');
  });

  test('buildFixMessages includes hint when present', () => {
    const ctx = buildFixContext('ZX0110', 'reserved word', 'error', 'test.zx', 1, 'function add\nend', 'try renaming');
    const { messages } = buildFixMessages(ctx);
    expect(messages[0].content).toContain('try renaming');
  });
});

describe('Fix with AI — response parsing', () => {
  test('parseFixResponse extracts explanation and code', () => {
    const response = [
      'EXPLANATION: The function name `add` is a reserved word in Zornux.',
      '',
      '```',
      'function sum with a',
      '    give back a',
      'end',
      '```',
    ].join('\n');
    const proposal = parseFixResponse(response, 'function add with a\n    give back a\nend');
    expect(proposal.explanation).toContain('reserved word');
    expect(proposal.rewritten).toContain('function sum');
    expect(proposal.diff.length).toBeGreaterThan(0);
  });

  test('parseFixResponse handles response without EXPLANATION prefix', () => {
    const response = [
      'The name is reserved.',
      '',
      '```zornux',
      'function total with a',
      '    give back a',
      'end',
      '```',
    ].join('\n');
    const proposal = parseFixResponse(response, 'function add with a\n    give back a\nend');
    expect(proposal.explanation).toContain('reserved');
    expect(proposal.rewritten).toContain('function total');
  });

  test('parseFixResponse strips line numbers from model output', () => {
    const response = [
      'EXPLANATION: Fix the name.',
      '',
      '```',
      '1 | function total with a',
      '2 |     give back a',
      '3 | end',
      '```',
    ].join('\n');
    const proposal = parseFixResponse(response, 'function add with a\n    give back a\nend');
    expect(proposal.rewritten.includes('1 |')).toBe(false);
    expect(proposal.rewritten).toContain('function total');
  });

  test('parseFixResponse computes correct diff stats', () => {
    const response = 'EXPLANATION: Added a parameter.\n\n```\nfunction sum with a, b\n    give back a + b\nend\n```';
    const proposal = parseFixResponse(response, 'function sum with a\n    give back a\nend');
    expect(proposal.added).toBeGreaterThan(0);
    expect(proposal.removed).toBeGreaterThan(0);
  });
});

describe('Fix with AI — line number stripping', () => {
  test('stripLineNumbers removes numbered prefixes', () => {
    const code = '1 | function main\n2 |     print "hi"\n3 | end';
    const result = stripLineNumbers(code);
    expect(result).toBe('function main\n    print "hi"\nend');
  });

  test('stripLineNumbers leaves normal code unchanged', () => {
    const code = 'function main\n    print "hi"\nend';
    expect(stripLineNumbers(code)).toBe(code);
  });
});

describe('Fix with AI — region extraction and application', () => {
  const source = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10';

  test('extractRegion extracts lines around the target', () => {
    const region = extractRegion(source, 5, 2);
    const lines = region.split('\n');
    expect(lines.length).toBe(5); // lines 3-7
    expect(lines[0]).toBe('line3');
    expect(lines[4]).toBe('line7');
  });

  test('extractRegion clamps to file boundaries', () => {
    const region = extractRegion(source, 1, 3);
    expect(region).toContain('line1');
  });

  test('applyFix replaces the region in the full source', () => {
    const original = extractRegion(source, 3, 1);
    const fixed = original.replace('line3', 'FIXED');
    const result = applyFix(source, 3, original, fixed);
    expect(result).toContain('FIXED');
    expect(result.includes('line3')).toBe(false);
    expect(result).toContain('line1');
    expect(result).toContain('line10');
  });
});

describe('Fix with AI — summary', () => {
  test('summarizeFix reports line counts', () => {
    expect(summarizeFix({ explanation: '', rewritten: '', diff: [], added: 2, removed: 1 }))
      .toBe('+2 −1 lines');
  });

  test('summarizeFix handles no changes', () => {
    expect(summarizeFix({ explanation: '', rewritten: '', diff: [], added: 0, removed: 0 }))
      .toBe('No changes proposed.');
  });

  test('summarizeFix handles singular', () => {
    expect(summarizeFix({ explanation: '', rewritten: '', diff: [], added: 1, removed: 0 }))
      .toBe('+1 −0 line');
  });
});
