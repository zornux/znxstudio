import { describe, expect, test } from './harness';
import { ServiceRegistry } from '../src/renderer/core/ServiceRegistry';
import { CommandRegistry } from '../src/renderer/commands/CommandRegistry';
import { ServiceKeys, type StatusService } from '../src/renderer/core/Contracts';
import type { LayoutManager } from '../src/renderer/core/LayoutManager';
import type { ModuleContext } from '../src/renderer/core/Module';
import { createExtensionApi } from '../src/renderer/extensions/ExtensionApi';
import { ExtensionRuntime } from '../src/renderer/extensions/ExtensionRuntime';
import {
  DEFAULT_LIMITS,
  RateLimiter,
  ResourceCounter,
  createSandboxedApi,
  withTimeout,
} from '../src/renderer/extensions/sandbox';
import { parseExtensionManifest } from '../src/shared/extensions/manifest';
import type { ExtensionContext } from '../src/renderer/extensions/sdk';

function innerApi() {
  const services = new ServiceRegistry();
  const commands = new CommandRegistry();
  services.register(ServiceKeys.Status, {
    setItem: () => undefined,
    removeItem: () => undefined,
  } as unknown as StatusService);
  const layout = { showToast: () => undefined } as unknown as LayoutManager;
  const context: ModuleContext = { services, commands, layout, subscriptions: [] };
  const manifest = parseExtensionManifest({
    name: 'Sbx',
    publisher: 'acme',
    version: '1.0.0',
    engines: { znxstudio: '^1.0.0' },
    permissions: ['commands', 'statusBar'],
    contributes: {},
  }).manifest!;
  return { inner: createExtensionApi(manifest, context), commands };
}

describe('sandbox primitives', () => {
  test('withTimeout resolves a fast value and rejects a hung one', async () => {
    expect(await withTimeout(Promise.resolve(7), 50)).toBe(7);
    let rejected = false;
    try {
      await withTimeout(new Promise(() => undefined), 20, 'op');
    } catch (error) {
      rejected = (error as Error).message.includes('timed out');
    }
    expect(rejected).toBe(true);
  });

  test('ResourceCounter caps acquisitions', () => {
    const counter = new ResourceCounter(2);
    expect(counter.tryAcquire()).toBe(true);
    expect(counter.tryAcquire()).toBe(true);
    expect(counter.tryAcquire()).toBe(false);
    counter.release();
    expect(counter.tryAcquire()).toBe(true);
  });

  test('RateLimiter allows up to max within the window', () => {
    let now = 1000;
    const limiter = new RateLimiter(2, 100, () => now);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(true);
    expect(limiter.allow()).toBe(false);
    now += 200; // window elapsed
    expect(limiter.allow()).toBe(true);
  });
});

describe('createSandboxedApi', () => {
  test('isolates a throwing command handler', async () => {
    const { inner, commands } = innerApi();
    const errors: string[] = [];
    const api = createSandboxedApi(inner, { onError: (_w, e) => errors.push(e.message) }, DEFAULT_LIMITS);
    api.commands.register('acme.sbx.boom', () => {
      throw new Error('kaboom');
    });
    await commands.execute('acme.sbx.boom'); // must NOT throw
    expect(errors).toEqual(['kaboom']);
  });

  test('rate-limits handler calls', async () => {
    const { inner, commands } = innerApi();
    const errors: string[] = [];
    let ran = 0;
    const api = createSandboxedApi(
      inner,
      { onError: (_w, e) => errors.push(e.message) },
      { ...DEFAULT_LIMITS, maxHandlerCallsPerMinute: 2 },
      () => 0,
    );
    api.commands.register('acme.sbx.run', () => (ran += 1));
    await commands.execute('acme.sbx.run');
    await commands.execute('acme.sbx.run');
    await commands.execute('acme.sbx.run'); // blocked
    expect(ran).toBe(2);
    expect(errors.some((e) => e.includes('rate limit'))).toBe(true);
  });

  test('caps command registrations', () => {
    const { inner } = innerApi();
    const errors: string[] = [];
    const api = createSandboxedApi(inner, { onError: (_w, e) => errors.push(e.message) }, { ...DEFAULT_LIMITS, maxCommands: 1 });
    api.commands.register('acme.sbx.a', () => undefined);
    let threw = false;
    try {
      api.commands.register('acme.sbx.b', () => undefined);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(errors.some((e) => e.includes('command limit'))).toBe(true);
  });

  test('freezes the facade', () => {
    const { inner } = innerApi();
    const api = createSandboxedApi(inner, { onError: () => undefined }, DEFAULT_LIMITS);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.commands)).toBe(true);
    expect(Object.isFrozen(api.window)).toBe(true);
  });
});

describe('ExtensionRuntime — activation timeout', () => {
  test('a hung activation is bounded and marked failed', async () => {
    const { inner } = innerApi();
    const runtime = new ExtensionRuntime(() => inner as ExtensionContext, { activationTimeoutMs: 20 });
    const manifest = parseExtensionManifest({
      name: 'Hang',
      publisher: 'acme',
      version: '1.0.0',
      engines: { znxstudio: '^1.0.0' },
      permissions: [],
      contributes: {},
    }).manifest!;
    runtime.register(manifest, { activate: () => new Promise(() => undefined) });
    expect(await runtime.activate('acme.hang')).toBe(false);
    expect(runtime.info('acme.hang')!.state).toBe('failed');
    expect(runtime.info('acme.hang')!.error!.includes('timed out')).toBe(true);
  });
});
