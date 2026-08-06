import { describe, expect, test } from './harness';
import { ServiceRegistry } from '../src/renderer/core/ServiceRegistry';
import { CommandRegistry } from '../src/renderer/commands/CommandRegistry';
import {
  ServiceKeys,
  type EditorService,
  type OutputService,
  type SettingsService,
  type WorkspaceService,
} from '../src/renderer/core/Contracts';
import type { LayoutManager } from '../src/renderer/core/LayoutManager';
import type { ModuleContext } from '../src/renderer/core/Module';
import { createExtensionApi } from '../src/renderer/extensions/ExtensionApi';
import { parseExtensionManifest, type ExtensionManifest } from '../src/shared/extensions/manifest';

function harness() {
  const services = new ServiceRegistry();
  const commands = new CommandRegistry();
  const outputs: string[] = [];
  const settingsStore = new Map<string, unknown>();
  let inserted = '';
  services.register(ServiceKeys.Output, {
    append: () => undefined,
    appendLine: (line: string) => outputs.push(line),
    clear: () => undefined,
    show: () => undefined,
  } as unknown as OutputService);
  services.register(ServiceKeys.Editor, {
    currentFile: () => 'C:/proj/a.zx',
    activeText: () => 'source text',
    selectedText: () => 'selected',
    insertText: (t: string) => (inserted = t),
    onDidChangeActiveFile: () => ({ dispose: () => undefined }),
  } as unknown as EditorService);
  services.register(ServiceKeys.Settings, {
    get: (key: string, fallback: unknown) => (settingsStore.has(key) ? settingsStore.get(key) : fallback),
    set: (key: string, value: unknown) => void settingsStore.set(key, value),
  } as unknown as SettingsService);
  services.register(ServiceKeys.Workspace, {
    currentFolder: () => 'C:/proj',
    folders: () => [{ root: 'C:/proj' }, { root: 'C:/lib' }],
  } as unknown as WorkspaceService);
  const layout = { showToast: () => undefined } as unknown as LayoutManager;
  const context: ModuleContext = { services, commands, layout, subscriptions: [] };
  return { context, outputs, settingsStore, getInserted: () => inserted };
}

function manifest(permissions: string[]): ExtensionManifest {
  return parseExtensionManifest({
    name: 'API Test',
    publisher: 'acme',
    version: '1.0.0',
    engines: { znxstudio: '^1.0.0' },
    permissions,
    contributes: {},
  }).manifest!;
}

describe('ExtensionApi — 11B surface', () => {
  test('output channel prefixes and forwards lines', () => {
    const { context, outputs } = harness();
    const api = createExtensionApi(manifest(['output']), context);
    const channel = api.window.createOutputChannel('Main');
    channel.appendLine('hello');
    expect(outputs).toEqual(['[acme.api-test:Main] hello']);
  });

  test('editor access reads and inserts through the editor service', () => {
    const { context, getInserted } = harness();
    const api = createExtensionApi(manifest(['editor']), context);
    expect(api.editor.activeFile()).toBe('C:/proj/a.zx');
    expect(api.editor.activeText()).toBe('source text');
    expect(api.editor.selectedText()).toBe('selected');
    api.editor.insertText('new code');
    expect(getInserted()).toBe('new code');
  });

  test('workspace folders returns all roots', () => {
    const { context } = harness();
    const api = createExtensionApi(manifest(['workspace']), context);
    expect(api.workspace.folders()).toEqual(['C:/proj', 'C:/lib']);
  });

  test('storage persists per-extension via the settings service', () => {
    const { context, settingsStore } = harness();
    const api = createExtensionApi(manifest(['storage']), context);
    expect(api.storage.get('count', 0)).toBe(0);
    api.storage.set('count', 3);
    expect(api.storage.get('count', 0)).toBe(3);
    expect(api.storage.keys()).toEqual(['count']);
    expect(settingsStore.has('ext.acme.api-test.storage')).toBe(true);
  });

  test('capabilities are gated on declared permissions', () => {
    const { context } = harness();
    const api = createExtensionApi(manifest(['commands']), context); // no editor/output/storage
    let threwEditor = false;
    let threwOutput = false;
    let threwStorage = false;
    try {
      api.editor.activeText();
    } catch {
      threwEditor = true;
    }
    try {
      api.window.createOutputChannel('x');
    } catch {
      threwOutput = true;
    }
    try {
      api.storage.get('k', 0);
    } catch {
      threwStorage = true;
    }
    expect(threwEditor).toBe(true);
    expect(threwOutput).toBe(true);
    expect(threwStorage).toBe(true);
  });
});
