import { describe, expect, test } from './harness';
import {
  buildInlineMessages,
  cleanInlineOutput,
  findInlineAction,
  INLINE_ACTIONS,
} from '../src/renderer/ai/inlineActions';

describe('Inline AI — action registry', () => {
  test('INLINE_ACTIONS has all 6 actions', () => {
    expect(INLINE_ACTIONS.length).toBe(6);
    const ids = INLINE_ACTIONS.map((a) => a.id);
    expect(ids).toContain('explain');
    expect(ids).toContain('generate');
    expect(ids).toContain('rewrite');
    expect(ids).toContain('simplify');
    expect(ids).toContain('addTypes');
    expect(ids).toContain('addTests');
  });

  test('explain and addTests do not replace selection', () => {
    const explain = findInlineAction('explain')!;
    const addTests = findInlineAction('addTests')!;
    expect(explain.replaces).toBe(false);
    expect(addTests.replaces).toBe(false);
  });

  test('rewrite, simplify, addTypes, generate replace selection', () => {
    for (const id of ['rewrite', 'simplify', 'addTypes', 'generate'] as const) {
      const action = findInlineAction(id)!;
      expect(action.replaces).toBe(true);
    }
  });

  test('generate and rewrite need instruction', () => {
    expect(findInlineAction('generate')!.needsInstruction).toBe(true);
    expect(findInlineAction('rewrite')!.needsInstruction).toBe(true);
  });

  test('explain, simplify, addTypes, addTests do not need instruction', () => {
    for (const id of ['explain', 'simplify', 'addTypes', 'addTests'] as const) {
      expect(findInlineAction(id)!.needsInstruction).toBe(false);
    }
  });

  test('findInlineAction returns undefined for unknown id', () => {
    expect(findInlineAction('nonexistent' as any)).toBe(undefined);
  });
});

describe('Inline AI — prompt building', () => {
  const code = 'function add with a, b\n    give back a + b\nend';

  test('explain builds a system prompt for explanation', () => {
    const action = findInlineAction('explain')!;
    const { system, messages } = buildInlineMessages(action, code, 'math.zx');
    expect(system).toContain('Explain');
    expect(system).toContain('Markdown');
    expect(messages.length).toBe(1);
    expect(messages[0].role).toBe('user');
    expect(messages[0].content).toContain('math.zx');
    expect(messages[0].content).toContain('function add');
  });

  test('generate includes the instruction as the description', () => {
    const action = findInlineAction('generate')!;
    const { messages } = buildInlineMessages(action, code, 'math.zx', 'add error handling');
    expect(messages[0].content).toContain('add error handling');
    expect(messages[0].content).toContain('Description:');
  });

  test('rewrite includes the instruction', () => {
    const action = findInlineAction('rewrite')!;
    const { messages } = buildInlineMessages(action, code, 'math.zx', 'use pattern matching');
    expect(messages[0].content).toContain('Instruction: use pattern matching');
  });

  test('simplify system prompt mentions preserving behavior', () => {
    const action = findInlineAction('simplify')!;
    const { system } = buildInlineMessages(action, code, null);
    expect(system).toContain('Preserve behavior');
  });

  test('addTypes system prompt mentions type annotations', () => {
    const action = findInlineAction('addTypes')!;
    const { system } = buildInlineMessages(action, code, null);
    expect(system).toContain('type annotation');
  });

  test('addTests system prompt mentions test syntax', () => {
    const action = findInlineAction('addTests')!;
    const { system } = buildInlineMessages(action, code, null);
    expect(system).toContain('test "description"');
  });

  test('null fileName omits file line from user content', () => {
    const action = findInlineAction('explain')!;
    const { messages } = buildInlineMessages(action, code, null);
    expect(messages[0].content.includes('File:')).toBe(false);
    expect(messages[0].content).toContain('Selected code:');
  });
});

describe('Inline AI — output cleaning', () => {
  test('cleanInlineOutput strips code fences', () => {
    const raw = '```zornux\nfunction add with a, b\n    give back a + b\nend\n```';
    expect(cleanInlineOutput(raw)).toBe('function add with a, b\n    give back a + b\nend');
  });

  test('cleanInlineOutput strips leading/trailing whitespace', () => {
    const raw = '\n\n  hello world  \n\n';
    expect(cleanInlineOutput(raw)).toBe('  hello world');
  });

  test('cleanInlineOutput leaves plain code unchanged', () => {
    const raw = 'function main\n    print "hi"\nend';
    expect(cleanInlineOutput(raw)).toBe(raw);
  });

  test('cleanInlineOutput handles CRLF', () => {
    const raw = '```\r\nfunction main\r\nend\r\n```';
    expect(cleanInlineOutput(raw)).toBe('function main\nend');
  });
});
