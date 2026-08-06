import { describe, expect, test } from './harness';
import { ChatSession, composeSystemPrompt, truncateForContext } from '../src/renderer/ai/chatSession';

describe('ChatSession', () => {
  test('accumulates turns and returns copies', () => {
    const session = new ChatSession();
    expect(session.isEmpty()).toBe(true);
    session.addUser('hi');
    session.addAssistant('hello');
    const history = session.history();
    expect(history).toHaveLength(2);
    expect(history[0].role).toBe('user');
    expect(history[1].role).toBe('assistant');
    history[0].content = 'mutated';
    expect(session.history()[0].content).toBe('hi'); // copy, not a live ref
  });

  test('reset clears the conversation', () => {
    const session = new ChatSession();
    session.addUser('x');
    session.reset();
    expect(session.isEmpty()).toBe(true);
  });
});

describe('composeSystemPrompt', () => {
  test('mentions Zornux and Zoijs', () => {
    const prompt = composeSystemPrompt();
    expect(prompt).toContain('Zornux');
    expect(prompt).toContain('Zoijs');
  });

  test('includes the active file and its code when shared', () => {
    const prompt = composeSystemPrompt({ activeFile: 'main.zx', code: 'print "hi"' });
    expect(prompt).toContain('main.zx');
    expect(prompt).toContain('print "hi"');
  });

  test('names the file but omits code when not shared', () => {
    const prompt = composeSystemPrompt({ activeFile: 'main.zx' });
    expect(prompt).toContain('main.zx');
    expect(prompt).toContain('not shared');
  });
});

describe('truncateForContext', () => {
  test('leaves short code untouched', () => {
    expect(truncateForContext('abc', 10)).toBe('abc');
  });
  test('truncates long code with a marker', () => {
    const out = truncateForContext('x'.repeat(50), 10);
    expect(out).toContain('truncated');
    expect(out.length).toBeLessThan(60);
  });
});
