import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannels } from '../shared/ipc';
import type {
  TerminalDataEvent,
  TerminalExitEvent,
  TaskOutputEvent,
  TaskExitEvent,
  DebugEventMessage,
  DebugClosedMessage,
  LspDiagnosticsMessage,
  LspClosedMessage,
  CollabMessageEvent,
  CollabPeerJoinedEvent,
  CollabPeerLeftEvent,
  CollabClosedEvent,
  MobileLogEvent,
  Unsubscribe,
  ZnxStudioApi,
} from '../shared/types';
import type { TrustState } from '../shared/workspaceTrust';
import type { UpdateStatus } from '../shared/update';
import type { AiCompletionResult } from '../shared/ai/providers';

/** Subscribe to a main→renderer channel and return a detach function. */
function subscribe<T>(channel: string, callback: (payload: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/** Monotonic id so concurrent streams don't cross their delta/done events. */
let aiStreamSeq = 0;

/**
 * The context bridge. Exposes a single, typed `window.znxstudio` object to the
 * renderer. Nothing else from Node/Electron leaks into the page.
 */
const api: ZnxStudioApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IpcChannels.AppGetInfo),
    newWindow: () => ipcRenderer.invoke(IpcChannels.AppNewWindow),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke(IpcChannels.ShellOpenExternal, url),
    showItemInFolder: (path) => ipcRenderer.invoke(IpcChannels.ShellShowItemInFolder, path),
  },
  dialog: {
    openFolder: () => ipcRenderer.invoke(IpcChannels.DialogOpenFolder),
    openFile: () => ipcRenderer.invoke(IpcChannels.DialogOpenFile),
    saveFile: (defaultPath, content) => ipcRenderer.invoke(IpcChannels.DialogSaveFile, defaultPath, content),
  },
  fs: {
    readDirectory: (path) => ipcRenderer.invoke(IpcChannels.FsReadDirectory, path),
    readFile: (path) => ipcRenderer.invoke(IpcChannels.FsReadFile, path),
    writeFile: (path, content) => ipcRenderer.invoke(IpcChannels.FsWriteFile, path, content),
    directoryExists: (path) => ipcRenderer.invoke(IpcChannels.FsDirectoryExists, path),
    pathExists: (path) => ipcRenderer.invoke(IpcChannels.FsPathExists, path),
    createDirectory: (path) => ipcRenderer.invoke(IpcChannels.FsCreateDirectory, path),
    rename: (from, to) => ipcRenderer.invoke(IpcChannels.FsRename, from, to),
    delete: (path) => ipcRenderer.invoke(IpcChannels.FsDelete, path),
  },
  project: {
    create: (options) => ipcRenderer.invoke(IpcChannels.ProjectCreate, options),
    scaffold: (request) => ipcRenderer.invoke(IpcChannels.ProjectScaffold, request),
  },
  workspace: {
    load: (folder) => ipcRenderer.invoke(IpcChannels.WorkspaceLoad, folder),
  },
  terminal: {
    shells: () => ipcRenderer.invoke(IpcChannels.TerminalShells),
    create: (options) => ipcRenderer.invoke(IpcChannels.TerminalCreate, options),
    input: (id, data) => ipcRenderer.send(IpcChannels.TerminalInput, { id, data }),
    resize: (id, cols, rows) => ipcRenderer.send(IpcChannels.TerminalResize, { id, cols, rows }),
    dispose: (id) => ipcRenderer.send(IpcChannels.TerminalDispose, { id }),
    onData: (callback) => subscribe<TerminalDataEvent>(IpcChannels.TerminalData, callback),
    onExit: (callback) => subscribe<TerminalExitEvent>(IpcChannels.TerminalExit, callback),
  },
  settings: {
    read: () => ipcRenderer.invoke(IpcChannels.SettingsRead),
    write: (settings) => ipcRenderer.invoke(IpcChannels.SettingsWrite, settings),
    filePath: () => ipcRenderer.invoke(IpcChannels.SettingsPath),
  },
  trust: {
    state: () => ipcRenderer.invoke(IpcChannels.TrustState),
    setWorkspace: (roots) => ipcRenderer.invoke(IpcChannels.TrustSetWorkspace, roots),
    trustWorkspace: () => ipcRenderer.invoke(IpcChannels.TrustWorkspace),
    trustParent: () => ipcRenderer.invoke(IpcChannels.TrustParent),
    revoke: () => ipcRenderer.invoke(IpcChannels.TrustRevoke),
    continueRestricted: () => ipcRenderer.invoke(IpcChannels.TrustRestricted),
    onChanged: (callback) => subscribe<TrustState>(IpcChannels.TrustChanged, callback),
  },
  task: {
    run: (options) => ipcRenderer.invoke(IpcChannels.TaskRun, options),
    kill: (id) => ipcRenderer.send(IpcChannels.TaskKill, { id }),
    onOutput: (callback) => subscribe<TaskOutputEvent>(IpcChannels.TaskOutput, callback),
    onExit: (callback) => subscribe<TaskExitEvent>(IpcChannels.TaskExit, callback),
  },
  compiler: {
    info: () => ipcRenderer.invoke(IpcChannels.CompilerInfo),
    check: (request) => ipcRenderer.invoke(IpcChannels.CompilerCheck, request),
    build: (request) => ipcRenderer.invoke(IpcChannels.CompilerBuild, request),
    checkProject: (request) => ipcRenderer.invoke(IpcChannels.CompilerCheckProject, request),
    cacheStats: () => ipcRenderer.invoke(IpcChannels.CompilerCacheStats),
    cacheClear: () => ipcRenderer.invoke(IpcChannels.CompilerCacheClear),
    cacheConfig: (enabled) => ipcRenderer.invoke(IpcChannels.CompilerCacheConfig, enabled),
    profile: () => ipcRenderer.invoke(IpcChannels.CompilerProfile),
    profileReset: () => ipcRenderer.invoke(IpcChannels.CompilerProfileReset),
    format: (request) => ipcRenderer.invoke(IpcChannels.CompilerFormat, request),
  },
  toolchain: {
    info: (override) => ipcRenderer.invoke(IpcChannels.ToolchainInfo, override),
  },
  graph: {
    build: (request) => ipcRenderer.invoke(IpcChannels.GraphBuild, request),
  },
  packages: {
    run: (request) => ipcRenderer.invoke(IpcChannels.PackageRun, request),
    query: (request) => ipcRenderer.invoke(IpcChannels.PackageQuery, request),
  },
  config: {
    query: (request) => ipcRenderer.invoke(IpcChannels.ConfigQuery, request),
  },
  window: {
    getState: () => ipcRenderer.invoke(IpcChannels.WindowGetState),
    setFullScreen: (fullScreen) => ipcRenderer.invoke(IpcChannels.WindowSetFullScreen, fullScreen),
    toggleMaximize: () => ipcRenderer.invoke(IpcChannels.WindowToggleMaximize),
    minimize: () => ipcRenderer.invoke(IpcChannels.WindowMinimize),
    close: () => ipcRenderer.invoke(IpcChannels.WindowClose),
    onQueryClose: (callback) => subscribe<void>(IpcChannels.WindowQueryClose, () => callback()),
    confirmClose: () => ipcRenderer.send(IpcChannels.WindowConfirmClose),
    cancelClose: () => ipcRenderer.send(IpcChannels.WindowCancelClose),
    setZoom: (factor) => ipcRenderer.invoke(IpcChannels.WindowSetZoom, factor),
  },
  update: {
    check: (options) => ipcRenderer.invoke(IpcChannels.UpdateCheck, options),
    download: () => ipcRenderer.invoke(IpcChannels.UpdateDownload),
    install: () => ipcRenderer.invoke(IpcChannels.UpdateInstall),
    rollback: () => ipcRenderer.invoke(IpcChannels.UpdateRollback),
    status: () => ipcRenderer.invoke(IpcChannels.UpdateStatusGet),
    onStatus: (callback) => subscribe<UpdateStatus>(IpcChannels.UpdateStatusEvent, callback),
  },
  log: {
    append: (lines) => ipcRenderer.invoke(IpcChannels.LogAppend, lines),
    read: (limit) => ipcRenderer.invoke(IpcChannels.LogRead, limit),
    path: () => ipcRenderer.invoke(IpcChannels.LogPath),
    clear: () => ipcRenderer.invoke(IpcChannels.LogClear),
  },
  diagnostics: {
    session: () => ipcRenderer.invoke(IpcChannels.DiagSession),
    recordCrash: (record) => ipcRenderer.invoke(IpcChannels.DiagRecordCrash, record),
    acknowledgeCrash: () => ipcRenderer.invoke(IpcChannels.DiagAcknowledgeCrash),
    processMetrics: () => ipcRenderer.invoke(IpcChannels.DiagProcessMetrics),
  },
  collab: {
    host: (options) => ipcRenderer.invoke(IpcChannels.CollabHost, options),
    join: (options) => ipcRenderer.invoke(IpcChannels.CollabJoin, options),
    send: (payload) => ipcRenderer.invoke(IpcChannels.CollabSend, payload),
    sendTo: (peerId, payload) => ipcRenderer.invoke(IpcChannels.CollabSendTo, peerId, payload),
    leave: () => ipcRenderer.invoke(IpcChannels.CollabLeave),
    onMessage: (callback) => subscribe<CollabMessageEvent>(IpcChannels.CollabMessage, callback),
    onPeerJoined: (callback) => subscribe<CollabPeerJoinedEvent>(IpcChannels.CollabPeerJoined, callback),
    onPeerLeft: (callback) => subscribe<CollabPeerLeftEvent>(IpcChannels.CollabPeerLeft, callback),
    onClosed: (callback) => subscribe<CollabClosedEvent>(IpcChannels.CollabClosed, callback),
  },
  preview: {
    start: (root, proxy) => ipcRenderer.invoke(IpcChannels.PreviewStart, root, proxy),
    stop: () => ipcRenderer.invoke(IpcChannels.PreviewStop),
  },
  search: {
    text: (request) => ipcRenderer.invoke(IpcChannels.SearchText, request),
    symbols: (request) => ipcRenderer.invoke(IpcChannels.SearchSymbols, request),
    previewReplace: (request) => ipcRenderer.invoke(IpcChannels.SearchPreviewReplace, request),
    applyReplace: (request) => ipcRenderer.invoke(IpcChannels.SearchApplyReplace, request),
    files: (root) => ipcRenderer.invoke(IpcChannels.SearchFiles, root),
  },
  debug: {
    start: (config) => ipcRenderer.invoke(IpcChannels.DebugStart, config),
    request: (command, args) => ipcRenderer.invoke(IpcChannels.DebugRequest, { command, args }),
    stop: () => ipcRenderer.invoke(IpcChannels.DebugStop),
    onEvent: (callback) => subscribe<DebugEventMessage>(IpcChannels.DebugEvent, callback),
    onClosed: (callback) => subscribe<DebugClosedMessage>(IpcChannels.DebugClosed, callback),
  },
  ai: {
    complete: (request) => ipcRenderer.invoke(IpcChannels.AiComplete, request),
    probe: (request) => ipcRenderer.invoke(IpcChannels.AiProbe, request),
    completeStream: (request, callbacks) => {
      const id = `s${aiStreamSeq++}`;
      const onData = (_event: IpcRendererEvent, payload: { id: string; delta: string }) => {
        if (payload?.id === id) callbacks.onDelta(payload.delta);
      };
      const onDone = (_event: IpcRendererEvent, payload: { id: string; result: AiCompletionResult }) => {
        if (payload?.id !== id) return;
        ipcRenderer.removeListener(IpcChannels.AiStreamData, onData);
        ipcRenderer.removeListener(IpcChannels.AiStreamDone, onDone);
        callbacks.onDone(payload.result);
      };
      ipcRenderer.on(IpcChannels.AiStreamData, onData);
      ipcRenderer.on(IpcChannels.AiStreamDone, onDone);
      ipcRenderer.send(IpcChannels.AiStreamStart, { id, request });
      // Cancel: ask main to abort. The stream still resolves with a final
      // `AiStreamDone`, which detaches the listeners above.
      return () => ipcRenderer.send(IpcChannels.AiStreamCancel, { id });
    },
  },
  marketplace: {
    search: (params) => ipcRenderer.invoke(IpcChannels.MarketplaceSearch, params),
    detail: (publisher, slug) => ipcRenderer.invoke(IpcChannels.MarketplaceDetail, { publisher, slug }),
    install: (publisher, slug, version) =>
      ipcRenderer.invoke(IpcChannels.ExtensionsInstall, { publisher, slug, version }),
    uninstall: (publisher, slug, version) =>
      ipcRenderer.invoke(IpcChannels.ExtensionsUninstall, { publisher, slug, version }),
    setEnabled: (publisher, slug, version, enabled) =>
      ipcRenderer.invoke(IpcChannels.ExtensionsSetEnabled, { publisher, slug, version, enabled }),
    listInstalled: () => ipcRenderer.invoke(IpcChannels.ExtensionsList),
    loadEnabled: () => ipcRenderer.invoke(IpcChannels.ExtensionsLoadEnabled),
  },
  git: {
    exec: (request) => ipcRenderer.invoke(IpcChannels.GitExec, request),
  },
  github: {
    exec: (request) => ipcRenderer.invoke(IpcChannels.GhExec, request),
  },
  tool: {
    exec: (request) => ipcRenderer.invoke(IpcChannels.ToolExec, request),
  },
  lsp: {
    start: (config) => ipcRenderer.invoke(IpcChannels.LspStart, config),
    request: (method, params) => ipcRenderer.invoke(IpcChannels.LspRequest, { method, params }),
    notify: (method, params) => ipcRenderer.send(IpcChannels.LspNotify, { method, params }),
    stop: () => ipcRenderer.invoke(IpcChannels.LspStop),
    onDiagnostics: (callback) => subscribe<LspDiagnosticsMessage>(IpcChannels.LspDiagnostics, callback),
    onClosed: (callback) => subscribe<LspClosedMessage>(IpcChannels.LspClosed, callback),
  },
  mobile: {
    devices: () => ipcRenderer.invoke(IpcChannels.MobileDeviceList),
    selectDevice: (id) => ipcRenderer.invoke(IpcChannels.MobileDeviceSelect, id),
    emulators: () => ipcRenderer.invoke(IpcChannels.MobileEmulatorList),
    startEmulator: (name) => ipcRenderer.invoke(IpcChannels.MobileEmulatorStart, name),
    doctor: (platform) => ipcRenderer.invoke(IpcChannels.MobileDoctor, platform),
    runStart: (deviceId, workspaceRoot) => ipcRenderer.invoke(IpcChannels.MobileRunStart, deviceId, workspaceRoot),
    runStop: () => ipcRenderer.invoke(IpcChannels.MobileRunStop),
    status: () => ipcRenderer.invoke(IpcChannels.MobileRunStatus),
    onLogs: (callback) => subscribe<MobileLogEvent>(IpcChannels.MobileLogs, callback),
  },
};

contextBridge.exposeInMainWorld('znxstudio', api);
