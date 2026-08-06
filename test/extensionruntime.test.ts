import { describe, expect, test } from './harness';
import { ServiceRegistry } from '../src/renderer/core/ServiceRegistry';
import { CommandRegistry } from '../src/renderer/commands/CommandRegistry';
import { ServiceKeys, type StatusService, type WorkspaceService } from '../src/renderer/core/Contracts';
import type { LayoutManager } from '../src/renderer/core/LayoutManager';
import type { ModuleContext } from '../src/renderer/core/Module';
import { createExtensionApi } from '../src/renderer/extensions/ExtensionApi';
import { ExtensionRuntime } from '../src/renderer/extensions/ExtensionRuntime';
import { parseExtensionManifest } from '../src/shared/extensions/manifest';
import type { ZnxStudioExtension } from '../src/renderer/extensions/sdk';

function makeHarness() {
  const services = new ServiceRegistry();
  const commands = new CommandRegistry();
  const statusItems = new Map<string, unknown>();
  services.register(ServiceKeys.Status, {
    setItem: (id: string, item: unknown) => statusItems.set(id, item),
    removeItem: (id: string) => void statusItems.delete(id),
  } as unknown as StatusService);
  services.register(ServiceKeys.Workspace, { currentFolder: () => 'C:/proj' } as unknown as WorkspaceService);
  const layout = { showToast: () => undefined } as unknown as LayoutManager;
  const context: ModuleContext = { services, commands, layout, subscriptions: [] };
  const runtime = new ExtensionRuntime((manifest) => createExtensionApi(manifest, context));
  return { runtime, commands, statusItems };
}

function manifest(overrides: Record<string, unknown> = {}) {
  return parseExtensionManifest({
    name: 'Tool',
    publisher: 'acme',
    version: '1.0.0',
    engines: { znxstudio: '^1.0.0' },
    activationEvents: ['onStartup'],
    permissions: ['commands', 'statusBar', 'notifications'],
    contributes: { commands: [{ command: 'acme.tool.run', title: 'Run' }] },
    ...overrides,
  }).manifest!;
}

describe('ExtensionRuntime — activation lifecycle', () => {
  test('activates an extension through the facade and registers its command', async () => {
    const { runtime, commands, statusItems } = makeHarness();
    let ran = false;
    const ext: ZnxStudioExtension = {
      activate: (ctx) => {
        ctx.subscriptions.push(ctx.commands.register('acme.tool.run', () => (ran = true), 'Run'));
        ctx.window.setStatusBarItem('badge', { text: 'x' });
      },
    };
    runtime.register(manifest(), ext);
    expect(await runtime.activate('acme.tool')).toBe(true);
    expect(runtime.isActive('acme.tool')).toBe(true);
    expect(commands.has('acme.tool.run')).toBe(true);
    await commands.execute('acme.tool.run');
    expect(ran).toBe(true);
    expect(statusItems.has('ext.acme.tool.badge')).toBe(true);
  });

  test('deactivate disposes commands and status items', async () => {
    const { runtime, commands, statusItems } = makeHarness();
    const ext: ZnxStudioExtension = {
      activate: (ctx) => {
        ctx.commands.register('acme.tool.run', () => undefined, 'Run');
        ctx.window.setStatusBarItem('badge', { text: 'x' });
      },
    };
    runtime.register(manifest(), ext);
    await runtime.activate('acme.tool');
    await runtime.deactivate('acme.tool');
    expect(commands.has('acme.tool.run')).toBe(false);
    expect(statusItems.has('ext.acme.tool.badge')).toBe(false);
    expect(runtime.isActive('acme.tool')).toBe(false);
  });

  test('activateForTrigger activates onStartup extensions', async () => {
    const { runtime } = makeHarness();
    runtime.register(manifest(), { activate: () => undefined });
    const activated = await runtime.activateForTrigger('onStartup');
    expect(activated).toEqual(['acme.tool']);
  });
});

describe('ExtensionRuntime — guards', () => {
  test('missing permission fails activation with a clear error', async () => {
    const { runtime, statusItems } = makeHarness();
    const ext: ZnxStudioExtension = {
      activate: (ctx) => {
        ctx.window.setStatusBarItem('badge', { text: 'x' }); // no statusBar permission
      },
    };
    runtime.register(manifest({ permissions: ['commands'] }), ext);
    expect(await runtime.activate('acme.tool')).toBe(false);
    const info = runtime.info('acme.tool')!;
    expect(info.state).toBe('failed');
    expect(info.error!.includes('statusBar')).toBe(true);
    expect(statusItems.size).toBe(0);
  });

  test('registering a command outside the extension namespace fails activation', async () => {
    const { runtime, commands } = makeHarness();
    const ext: ZnxStudioExtension = {
      activate: (ctx) => {
        ctx.commands.register('evil.cmd', () => undefined, 'Evil');
      },
    };
    runtime.register(manifest({ contributes: {} }), ext);
    expect(await runtime.activate('acme.tool')).toBe(false);
    expect(runtime.info('acme.tool')!.state).toBe('failed');
    expect(commands.has('evil.cmd')).toBe(false);
  });

  test('an incompatible engine is recorded, never activated', async () => {
    const { runtime } = makeHarness();
    const state = runtime.register(manifest({ engines: { znxstudio: '^99.0.0' } }), { activate: () => undefined });
    expect(state).toBe('incompatible');
    expect(await runtime.activate('acme.tool')).toBe(false);
    expect(runtime.info('acme.tool')!.state).toBe('incompatible');
  });
});
