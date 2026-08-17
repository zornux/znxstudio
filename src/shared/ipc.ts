/**
 * Canonical IPC channel names. Imported by both the main process (handlers)
 * and the preload bridge (invokers) so the two never drift apart.
 */
export const IpcChannels = {
  // Core
  AppGetInfo: 'app:getInfo',
  ShellOpenExternal: 'shell:openExternal',
  ShellShowItemInFolder: 'shell:showItemInFolder',
  DialogOpenFolder: 'dialog:openFolder',
  DialogOpenFile: 'dialog:openFile',
  DialogSaveFile: 'dialog:saveFile',
  AppNewWindow: 'app:new-window',
  FsDirectoryExists: 'fs:directoryExists',
  FsPathExists: 'fs:pathExists',
  FsReadDirectory: 'fs:readDirectory',
  FsReadFile: 'fs:readFile',
  FsWriteFile: 'fs:writeFile',
  FsCreateDirectory: 'fs:createDirectory',
  FsRename: 'fs:rename',
  FsDelete: 'fs:delete',
  ProjectCreate: 'project:create',
  WorkspaceLoad: 'workspace:load',

  // Terminal (streaming)
  TerminalShells: 'terminal:shells',
  TerminalCreate: 'terminal:create',
  TerminalInput: 'terminal:input',
  TerminalResize: 'terminal:resize',
  TerminalDispose: 'terminal:dispose',
  TerminalData: 'terminal:data',
  TerminalExit: 'terminal:exit',

  // Settings
  SettingsRead: 'settings:read',
  SettingsWrite: 'settings:write',
  SettingsPath: 'settings:path',

  // Tasks (run/build)
  TaskRun: 'task:run',
  TaskKill: 'task:kill',
  TaskOutput: 'task:output',
  TaskExit: 'task:exit',

  // Compiler (Zornux CLI)
  CompilerInfo: 'compiler:info',
  CompilerCheck: 'compiler:check',
  CompilerBuild: 'compiler:build',
  CompilerCheckProject: 'compiler:checkProject',
  CompilerCacheStats: 'compiler:cacheStats',
  CompilerCacheClear: 'compiler:cacheClear',
  CompilerCacheConfig: 'compiler:cacheConfig',
  CompilerProfile: 'compiler:profile',
  CompilerProfileReset: 'compiler:profileReset',
  CompilerFormat: 'compiler:format',

  // Toolchain negotiation (Integration Layer) — product/protocol versions + capabilities
  ToolchainInfo: 'toolchain:info',

  // Dependency graph
  GraphBuild: 'graph:build',

  // Debugger (DAP)
  DebugStart: 'debug:start',
  DebugRequest: 'debug:request',
  DebugStop: 'debug:stop',
  DebugEvent: 'debug:event',
  DebugClosed: 'debug:closed',

  // Package manager
  PackageRun: 'packages:run',
  PackageQuery: 'packages:query',
  ConfigQuery: 'config:query',
  ProjectScaffold: 'project:scaffold',
  PreviewStart: 'preview:start',
  PreviewStop: 'preview:stop',
  SearchText: 'search:text',
  SearchSymbols: 'search:symbols',
  SearchPreviewReplace: 'search:preview-replace',
  SearchApplyReplace: 'search:apply-replace',
  SearchFiles: 'search:files',

  // AI (vendor-neutral provider layer, Phase 10)
  AiComplete: 'ai:complete',
  AiProbe: 'ai:probe',
  // Streaming (Phase 10, modernization): event-based, not invoke.
  AiStreamStart: 'ai:stream-start',
  AiStreamCancel: 'ai:stream-cancel',
  AiStreamData: 'ai:stream-data',
  AiStreamDone: 'ai:stream-done',

  // Marketplace + extensions (live registry; main owns integrity + persistence).
  MarketplaceSearch: 'marketplace:search',
  MarketplaceDetail: 'marketplace:detail',
  ExtensionsInstall: 'extensions:install',
  ExtensionsUninstall: 'extensions:uninstall',
  ExtensionsSetEnabled: 'extensions:setEnabled',
  ExtensionsList: 'extensions:list',
  ExtensionsLoadEnabled: 'extensions:loadEnabled',

  // Source control (Phase 12) — runs the real `git` binary (+ optional `gh`)
  GitExec: 'git:exec',
  GhExec: 'gh:exec',

  // Deployment tools (Phase 13) — allowlisted docker/kubectl/cloud CLIs
  ToolExec: 'tool:exec',

  // Collaboration (Phase 16) — a TCP session the host's own IDE serves
  CollabHost: 'collab:host',
  CollabJoin: 'collab:join',
  CollabSend: 'collab:send',
  CollabSendTo: 'collab:send-to',
  CollabLeave: 'collab:leave',
  CollabMessage: 'collab:message',
  CollabPeerJoined: 'collab:peer-joined',
  CollabPeerLeft: 'collab:peer-left',
  CollabClosed: 'collab:closed',

  // Window management (Phase 17C)
  WindowGetState: 'window:get-state',
  WindowSetFullScreen: 'window:set-fullscreen',
  WindowToggleMaximize: 'window:toggle-maximize',
  WindowMinimize: 'window:minimize',
  WindowClose: 'window:close',
  WindowSetZoom: 'window:set-zoom',
  // Unsaved-changes close guard (Phase 20J WI2)
  WindowQueryClose: 'window:query-close',
  WindowConfirmClose: 'window:confirm-close',
  WindowCancelClose: 'window:cancel-close',

  // Diagnostics, logging and local-only telemetry (Phase 19).
  // Nothing here reaches the network: the log is a file, the metrics are Electron's own.
  LogAppend: 'log:append',
  LogRead: 'log:read',
  LogPath: 'log:path',
  LogClear: 'log:clear',
  DiagSession: 'diagnostics:session',
  DiagRecordCrash: 'diagnostics:record-crash',
  DiagAcknowledgeCrash: 'diagnostics:acknowledge-crash',
  DiagProcessMetrics: 'diagnostics:process-metrics',

  // Auto-update (Phase 20J WI3)
  UpdateCheck: 'update:check',
  UpdateDownload: 'update:download',
  UpdateInstall: 'update:install',
  UpdateRollback: 'update:rollback',
  UpdateStatusGet: 'update:status',
  UpdateStatusEvent: 'update:status-event',

  // Workspace Trust (Phase 20J WI1) — gates every execution path
  TrustState: 'trust:state',
  TrustSetWorkspace: 'trust:set-workspace',
  TrustWorkspace: 'trust:trust',
  TrustParent: 'trust:trust-parent',
  TrustRevoke: 'trust:revoke',
  TrustRestricted: 'trust:restricted',
  TrustChanged: 'trust:changed',

  // Mobile development (Android)
  MobileDeviceList: 'mobile:devices',
  MobileDeviceSelect: 'mobile:select-device',
  MobileEmulatorList: 'mobile:emulators',
  MobileEmulatorStart: 'mobile:start-emulator',
  MobileDoctor: 'mobile:doctor',
  MobileLogs: 'mobile:logs',
  MobileRunStart: 'mobile:run-start',
  MobileRunStop: 'mobile:run-stop',
  MobileRunStatus: 'mobile:run-status',
  MobileDebugStart: 'mobile:debug-start',
  MobileDebugStop: 'mobile:debug-stop',
  MobileDebugStatus: 'mobile:debug-status',
  MobileDebugEvent: 'mobile:debug-event',
  MobileTestRun: 'mobile:test-run',
  MobileTestStop: 'mobile:test-stop',
  MobileTestResult: 'mobile:test-result',

  // Language server (LSP)
  LspStart: 'lsp:start',
  LspRequest: 'lsp:request',
  LspNotify: 'lsp:notify',
  LspStop: 'lsp:stop',
  LspDiagnostics: 'lsp:diagnostics',
  LspClosed: 'lsp:closed',
} as const;

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels];
