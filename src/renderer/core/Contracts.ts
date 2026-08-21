import type { Event } from './Emitter';
import type {
  CompilerBuildRequest,
  CompilerBuildResult,
  CompilerCacheStats,
  CompilerCheckProjectRequest,
  CompilerCheckRequest,
  CompilerCheckResult,
  CompilerInfo,
  DebugRequestResult,
  DebugSourceBreakpoints,
  DebugSourceVerified,
  WorkspaceInfo,
} from '../../shared/types';
import type { DependencyGraphSnapshot } from '../../shared/dependencyGraph';
import type { CompilerProfile } from '../../shared/compilerProfiler';
import type { ZornuxInfo } from '../../shared/toolchain/contracts';
import type { ProtocolCompatibility } from '../../shared/toolchain/negotiation';
import type { EnvironmentProfile } from '../../shared/environmentProfiles';
import type { TrustState as TrustStateContract } from '../../shared/workspaceTrust';
import type {
  AiCompletionResult,
  AiMessage,
  AiProviderConfig,
  AiProviderId,
} from '../../shared/ai/providers';
import type { MarketplaceEntry } from '../../shared/extensions/marketplace';
import type { GitExecResult } from '../../shared/types';
import type { GitFileStatus } from '../scm/gitStatus';
import type { GitHubRepo, GitRemote } from '../scm/github';
import type { PullRequest } from '../scm/pullRequests';
import type { Branch } from '../scm/branches';
import type { Commit, CommitFile } from '../scm/history';
import type { DeploymentProfile } from '../deploy/profiles';
import type { ProfileMode, ProfileReport, ProfilerEvent } from '../profiler/profile';
import type { ScanResult, SecurityFinding } from '../security/findings';
import type { SessionInfo } from '../collab/session';
import type { CollabFrame } from '../collab/CollabModule';
import type { OffsetEdit } from '../collab/ot';
import type { LayoutState } from '../layout/layoutModel';
import type { PanelPreferences } from '../layout/panels';
import type { Keybinding } from '../keybindings/keybindings';
import type { Snippet } from '../snippets/snippets';
import type { Disposable } from './Module';
import type { DocCoverage, DocOptions, DocResult, DocSummary } from '../docs/apiReference';
import type { LogLevel, LogRecord } from '../health/logging';
import type { BudgetVerdict, MetricSummary, ProcessSnapshot, StartupReport } from '../health/perf';
import type { CheckStatus, DiagnosticsReport } from '../health/diagnostics';
import type {
  ExerciseAttempt,
  LearningPack,
  LearningProgress,
  Lesson,
  PackProblem,
  Tutorial,
} from '../docs/learning';

/**
 * Service contracts + well-known service keys.
 *
 * Modules publish an implementation of a contract under a key, and consumers
 * resolve it by key. This is how the shell stays decoupled: nothing imports a
 * concrete module to talk to it — they share only these interfaces.
 */

export const ServiceKeys = {
  Editor: 'znxstudio.service.editor',
  Theme: 'znxstudio.service.theme',
  Settings: 'znxstudio.service.settings',
  Workspace: 'znxstudio.service.workspace',
  Output: 'znxstudio.service.output',
  Status: 'znxstudio.service.status',
  Compiler: 'znxstudio.service.compiler',
  Toolchain: 'znxstudio.service.toolchain',
  DependencyGraph: 'znxstudio.service.dependencyGraph',
  Debugger: 'znxstudio.service.debugger',
  Breakpoints: 'znxstudio.service.breakpoints',
  LanguageServer: 'znxstudio.service.languageServer',
  ProjectReferences: 'znxstudio.service.projectReferences',
  Profile: 'znxstudio.service.profile',
  Database: 'znxstudio.service.database',
  Ai: 'znxstudio.service.ai',
  Extensions: 'znxstudio.service.extensions',
  Marketplace: 'znxstudio.service.marketplace',
  Snippets: 'znxstudio.service.snippets',
  SourceControl: 'znxstudio.service.sourceControl',
  Deployment: 'znxstudio.service.deployment',
  Performance: 'znxstudio.service.performance',
  Security: 'znxstudio.service.security',
  Collab: 'znxstudio.service.collab',
  Layout: 'znxstudio.service.layout',
  Keybindings: 'znxstudio.service.keybindings',
  Docs: 'znxstudio.service.docs',
  ApiReference: 'znxstudio.service.apiReference',
  Learning: 'znxstudio.service.learning',
  Log: 'znxstudio.service.log',
  Telemetry: 'znxstudio.service.telemetry',
  Health: 'znxstudio.service.health',
  Explorer: 'znxstudio.service.explorer',
  Trust: 'znxstudio.service.trust',
  QuickPick: 'znxstudio.service.quickPick',
  InputBox: 'znxstudio.service.inputBox',
  Terminal: 'znxstudio.service.terminal',
  AiContext: 'znxstudio.service.aiContext',
  Simulator: 'znxstudio.service.simulator',
} as const;

/** A program to run in a new integrated-terminal tab. */
export interface TerminalRunOptions {
  /** Executable to launch (e.g. the resolved compiler path). */
  command: string;
  args?: string[];
  cwd?: string;
  /** Tab label; defaults to "Run". */
  label?: string;
}

/**
 * The integrated terminal, exposed so other modules (Run/Build) can run a
 * program in a real PTY tab — the only path with interactive stdin, so a
 * `read_line(...)` prompt can actually be typed into. Backed by node-pty;
 * `isAvailable()` is false when the native module can't load on this platform.
 */
export interface TerminalRunnerService {
  isAvailable(): boolean;
  /** Open a new terminal tab running `command`. Rejects if the PTY can't spawn. */
  runCommand(options: TerminalRunOptions): Promise<void>;
}

/** Options for {@link InputBoxService.prompt}. */
export interface InputBoxOptions {
  title: string;
  /** Field label shown above the input. */
  label?: string;
  /** Initial value (pre-selected). */
  value?: string;
  placeholder?: string;
  /** Confirm-button text (default "Create"). */
  submitLabel?: string;
  /** Live validator: return an error string to block submission, or null when valid. */
  validate?: (value: string) => string | null;
}

/** Options for {@link InputBoxService.confirm}. */
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
}

/**
 * A small modal dialog service: a single-line text prompt with live validation
 * and a yes/no confirm. Keyboard-operable and screen-reader labelled.
 */
export interface InputBoxService {
  prompt(options: InputBoxOptions): Promise<string | null>;
  confirm(options: ConfirmOptions): Promise<boolean>;
}

/** One selectable row in a {@link QuickPickService} overlay. */
export interface QuickPickItem<T = unknown> {
  /** Primary text shown for the row. */
  label: string;
  /** Muted secondary text shown to the right (e.g. an executable path). */
  description?: string;
  /** The value returned when this row is chosen. */
  value: T;
}

/** Options for a quick-pick overlay. */
export interface QuickPickOptions {
  /** Placeholder text in the filter input. */
  placeholder?: string;
}

/**
 * A command-palette-style chooser any module can invoke: a filterable, fully
 * keyboard-operable modal list rendered with the palette's look and ARIA. The
 * promise resolves to the chosen item's value, or `undefined` if dismissed.
 */
export interface QuickPickService {
  pick<T>(items: QuickPickItem<T>[], options?: QuickPickOptions): Promise<T | undefined>;
}

/**
 * A collapsible section contributed to the Explorer sidebar (UX-6): Open
 * Editors, Outline, Bookmarks, … stacked above the file tree. Contributors own
 * their `element` and keep it up to date; the Explorer only frames it with a
 * collapsible header and remembers the collapsed state.
 */
export interface ExplorerSection {
  id: string;
  title: string;
  /** Lower sorts higher. The file tree lives at 100, so sections default above it. */
  order: number;
  element: HTMLElement;
  /** Small header buttons (refresh, clear, …). */
  actions?: { icon: string; tooltip: string; run: () => void; commandId?: string }[];
  /** Initial collapsed state (a persisted user choice overrides it). */
  collapsed?: boolean;
}

/** The Explorer sidebar's section registry (UX-6). */
export interface ExplorerService {
  registerSection(section: ExplorerSection): void;
  removeSection(id: string): void;
  readonly onDidChange: Event<void>;
  /** The directory of the current context (right-clicked node or selection), else the first root. */
  contextDirectory(): string | null;
  /** Re-read a directory that's currently expanded in the tree (after a create/delete). */
  refreshDirectory(dirPath: string): Promise<void>;
  /** Expand ancestors of a path, then highlight + scroll it into view. */
  revealPath(path: string): Promise<void>;
}

/**
 * Workspace Trust (Phase 20J WI1). The renderer-side view of the authoritative
 * main-process trust state. Enforcement lives in the main process (every
 * execution IPC refuses in Restricted Mode); this service lets feature modules
 * reflect trust in their UI and check it before offering an action.
 */
export interface TrustService {
  /** Is the current workspace trusted (execution allowed)? */
  isTrusted(): boolean;
  /** The full trust state (roots, trusted folders, decided). */
  state(): TrustStateContract;
  /**
   * Guard an execution-requiring action: returns true when trusted; otherwise
   * shows the trust prompt and returns false so the caller aborts.
   */
  requireTrust(action: string): boolean;
  readonly onDidChange: Event<TrustStateContract>;
}

/**
 * Logging (Phase 19D). Messages are REDACTED at record time — secrets and the
 * user's home directory never reach the buffer, let alone the file.
 */
export interface LogService {
  log(level: LogLevel, source: string, message: string): void;
  trace(source: string, message: string): void;
  debug(source: string, message: string): void;
  info(source: string, message: string): void;
  warn(source: string, message: string): void;
  error(source: string, message: string): void;
  records(): LogRecord[];
  /** The last `limit` formatted, redacted lines — for the diagnostics report. */
  tail(limit?: number): string[];
  level(): LogLevel;
  setLevel(level: LogLevel): void;
  filePath(): Promise<string>;
  clear(): Promise<void>;
  readonly onDidChange: Event<void>;
}

/**
 * Performance telemetry (Phase 19C). **Local only** — the registry is in
 * memory, the process metrics are Electron's own, and nothing here uploads.
 */
export interface TelemetryService {
  record(metric: string, milliseconds: number): void;
  /** Time an operation; the duration is recorded even when it throws. */
  measure<T>(metric: string, operation: () => Promise<T>): Promise<T>;
  metrics(): MetricSummary[];
  startup(): StartupReport;
  budgets(): BudgetVerdict[];
  /** Electron's real per-process memory/CPU, or null when unavailable. */
  processMetrics(): Promise<ProcessSnapshot | null>;
  reset(): void;
  readonly onDidChange: Event<void>;
}

/**
 * IDE self-diagnostics (Phase 19A). A check that could not run reports
 * `unknown`, never `pass`.
 */
export interface HealthService {
  report(): Promise<DiagnosticsReport>;
  /** The same report as redacted Markdown, ready to paste into a bug tracker. */
  reportMarkdown(): Promise<string>;
  status(): Promise<CheckStatus>;
  readonly onDidChange: Event<void>;
}

/**
 * Where a document came from. `root` is the folder reads are CONFINED to; a
 * generated (in-memory) document has none, and therefore no relative links.
 */
export interface DocsSource {
  label: string;
  root: string | null;
}

/**
 * Documentation viewer (Phase 18A). One safe Markdown surface shared by the API
 * reference (18B), tutorials (18C), samples (18D) and the learning center (18E).
 */
export interface DocsService {
  /** Open `relativePath` beneath `source.root`. The path cannot escape the root. */
  openFile(source: DocsSource, relativePath: string): Promise<void>;
  /** Show Markdown held in memory (generated output, a lesson body). */
  openText(title: string, markdown: string, source?: DocsSource): void;
  /** Bring the viewer to the front without changing the document. */
  reveal(): void;
  current(): { title: string; path: string } | null;
  canGoBack(): boolean;
  canGoForward(): boolean;
  back(): void;
  forward(): void;
  readonly onDidChange: Event<void>;
}

/**
 * API reference (Phase 18B). Drives the REAL `zornux doc --json`, into a scratch
 * folder rather than the project. A null summary means the generator produced
 * nothing — which is not the same as an empty API surface.
 */
export interface ApiReferenceService {
  summary(): DocSummary | null;
  coverage(): DocCoverage | null;
  generate(target?: string, options?: Partial<DocOptions>): Promise<DocResult | null>;
  readonly onDidChange: Event<void>;
}

/**
 * Learning center (Phase 18E). Owns the curriculum loaded from a pack on disk
 * and the learner's progress. Exercises are graded by the REAL Zornux compiler:
 * `runExercise` returns null only when the compiler is unavailable, which is a
 * different thing from a wrong answer.
 */
export interface LearningService {
  pack(): LearningPack;
  /** Everything the pack got wrong. A dropped lesson is reported, not hidden. */
  problems(): PackProblem[];
  progress(): LearningProgress;
  /** The pack folder, or null when none was found. */
  root(): string | null;
  lesson(id: string): Lesson | null;
  tutorial(id: string): Tutorial | null;
  runExercise(lessonId: string, exerciseId: string, code: string): Promise<ExerciseAttempt | null>;
  markTutorialComplete(id: string): void;
  markLessonRead(id: string): void;
  reload(): Promise<void>;
  readonly onDidChange: Event<void>;
}

/**
 * The workbench arrangement (Phase 17A/17B). Owns the layout state, applies it to
 * the shell and persists it; layout profiles (17F) swap it wholesale.
 */
export interface LayoutService {
  layout(): LayoutState;
  panels(): PanelPreferences;
  setLayout(next: LayoutState): void;
  setPanelPreferences(next: PanelPreferences): void;
  readonly onDidChangeLayout: Event<LayoutState>;
}

/**
 * Keybindings (Phase 17D). Owns the one global key listener, resolves defaults
 * against the user's overrides, and dispatches commands.
 */
export interface KeybindingService {
  /** Defaults plus user overrides, in resolution order (user last). */
  bindings(): Keybinding[];
  /** Register a default binding for a command. Later registrations shadow earlier ones. */
  registerDefault(keys: string, command: string): void;
  /** Register an extension-contributed binding; dispose removes it. */
  registerExternal(keys: string, command: string): Disposable;
  /** Replace the user's overrides. Persisted. */
  setUserBindings(bindings: Record<string, string>): void;
  /** The keys bound to a command, canonical, for a menu or tooltip. */
  keysFor(command: string): string | null;
  readonly onDidChange: Event<void>;
}

/**
 * Collaboration hub (Phase 16). There is NO ZnxStudio cloud: the host's own IDE
 * binds a TCP port and guests connect straight to it, unencrypted, loopback by
 * default. Everything above the wire (documents, presence) rides these frames.
 */
export type CollabState = 'idle' | 'hosting' | 'joined';
export interface CollabService {
  session(): SessionInfo | null;
  state(): CollabState;
  /** This IDE's participant id within the session. */
  participantId(): string;
  /** False when the session admitted this participant read-only. */
  canWrite(): boolean;
  send(frame: CollabFrame): Promise<void>;
  /** Frames this hub does not handle itself (operations, presence, follow). */
  readonly onDidReceiveFrame: Event<{ peerId: string; frame: CollabFrame }>;
  readonly onDidChange: Event<void>;
}

/**
 * Security analysis hub (Phase 15). Runs the REAL `zornux check <file>
 * --security --json` CLI and shares the parsed findings with the Secrets,
 * Scanner, Dependencies, Rules and Dashboard views.
 *
 * `analyzed: false` on a result is load-bearing: the compiler runs the security
 * pass only once a program compiles, so a file with errors is UNANALYZED, never
 * "clean".
 */
export interface SecurityScanState {
  running: boolean;
  scope: 'file' | 'workspace' | null;
  /** How many files the last workspace scan covered. */
  scanned: number;
  error?: string;
}
export interface SecurityService {
  /** One result per file scanned, newest scan only. */
  results(): ScanResult[];
  /** Every finding across the last scan, most-severe first. */
  findings(): SecurityFinding[];
  state(): SecurityScanState;
  /** Scan one .zx file with the real CLI. */
  scanFile(file: string): Promise<ScanResult | null>;
  /** Scan every .zx file in the primary workspace folder. */
  scanWorkspace(): Promise<ScanResult[]>;
  readonly onDidChange: Event<void>;
}

/**
 * Performance profiling hub (Phase 14). Runs the REAL `zornux profile <mode>`
 * CLI and shares one captured report + trace with the five profiler views
 * (CPU / Memory / Timeline / Hotspots / Allocations).
 */
export interface ProfilerRunState {
  running: boolean;
  file: string | null;
  engine: 'interpreter' | 'vm';
  error?: string;
}
export interface ProfilerService {
  /** The last captured report (run/vm-run/allocations/heap/serve), or null. */
  report(): ProfileReport | null;
  /** The last captured trace events (timeline mode), or []. */
  events(): ProfilerEvent[];
  state(): ProfilerRunState;
  /** Profile the active .zx file with the real CLI. */
  profile(mode: ProfileMode): Promise<void>;
  readonly onDidChange: Event<void>;
}

/** Project context the Phase 13 generators build artifacts from. */
export interface DeploymentContext {
  projectName: string;
  root: string | null;
  entry: string;
  environment: string;
  registry: string;
  port: number;
  envVars: Record<string, string>;
}

/** A generator action contributed to the Deployment hub (Docker, K8s, CI, …). */
export interface DeployAction {
  id: string;
  label: string;
  group: string;
  command: string;
}

export interface ArtifactSaveResult {
  ok: boolean;
  path?: string;
  error?: string;
}

/**
 * Deployment hub (Phase 13). Owns deployment profiles + project context and
 * writes generated artifacts into the workspace. The 13B–13F generators read the
 * context, render a preview, and save through `saveArtifact`.
 */
export interface DeploymentService {
  profiles(): DeploymentProfile[];
  active(): DeploymentProfile | null;
  setActive(id: string): void;
  addProfile(profile: DeploymentProfile): void;
  removeProfile(id: string): void;
  context(): DeploymentContext;
  /** Write an artifact (relative path) into the workspace root. */
  saveArtifact(relPath: string, content: string): Promise<ArtifactSaveResult>;
  /** Contribute a generator action to the hub (called by 13B–13F). */
  registerAction(action: DeployAction): void;
  actions(): DeployAction[];
  readonly onDidChange: Event<void>;
}

/**
 * Source control (Phase 12). Backed by the real `git` binary in the main process;
 * grows across 12A–12F. Consumers resolve the repo state and issue operations
 * without knowing the CLI. `exec` is the low-level escape hatch for later phases.
 */
export interface GitCommitResult {
  ok: boolean;
  error?: string;
}
export interface SourceControlService {
  isRepo(): boolean;
  root(): string | null;
  branch(): string | null;
  status(): GitFileStatus[];
  refresh(): Promise<void>;
  stage(path: string): Promise<void>;
  unstage(path: string): Promise<void>;
  stageAll(): Promise<void>;
  commit(message: string): Promise<GitCommitResult>;
  /** Configured remotes (Phase 12B). */
  remotes(): GitRemote[];
  /** The detected GitHub repo, or null (Phase 12B). */
  gitHub(): GitHubRepo | null;
  /** Open pull requests via the `gh` CLI; empty when gh is unavailable (Phase 12C). */
  listPullRequests(): Promise<PullRequest[]>;
  /** GitHub "new pull request" URL for the current branch, or null (Phase 12C). */
  pullRequestUrl(): string | null;
  /** Run an arbitrary git command in the repo (used by later SCM phases). */
  exec(args: string[]): Promise<GitExecResult>;
  /** Run a `gh` CLI command in the repo (Phase 12C). */
  gh(args: string[]): Promise<GitExecResult>;
  /** Local + remote branches (Phase 12E). */
  branches(): Branch[];
  checkout(name: string): Promise<GitCommitResult>;
  createBranch(name: string): Promise<GitCommitResult>;
  deleteBranch(name: string): Promise<GitCommitResult>;
  mergeBranch(name: string): Promise<GitCommitResult>;
  /** Recent commits (Phase 12F). */
  log(limit?: number): Promise<Commit[]>;
  /** Files changed in a commit, with line counts (Phase 12F). */
  commitFiles(hash: string): Promise<CommitFile[]>;
  readonly onDidChange: Event<void>;
}

/** Lifecycle state of a registered extension (Phase 11A). */
export type ExtensionState = 'registered' | 'active' | 'failed' | 'incompatible';

/** A read-only view of a registered extension, for the manager UI + consumers. */
export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  publisher: string;
  description?: string;
  state: ExtensionState;
  error?: string;
  activationEvents: string[];
  commands: { command: string; title: string }[];
  /** Diagnostics (Phase 11F). */
  activationMs?: number;
  errorCount?: number;
  logs?: string[];
}

/** The installed-extensions registry (Phase 11A). */
export interface ExtensionService {
  list(): ExtensionInfo[];
  isActive(id: string): boolean;
  activate(id: string): Promise<boolean>;
  deactivate(id: string): Promise<void>;
  /** Deactivate then re-activate an extension (Phase 11F). */
  reload(id: string): Promise<boolean>;
  readonly onDidChange: Event<ExtensionInfo[]>;
}

/** A remote (live-marketplace) extension the user has installed. */
export interface RemoteInstalled {
  id: string;
  name: string;
  publisher: string;
  publisherHandle: string;
  slug: string;
  version: string;
  enabled: boolean;
}

/**
 * The extension marketplace. `catalog()` is the bundled sample set (sync); `search()`
 * queries the LIVE Zornux Marketplace (async). Installing a bundled entry registers its
 * code; installing a remote entry downloads + validates it in the main process and applies
 * its declarative contributions here. Both go through `install(entry)`.
 */
export interface MarketplaceService {
  catalog(): MarketplaceEntry[];
  isInstalled(id: string): boolean;
  install(entry: MarketplaceEntry): Promise<boolean>;
  uninstall(id: string): Promise<void>;
  readonly onDidChange: Event<void>;
  // --- live marketplace (remote) ---
  /** Search the live marketplace; returns mapped entries (empty on error — see lastError). */
  search(query: string): Promise<MarketplaceEntry[]>;
  /** Remote extensions currently installed (cached; drives the Installed section). */
  installedRemote(): RemoteInstalled[];
  /** Enable/disable an installed remote extension (applies/removes its contributions). */
  setRemoteEnabled(id: string, enabled: boolean): Promise<void>;
}

/** A workspace database connection with its resolved table schema (Phase 8). */
export interface DatabaseTableInfo {
  table: string;
  from: string;
  columns: string[];
}
export interface DatabaseConnectionInfo {
  name: string;
  provider: string;
  connection?: string;
  file: string;
  line: number;
  migrateOnOpen: boolean;
  tables: DatabaseTableInfo[];
}
/** The discovered database connections, consumed by the Query Console (8C) etc. */
export interface DatabaseService {
  connections(): DatabaseConnectionInfo[];
  readonly onDidChange: Event<DatabaseConnectionInfo[]>;
}

/** Options that adjust a single AI request without touching persisted settings. */
export interface AiRequestOptions {
  /** Prepended as a system message when the caller has not supplied one. */
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * The vendor-neutral AI facade (Phase 10). EVERY AI feature — chat, completion,
 * refactoring, docs, test-gen, debugging, architecture — goes through this one
 * interface, so the concrete provider (OpenAI / Anthropic / Google / Ollama /
 * Azure / custom / none) is a pure runtime choice made in settings. When no
 * provider is configured, `isEnabled()` is false and features degrade quietly.
 */
export interface AiService {
  /** True when a provider other than `none` is configured and ready. */
  isEnabled(): boolean;
  providerId(): AiProviderId;
  providerLabel(): string;
  /** The assembled config (key redacted responsibility stays with callers/logs). */
  config(): AiProviderConfig;
  /** Why the current config cannot run, or null when it is ready. */
  readiness(): string | null;
  /** Multi-turn completion against the configured provider. */
  complete(messages: AiMessage[], options?: AiRequestOptions): Promise<AiCompletionResult>;
  /** Streamed multi-turn completion: `onDelta` per chunk, `onDone` at the end; returns cancel. */
  completeStream(
    messages: AiMessage[],
    callbacks: { onDelta(delta: string): void; onDone(result: AiCompletionResult): void },
    options?: AiRequestOptions,
  ): () => void;
  /** Convenience single-shot prompt (+ optional system) for feature code. */
  ask(prompt: string, options?: AiRequestOptions): Promise<AiCompletionResult>;
  /** A cheap auth/liveness ping for the current config. */
  probe(): Promise<AiCompletionResult>;
  /** Open the provider picker (AI settings). */
  openSettings(): void;
  /** Fires when the provider/model/key changes. */
  readonly onDidChangeConfig: Event<AiProviderConfig>;
}

/**
 * Status of the `zornux lsp` language server. Other modules consult this so they
 * can stand down when the server is the authoritative diagnostics provider — e.g.
 * the Language Platform skips its subprocess `zornux check` while the server runs.
 */
export interface LanguageServerStatus {
  isRunning(): boolean;
}

/** A breakpoint glyph in the editor gutter (0-based line). */
export interface BreakpointGlyph {
  line: number;
  state: 'verified' | 'unverified' | 'conditional';
  hover?: string;
}

/** A 0-based editor selection range. An empty range (start === end) is a bare caret. */
export interface CursorSelection {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
}

/** An editor-agnostic decoration (0-based geometry). The editor renders it. */
export interface EditorDecoration {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  severity: 'error' | 'warning' | 'info' | 'hint';
  /** Message rendered inline at the end of the start line (error-lens style). */
  inlineMessage?: string;
  /** Tint the whole start line by severity. */
  wholeLine?: boolean;
}

/** One open editor tab, for the Open Editors view (UX-6). */
export interface OpenEditor {
  uri: string;
  path: string;
  name: string;
  dirty: boolean;
  pinned: boolean;
  preview: boolean;
  active: boolean;
}

export interface EditorService {
  /**
   * Open a file from disk into the editor surface. `preview` opens a reusable
   * "peek" tab (single-click / picker flows); omit it for a permanent tab. The
   * default is permanent, so existing callers are unchanged.
   */
  openFile(path: string, options?: { preview?: boolean }): Promise<void>;
  /** The open editor tabs, in tab order (Open Editors view). */
  openEditors(): OpenEditor[];
  /** Focus an already-open editor by uri. */
  activateEditor(uri: string): void;
  /** Close an open editor by uri (disposes its model). */
  closeEditor(uri: string): void;
  /** Confirm and temporarily lock affected editors for a filesystem mutation. */
  prepareEditorsForPath(path: string): Promise<{ commit(): void; cancel(): void } | null>;
  /** Fires when the set / order / dirty / pin state of open editors changes. */
  readonly onDidChangeEditors: Event<void>;
  /** Overlay an arbitrary DOM view (welcome, settings, …) over the editor. */
  showView(element: HTMLElement): void;
  /** Dismiss the overlay view (e.g. the welcome screen once a project is open). */
  hideView(): void;
  /** The reserved DOM bar between the tabs and the code, for breadcrumbs (Phase 7D). */
  breadcrumbHost(): HTMLElement;
  /** Move the editor caret to a 0-based position and center it. */
  revealPosition(line: number, character: number): void;
  /** Open the document identified by uri (a file uri) and reveal a 0-based position. */
  revealLocation(uri: string, line: number, character: number): Promise<void>;
  currentFile(): string | null;
  /** Uri (file uri) of the active document, or null. */
  currentUri(): string | null;
  /** 0-based caret position, or null when no editor/model is active. */
  cursorPosition(): { line: number; character: number } | null;
  /** Replace the decorations owned by `owner` on the active model. */
  setDecorations(owner: string, decorations: EditorDecoration[]): void;
  /** Remove the decorations owned by `owner`. */
  clearDecorations(owner: string): void;
  /** Fires (0-based line) when the user clicks the breakpoint gutter. */
  onDidClickGutter(handler: (line: number) => void): void;
  /** Render breakpoint glyphs in the gutter for the active model. */
  setBreakpointGlyphs(glyphs: BreakpointGlyph[]): void;
  /** Render bookmark glyphs (0-based lines) in the gutter for the active model (Phase 7E). */
  setBookmarkGlyphs(lines: number[]): void;
  /**
   * Highlight the debugger's current execution line (0-based) on the given file,
   * re-shown when that file is active; pass a null uri to clear it. `kind`
   * distinguishes a normal stop from an exception (rendered in red).
   */
  setExecutionPointer(uri: string | null, line?: number, kind?: 'step' | 'exception'): void;
  readonly onDidChangeActiveFile: Event<string | null>;
  /** Active selections (0-based), primary first. Empty ranges are bare carets. */
  getSelections(): CursorSelection[];
  /** Replace all cursors/selections (0-based); focuses the editor. No-op if empty. */
  setSelections(selections: CursorSelection[]): void;
  /** Full text of the active model, or null when no model is open. */
  activeText(): string | null;
  /** Total characters covered by the current selections. */
  selectedCharCount(): number;
  /** Run a built-in editor action by id (e.g. Monaco's multi-cursor actions). */
  runEditorAction(actionId: string): void;
  /** Insert a Monaco snippet (with `${1:…}` tab-stops) at the cursor (Phase 7F). */
  insertSnippet(body: string): void;
  /**
   * Apply edits given in CHARACTER OFFSETS against the current document, in one
   * undoable batch (Phase 16B). Offsets all refer to the document as it is now,
   * so a remote operation can be mirrored without re-deriving positions.
   */
  applyOffsetEdits(edits: OffsetEdit[]): void;
  /** Insert literal text at the cursor, replacing any selection (Phase 7H). */
  insertText(text: string): void;
  /** The primary selection's text, or '' when nothing is selected. */
  selectedText(): string;
  /** Subscribe to cursor/selection changes; receives the current selections. */
  onDidChangeSelections(handler: (selections: CursorSelection[]) => void): Disposable;
}

/** A validated, data-only theme contributed by a marketplace extension. */
export interface ExternalThemeData {
  id: string;
  label: string;
  type: 'light' | 'dark';
  /** `--z-*` CSS variable → hex color (already validated). */
  cssVars: Record<string, string>;
}

export interface ThemeService {
  apply(name: string): void;
  toggle(): void;
  current(): string;
  list(): string[];
  /** Register an extension-contributed theme; dispose removes it (reverting if active). */
  register(theme: ExternalThemeData): Disposable;
  readonly onDidChange: Event<string>;
}

/** Snippet registry (Phase: marketplace) — lets extensions contribute completion snippets. */
export interface SnippetService {
  /** Add extension snippets; dispose removes them from completion. */
  addExternal(snippets: Snippet[]): Disposable;
}

export interface SettingsChangeEvent {
  key: string;
  value: unknown;
  settings: Record<string, unknown>;
}

/** Where a setting is written: the global user store, or the open workspace. */
export type SettingScope = 'user' | 'workspace';

export interface SettingsService {
  /** The effective value: workspace override (if a folder is open) → user → fallback. */
  get<T>(key: string, fallback: T): T;
  /** Write a value. `scope` defaults to 'user'; 'workspace' overrides for the open folder only. */
  set<T>(key: string, value: T, scope?: SettingScope): void;
  applyAll(next: Record<string, unknown>): void;
  all(): Record<string, unknown>;
  readonly onDidChange: Event<SettingsChangeEvent>;
}

export interface WorkspaceService {
  /** Replace the workspace with a single folder ("Open Folder"). */
  openFolder(path?: string): Promise<void>;
  /** Add a folder to the workspace, keeping the others (multi-root, Phase 5A). */
  addFolder(path?: string): Promise<void>;
  /** Remove a folder from the workspace by its root path. */
  removeFolder(root: string): void;
  refresh(): Promise<void>;
  /** The primary root (first folder), for single-root consumers. */
  currentFolder(): string | null;
  /** The primary folder (first), for single-root consumers. */
  currentWorkspace(): WorkspaceInfo | null;
  /** Every open workspace folder. */
  folders(): WorkspaceInfo[];
  /** The open folder that owns `path` (longest matching root), or null. */
  folderContaining(path: string): WorkspaceInfo | null;
  /** Fires when the PRIMARY folder changes (single-root consumers). */
  readonly onDidChangeWorkspace: Event<WorkspaceInfo | null>;
  /** Fires whenever the set of open folders changes (multi-root consumers). */
  readonly onDidChangeFolders: Event<WorkspaceInfo[]>;
}

export interface OutputService {
  append(text: string): void;
  appendLine(text: string): void;
  clear(): void;
  show(): void;
}

export interface StatusItem {
  text: string;
  tooltip?: string;
  /** Command id executed on click. */
  command?: string;
  side?: 'left' | 'right';
  /** Lower priorities sort further left within a side. */
  priority?: number;
  /**
   * For CONTEXTUAL items (SB-2): `false` keeps the segment tracked but unmounted
   * (idle), `true`/undefined shows it. Ignored for always/hidden items.
   */
  active?: boolean;
  /** Auto-remove this item after N ms — for transient results (build ✓, task ✗). */
  autoHideMs?: number;
}

export interface StatusService {
  setItem(id: string, item: StatusItem): void;
  removeItem(id: string): void;
}

/**
 * The Zornux compiler, exposed to the renderer. The authoritative source of
 * diagnostics (and, in later phases, builds). Backed by the real CLI in the
 * main process; degrades to `available: false` when the compiler is absent.
 */
export interface CompilerService {
  info(refresh?: boolean): Promise<CompilerInfo>;
  check(request: CompilerCheckRequest): Promise<CompilerCheckResult>;
  build(request: CompilerBuildRequest): Promise<CompilerBuildResult>;
  checkProject(request: CompilerCheckProjectRequest): Promise<CompilerCheckResult>;
  cacheStats(): Promise<CompilerCacheStats>;
  cacheClear(): Promise<CompilerCacheStats>;
  cacheConfig(enabled: boolean): Promise<CompilerCacheStats>;
  profile(): Promise<CompilerProfile>;
  profileReset(): Promise<CompilerProfile>;
  /** Reformat source with the real `zornux format`; null when the compiler is unavailable. */
  format(source: string, cwd?: string): Promise<string | null>;
}

/**
 * The negotiated Zornux toolchain (Integration Layer). The ONE place feature
 * modules learn what the installed compiler can do — its product/protocol
 * versions and capabilities — so they gate on capabilities, never on a version
 * number. Backed by `zornux capabilities --json` (authoritative) with a
 * derive-from-version fallback; degrades to `unavailable` when the compiler is
 * absent. Cached; pass `refresh` to re-probe (e.g. after the user repoints it).
 */
export interface ToolchainService {
  info(refresh?: boolean): Promise<ZornuxInfo>;
  /** True when the toolchain advertises (or is derived to have) this capability. */
  supports(capability: string): Promise<boolean>;
  /** Per-protocol compatibility of the toolchain against what ZnxStudio speaks. */
  protocolCompatibility(): Promise<ProtocolCompatibility[]>;
  /** True when no protocol surface is on an incompatible (different) major. */
  compatible(): Promise<boolean>;
}

/** The current project module dependency graph (built from workspace .zx files). */
export interface DependencyGraphService {
  /** The latest built snapshot, or null if not built yet. */
  snapshot(): DependencyGraphSnapshot | null;
  /** Files that transitively depend on `path` (re-check candidates on change). */
  affected(path: string): string[];
}

export type DebugState = 'idle' | 'starting' | 'running' | 'stopped' | 'terminated' | 'error';

/**
 * The active debug session, exposed so later Phase 4 features (breakpoints,
 * call stack, variables) can issue DAP requests and observe state without
 * re-plumbing the adapter connection.
 */
export interface DebuggerService {
  /** Send an arbitrary DAP request to the active adapter. */
  request(command: string, args?: unknown): Promise<DebugRequestResult>;
  state(): DebugState;
  readonly onDidChangeState: Event<DebugState>;
}

/** The breakpoint model, consumed by the debug session to install breakpoints. */
export interface BreakpointService {
  toggle(uri: string, line: number): void;
  launchList(): DebugSourceBreakpoints[];
  applyVerified(results: DebugSourceVerified[]): void;
}

/**
 * The active environment profile for the workspace (Phase 5F). Backed by the
 * real Zornux profile concept (development / testing / staging / production);
 * the active value is persisted per primary folder and threaded into the CLI as
 * `--profile <name>` (run / serve / config). Consumers (Run) read `active()`.
 */
export interface ProfileService {
  active(): EnvironmentProfile;
  setActive(profile: EnvironmentProfile): void;
  list(): readonly EnvironmentProfile[];
  readonly onDidChangeProfile: Event<EnvironmentProfile>;
}

export interface SimulatorService {
  readonly state: import('../../shared/simulatorTypes').SimulatorSessionState;
  start(app: import('../../shared/simulatorTypes').MobileIRApp): Promise<void>;
  reload(app: import('../../shared/simulatorTypes').MobileIRApp): Promise<void>;
  stop(): void;
  restart(): Promise<void>;
  pause(): void;
  resume(): void;
  reset(): void;
  readonly onDidChangeState: Event<import('../../shared/simulatorTypes').SimulatorSessionState>;
}
