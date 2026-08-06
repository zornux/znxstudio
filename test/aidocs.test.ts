import { describe, expect, test } from './harness';
import {
  buildFileDocMessages,
  buildSymbolDocMessages,
  cleanDocText,
  extractBlock,
  findDeclaration,
  formatDocComment,
  hasDocCommentAbove,
} from '../src/renderer/ai/docs';

const SOURCE = 'module math\n\nfunction add with a, b\n    give back a + b\nend\n\nclass Point\n    has field x\nend\n';

describe('findDeclaration', () => {
  test('finds the nearest declaration at or above the cursor', () => {
    const decl = findDeclaration(SOURCE, 3); // inside add's body
    expect(decl!.kind).toBe('function');
    expect(decl!.name).toBe('add');
    expect(decl!.headerLine).toBe(2);
    expect(decl!.indent).toBe('');
  });
  test('finds a class header', () => {
    expect(findDeclaration(SOURCE, 7)!.name).toBe('Point');
  });
  test('returns null before any declaration', () => {
    expect(findDeclaration('# just a comment\n', 0)).toBeNull();
  });
});

describe('extractBlock', () => {
  test('captures header through matching end', () => {
    const decl = findDeclaration(SOURCE, 2)!;
    const block = extractBlock(SOURCE, decl);
    expect(block.split('\n')).toHaveLength(3); // header, body, end
    expect(block).toContain('give back a + b');
    expect(block).toContain('end');
  });
  test('respects a nested indent end', () => {
    const src = 'service S\n    function m with x\n        give back x\n    end\nend\n';
    const decl = findDeclaration(src, 1)!; // the nested function
    expect(decl.indent).toBe('    ');
    const block = extractBlock(src, decl);
    expect(block.split('\n')[block.split('\n').length - 1]).toBe('    end');
  });
});

describe('prompts', () => {
  test('symbol doc forbids comment markers and code', () => {
    const decl = findDeclaration(SOURCE, 2)!;
    const { system, messages } = buildSymbolDocMessages(decl, 'function add', 'math.zx');
    expect(system).toContain('no comment markers');
    expect(messages[0].content).toContain('function add');
    expect(messages[0].content).toContain('math.zx');
  });
  test('file doc asks for Markdown', () => {
    expect(buildFileDocMessages('x', 'a.zx').system).toContain('Markdown');
  });
});

describe('cleanDocText & formatDocComment', () => {
  test('strips fences, comment markers, and collapses blank lines', () => {
    expect(cleanDocText('```\n# Adds numbers\n\n\nreturns sum\n```')).toBe('Adds numbers\n\nreturns sum');
  });
  test('formats a comment block at the given indent', () => {
    const block = formatDocComment('Adds two numbers.\na: addend', '    ');
    expect(block).toBe('    # Adds two numbers.\n    # a: addend\n');
  });
  test('blank doc lines become bare comment markers', () => {
    expect(formatDocComment('one\n\ntwo', '')).toBe('# one\n#\n# two\n');
  });
});

describe('hasDocCommentAbove', () => {
  test('detects a comment on the preceding line', () => {
    expect(hasDocCommentAbove('# doc\nfunction f\nend', 1)).toBe(true);
    expect(hasDocCommentAbove('function f\nend', 0)).toBe(false);
    expect(hasDocCommentAbove('let x = 1\nfunction f\nend', 1)).toBe(false);
  });
});
