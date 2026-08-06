import { describe, expect, test } from './harness';
import {
  buildRefactorMessages,
  cleanRefactorOutput,
  diffLines,
  diffStats,
  findRefactorAction,
  REFACTOR_ACTIONS,
  stripCodeFences,
} from '../src/renderer/ai/refactor';

describe('refactor actions', () => {
  test('catalog has a custom action and named transforms', () => {
    expect(REFACTOR_ACTIONS.length).toBeGreaterThan(4);
    expect(findRefactorAction('rename')!.label).toBe('Improve names');
    expect(findRefactorAction('custom')!.custom).toBe(true);
  });
});

describe('buildRefactorMessages', () => {
  test('embeds the instruction, file, and code and forbids fences', () => {
    const action = findRefactorAction('simplify')!;
    const { system, messages } = buildRefactorMessages(action, 'give back 1', 'm.zx');
    expect(messages[0].content).toContain('Simplify');
    expect(messages[0].content).toContain('m.zx');
    expect(messages[0].content).toContain('give back 1');
    expect(system).toContain('no Markdown code fences');
  });
  test('uses the custom instruction for the custom action', () => {
    const action = findRefactorAction('custom')!;
    const { messages } = buildRefactorMessages(action, 'x', null, 'convert to a record');
    expect(messages[0].content).toContain('convert to a record');
  });
});

describe('output cleanup', () => {
  test('stripCodeFences unwraps a fenced block', () => {
    expect(stripCodeFences('```zornux\nabc\n```')).toBe('abc');
  });
  test('cleanRefactorOutput trims fences and outer blank lines', () => {
    expect(cleanRefactorOutput('```\n\nfoo\n\n```')).toBe('foo');
  });
});

describe('diffLines', () => {
  test('classifies context / add / del', () => {
    const diff = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(diff.map((l) => l.type)).toEqual(['context', 'del', 'add', 'context', 'add']);
    expect(diffStats(diff)).toEqual({ added: 2, removed: 1 });
  });
  test('identical input yields all context, no changes', () => {
    const diff = diffLines('x\ny', 'x\ny');
    expect(diffStats(diff)).toEqual({ added: 0, removed: 0 });
  });
  test('full replacement deletes then adds', () => {
    const diff = diffLines('old', 'new');
    expect(diff.map((l) => l.type)).toEqual(['del', 'add']);
  });
});
