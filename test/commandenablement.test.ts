import { describe, expect, test } from './harness';
import { CommandRegistry } from '../src/renderer/commands/CommandRegistry';

describe('command enablement (trust-gated UI)', () => {
  test('commands are enabled by default and reflected in list()', () => {
    const registry = new CommandRegistry();
    registry.register('znxstudio.run.start', () => {}, 'Run');
    expect(registry.isEnabled('znxstudio.run.start')).toBe(true);
    expect(registry.list().find((c) => c.id === 'znxstudio.run.start')?.enabled).toBe(true);
  });

  test('an enablement rule can disable specific commands; abstaining leaves others enabled', () => {
    const registry = new CommandRegistry();
    registry.register('znxstudio.run.start', () => {}, 'Run');
    registry.register('znxstudio.view.explorer', () => {}, 'Explorer');

    let trusted = false;
    const gated = new Set(['znxstudio.run.start']);
    registry.addEnablementRule((id) => (gated.has(id) ? trusted : undefined));

    expect(registry.isEnabled('znxstudio.run.start')).toBe(false); // gated + untrusted
    expect(registry.isEnabled('znxstudio.view.explorer')).toBe(true); // rule abstains

    trusted = true;
    expect(registry.isEnabled('znxstudio.run.start')).toBe(true); // re-enabled live, no re-register
  });

  test('any rule returning false disables the command', () => {
    const registry = new CommandRegistry();
    registry.register('c', () => {});
    registry.addEnablementRule(() => true);
    registry.addEnablementRule(() => false);
    expect(registry.isEnabled('c')).toBe(false);
  });

  test('execute enforces enablement instead of relying only on UI callers', async () => {
    const registry = new CommandRegistry();
    let ran = false;
    registry.register('dangerous', () => { ran = true; });
    registry.addEnablementRule((id) => id === 'dangerous' ? false : undefined);
    let message = '';
    try {
      await registry.execute('dangerous');
    } catch (error) {
      message = (error as Error).message;
    }
    expect(ran).toBe(false);
    expect(message).toContain('disabled');
  });

  test('executeFromUi contains rejection and reports it to the UI callback', async () => {
    const registry = new CommandRegistry();
    registry.register('broken', () => { throw new Error('boom'); });
    let detail = '';
    registry.executeFromUi('broken', (error) => { detail = (error as Error).message; });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(detail).toBe('boom');
  });

  test('onDidChangeEnablement notifies subscribers until disposed', () => {
    const registry = new CommandRegistry();
    let count = 0;
    const sub = registry.onDidChangeEnablement(() => (count += 1));
    registry.notifyEnablementChanged();
    registry.notifyEnablementChanged();
    expect(count).toBe(2);
    sub.dispose();
    registry.notifyEnablementChanged();
    expect(count).toBe(2);
  });
});
