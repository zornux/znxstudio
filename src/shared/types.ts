/**
 * Cross-process domain types shared between the main process, the preload
 * bridge and the renderer. Keep this file free of any runtime imports so it
 * can be consumed from every process without side effects.
 */
import type { CompilerCheckOutcome, CompilerDiagnostic } from './compilerProtocol';
import type { CompilerProfile } from './compilerProfiler';
import type { DependencyGraphSnapshot } from './dependencyGraph';
import type { PackageCommandResult } from './packageProtocol';
import type { AiCompletionRequest, AiCompletionResult } from './ai/providers';
import type { CrashRecord, ProcessSnapshot, SessionState } from './health';
import type { ZornuxInfo } from './toolchain/contracts';
import type { TrustState } from './workspaceTrust';
import type { UpdateChannel, UpdateStatus } from './update';
import type {
  ValidatedExtension,
  InstalledExtensionSummary,
  LoadEnabledResult,
} from './extensions/registry';

export type { PackageCommandResult, PackageDiagnostic } from './packageProtocol';

export type FileNodeType = 'file' | 'directory';

export interface FileNode {
  name: string;
  path: string;
  type: FileNodeType;
  /** Populated lazily by the explorer when a directory is expanded. */
  children?: FileNode[];
}

export interface AppInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: NodeJS.Platform | string;
  /** True when launched with ZNXSTUDIO_SELFTEST=1 (headless architecture self-test). */
  selftest: boolean;
  /**
   * Max number of module self-tests allowed to run at once, from
   * ZORNUX_SELFTEST_CONCURRENCY (default 1). Gating to 1 keeps the unawaited
   * per-module self-tests from stampeding the compiler/adapter subprocesses.
   */
  selftestConcurrency: number;
  /** OS temp directory — a repo-safe scratch location for generated programs (8C). */
  tempDir: string;
  /** User home directory — used to read ~/.ssh/config for remote envs (13F). */
  homeDir: string;
  /**
   * Cross-platform root of the Zornux example programs the headless self-tests
   * read from. Resolved from ZORNUX_EXAMPLES_DIR, else a sibling `xojin/examples`
   * next to the app; empty string when unavailable (self-tests then skip rather
   * than fail on a hardcoded, platform-specific path).
   */
  examplesDir: string;
  /**
   * Cross-platform root of the Zoijs frontend documentation project the preview /
   * Zoijs self-tests read from. Resolved from ZORNUX_ZOIJS_DOCS_DIR, else a sibling
   * `Xornux frontend documentation` next to the app; '' when unavailable.
   */
  zoijsDocsDir: string;
}

/* ----- Project model ----- */

/** Detected classification of an opened workspace. */
export type WorkspaceType =
  | 'zornux-api'
  | 'zornux-mobile'
  | 'zoijs-frontend'
  | 'zornux-zoijs-fullstack'
  | 'generic';

export interface ZnxStudioProjectWorkspace {
  sourceDirs?: string[];
  generatedDirs?: string[];
  configFiles?: string[];
}

/** Typed model of a `znxstudio.project.json` manifest. */
export interface ZnxStudioProject {
  name: string;
  type: string;
  version: string;
  scripts?: Record<string, string>;
  languageTargets?: string[];
  frameworkTargets?: string[];
  extensionRequirements?: string[];
  workspace?: ZnxStudioProjectWorkspace;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface ProjectDiagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  hint?: string;
}

/** Result of loading + validating an opened folder. Never throws to the renderer. */
export interface WorkspaceInfo {
  root: string;
  isZnxStudioProject: boolean;
  project: ZnxStudioProject | null;
  detectedType: WorkspaceType;
  diagnostics: ProjectDiagnostic[];
}

export interface CreateProjectOptions {
  name: string;
  location: string;
  type?: string;
}

export interface CreatedProject {
  path: string;
  name: string;
}

/* ----- Terminal ----- */
export type { ShellProfile } from './terminal/shells';
export interface TerminalCreateOptions {
  id: string;
  cwd?: string;
  cols?: number;
  rows?: number;
  /** Which discovered shell to launch; falls back to the platform default. */
  shellId?: string;
  /**
   * Launch this program directly in the PTY instead of an interactive shell
   * (Run in Terminal). When set, `shellId` is ignored and the pane closes when
   * the program exits. The real TTY is what makes interactive stdin — e.g. a
   * `read_line(...)` prompt — work.
   */
  command?: string;
  args?: string[];
}
export interface TerminalDataEvent {
  id: string;
  data: string;
}
export interface TerminalExitEvent {
  id: string;
  exitCode: number;
}

/* ----- Tasks ----- */
export interface TaskRunOptions {
  id: string;
  command: string;
  cwd: string;
}
export interface TaskOutputEvent {
  id: string;
  stream: 'stdout' | 'stderr';
  data: string;
}
export interface TaskExitEvent {
  id: string;
  code: number | null;
}

/* ----- Compiler (Zornux CLI) ----- */

/** Where the located compiler executable came from. */
export type CompilerLocationSource = 'env' | 'bundled' | 'default' | 'path' | 'none';

/** Availability + identity of the Zornux compiler on this machine. */
export interface CompilerInfo {
  available: boolean;
  path: string | null;
  version: string | null;
  source: CompilerLocationSource;
}

/**
 * A request to check a single document. The renderer sends the live buffer so
 * unsaved edits are checked; the main process checks the real file on disk when
 * the buffer is clean (best fidelity), else a temp copy of the buffer.
 */
export interface CompilerCheckRequest {
  /** Document uri — echoed for the renderer to correlate; ignored by the CLI. */
  uri: string;
  /** Real filesystem path, or null for an untitled/in-memory buffer. */
  path: string | null;
  /** Current buffer text. */
  source: string;
  /** Whether the buffer has unsaved edits (drives real-file vs temp-copy). */
  isDirty: boolean;
  /** Workspace root, used as the CLI working directory when present. */
  workspaceRoot?: string | null;
  /** Optional explicit compiler path override (from settings). */
  compilerPath?: string | null;
}

/** Result of a single compiler check. Never throws to the renderer. */
export interface CompilerCheckResult {
  /** True when the compiler was located and successfully spawned. */
  available: boolean;
  /** True when the check actually ran (exit 0 or 1). */
  ran: boolean;
  outcome: CompilerCheckOutcome | 'unavailable';
  exitCode: number | null;
  diagnostics: CompilerDiagnostic[];
  durationMs: number;
  /** True when the result was served from the incremental cache (no subprocess). */
  cached: boolean;
  /** Populated when the check could not run (stderr / spawn / usage message). */
  error?: string;
}

/** A request to compile a single entry file to a `.zxbc` build artifact. */
export interface CompilerBuildRequest {
  /** Absolute path of the entry file to build. */
  path: string;
  /** Workspace root, used as the CLI working directory when present. */
  workspaceRoot?: string | null;
  /** Optional explicit compiler path override (from settings). */
  compilerPath?: string | null;
}

/** Result of a build. Never throws to the renderer. */
export interface CompilerBuildResult {
  available: boolean;
  /** True when the build actually ran (exit 0 or 1). */
  ran: boolean;
  /** True when the build succeeded with no errors (exit 0). */
  ok: boolean;
  outcome: CompilerCheckOutcome | 'unavailable';
  exitCode: number | null;
  diagnostics: CompilerDiagnostic[];
  /** Path to the produced `.zxbc` artifact, or null when the build failed. */
  artifact: string | null;
  durationMs: number;
  /** True when the result was served from the incremental cache (no subprocess). */
  cached: boolean;
  error?: string;
}

/** A whole-project (module-aware) check over a source directory. */
export interface CompilerCheckProjectRequest {
  /** Absolute source directory to check (compiler links all .zx under it). */
  sourceDir: string;
  workspaceRoot?: string | null;
  compilerPath?: string | null;
}

/** Persistent compile-cache status (Phase 3F). */
export interface CompilerCacheStats {
  enabled: boolean;
  entries: number;
  bytes: number;
}

/* ----- Debugger (DAP) ----- */

/** A requested breakpoint (1-based line, matching DAP). */
export interface DebugBreakpointInput {
  line: number;
  condition?: string;
}

/** All breakpoints requested for one source file. */
export interface DebugSourceBreakpoints {
  path: string;
  lines: DebugBreakpointInput[];
}

/** The adapter's verdict for one breakpoint. */
export interface DebugVerifiedBreakpoint {
  verified: boolean;
  line?: number;
  message?: string;
}

/** The adapter's verdicts for one source file (parallel to the requested lines). */
export interface DebugSourceVerified {
  path: string;
  breakpoints: DebugVerifiedBreakpoint[];
}

export interface DebugLaunchConfig {
  /** Absolute path to the .zx entry file to debug (may be '' when attaching). */
  program: string;
  compilerPath?: string | null;
  engine?: 'interpreter' | 'vm';
  workspaceRoot?: string | null;
  /** Local transport for a spawned adapter: piped stdio (default) or a TCP socket. */
  transport?: 'stdio' | 'tcp';
  /** When set, attach to a remote DAP server over TCP instead of spawning one. */
  connection?: { host: string; port: number };
  /** Breakpoints to install before launch (so the first run can stop). */
  breakpoints?: DebugSourceBreakpoints[];
  /**
   * DAP exception-breakpoint filters (`all` / `uncaught`), installed before
   * launch. An EMPTY array means "never break on an error" and is meaningful;
   * `undefined` means "do not send the request", which leaves the adapter on its
   * own default. Honoured from Zornux rc.4 — earlier adapters accept the request
   * and ignore it.
   */
  exceptionFilters?: string[];
}

export interface DebugStartResult {
  success: boolean;
  /** DAP `initialize` capabilities, when the session started. */
  capabilities?: Record<string, unknown>;
  /** The adapter's verified breakpoints for the installed sources. */
  breakpoints?: DebugSourceVerified[];
  error?: string;
}

export interface DebugRequestResult {
  success: boolean;
  body?: unknown;
  message?: string;
}

/** A forwarded DAP event (initialized, stopped, terminated, …). */
export interface DebugEventMessage {
  event: string;
  body?: unknown;
}

/** The adapter process exited. */
export interface DebugClosedMessage {
  code: number | null;
}

/* ----- Dependency graph ----- */
export interface GraphBuildRequest {
  /** Workspace root (absolute). */
  root: string;
  /** Absolute directory scanned recursively for .zx module files. */
  sourceDir: string;
}

/** Function returned by event subscriptions to detach the listener. */
export type Unsubscribe = () => void;

/* ----- Source control (Phase 12) ----- */

/** A raw `git` invocation. The main process always runs the `git` binary. */
export interface GitExecRequest {
  /** Arguments passed to `git` (no shell; each element is a literal argv entry). */
  args: string[];
  /** Working directory the command runs in. */
  cwd: string;
}

export interface GitExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** An allowlisted deployment CLI invocation (Phase 13). */
export interface ToolExecRequest {
  /** Tool name (must be on the main-process allowlist). */
  tool: string;
  args: string[];
  cwd: string;
}

/* ----- Language server (LSP) ----- */

/** How to launch the `zornux lsp` server. */
export interface LspStartConfig {
  /** Explicit path to the zornux CLI (blank = auto-detect). */
  compilerPath?: string | null;
  /** Workspace root as a file:// URI (enables cross-file project features), or null for per-document mode. */
  rootUri?: string | null;
  /** Workspace root path used as the server process cwd. */
  rootPath?: string | null;
  /**
   * The `zornux` settings block the server reads from `initializationOptions`
   * (and again from `workspace/didChangeConfiguration`). `security: true` makes
   * it publish ZX37xx security findings alongside compiler diagnostics.
   */
  settings?: ZornuxLspSettings;
}

/** The server's `zornux` settings block (`ConfigurationProvider.ServerConfiguration`). */
export interface ZornuxLspSettings {
  /** Include security-analyzer findings in published diagnostics. Off by default. */
  security?: boolean;
  /** Maximum diagnostics per document. Server default is 100. */
  maxProblems?: number;
}

/** Result of starting the language server (from the LSP `initialize` handshake). */
export interface LspStartResult {
  success: boolean;
  error?: string;
  /** The server's advertised capabilities (raw LSP ServerCapabilities). */
  capabilities?: Record<string, unknown>;
  serverInfo?: { name: string; version?: string };
}

/** Result of an LSP request pass-through. */
export interface LspRequestResult {
  ok: boolean;
  /** The JSON-RPC `result` (may be null when the server has no answer). */
  result?: unknown;
  /** A JSON-RPC error object, or a transport-level error string. */
  error?: { code: number; message: string } | string;
}

/** A raw LSP position (0-based line/character, UTF-16 code units). */
export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

/** A raw LSP diagnostic as published by the server. */
export interface LspRawDiagnostic {
  range: LspRange;
  /** 1=Error, 2=Warning, 3=Information, 4=Hint. */
  severity?: number;
  /** The ZX#### code (a string from `zornux lsp`). */
  code?: string | number;
  source?: string;
  message: string;
}

/** A `textDocument/publishDiagnostics` notification, forwarded to the renderer. */
export interface LspDiagnosticsMessage {
  uri: string;
  diagnostics: LspRawDiagnostic[];
}

/** The language server process ended. */
export interface LspClosedMessage {
  code: number | null;
}

/* ----- Package manager (Phase 5D) ----- */

/** A `zornux` package operation to run in a project directory. */
export interface PackageCommandRequest {
  command: 'add' | 'remove' | 'restore' | 'registry';
  /** Project root the command runs in (its cwd). */
  cwd: string;
  /** Positional args, e.g. ["MathTools@1.2.0"] for add, ["MathTools"] for remove. */
  args: string[];
  /** Registry name to scope an add to (maps to --registry). */
  registry?: string;
  compilerPath?: string | null;
}

/* ----- Package browsing / registries (Phase 5E) ----- */

/**
 * A read-oriented `zornux` package query (search / info / registry list /
 * publish). Returns the raw process result; the renderer parses the text with
 * the pure `packageQuery` helpers (results are text, not JSON).
 */
export interface PackageQueryRequest {
  command: 'search' | 'info' | 'registry' | 'publish';
  cwd: string;
  args: string[];
  registry?: string;
  compilerPath?: string | null;
}

export interface PackageQueryResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/* ----- Environment / configuration profiles (Phase 5F) ----- */

/** A `zornux config <show|validate>` invocation for the active profile. */
export interface ConfigQueryRequest {
  subcommand: 'show' | 'validate';
  /** The .zx entry file that declares the `configuration` block(s). */
  file: string;
  /** Environment profile name (development / testing / staging / production). */
  profile: string;
  /** Directory the command runs in (config layer files are resolved beside the entry). */
  cwd: string;
  compilerPath?: string | null;
}

export interface ConfigQueryResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/* ----- Project templates / scaffolding (Phase 5G) ----- */

/** One file to write, path relative to the project directory (forward slashes). */
export interface ScaffoldFile {
  path: string;
  content: string;
}

/** A request to scaffold a new project from a rendered template. */
export interface ScaffoldRequest {
  name: string;
  /** Parent directory; the project is created at `<location>/<name>`. */
  location: string;
  /** Run the real `zornux init` first (authoritative zornux.project). */
  runZornuxInit: boolean;
  /** Files written after init (may override init's placeholders). */
  files: ScaffoldFile[];
  compilerPath?: string | null;
  /** Copy the ZoiJS runtime into this relative directory (e.g. "vendor/zoijs" or "web/vendor/zoijs"). */
  vendorZoijsDir?: string;
}

export interface ScaffoldResult {
  ok: boolean;
  /** Absolute path of the created project directory. */
  path: string;
  name: string;
  /** Set when ok is false. */
  error?: string;
}

/* ----- Live Preview (Phase 6G) ----- */

export interface PreviewStartResult {
  ok: boolean;
  /** Base URL the preview iframe loads (e.g. http://127.0.0.1:PORT/). */
  url?: string;
  /** Resolved served root directory. */
  root?: string;
  error?: string;
}

/* ----- Find in Files / Symbols (Phase 7A) ----- */

export interface SearchTextRequest {
  root: string;
  query: string;
  isRegex?: boolean;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  maxResults?: number;
}

export interface SearchMatch {
  /** 0-based line. */
  line: number;
  text: string;
  /** Match ranges within the line as [start, end). */
  ranges: [number, number][];
}

export interface SearchFileResult {
  file: string;
  matches: SearchMatch[];
}

export interface SearchTextResult {
  files: SearchFileResult[];
  totalMatches: number;
  filesScanned: number;
  truncated: boolean;
}

export interface SearchSymbolRequest {
  root: string;
  query: string;
  maxResults?: number;
}

export interface SearchSymbolHit {
  name: string;
  kind: string;
  file: string;
  line: number;
  col: number;
}

export interface SearchSymbolResult {
  symbols: SearchSymbolHit[];
  truncated: boolean;
}

/* Replace (Phase 7B) */
export interface SearchReplaceRequest extends SearchTextRequest {
  replacement: string;
}

export interface ReplaceMatch {
  line: number;
  text: string;
  newText: string;
  ranges: [number, number][];
}

export interface ReplaceFileResult {
  file: string;
  matches: ReplaceMatch[];
}

export interface SearchReplacePreview {
  files: ReplaceFileResult[];
  totalMatches: number;
  filesScanned: number;
  truncated: boolean;
}

export interface SearchApplyRequest extends SearchReplaceRequest {
  /** Apply only to these files (e.g. the closed ones the renderer didn't edit in-model). */
  files?: string[];
}

export interface SearchApplyResult {
  filesChanged: number;
  replacements: number;
}

/** Optional dev proxy so the served frontend can call the backend same-origin (Phase 6H). */
export interface PreviewProxy {
  /** Path prefix routed to the backend, e.g. "/api". */
  prefix: string;
  /** Backend base URL, e.g. "http://localhost:8080". */
  target: string;
}

/** The window's own state (Phase 17C). */
export interface WindowState {
  fullScreen: boolean;
  maximized: boolean;
  focused: boolean;
}

/* ----------------------------------------------- Collaboration (Phase 16) */

/**
 * A collaboration session is served by the HOST'S OWN IDE over a plain TCP
 * socket — there is no ZnxStudio cloud and nothing is relayed. Traffic is not
 * encrypted, so the default binding is loopback.
 */
export interface CollabHostOptions {
  token: string;
  /** Defaults to 127.0.0.1. Pass 0.0.0.0 to expose the session on the LAN. */
  host?: string;
  /** 0 asks the OS for a free port, reported back in the result. */
  port?: number;
}

export interface CollabHostResult {
  ok: boolean;
  host?: string;
  port?: number;
  loopbackOnly?: boolean;
  error?: string;
}

export interface CollabJoinOptions {
  host: string;
  port: number;
  token: string;
  name: string;
}

export interface CollabJoinResult {
  ok: boolean;
  error?: string;
}

export interface CollabMessageEvent {
  peerId: string;
  payload: unknown;
}

export interface CollabPeerJoinedEvent {
  peerId: string;
  name: string;
}

export interface CollabPeerLeftEvent {
  peerId: string;
}

export interface CollabClosedEvent {
  reason: string;
}

/* ----- Mobile (Android) ----- */

export interface AndroidDevice {
  id: string;
  name: string;
  type: 'physical' | 'emulator';
  apiLevel: string | null;
  status: 'device' | 'offline' | 'unauthorized';
}

export interface AndroidEmulator {
  name: string;
  apiLevel: string | null;
}

export interface MobileDoctorResult {
  ok: boolean;
  checks: { name: string; passed: boolean; detail: string }[];
}

export interface MobileRunStatus {
  running: boolean;
  deviceId: string | null;
}

export interface MobileLogEvent {
  line: string;
}

export interface MobileDebugConfig {
  deviceId: string;
  workspaceRoot: string;
}

export interface MobileDebugStatus {
  active: boolean;
  deviceId: string | null;
  state: 'idle' | 'launching' | 'running' | 'stopped' | 'terminated' | 'error';
}

export interface MobileDebugEvent {
  type: 'stopped' | 'continued' | 'terminated' | 'output';
  file?: string;
  line?: number;
  reason?: string;
  screenName?: string;
  message?: string;
}

export interface MobileTestConfig {
  workspaceRoot: string;
  filter?: string;
  deviceId?: string;
  verbose?: boolean;
}

export interface MobileTestResultItem {
  name: string;
  passed: boolean;
  message?: string;
  file?: string;
  line?: number;
  durationMs?: number;
}

export interface MobileTestReport {
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
  results: MobileTestResultItem[];
}

/* ----- Android Toolchain Management ----- */

export interface ToolchainComponent {
  name: string;
  required: boolean;
  installed: boolean;
  version: string | null;
  requiredVersion: string | null;
  updateAvailable: boolean;
}

export interface ToolchainStatus {
  ready: boolean;
  managedPath: string | null;
  components: ToolchainComponent[];
}

export interface ToolchainSetupProgress {
  step: string;
  progress: number;
  complete: boolean;
  error: string | null;
}

/* ----- Mobile Profile (Android) ----- */

export interface MobileProfileConfig {
  workspaceRoot: string;
  deviceId?: string;
  durationMs?: number;
}

export interface MobileProfileMetric {
  name: string;
  value: number;
  unit: string;
  budget?: number;
  file?: string;
  line?: number;
}

export interface MobileProfileTimelineEvent {
  timestampMs: number;
  name: string;
  durationMs?: number;
  category: string;
}

export interface MobileProfileReport {
  durationMs: number;
  metrics: MobileProfileMetric[];
  events: MobileProfileTimelineEvent[];
}

export interface MobileProfileEvent {
  type: 'metric' | 'complete' | 'error';
  name?: string;
  value?: number;
  unit?: string;
  file?: string;
  line?: number;
  message?: string;
}

/* ----- Mobile Build (Android) ----- */

export interface MobileBuildConfig {
  workspaceRoot: string;
  mode: 'debug' | 'release';
  format: 'apk' | 'aab';
}

export interface MobileBuildResult {
  success: boolean;
  artifactPath: string | null;
  artifactSizeBytes: number | null;
  diagnostics: string[];
}

export interface MobileBuildProgress {
  phase: string;
  message: string;
}

/* ----- Mobile Release (Android) ----- */

export interface MobileReleaseIssue {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
}

export interface MobileReleaseCheckResult {
  ready: boolean;
  applicationId: string | null;
  version: string | null;
  versionCode: number | null;
  signing: { configured: boolean; detail: string } | null;
  issues: MobileReleaseIssue[];
}

/* ----- Mobile Session State ----- */

export type MobileSessionState =
  | 'idle'
  | 'preparing'
  | 'building'
  | 'running'
  | 'debugging'
  | 'testing'
  | 'profiling'
  | 'stopping'
  | 'failed';

/* ----- Android Project Config ----- */

export interface AndroidProjectConfig {
  applicationId: string;
  version: string;
  versionCode?: number;
  minSdk: number;
  targetSdk: number;
  compileSdk: number;
  permissions: string[];
}

export interface MobileSigningConfig {
  keystorePath: string;
  alias: string;
  passwordEnvVar: string;
}

/**
 * The typed surface exposed to the renderer via `window.znxstudio`.
 * This is the ONLY channel the renderer uses to reach the OS/filesystem.
 */
export interface ZnxStudioApi {
  app: {
    getInfo(): Promise<AppInfo>;
    /** Open a second main window (File → New Window). */
    newWindow(): Promise<void>;
  };
  shell: {
    /** Open an http(s) url in the user's default browser. */
    openExternal(url: string): Promise<void>;
    /** Reveal a workspace file/folder in the OS file manager (Explorer/Finder). */
    showItemInFolder(path: string): Promise<void>;
  };
  dialog: {
    openFolder(): Promise<string | null>;
    /** Pick a single file to open; null if cancelled. */
    openFile(): Promise<string | null>;
    /** Pick a destination and write explicit user-provided content there. */
    saveFile(defaultPath: string, content: string): Promise<string | null>;
  };
  fs: {
    readDirectory(path: string): Promise<FileNode[]>;
    readFile(path: string): Promise<string>;
    writeFile(path: string, content: string): Promise<void>;
    /** Whether a path still exists as a directory — used to prune stale recents. */
    directoryExists(path: string): Promise<boolean>;
    /** Whether a path exists at all (file or directory) — used to reject duplicates. */
    pathExists(path: string): Promise<boolean>;
    /** Create a directory (and any missing parents). */
    createDirectory(path: string): Promise<void>;
    /** Rename/move a file or directory. */
    rename(from: string, to: string): Promise<void>;
    /** Delete a file or directory (recursively). */
    delete(path: string): Promise<void>;
  };
  project: {
    create(options: CreateProjectOptions): Promise<CreatedProject>;
    scaffold(request: ScaffoldRequest): Promise<ScaffoldResult>;
  };
  workspace: {
    load(folder: string): Promise<WorkspaceInfo>;
  };
  terminal: {
    /** Discover the shells installed on this machine (bash, PowerShell, cmd, …). */
    shells(): Promise<import('./terminal/shells').ShellProfile[]>;
    create(options: TerminalCreateOptions): Promise<void>;
    input(id: string, data: string): void;
    resize(id: string, cols: number, rows: number): void;
    dispose(id: string): void;
    onData(callback: (event: TerminalDataEvent) => void): Unsubscribe;
    onExit(callback: (event: TerminalExitEvent) => void): Unsubscribe;
  };
  settings: {
    read(): Promise<Record<string, unknown>>;
    write(settings: Record<string, unknown>): Promise<void>;
    filePath(): Promise<string>;
  };
  task: {
    run(options: TaskRunOptions): Promise<void>;
    kill(id: string): void;
    onOutput(callback: (event: TaskOutputEvent) => void): Unsubscribe;
    onExit(callback: (event: TaskExitEvent) => void): Unsubscribe;
  };
  /** Workspace Trust (Phase 20J WI1) — gates every execution path. */
  trust: {
    state(): Promise<TrustState>;
    setWorkspace(roots: string[]): Promise<TrustState>;
    trustWorkspace(): Promise<TrustState>;
    trustParent(): Promise<TrustState>;
    revoke(): Promise<TrustState>;
    continueRestricted(): Promise<TrustState>;
    onChanged(callback: (state: TrustState) => void): Unsubscribe;
  };
  compiler: {
    info(): Promise<CompilerInfo>;
    check(request: CompilerCheckRequest): Promise<CompilerCheckResult>;
    build(request: CompilerBuildRequest): Promise<CompilerBuildResult>;
    checkProject(request: CompilerCheckProjectRequest): Promise<CompilerCheckResult>;
    cacheStats(): Promise<CompilerCacheStats>;
    cacheClear(): Promise<CompilerCacheStats>;
    cacheConfig(enabled: boolean): Promise<CompilerCacheStats>;
    profile(): Promise<CompilerProfile>;
    profileReset(): Promise<CompilerProfile>;
    /** Reformat source with the real `zornux format`; null if the compiler is unavailable. */
    format(request: { source: string; cwd?: string }): Promise<string | null>;
  };
  toolchain: {
    /** Negotiate product/protocol versions + capabilities for the resolved (or overridden) toolchain. */
    info(override?: string | null): Promise<ZornuxInfo>;
  };
  graph: {
    build(request: GraphBuildRequest): Promise<DependencyGraphSnapshot>;
  };
  packages: {
    run(request: PackageCommandRequest): Promise<PackageCommandResult>;
    query(request: PackageQueryRequest): Promise<PackageQueryResult>;
  };
  config: {
    query(request: ConfigQueryRequest): Promise<ConfigQueryResult>;
  };
  window: {
    getState(): Promise<WindowState>;
    setFullScreen(fullScreen: boolean): Promise<WindowState>;
    toggleMaximize(): Promise<WindowState>;
    minimize(): Promise<void>;
    /** Close the focused window (File → Exit); routes through the unsaved-changes guard. */
    close(): Promise<void>;
    /** The main process asks before closing so unsaved work can be saved (Phase 20J WI2). */
    onQueryClose(callback: () => void): Unsubscribe;
    /** Tell the main process it is safe to close the window now. */
    confirmClose(): void;
    /** Tell the main process the user cancelled the close — keep the window open and unsaved work intact. */
    cancelClose(): void;
    /** Set the webContents zoom factor (Phase 20J WI4 UI zoom). */
    setZoom(factor: number): Promise<void>;
  };
  /** Auto-update (Phase 20J WI3). */
  update: {
    check(options: { channel: UpdateChannel }): Promise<UpdateStatus>;
    download(): Promise<UpdateStatus | null>;
    install(): Promise<UpdateStatus | null>;
    /** Restore the previously-installed version and relaunch (last-known-good). */
    rollback(): Promise<UpdateStatus | null>;
    status(): Promise<UpdateStatus | null>;
    onStatus(callback: (status: UpdateStatus) => void): Unsubscribe;
  };
  /** Logging (Phase 19D). Lines arrive already REDACTED; main only writes them. */
  log: {
    append(lines: string[]): Promise<void>;
    read(limit?: number): Promise<string[]>;
    path(): Promise<string>;
    clear(): Promise<void>;
  };
  /**
   * Crash detection + real process metrics (Phase 19B/19C). Local only: the log
   * is a file, the metrics are Electron's own. Nothing here opens a socket.
   */
  diagnostics: {
    session(): Promise<SessionState>;
    recordCrash(record: CrashRecord): Promise<void>;
    acknowledgeCrash(): Promise<void>;
    processMetrics(): Promise<ProcessSnapshot>;
  };
  collab: {
    host(options: CollabHostOptions): Promise<CollabHostResult>;
    join(options: CollabJoinOptions): Promise<CollabJoinResult>;
    send(payload: unknown): Promise<void>;
    sendTo(peerId: string, payload: unknown): Promise<void>;
    leave(): Promise<void>;
    onMessage(callback: (message: CollabMessageEvent) => void): Unsubscribe;
    onPeerJoined(callback: (event: CollabPeerJoinedEvent) => void): Unsubscribe;
    onPeerLeft(callback: (event: CollabPeerLeftEvent) => void): Unsubscribe;
    onClosed(callback: (event: CollabClosedEvent) => void): Unsubscribe;
  };
  preview: {
    start(root: string, proxy?: PreviewProxy): Promise<PreviewStartResult>;
    stop(): Promise<void>;
  };
  search: {
    text(request: SearchTextRequest): Promise<SearchTextResult>;
    symbols(request: SearchSymbolRequest): Promise<SearchSymbolResult>;
    previewReplace(request: SearchReplaceRequest): Promise<SearchReplacePreview>;
    applyReplace(request: SearchApplyRequest): Promise<SearchApplyResult>;
    files(root: string): Promise<string[]>;
  };
  debug: {
    start(config: DebugLaunchConfig): Promise<DebugStartResult>;
    request(command: string, args?: unknown): Promise<DebugRequestResult>;
    stop(): Promise<void>;
    onEvent(callback: (event: DebugEventMessage) => void): Unsubscribe;
    onClosed(callback: (event: DebugClosedMessage) => void): Unsubscribe;
  };
  ai: {
    /** Run a completion against the configured provider (main performs the fetch). */
    complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
    /** A tiny liveness/auth ping for the given config (validates the connection). */
    probe(request: AiCompletionRequest): Promise<AiCompletionResult>;
    /**
     * Stream a completion: `onDelta` fires per text chunk, `onDone` with the final
     * result. Returns a cancel function (asks main to abort; `onDone` still fires).
     */
    completeStream(
      request: AiCompletionRequest,
      callbacks: { onDelta(delta: string): void; onDone(result: AiCompletionResult): void },
    ): () => void;
  };
  marketplace: {
    /** Search the live marketplace for extensions (returns raw catalog cards). */
    search(params: { query?: string; page?: number; perPage?: number; sort?: string }): Promise<{ items: unknown[]; total: number }>;
    /** Full asset detail for one extension. */
    detail(publisher: string, slug: string): Promise<unknown>;
    /** Install: main verifies integrity + validates, returns the data-only contribution model. */
    install(publisher: string, slug: string, version: string): Promise<ValidatedExtension>;
    uninstall(publisher: string, slug: string, version: string): Promise<void>;
    setEnabled(publisher: string, slug: string, version: string, enabled: boolean): Promise<void>;
    listInstalled(): Promise<InstalledExtensionSummary[]>;
    /** Enabled extensions to apply at startup (+ quarantined records). */
    loadEnabled(): Promise<LoadEnabledResult>;
  };
  git: {
    /** Run the real `git` binary and return its raw result. */
    exec(request: GitExecRequest): Promise<GitExecResult>;
  };
  github: {
    /** Run the `gh` CLI (may be unavailable — surfaces as a non-zero exit). */
    exec(request: GitExecRequest): Promise<GitExecResult>;
  };
  tool: {
    /** Run an allowlisted deployment CLI (docker/kubectl/cloud). */
    exec(request: ToolExecRequest): Promise<GitExecResult>;
  };
  lsp: {
    start(config: LspStartConfig): Promise<LspStartResult>;
    /** Send an LSP request and await its response (pass-through). */
    request(method: string, params?: unknown): Promise<LspRequestResult>;
    /** Send an LSP notification (fire-and-forget: didOpen/didChange/didClose…). */
    notify(method: string, params?: unknown): void;
    stop(): Promise<void>;
    onDiagnostics(callback: (message: LspDiagnosticsMessage) => void): Unsubscribe;
    onClosed(callback: (message: LspClosedMessage) => void): Unsubscribe;
  };
  /** Mobile development (Android). Available when `zornux mobile` is present. */
  mobile: {
    devices(): Promise<AndroidDevice[]>;
    selectDevice(id: string): Promise<void>;
    emulators(): Promise<AndroidEmulator[]>;
    startEmulator(name: string): Promise<void>;
    doctor(platform: string): Promise<MobileDoctorResult>;
    runStart(deviceId: string, workspaceRoot: string): Promise<void>;
    runStop(): Promise<void>;
    status(): Promise<MobileRunStatus>;
    onLogs(callback: (event: MobileLogEvent) => void): Unsubscribe;
    debugStart(config: MobileDebugConfig): Promise<void>;
    debugStop(): Promise<void>;
    debugStatus(): Promise<MobileDebugStatus>;
    onDebugEvent(callback: (event: MobileDebugEvent) => void): Unsubscribe;
    testRun(config: MobileTestConfig): Promise<MobileTestReport>;
    testStop(): Promise<void>;
    onTestResult(callback: (result: MobileTestReport) => void): Unsubscribe;
    profileStart(config: MobileProfileConfig): Promise<void>;
    profileStop(): Promise<MobileProfileReport>;
    onProfileEvent(callback: (event: MobileProfileEvent) => void): Unsubscribe;
    buildApk(config: MobileBuildConfig): Promise<MobileBuildResult>;
    buildAab(config: MobileBuildConfig): Promise<MobileBuildResult>;
    buildStop(): Promise<void>;
    onBuildProgress(callback: (progress: MobileBuildProgress) => void): Unsubscribe;
    releaseCheck(workspaceRoot: string): Promise<MobileReleaseCheckResult>;
    clean(workspaceRoot: string): Promise<void>;
    sessionState(): Promise<MobileSessionState>;
    onSessionState(callback: (state: MobileSessionState) => void): Unsubscribe;
    projectConfig(workspaceRoot: string): Promise<AndroidProjectConfig | null>;
    updateProjectConfig(workspaceRoot: string, config: Partial<AndroidProjectConfig>): Promise<void>;
  };
  /** Android toolchain management. */
  androidToolchain: {
    status(): Promise<ToolchainStatus>;
    setup(): Promise<void>;
    onSetupProgress(callback: (progress: ToolchainSetupProgress) => void): Unsubscribe;
    sdkList(): Promise<ToolchainComponent[]>;
    sdkInstall(component: string): Promise<void>;
    update(): Promise<void>;
  };

  /** Sandboxed command execution for the AI agent (Phase 10L). */
  agentExec: {
    run(request: import('./ai/agentExec').AgentExecRequest): Promise<import('./ai/agentExec').AgentExecResult>;
    cancel(execId: string): void;
  };
}
