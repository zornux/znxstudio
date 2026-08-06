import { describe, expect, test } from './harness';
import { ServiceRegistry } from '../src/renderer/core/ServiceRegistry';
import { CommandRegistry } from '../src/renderer/commands/CommandRegistry';
import { ServiceKeys, type StatusService } from '../src/renderer/core/Contracts';
import type { LayoutManager } from '../src/renderer/core/LayoutManager';
import type { ModuleContext } from '../src/renderer/core/Module';
import { ExtensionDiagnostics } from '../src/renderer/extensions/diagnostics';
import { createExtensionApi } from '../src/renderer/extensions/ExtensionApi';
import { ExtensionRuntime } from '../src/renderer/extensions/ExtensionRuntime';
import { parseExtensionManifest } from '../src/shared/extensions/manifest';

describe('ExtensionDiagnostics', () => {
  test('records logs, activation timing, and errors', () => {
    const diag = new ExtensionDiagnostics();
    diag.log('a', 'info', 'started');
    diag.recordActivation('a', 12);
    diag.recordError('a', 'boom');
    const record = diag.get('a')!;
    expect(record.activationMs).toBe(12);
    expect(record.errorCount).toBe(1);
    expect(record.lastError).toBe('boom');
    // recordError also appends an error log line.
    expect(diag.recentMessages('a')).toEqual(['[info] started', '[error] boom']);
  });

  test('caps the log ring buffer', () => {
    const diag = new ExtensionDiagnostics(3);
    for (let i = 0; i < 10; i++) diag.log('a', 'info', `m${i}`);
    expect(diag.get('a')!.logs).toHaveLength(3);
    expect(diag.recentMessages('a')).toEqual(['[info] m7', '[info] m8', '[info] m9']);
  });

  test('reset clears an extension', () => {
    const diag = new ExtensionDiagnostics();
    diag.log('a', 'info', 'x');
    diag.reset('a');
    expect(diag.get('a')).toBe(undefined);
  });
});

describe('runtime feeds diagnostics into ExtensionInfo', () => {
  test('activation timing and logger output surface on ExtensionInfo', async () => {
    const services = new ServiceRegistry();
    const commands = new CommandRegistry();
    services.register(ServiceKeys.Status, { setItem: () => undefined, removeItem: () => undefined } as unknown as StatusService);
    const layout = { showToast: () => undefined } as unknown as LayoutManager;
    const context: ModuleContext = { services, commands, layout, subscriptions: [] };
    const diagnostics = new ExtensionDiagnostics();

    let now = 100;
    const runtime = new ExtensionRuntime(
      (manifest) => createExtensionApi(manifest, context, { log: (level, message) => diagnostics.log(manifest.id, level, message) }),
      { diagnostics, clock: () => now },
    );
    const manifest = parseExtensionManifest({
      name: 'Logger',
      publisher: 'acme',
      version: '1.0.0',
      engines: { znxstudio: '^1.0.0' },
      permissions: [],
      contributes: {},
    }).manifest!;
    runtime.register(manifest, {
      activate: (ctx) => {
        now = 115; // 15ms elapse during activation
        ctx.logger.info('ready');
      },
    });
    await runtime.activate('acme.logger');
    const info = runtime.info('acme.logger')!;
    expect(info.activationMs).toBe(15);
    expect(info.logs).toEqual(['[info] ready']);
    expect(info.errorCount).toBe(0);
  });
});
