import { SDK_VERSION } from '../../shared/extensions/manifest';

/**
 * The public ZnxStudio Extension SDK (Phase 11A). This is the ONLY surface a
 * third-party extension is written against — a curated facade, deliberately
 * decoupled from the workbench internals (ServiceRegistry, LayoutManager, Monaco).
 * Keeping this narrow is what lets the internals evolve without breaking plugins,
 * and is the seam the sandbox (11C) will enforce.
 */

export { SDK_VERSION };

export interface Disposable {
  dispose(): void;
}

export type ExtensionCommandHandler = (...args: unknown[]) => unknown;

export interface ExtensionStatusItem {
  text: string;
  tooltip?: string;
  /** A command id to run on click. */
  command?: string;
}

export interface ExtensionLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** The command bus, scoped so an extension can only register under its own id. */
export interface ExtensionCommands {
  /**
   * Register a command. The id MUST be namespaced under the extension id
   * (`<extensionId>.<name>`) — the facade rejects anything else.
   */
  register(command: string, handler: ExtensionCommandHandler, title?: string): Disposable;
  /** Execute any command by id (extensions may invoke core commands too). */
  execute<T = unknown>(command: string, ...args: unknown[]): Promise<T>;
}

export interface ExtensionWindow {
  showInformationMessage(message: string): void;
  showErrorMessage(message: string): void;
  /** Add/replace a status-bar item owned by this extension. */
  setStatusBarItem(id: string, item: ExtensionStatusItem): Disposable;
  /** Create a named output channel (requires the `output` permission). */
  createOutputChannel(name: string): ExtensionOutputChannel;
}

export interface ExtensionWorkspace {
  /** The primary open folder, or null. Read-only. */
  currentFolder(): string | null;
  /** All open workspace folder roots. */
  folders(): string[];
  /** Read a file's text (requires the `workspace` permission). */
  readFile(path: string): Promise<string>;
}

/** A named output sink surfaced in the IDE's Output panel. */
export interface ExtensionOutputChannel {
  append(text: string): void;
  appendLine(line: string): void;
  clear(): void;
  show(): void;
}

/** Read-mostly access to the active editor (requires the `editor` permission). */
export interface ExtensionEditor {
  activeFile(): string | null;
  activeText(): string | null;
  selectedText(): string;
  /** Insert text at the cursor, replacing any selection. */
  insertText(text: string): void;
  onDidChangeActiveFile(handler: (file: string | null) => void): Disposable;
}

/** A per-extension persisted key/value store (requires the `storage` permission). */
export interface ExtensionStorage {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  keys(): string[];
}

/**
 * Everything an extension receives at `activate`. Capabilities beyond `commands`
 * are gated on the manifest `permissions` — an ungranted namespace throws.
 */
export interface ExtensionContext {
  readonly extensionId: string;
  readonly sdkVersion: string;
  /** Disposables torn down automatically when the extension deactivates. */
  readonly subscriptions: Disposable[];
  readonly commands: ExtensionCommands;
  readonly window: ExtensionWindow;
  readonly workspace: ExtensionWorkspace;
  readonly editor: ExtensionEditor;
  readonly storage: ExtensionStorage;
  readonly logger: ExtensionLogger;
}

/** The shape an extension's entry module exports. */
export interface ZnxStudioExtension {
  activate(context: ExtensionContext): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
