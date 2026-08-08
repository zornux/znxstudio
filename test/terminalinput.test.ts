import { describe, expect, test } from './harness';
import { TerminalInputBuffer } from '../src/renderer/terminal/inputBuffer';
import { terminalSessionKey } from '../src/main/services/terminalSessionKey';
import { resolveTerminalShortcut, type TerminalKeyLike } from '../src/renderer/terminal/terminalShortcuts';

const key = (keyName: string, modifiers: Partial<TerminalKeyLike> = {}): TerminalKeyLike => ({
  key: keyName,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
});

describe('terminal interactive input', () => {
  test('preserves typing and paste entered before the PTY is ready', () => {
    const input = new TerminalInputBuffer();
    const sent: string[] = [];
    const send = (data: string): void => { sent.push(data); };
    input.accept('Ada', send);
    input.accept('\r', send);
    expect(sent).toEqual([]);
    input.markReady(send);
    input.accept('next', send);
    expect(sent).toEqual(['Ada\r', 'next']);
  });

  test('drops buffered and future input after a process exits', () => {
    const input = new TerminalInputBuffer();
    const sent: string[] = [];
    input.accept('secret', (data) => sent.push(data));
    input.close();
    input.markReady((data) => sent.push(data));
    input.accept('ignored', (data) => sent.push(data));
    expect(sent).toEqual([]);
  });

  test('bounds startup input buffering', () => {
    const input = new TerminalInputBuffer();
    const sent: string[] = [];
    input.accept('x'.repeat(100_000), (data) => sent.push(data));
    input.markReady((data) => sent.push(data));
    expect(sent[0].length).toBe(64 * 1024);
  });

  test('scopes identical terminal ids to their owning window', () => {
    expect(terminalSessionKey(1, 'term-1')).toBe('1:term-1');
    expect(terminalSessionKey(2, 'term-1')).toBe('2:term-1');
  });

  test('keeps common shell control keys in the PTY', () => {
    for (const name of ['c', 'd', 'l', 'r', 'z', 'ArrowUp', 'ArrowDown']) {
      expect(resolveTerminalShortcut(key(name, { ctrlKey: true }), false)).toBe('shell');
    }
  });

  test('recognizes cross-platform clipboard shortcuts', () => {
    expect(resolveTerminalShortcut(key('c', { ctrlKey: true, shiftKey: true }), false)).toBe('copy');
    expect(resolveTerminalShortcut(key('v', { ctrlKey: true, shiftKey: true }), false)).toBe('paste');
    expect(resolveTerminalShortcut(key('Insert', { ctrlKey: true }), false)).toBe('copy');
    expect(resolveTerminalShortcut(key('Insert', { shiftKey: true }), false)).toBe('paste');
    expect(resolveTerminalShortcut(key('c', { metaKey: true }), true)).toBe('copy');
    expect(resolveTerminalShortcut(key('v', { metaKey: true }), true)).toBe('paste');
    expect(resolveTerminalShortcut(key('c', { metaKey: true }), false)).toBe('shell');
  });

  test('switches terminal tabs without sending PageUp or PageDown to the shell', () => {
    expect(resolveTerminalShortcut(key('PageDown', { ctrlKey: true }), false)).toBe('next-tab');
    expect(resolveTerminalShortcut(key('PageUp', { ctrlKey: true }), false)).toBe('previous-tab');
    expect(resolveTerminalShortcut(key('PageDown'), false)).toBe('shell');
  });
});
