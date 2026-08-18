import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type CompilerService,
  type EditorService,
  type OutputService,
  type ProfileService,
  type QuickPickService,
  type SettingsService,
  type StatusService,
  type TerminalRunnerService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { WorkspaceInfo } from '../../shared/types';
import type { CompilerDiagnostic } from '../../shared/compilerProtocol';
import { LanguageServiceKeys, type DiagnosticSink } from '../language/api';
import { DiagnosticSources } from '../language/diagnosticSources';
import { DocumentManager } from '../language/DocumentManager';
import { toPlatformDiagnostics } from '../compiler/compilerDiagnostics';
import { buildSummary, groupByFile } from './buildDiagnostics';
import { ensureAndroidRunTarget } from '../mobile/deviceTarget';

/**
 * Run & Build pipeline. For Zornux workspaces it drives the real compiler:
 *   - Build → `zornux build <entry>` (request/response). Errors become clickable
 *     Problems (for files not already covered live) + an Output log + status.
 *   - Run   → `zornux run <entry>` streamed through the Task service.
 * For generic (non-Zornux) projects it falls back to the manifest `scripts`.
 * Consumes Workspace/Output/Status/Editor/Compiler + the DiagnosticsEngine — no
 * sibling-module imports.
 */
export class RunBuildModule implements IModule {
  readonly id = 'znxstudio.runBuild';
  readonly displayName = 'Run & Build';

  private context!: ModuleContext;
  private readonly runDebugButtons = new Map<string, HTMLButtonElement>();
  /** Uris carrying diagnostics from the last build, so we can clear them. */
  private lastBuildUris: string[] = [];

  activate(context: ModuleContext): void {
    this.context = context;

    context.commands.register(CommandIds.RunStart, () => this.run(), 'Zornux: Run Project');
    context.commands.register(CommandIds.BuildStart, () => this.build(), 'Zornux: Build Project');
    context.commands.register(CommandIds.BuildRebuild, () => this.rebuild(), 'Zornux: Rebuild Project');
    context.commands.register(
      CommandIds.RunScript,
      (name?: string, root?: string) => this.runScript(name, root),
      'Zornux: Run Script',
    );
    const workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        const info = workspace.currentWorkspace();
        if (id === CommandIds.RunScript) {
          return workspace.folders().some((folder) => Object.keys(folder.project?.scripts ?? {}).length > 0);
        }
        if (id === CommandIds.RunStart || id === CommandIds.BuildStart || id === CommandIds.BuildRebuild) {
          return info !== null;
        }
        return undefined;
      }),
      context.commands.onDidChangeEnablement(() => this.refreshRunDebugActions()),
    );
    workspace.onDidChangeFolders(() => context.commands.notifyEnablementChanged());

    const status = this.status();
    status?.setItem('run.action', {
      text: '▶ Run',
      tooltip: 'Run project',
      command: CommandIds.RunStart,
      side: 'right',
      priority: 32,
    });
    status?.setItem('build.action', {
      text: '⚙ Build',
      tooltip: 'Build project',
      command: CommandIds.BuildStart,
      side: 'right',
      priority: 31,
    });

    // Run & Debug workspace (UX-1): one of the five default Activity Bar items,
    // surfacing the existing run/build/debug commands in a sidebar.
    context.layout.addActivityItem({
      id: 'run-debug',
      label: 'Run & Debug',
      icon: '▷',
      onSelect: () => this.revealRunDebug(),
    });

    // Reflect streamed task (Run) completion in the status bar.
    window.znxstudio.task.onExit((event) =>
      status?.setItem('runbuild.status', {
        text: event.code === 0 ? '✓ task ok' : `✗ task (${event.code ?? '—'})`,
        side: 'right',
        priority: 30,
        autoHideMs: 4000,
      }),
    );

    // When a file flagged by the last build is opened, the live compiler layer
    // takes over — drop the build's diagnostics for it to avoid duplicates.
    const documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    if (documents) context.subscriptions.push(
      documents.onDidOpen((doc) => this.engine()?.clear(doc.uri, DiagnosticSources.ZornuxBuild)),
    );
  }

  /** Build and reveal the Run & Debug sidebar of action buttons. */
  private revealRunDebug(): void {
    this.runDebugButtons.clear();
    const view = document.createElement('div');
    view.className = 'znxstudio-rundebug';

    const actions: { label: string; command: string }[] = [
      { label: '▶  Run Project', command: CommandIds.RunStart },
      { label: '⚙  Build Project', command: CommandIds.BuildStart },
      { label: '○  Start Debugging', command: CommandIds.DebugStart },
      { label: '⏭  Step Over', command: CommandIds.DebugStepOver },
      { label: '▶▶  Continue', command: CommandIds.DebugContinue },
      { label: '⏸  Pause', command: CommandIds.DebugPause },
      { label: '⏹  Stop', command: CommandIds.DebugStop },
    ];
    for (const action of actions) {
      const button = document.createElement('button');
      button.className = 'znxstudio-btn-small znxstudio-rundebug-action';
      button.textContent = action.label;
      this.runDebugButtons.set(action.command, button);
      button.addEventListener('click', () => {
        if (this.context.commands.has(action.command) && this.context.commands.isEnabled(action.command)) {
          this.context.commands.executeFromUi(action.command);
        }
      });
      view.appendChild(button);
    }
    this.refreshRunDebugActions();

    this.context.layout.setSideBar('Run & Debug', view);
    this.context.layout.focusSideBar();
  }

  private refreshRunDebugActions(): void {
    for (const [command, button] of this.runDebugButtons) {
      button.disabled = !this.context.commands.has(command) || !this.context.commands.isEnabled(command);
    }
  }

  /** Rebuild: drop the compiler cache first so the build runs from scratch. */
  private async rebuild(): Promise<void> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    if (compiler) await compiler.cacheClear();
    await this.build();
  }

  /* ----- Build ----- */
  /**
   * Persist unsaved editor edits before running/building. The compiler and runner
   * read files from disk, so without this a dirty buffer would run stale content
   * (the on-disk version), and the output wouldn't match what's on screen.
   */
  private async saveOpenDocuments(): Promise<void> {
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    await documents?.saveAllDirty();
  }

  private async build(): Promise<void> {
    const info = this.workspaceInfoForActiveFile();
    if (!info) {
      this.context.layout.showToast('Open a folder to build.', 'error');
      return;
    }
    await this.saveOpenDocuments();

    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const entry = this.zornuxEntry(info);
    const compilerAvailable = compiler ? (await compiler.info()).available : false;

    // Mobile projects use `zornux mobile build android` instead of the regular build.
    if (info.detectedType === 'zornux-mobile') {
      await this.mobileBuild(info);
      return;
    }

    if (info.detectedType === 'zoijs-frontend' && !info.project?.scripts?.build) {
      this.context.layout.showToast('This Zoijs project runs directly in Live Preview; no build step is required.', 'info');
      return;
    }

    if (compiler && compilerAvailable && entry) {
      await this.compilerBuild(compiler, entry, info);
      return;
    }
    // Fall back to a manifest script for generic projects.
    if (info.project?.scripts?.build) {
      await this.runScript('build', info.root);
      return;
    }
    this.context.layout.showToast(
      entry ? 'Zornux compiler not available for build.' : 'Open a .zx file or add src/main.zx to build.',
      'error',
    );
  }

  private async compilerBuild(compiler: CompilerService, entry: string, info: WorkspaceInfo): Promise<void> {
    const output = this.output();
    output?.clear();
    output?.show();
    output?.appendLine(`> zornux build ${entry}`);
    this.status()?.setItem('runbuild.status', { text: '⏳ building…', side: 'right', priority: 30 });

    const result = await compiler.build({
      path: entry,
      workspaceRoot: info.root,
      compilerPath: this.compilerPathOverride(),
    });

    if (!result.available) {
      output?.appendLine(`Zornux compiler unavailable${result.error ? `: ${result.error}` : ''}.`);
      this.status()?.setItem('runbuild.status', { text: '✗ no compiler', side: 'right', priority: 30, autoHideMs: 4000 });
      return;
    }
    if (!result.ran) {
      // Usage / file-not-found / internal error — surface it plainly.
      output?.appendLine(`Build could not run (${result.outcome})${result.error ? `: ${result.error}` : ''}.`);
      this.status()?.setItem('runbuild.status', { text: '✗ build error', side: 'right', priority: 30, autoHideMs: 4000 });
      return;
    }

    this.publishBuildDiagnostics(result.diagnostics, info.root);

    const errors = result.diagnostics.filter((d) => d.severity === 'error').length;
    const warnings = result.diagnostics.filter((d) => d.severity === 'warning').length;
    const took = `${result.durationMs.toFixed(0)}ms`;

    if (result.ok) {
      const suffix = result.cached ? ' (cached, unchanged)' : '';
      output?.appendLine(`✓ Built ${result.artifact ?? '(artifact)'} in ${took}${suffix}.`);
      this.status()?.setItem('runbuild.status', { text: '✓ build ok', side: 'right', priority: 30, autoHideMs: 4000 });
    } else {
      output?.appendLine(`✗ Build failed — ${buildSummary(errors, warnings)} in ${took}.`);
      this.status()?.setItem('runbuild.status', {
        text: `✗ build (${errors})`,
        side: 'right',
        priority: 30,
        autoHideMs: 4000,
      });
      // Bring the clickable Problems list forward.
      if (this.context.commands.has(CommandIds.ViewProblems)) {
        await this.context.commands.execute(CommandIds.ViewProblems);
      }
    }
  }

  /**
   * Publish build diagnostics per file. Files already open are covered by the
   * live compiler layer, so we skip them here (no duplicate squiggles); closed
   * files get a `zornux-build` source so their errors are visible + clickable.
   */
  private publishBuildDiagnostics(diagnostics: CompilerDiagnostic[], workspaceRoot: string): void {
    const engine = this.engine();
    if (!engine) return;
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);

    for (const uri of this.lastBuildUris) engine.clear(uri, DiagnosticSources.ZornuxBuild);
    this.lastBuildUris = [];

    for (const [path, list] of groupByFile(diagnostics, workspaceRoot)) {
      const uri = monaco.Uri.file(path).toString();
      if (documents?.get(uri)) continue; // open → live layer owns it
      engine.set(uri, DiagnosticSources.ZornuxBuild, toPlatformDiagnostics(list, DiagnosticSources.ZornuxBuild));
      this.lastBuildUris.push(uri);
    }
  }

  /* ----- Run ----- */
  private async run(): Promise<void> {
    const info = this.workspaceInfoForActiveFile();
    if (!info) {
      this.context.layout.showToast('Open a folder to run.', 'error');
      return;
    }
    await this.saveOpenDocuments();

    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const entry = this.zornuxEntry(info);
    const compilerInfo = compiler ? await compiler.info() : null;

    // Mobile projects use `zornux mobile run android` with the selected device.
    if (info.detectedType === 'zornux-mobile') {
      await this.mobileRun(info);
      return;
    }

    if (info.detectedType === 'zoijs-frontend' && this.context.commands.has(CommandIds.PreviewStart)) {
      await this.context.commands.execute(CommandIds.PreviewStart);
      return;
    }

    if (info.detectedType === 'zornux-zoijs-fullstack' && this.context.commands.has(CommandIds.FullStackStart)) {
      await this.context.commands.execute(CommandIds.FullStackStart);
      return;
    }

    if (compiler && compilerInfo?.available && compilerInfo.path && entry) {
      // Thread the workspace's active environment profile (Phase 5F) into run.
      const profile = this.context.services.tryGet<ProfileService>(ServiceKeys.Profile)?.active();

      // Prefer a real PTY terminal tab: it has interactive stdin, so a program
      // that calls read_line(...) can actually be typed into. The Output panel is
      // one-way, so fall back to it only when the PTY is unavailable.
      const terminal = this.context.services.tryGet<TerminalRunnerService>(ServiceKeys.Terminal);
      if (terminal) {
        const args = ['run', entry, ...(profile ? ['--profile', profile] : [])];
        try {
          await terminal.runCommand({
            command: compilerInfo.path,
            args,
            cwd: info.root,
            label: `Run ${baseName(entry)}`,
          });
          this.status()?.setItem('runbuild.status', {
            text: '▶ running…',
            side: 'right',
            priority: 30,
            autoHideMs: 2500,
          });
          return;
        } catch {
          // PTY missing on this platform — fall through to the streamed Output panel.
        }
      }

      const profileArg = profile ? ` --profile ${profile}` : '';
      const command = `"${compilerInfo.path}" run "${entry}"${profileArg}`;
      await this.streamTask('run', command, info.root, `> zornux run ${entry}${profileArg}`);
      return;
    }
    if (info.project?.scripts?.run) {
      await this.runScript('run', info.root);
      return;
    }
    this.context.layout.showToast(
      entry ? 'Zornux compiler not available to run.' : 'Open a .zx file or add src/main.zx to run.',
      'error',
    );
  }

  /* ----- Mobile (Android) ----- */

  /** Build a mobile project via `zornux mobile build android`, streamed through the task service. */
  private async mobileBuild(info: WorkspaceInfo): Promise<void> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const compilerInfo = compiler ? await compiler.info() : null;
    const compilerPath = compilerInfo?.available && compilerInfo.path ? compilerInfo.path : 'zornux';

    const command = `"${compilerPath}" mobile build android`;
    await this.streamTask('mobile-build', command, info.root, `> zornux mobile build android`);
  }

  /**
   * Run a mobile project via `zornux mobile run android --device <selected>`.
   * Uses the persistent run process managed by MobileService for log streaming.
   */
  private async mobileRun(info: WorkspaceInfo): Promise<void> {
    const status = await window.znxstudio.mobile.status();
    if (status.running) {
      this.context.layout.showToast('Mobile app is already running. Stop it first.', 'info');
      return;
    }

    const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
    let targetId: string | null;
    try {
      targetId = await ensureAndroidRunTarget({
        api: window.znxstudio.mobile,
        pickDevice: quickPick ? async (devices) => quickPick.pick(
          devices.map((device) => ({
            label: `${device.name} (${device.type})`,
            description: device.apiLevel ? `API ${device.apiLevel} · ${device.id}` : device.id,
            value: device.id,
          })),
          { placeholder: 'Select an Android deployment target' },
        ) : undefined,
        pickEmulator: quickPick ? async (emulators) => quickPick.pick(
          emulators.map((emulator) => ({
            label: emulator.name,
            description: emulator.apiLevel ? `API ${emulator.apiLevel}` : 'Android virtual device',
            value: emulator.name,
          })),
          { placeholder: 'No phone connected — start a virtual device' },
        ) : undefined,
        onProgress: (message) => {
          this.context.layout.showToast(message, 'info');
          this.status()?.setItem('runbuild.status', { text: 'Android: emulator booting', side: 'right', priority: 30 });
        },
      });
    } catch (error) {
      this.context.layout.showToast(`Emulator launch failed: ${(error as Error).message}`, 'error');
      return;
    }
    if (!targetId) {
      this.context.layout.showToast('No Android target is available. Create or install a virtual device from Android SDK Manager.', 'error');
      return;
    }

    const output = this.output();
    output?.clear();
    output?.show();
    output?.appendLine(`> zornux mobile run android --device ${targetId}`);
    this.status()?.setItem('runbuild.status', { text: '▶ mobile…', side: 'right', priority: 30 });

    try {
      await window.znxstudio.mobile.runStart(targetId, info.root);
    } catch (error) {
      output?.appendLine(`Failed to start mobile run: ${(error as Error).message}`);
      this.status()?.setItem('runbuild.status', { text: '✗ mobile error', side: 'right', priority: 30, autoHideMs: 4000 });
    }
  }

  /* ----- generic manifest script (fallback + palette "Run Script") ----- */
  private async runScript(name?: string, root?: string): Promise<void> {
    let info = this.workspaceInfo(root);
    if (!info) {
      this.context.layout.showToast('Open a folder to run tasks.', 'error');
      return;
    }
    if (!name) {
      const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
      const choices = (workspace?.folders() ?? []).flatMap((folder) =>
        Object.entries(folder.project?.scripts ?? {})
          .filter((entry): entry is [string, string] => Boolean(entry[0].trim() && entry[1].trim()))
          .map(([scriptName, scriptCommand]) => ({ folder, scriptName, scriptCommand })),
      ).sort((left, right) => left.scriptName.localeCompare(right.scriptName));
      const duplicateNames = new Set(
        choices
          .filter((choice, index) => choices.findIndex((candidate) => candidate.scriptName === choice.scriptName) !== index)
          .map((choice) => choice.scriptName),
      );
      if (choices.length === 0) {
        this.context.layout.showToast('No project scripts are defined.', 'info');
        return;
      }
      const quickPick = this.context.services.tryGet<QuickPickService>(ServiceKeys.QuickPick);
      if (!quickPick) {
        this.context.layout.showToast('The script picker is not available.', 'error');
        return;
      }
      const selected = await quickPick.pick(
        choices.map(({ folder, scriptName, scriptCommand }) => ({
          label: duplicateNames.has(scriptName)
            ? `${scriptName} — ${folder.project?.name ?? folder.root.split(/[\\/]/).pop() ?? 'workspace'}`
            : scriptName,
          description: scriptCommand,
          value: { name: scriptName, root: folder.root },
        })),
        { placeholder: 'Select a project script to run' },
      );
      if (!selected) return;
      name = selected.name;
      info = this.workspaceInfo(selected.root);
      if (!info) return;
    }
    const command = info.project?.scripts?.[name];
    if (!command) {
      this.context.layout.showToast(`No "${name}" script defined for this project.`, 'error');
      return;
    }
    await this.streamTask(name, command, info.root, `> ${command}`);
  }

  private async streamTask(name: string, command: string, cwd: string, banner: string): Promise<void> {
    const output = this.output();
    output?.clear();
    output?.show();
    output?.appendLine(banner);
    this.status()?.setItem('runbuild.status', { text: `⏳ ${name}…`, side: 'right', priority: 30 });
    try {
      await window.znxstudio.task.run({ id: `task-${name}`, command, cwd });
    } catch (error) {
      output?.appendLine(`Failed to start task: ${(error as Error).message}`);
    }
  }

  /* ----- helpers ----- */
  private zornuxEntry(info: WorkspaceInfo): string | null {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const active = editor?.currentFile();
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (active && active.toLowerCase().endsWith('.zx') && workspace?.folderContaining(active)?.root === info.root) {
      return active;
    }
    const targetsZornux =
      info.detectedType === 'zornux-api' || info.detectedType === 'zornux-zoijs-fullstack' ||
      info.detectedType === 'zornux-mobile';
    if (targetsZornux) return `${info.root.replace(/[\\/]+$/, '')}/src/main.zx`;
    return null;
  }

  private compilerPathOverride(): string | null {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    const value = settings?.get('zornux.compiler.path', '');
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private workspaceInfo(root?: string): WorkspaceInfo | null {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (root) return workspace?.folders().find((folder) => folder.root === root) ?? null;
    return workspace?.currentWorkspace() ?? null;
  }

  private workspaceInfoForActiveFile(): WorkspaceInfo | null {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const active = this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.currentFile();
    return (active ? workspace?.folderContaining(active) : null) ?? workspace?.currentWorkspace() ?? null;
  }

  private engine(): DiagnosticSink | undefined {
    return this.context.services.tryGet<DiagnosticSink>(LanguageServiceKeys.Diagnostics);
  }

  private output(): OutputService | undefined {
    return this.context.services.tryGet<OutputService>(ServiceKeys.Output);
  }

  private status(): StatusService | undefined {
    return this.context.services.tryGet<StatusService>(ServiceKeys.Status);
  }
}

/** The final path segment (the file name) of a `/`- or `\`-separated path. */
function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}
