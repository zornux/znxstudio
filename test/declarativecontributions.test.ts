import { describe, expect, test } from './harness';
import { applyContributions } from '../src/renderer/extensions/DeclarativeContributions';
import { ServiceKeys } from '../src/renderer/core/Contracts';
import type { ValidatedExtension } from '../src/shared/extensions/registry';

function harness() {
  const commandHandlers = new Map<string, () => void>();
  const themes: unknown[] = [];
  const snippets: unknown[] = [];
  const keybindings: { key: string; command: string }[] = [];

  const commands = {
    register: (id: string, handler: () => void) => {
      commandHandlers.set(id, handler);
      return { dispose: () => void commandHandlers.delete(id) };
    },
    execute: (id: string) => commandHandlers.get(id)?.(),
  };
  const theme = {
    register: (t: unknown) => {
      themes.push(t);
      return { dispose: () => void themes.splice(themes.indexOf(t), 1) };
    },
  };
  const snippetService = {
    addExternal: (s: unknown[]) => {
      snippets.push(...s);
      return { dispose: () => void s.forEach((x) => snippets.splice(snippets.indexOf(x), 1)) };
    },
  };
  const keybindingService = {
    registerExternal: (key: string, command: string) => {
      const entry = { key, command };
      keybindings.push(entry);
      return { dispose: () => void keybindings.splice(keybindings.indexOf(entry), 1) };
    },
  };
  const services = {
    tryGet: (key: string) =>
      key === ServiceKeys.Theme ? theme : key === ServiceKeys.Snippets ? snippetService : key === ServiceKeys.Keybindings ? keybindingService : undefined,
  };
  const context = { commands, services } as never;
  return { context, commandHandlers, themes, snippets, keybindings };
}

function ext(contributions: Partial<ValidatedExtension['contributions']>): ValidatedExtension {
  return {
    id: 'zornux.midnight',
    name: 'Midnight',
    publisher: 'zornux',
    slug: 'midnight',
    version: '1.0.0',
    engines: { znxstudio: '>=1.0.0' },
    contributions: { commands: [], snippets: [], keybindings: [], themes: [], ...contributions },
  };
}

describe('applyContributions', () => {
  test('registers snippets, keybindings, themes, and allowlisted command aliases', () => {
    const h = harness();
    const disposable = applyContributions(
      h.context,
      ext({
        commands: [{ command: 'zornux.midnight.problems', title: 'Problems', runs: 'znxstudio.view.problems' }],
        snippets: [{ language: 'zornux', prefix: 'fn', body: 'function' }],
        keybindings: [{ key: 'Ctrl+K Ctrl+P', command: 'znxstudio.view.problems' }],
        themes: [{ id: 'zornux.midnight.dark', label: 'Dark', type: 'dark', cssVars: { '--z-bg': '#101018' } }],
      }),
    );
    expect(h.commandHandlers.has('zornux.midnight.problems')).toBe(true);
    expect(h.snippets).toHaveLength(1);
    expect(h.keybindings).toHaveLength(1);
    expect(h.themes).toHaveLength(1);

    // Dispose removes everything it registered.
    disposable.dispose();
    expect(h.commandHandlers.has('zornux.midnight.problems')).toBe(false);
    expect(h.snippets).toHaveLength(0);
    expect(h.keybindings).toHaveLength(0);
    expect(h.themes).toHaveLength(0);
  });

  test('defence-in-depth: skips a command alias to a non-allowlisted (privileged) command', () => {
    const h = harness();
    applyContributions(
      h.context,
      ext({ commands: [{ command: 'zornux.midnight.evil', title: 'Evil', runs: 'znxstudio.terminal.new' }] }),
    );
    expect(h.commandHandlers.has('zornux.midnight.evil')).toBe(false);
  });
});
