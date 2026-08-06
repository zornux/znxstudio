import {
  ServiceKeys,
  type EditorService,
  type OutputService,
  type SettingsService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import type { ModuleContext } from '../core/Module';
import type { ExtensionManifest } from '../../shared/extensions/manifest';
import { SDK_VERSION } from '../../shared/extensions/manifest';
import type { Disposable, ExtensionContext } from './sdk';

/**
 * Builds the SDK facade (`ExtensionContext`) over the workbench's ModuleContext
 * for one extension. Two guarantees enforced here: commands are namespaced under
 * the extension id (no global-namespace squatting), and every capability beyond
 * plain command execution is gated on the manifest's declared permissions.
 */
/** Optional diagnostics sink so the SDK logger feeds the manager's debug view (11F). */
export interface ApiLogSink {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export function createExtensionApi(
  manifest: ExtensionManifest,
  context: ModuleContext,
  sink?: ApiLogSink,
): ExtensionContext {
  const subscriptions: Disposable[] = [];
  const status = context.services.tryGet<StatusService>(ServiceKeys.Status);
  const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
  const output = context.services.tryGet<OutputService>(ServiceKeys.Output);
  const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
  const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
  const permissions = new Set(manifest.permissions);
  const storageKey = `ext.${manifest.id}.storage`;

  const require = (permission: string, capability: string): void => {
    if (!permissions.has(permission)) {
      throw new Error(`Extension "${manifest.id}" used ${capability} without the "${permission}" permission.`);
    }
  };

  const track = (disposable: Disposable): Disposable => {
    subscriptions.push(disposable);
    return disposable;
  };

  const logger = {
    info: (message: string) => {
      console.info(`[ext:${manifest.id}] ${message}`);
      sink?.log('info', message);
    },
    warn: (message: string) => {
      console.warn(`[ext:${manifest.id}] ${message}`);
      sink?.log('warn', message);
    },
    error: (message: string) => {
      console.error(`[ext:${manifest.id}] ${message}`);
      sink?.log('error', message);
    },
  };

  return {
    extensionId: manifest.id,
    sdkVersion: SDK_VERSION,
    subscriptions,
    logger,
    commands: {
      register: (command, handler, title) => {
        require('commands', 'commands.register');
        if (command !== manifest.id && !command.startsWith(`${manifest.id}.`)) {
          throw new Error(`Command "${command}" must be namespaced under "${manifest.id}.".`);
        }
        return track(context.commands.register(command, handler as never, title ?? command));
      },
      execute: (command, ...args) => context.commands.execute(command, ...args),
    },
    window: {
      showInformationMessage: (message) => {
        require('notifications', 'window.showInformationMessage');
        context.layout.showToast(message, 'info');
      },
      showErrorMessage: (message) => {
        require('notifications', 'window.showErrorMessage');
        context.layout.showToast(message, 'error');
      },
      setStatusBarItem: (id, item) => {
        require('statusBar', 'window.setStatusBarItem');
        const fullId = `ext.${manifest.id}.${id}`;
        status?.setItem(fullId, { text: item.text, tooltip: item.tooltip, command: item.command, side: 'left', priority: 5 });
        return track({ dispose: () => status?.removeItem(fullId) });
      },
      createOutputChannel: (name) => {
        require('output', 'window.createOutputChannel');
        const prefix = `[${manifest.id}:${name}] `;
        return {
          append: (text) => output?.append(text),
          appendLine: (line) => output?.appendLine(`${prefix}${line}`),
          clear: () => output?.clear(),
          show: () => output?.show(),
        };
      },
    },
    workspace: {
      currentFolder: () => {
        require('workspace', 'workspace.currentFolder');
        return workspace?.currentFolder() ?? null;
      },
      folders: () => {
        require('workspace', 'workspace.folders');
        return (workspace?.folders() ?? []).map((f) => f.root);
      },
      readFile: (path) => {
        require('workspace', 'workspace.readFile');
        return window.znxstudio.fs.readFile(path);
      },
    },
    editor: {
      activeFile: () => {
        require('editor', 'editor.activeFile');
        return editor?.currentFile() ?? null;
      },
      activeText: () => {
        require('editor', 'editor.activeText');
        return editor?.activeText() ?? null;
      },
      selectedText: () => {
        require('editor', 'editor.selectedText');
        return editor?.selectedText() ?? '';
      },
      insertText: (text) => {
        require('editor', 'editor.insertText');
        editor?.insertText(text);
      },
      onDidChangeActiveFile: (handler) => {
        require('editor', 'editor.onDidChangeActiveFile');
        const disposable = editor?.onDidChangeActiveFile(handler) ?? { dispose: () => undefined };
        return track(disposable);
      },
    },
    storage: {
      get: (key, fallback) => {
        require('storage', 'storage.get');
        const store = (settings?.get<Record<string, unknown>>(storageKey, {}) ?? {}) as Record<string, unknown>;
        return (key in store ? store[key] : fallback) as typeof fallback;
      },
      set: (key, value) => {
        require('storage', 'storage.set');
        const store = { ...(settings?.get<Record<string, unknown>>(storageKey, {}) ?? {}) };
        store[key] = value;
        settings?.set(storageKey, store);
      },
      keys: () => {
        require('storage', 'storage.keys');
        return Object.keys(settings?.get<Record<string, unknown>>(storageKey, {}) ?? {});
      },
    },
  };
}
