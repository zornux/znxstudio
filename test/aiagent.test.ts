import { describe, expect, test } from './harness';
import {
  AgentSession,
  buildAgentSystemPrompt,
  filterAgentOutput,
  isCommandSafe,
  parseAgentResponse,
} from '../src/renderer/ai/agentSession';

describe('Agent session — lifecycle', () => {
  test('new session starts idle', () => {
    const s = new AgentSession();
    expect(s.state).toBe('idle');
    expect(s.goal).toBe('');
    expect(s.aborted).toBe(false);
  });

  test('start() transitions to planning with a goal', () => {
    const s = new AgentSession();
    s.start('Refactor auth module');
    expect(s.state).toBe('planning');
    expect(s.goal).toBe('Refactor auth module');
    expect(s.aborted).toBe(false);
  });

  test('abort() transitions to done and sets aborted', () => {
    const s = new AgentSession();
    s.start('Fix bug');
    s.abort();
    expect(s.state).toBe('done');
    expect(s.aborted).toBe(true);
  });

  test('reset() returns to idle and clears everything', () => {
    const s = new AgentSession();
    s.start('Task');
    s.addTurn('user', 'hello');
    s.addStep('plan', 'Plan', 'Step 1');
    s.abort();
    s.reset();
    expect(s.state).toBe('idle');
    expect(s.goal).toBe('');
    expect(s.aborted).toBe(false);
    expect(s.history().length).toBe(0);
    expect(s.allSteps().length).toBe(0);
  });

  test('start() after previous session resets state', () => {
    const s = new AgentSession();
    s.start('Task 1');
    s.addStep('plan', 'Plan', 'Do stuff');
    s.start('Task 2');
    expect(s.goal).toBe('Task 2');
    expect(s.allSteps().length).toBe(0);
    expect(s.history().length).toBe(0);
  });
});

describe('Agent session — turns and steps', () => {
  test('addTurn records conversation history', () => {
    const s = new AgentSession();
    s.start('Goal');
    s.addTurn('user', 'hello');
    s.addTurn('assistant', 'hi');
    const h = s.history();
    expect(h.length).toBe(2);
    expect(h[0].role).toBe('user');
    expect(h[1].role).toBe('assistant');
  });

  test('history returns copies (not references)', () => {
    const s = new AgentSession();
    s.addTurn('user', 'hello');
    const h1 = s.history();
    h1[0].content = 'modified';
    expect(s.history()[0].content).toBe('hello');
  });

  test('addStep creates a pending step with incrementing id', () => {
    const s = new AgentSession();
    s.start('Goal');
    const s1 = s.addStep('plan', 'Plan', 'The plan');
    const s2 = s.addStep('edit', 'Edit main.zx', 'New content', { file: 'main.zx' });
    expect(s1.id).toBe(1);
    expect(s2.id).toBe(2);
    expect(s1.status).toBe('pending');
    expect(s2.file).toBe('main.zx');
  });

  test('updateStep modifies an existing step', () => {
    const s = new AgentSession();
    s.start('Goal');
    const step = s.addStep('edit', 'Edit', 'content');
    s.updateStep(step.id, { status: 'approved' });
    expect(s.allSteps()[0].status).toBe('approved');
  });

  test('updateStep does nothing for unknown id', () => {
    const s = new AgentSession();
    s.start('Goal');
    s.addStep('plan', 'Plan', 'content');
    s.updateStep(999, { status: 'approved' });
    expect(s.allSteps()[0].status).toBe('pending');
  });
});

describe('Agent session — filtering', () => {
  test('pendingEdits returns only pending edit steps', () => {
    const s = new AgentSession();
    s.start('Goal');
    s.addStep('plan', 'Plan', 'plan');
    const edit = s.addStep('edit', 'Edit', 'content', { file: 'a.zx' });
    s.addStep('command', 'Run', 'ls', { command: 'ls' });
    s.addStep('edit', 'Edit2', 'content2', { file: 'b.zx' });
    s.updateStep(edit.id, { status: 'approved' });
    expect(s.pendingEdits().length).toBe(1);
    expect(s.pendingEdits()[0].file).toBe('b.zx');
  });

  test('pendingCommands returns only pending command steps', () => {
    const s = new AgentSession();
    s.start('Goal');
    s.addStep('command', 'Run 1', 'ls', { command: 'ls' });
    const cmd2 = s.addStep('command', 'Run 2', 'echo hi', { command: 'echo hi' });
    s.updateStep(cmd2.id, { status: 'done' });
    expect(s.pendingCommands().length).toBe(1);
    expect(s.pendingCommands()[0].command).toBe('ls');
  });
});

describe('Agent session — stats', () => {
  test('stats counts steps by status', () => {
    const s = new AgentSession();
    s.start('Goal');
    s.addStep('plan', 'Plan', 'plan');
    const e1 = s.addStep('edit', 'E1', 'c1');
    const e2 = s.addStep('edit', 'E2', 'c2');
    const cmd = s.addStep('command', 'Run', 'ls');
    s.updateStep(e1.id, { status: 'applied' });
    s.updateStep(e2.id, { status: 'rejected' });
    s.updateStep(cmd.id, { status: 'done' });
    const st = s.stats();
    expect(st.total).toBe(4);
    expect(st.pending).toBe(1);
    expect(st.applied).toBe(2); // applied + done both count
    expect(st.rejected).toBe(1);
  });
});

describe('Agent — system prompt', () => {
  test('buildAgentSystemPrompt contains protocol actions', () => {
    const prompt = buildAgentSystemPrompt();
    expect(prompt).toContain('PLAN:');
    expect(prompt).toContain('EDIT');
    expect(prompt).toContain('RUN:');
    expect(prompt).toContain('CHECK:');
    expect(prompt).toContain('DONE:');
  });

  test('buildAgentSystemPrompt includes project map when provided', () => {
    const prompt = buildAgentSystemPrompt('auth.zx:\n  module Auth (L1)');
    expect(prompt).toContain('Project structure:');
    expect(prompt).toContain('module Auth');
  });
});

describe('Agent — response parsing', () => {
  test('parses PLAN response', () => {
    const result = parseAgentResponse('PLAN: 1. Read the file\n2. Fix the bug\n3. Run tests');
    expect(result.kind).toBe('plan');
    expect(result.label).toBe('Plan');
    expect(result.content).toContain('Read the file');
  });

  test('parses PLAN without colon', () => {
    const result = parseAgentResponse('PLAN\n1. Do something');
    expect(result.kind).toBe('plan');
  });

  test('parses EDIT response with file and code', () => {
    const raw = 'EDIT src/main.zx\n```zornux\nfunction main\n    print "fixed"\nend\n```';
    const result = parseAgentResponse(raw);
    expect(result.kind).toBe('edit');
    expect(result.file).toBe('src/main.zx');
    expect(result.proposed).toContain('function main');
    expect(result.proposed).toContain('print "fixed"');
    expect(result.label).toContain('main.zx');
  });

  test('parses RUN response', () => {
    const result = parseAgentResponse('RUN: zornux test .');
    expect(result.kind).toBe('command');
    expect(result.command).toBe('zornux test .');
    expect(result.label).toContain('zornux test');
  });

  test('parses CHECK response', () => {
    const result = parseAgentResponse('CHECK: Check for compilation errors');
    expect(result.kind).toBe('diagnostic');
    expect(result.command).toBe('zornux check');
  });

  test('parses bare CHECK', () => {
    expect(parseAgentResponse('CHECK').kind).toBe('diagnostic');
  });

  test('parses DONE response', () => {
    const result = parseAgentResponse('DONE: All errors fixed. 2 files modified.');
    expect(result.kind).toBe('message');
    expect(result.label).toBe('Done');
    expect(result.content).toContain('All errors fixed');
  });

  test('parses bare DONE', () => {
    const result = parseAgentResponse('DONE');
    expect(result.kind).toBe('message');
    expect(result.content).toBe('Agent finished.');
  });

  test('unknown format falls back to message', () => {
    const result = parseAgentResponse('I think we should refactor this.');
    expect(result.kind).toBe('message');
    expect(result.content).toContain('refactor');
  });
});

describe('Agent — command safety', () => {
  test('safe commands pass', () => {
    expect(isCommandSafe('zornux check .')).toBe(true);
    expect(isCommandSafe('zornux test .')).toBe(true);
    expect(isCommandSafe('ls -la')).toBe(true);
    expect(isCommandSafe('cat src/main.zx')).toBe(true);
    expect(isCommandSafe('echo hello')).toBe(true);
    expect(isCommandSafe('git status')).toBe(true);
    expect(isCommandSafe('git diff')).toBe(true);
    expect(isCommandSafe('npm install')).toBe(true);
  });

  test('destructive file commands are blocked', () => {
    expect(isCommandSafe('rm -rf /')).toBe(false);
    expect(isCommandSafe('rm -r src/')).toBe(false);
    expect(isCommandSafe('rmdir important')).toBe(false);
  });

  test('destructive git commands are blocked', () => {
    expect(isCommandSafe('git reset --hard HEAD~5')).toBe(false);
    expect(isCommandSafe('git clean -fd')).toBe(false);
    expect(isCommandSafe('git checkout .')).toBe(false);
    expect(isCommandSafe('git push --force')).toBe(false);
    expect(isCommandSafe('git push -f origin main')).toBe(false);
  });

  test('database commands are blocked', () => {
    expect(isCommandSafe('drop table users')).toBe(false);
    expect(isCommandSafe('DROP DATABASE prod')).toBe(false);
    expect(isCommandSafe('truncate table sessions')).toBe(false);
  });

  test('system commands are blocked', () => {
    expect(isCommandSafe('shutdown -h now')).toBe(false);
    expect(isCommandSafe('reboot')).toBe(false);
    expect(isCommandSafe('kill -9 1234')).toBe(false);
    expect(isCommandSafe('killall node')).toBe(false);
  });

  test('pipe-to-shell is blocked', () => {
    expect(isCommandSafe('curl | sh')).toBe(false);
    expect(isCommandSafe('wget | sh')).toBe(false);
  });

  test('publish commands are blocked', () => {
    expect(isCommandSafe('npm publish')).toBe(false);
    expect(isCommandSafe('cargo publish')).toBe(false);
  });

  test('permission changes are blocked', () => {
    expect(isCommandSafe('chmod 777 /etc/passwd')).toBe(false);
    expect(isCommandSafe('chown root file.txt')).toBe(false);
  });

  test('case insensitive matching', () => {
    expect(isCommandSafe('RM -RF /')).toBe(false);
    expect(isCommandSafe('Git Reset --Hard')).toBe(false);
  });
});

describe('Agent — output filtering', () => {
  test('filterAgentOutput redacts secrets', () => {
    const output = 'Connected with api_key = "sk-very-long-secret-key-1234567890ab"';
    const filtered = filterAgentOutput(output);
    expect(filtered).toContain('[REDACTED]');
    expect(filtered.includes('sk-very-long')).toBe(false);
  });

  test('filterAgentOutput passes normal output through', () => {
    const output = 'Build successful. 0 errors, 0 warnings.';
    expect(filterAgentOutput(output)).toBe(output);
  });
});
