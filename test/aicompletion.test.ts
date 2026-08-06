import { describe, expect, test } from './harness';
import {
  buildCompletionMessages,
  cleanCompletion,
  completionWindow,
  shouldComplete,
  stripPrefixOverlap,
} from '../src/renderer/ai/completion';

describe('completionWindow', () => {
  test('splits the buffer at the cursor', () => {
    const win = completionWindow('abcdef', 3);
    expect(win.prefix).toBe('abc');
    expect(win.suffix).toBe('def');
  });
  test('bounds prefix and suffix length', () => {
    const text = 'x'.repeat(5000);
    const win = completionWindow(text, 2500, 100, 50);
    expect(win.prefix).toHaveLength(100);
    expect(win.suffix).toHaveLength(50);
  });
  test('clamps an out-of-range offset', () => {
    expect(completionWindow('ab', 99).prefix).toBe('ab');
    expect(completionWindow('ab', -5).prefix).toBe('');
  });
});

describe('shouldComplete', () => {
  test('rejects an empty prefix', () => {
    expect(shouldComplete({ prefix: '   ', suffix: '' })).toBe(false);
  });
  test('rejects mid-identifier positions', () => {
    expect(shouldComplete({ prefix: 'let valu', suffix: 'e = 1' })).toBe(false);
  });
  test('accepts after a newline or symbol', () => {
    expect(shouldComplete({ prefix: 'function main\n', suffix: '' })).toBe(true);
    expect(shouldComplete({ prefix: 'give back ', suffix: '' })).toBe(true);
  });
});

describe('buildCompletionMessages', () => {
  test('frames the cursor and file, forbids fences', () => {
    const { system, messages } = buildCompletionMessages({ prefix: 'a', suffix: 'b' }, 'main.zx');
    expect(messages[0].content).toContain('<CURSOR>');
    expect(messages[0].content).toContain('main.zx');
    expect(system).toContain('no Markdown code fences');
  });
});

describe('stripPrefixOverlap', () => {
  test('removes an echoed prefix tail', () => {
    expect(stripPrefixOverlap('give back ', 'back sum')).toBe('sum');
  });
  test('leaves non-overlapping text', () => {
    expect(stripPrefixOverlap('let x = ', '42')).toBe('42');
  });
});

describe('cleanCompletion', () => {
  test('unwraps a code fence', () => {
    expect(cleanCompletion('```zornux\ngive back 1\n```', '')).toBe('give back 1');
  });
  test('drops an echoed prefix and trailing whitespace', () => {
    expect(cleanCompletion('back 42   ', 'give back ')).toBe('42');
  });
  test('caps the number of lines', () => {
    const many = Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n');
    expect(cleanCompletion(many, '', 5).split('\n')).toHaveLength(5);
  });
  test('drops a leading newline when the cursor is already at line start', () => {
    expect(cleanCompletion('\nnext', 'header\n')).toBe('next');
  });
});
