import { CommandRegistry } from '../commands/CommandRegistry';
import { CommandIds } from '../commands/CommandIds';
import { ExtensionHost } from '../extensions/ExtensionHost';
import { CommandPaletteModule } from '../palette/CommandPaletteModule';
import { QuickPickModule } from '../palette/QuickPickModule';
import { SearchEverywhereModule } from '../palette/SearchEverywhereModule';
import { DiagnosticsModule } from '../diagnostics/DiagnosticsModule';
import { EditorModule } from '../editor/EditorModule';
import { MultiCursorModule } from '../editor/MultiCursorModule';
import { BreadcrumbsModule } from '../editor/BreadcrumbsModule';
import { BookmarksModule } from '../editor/BookmarksModule';
import { NavHistoryModule } from '../editor/NavHistoryModule';
import { SnippetsModule } from '../snippets/SnippetsModule';
import { TasksModule } from '../tasks/TasksModule';
import { CodeGenModule } from '../codegen/CodeGenModule';
import { MetricsModule } from '../metrics/MetricsModule';
import { QuickOpenModule } from '../productivity/QuickOpenModule';
import { TodoModule } from '../productivity/TodoModule';
import { DatabaseModule } from '../database/DatabaseModule';
import { QueryConsoleModule } from '../database/QueryConsoleModule';
import { MigrationsModule } from '../database/MigrationsModule';
import { DataBrowserModule } from '../database/DataBrowserModule';
import { QueryProfilerModule } from '../database/QueryProfilerModule';
import { OrmExplorerModule } from '../database/OrmExplorerModule';
import { TestExplorerModule } from '../testing/TestExplorerModule';
import { CoverageModule } from '../testing/CoverageModule';
import { TestPerfModule } from '../testing/TestPerfModule';
import { MockingModule } from '../testing/MockingModule';
import { ContinuousTestModule } from '../testing/ContinuousTestModule';
import { AiModule } from '../ai/AiModule';
import { ChatModule } from '../ai/ChatModule';
import { CompletionModule } from '../ai/CompletionModule';
import { RefactorModule } from '../ai/RefactorModule';
import { ReviewModule } from '../ai/ReviewModule';
import { DocsModule } from '../ai/DocsModule';
import { TestGenModule } from '../ai/TestGenModule';
import { DebugAssistModule } from '../ai/DebugAssistModule';
import { ArchitectureModule } from '../ai/ArchitectureModule';
import { ExtensionsModule } from '../extensions/ExtensionsModule';
import { ExtensionsManagerModule } from '../extensions/ExtensionsManagerModule';
import { SourceControlModule } from '../scm/SourceControlModule';
import { PullRequestsModule } from '../scm/PullRequestsModule';
import { HistoryModule } from '../scm/HistoryModule';
import { DeploymentModule } from '../deploy/DeploymentModule';
import { DockerModule } from '../deploy/DockerModule';
import { KubernetesModule } from '../deploy/KubernetesModule';
import { CloudModule } from '../deploy/CloudModule';
import { CicdModule } from '../deploy/CicdModule';
import { RemoteEnvModule } from '../deploy/RemoteEnvModule';
import { PerformanceModule } from '../profiler/PerformanceModule';
import { CpuProfilerModule } from '../profiler/CpuProfilerModule';
import { MemoryProfilerModule } from '../profiler/MemoryProfilerModule';
import { TimelineModule } from '../profiler/TimelineModule';
import { HotspotsModule } from '../profiler/HotspotsModule';
import { AllocationsModule } from '../profiler/AllocationsModule';
import { SecurityModule } from '../security/SecurityModule';
import { SecretsModule } from '../security/SecretsModule';
import { ScannerModule } from '../security/ScannerModule';
import { DependencyAuditModule } from '../security/DependencyAuditModule';
import { SecurityRulesModule } from '../security/SecurityRulesModule';
import { SecurityDashboardModule } from '../security/SecurityDashboardModule';
import { CollabModule } from '../collab/CollabModule';
import { LiveShareModule } from '../collab/LiveShareModule';
import { PairModule } from '../collab/PairModule';
import { TeamModule } from '../collab/TeamModule';
import { ZoijsModule } from '../zoijs/ZoijsModule';
import { PreviewModule } from '../preview/PreviewModule';
import { FullStackModule } from '../preview/FullStackModule';
import { SearchModule } from '../search/SearchModule';
import { LiveErrorsModule } from '../errors/LiveErrorsModule';
import { DependencyGraphModule } from '../graph/DependencyGraphModule';
import { ProfilerModule } from '../profiler/ProfilerModule';
import { DebugModule } from '../debug/DebugModule';
import { BreakpointModule } from '../debug/BreakpointModule';
import { LanguagePlatformModule } from '../language/LanguagePlatformModule';
import { ToolchainStatusModule } from '../toolchain/ToolchainStatusModule';
import { LspModule } from '../language/lsp/LspModule';
import { OutlineModule } from '../outline/OutlineModule';
import { OutputModule } from '../output/OutputModule';
import { ProjectExplorerModule } from '../explorer/ProjectExplorerModule';
import { ExplorerActionsModule } from '../explorer/ExplorerActionsModule';
import { InputBoxModule } from '../ui/InputBoxModule';
import { OpenEditorsModule } from '../explorer/OpenEditorsModule';
import { ProjectReferencesModule } from '../solution/ProjectReferencesModule';
import { SolutionExplorerModule } from '../solution/SolutionExplorerModule';
import { PackageManagerModule } from '../packages/PackageManagerModule';
import { ProfilesModule } from '../profiles/ProfilesModule';
import { TemplatesModule } from '../templates/TemplatesModule';
import { WizardsModule } from '../wizards/WizardsModule';
import { RunBuildModule } from '../run/RunBuildModule';
import { MobileModule } from '../mobile/MobileModule';
import { SettingsModule } from '../settings/SettingsModule';
import { LayoutModule } from '../layout/LayoutModule';
import { KeybindingsModule } from '../keybindings/KeybindingsModule';
import { WorkbenchUxModule } from '../layout/WorkbenchUxModule';
import { LogModule } from '../health/LogModule';
import { TelemetryModule } from '../health/TelemetryModule';
import { CrashRecoveryModule } from '../health/CrashRecoveryModule';
import { HealthModule } from '../health/HealthModule';
import { HealthDashboardModule } from '../health/HealthDashboardModule';
import { DocsViewerModule } from '../docs/DocsViewerModule';
import { ApiReferenceModule } from '../docs/ApiReferenceModule';
import { SamplesModule } from '../docs/SamplesModule';
import { LearningCenterModule } from '../docs/LearningCenterModule';
import { TutorialsModule } from '../docs/TutorialsModule';
import { StatusBarModule } from '../statusbar/StatusBarModule';
import { TerminalModule } from '../terminal/TerminalModule';
import { ThemeModule } from '../themes/ThemeModule';
import { WelcomeModule } from '../welcome/WelcomeModule';
import { WorkspaceModule } from '../workspace/WorkspaceModule';
import { TrustModule } from '../trust/TrustModule';
import { UpdateModule } from '../update/UpdateModule';
import { ZoomModule } from '../view/ZoomModule';
import { ServiceKeys, type EditorService, type WorkspaceService } from './Contracts';
import { auditA11y, type A11yElement } from '../a11y/a11y';
import type { Disposable, ModuleContext } from './Module';
import { LayoutManager } from './LayoutManager';
import { ServiceRegistry } from './ServiceRegistry';
import { selfTestCoordinator } from './SelfTestCoordinator';

/**
 * The IDE shell. It owns the core registries and the extension host, then
 * boots the built-in modules. It contains NO Zornux/Zoijs-specific logic —
 * those arrive later as modules registered right here.
 */
export class Workbench {
  private readonly services = new ServiceRegistry();
  private readonly commands = new CommandRegistry();
  private readonly layout = new LayoutManager();
  private readonly extensions = new ExtensionHost();
  private readonly subscriptions: Disposable[] = [];

  async start(root: HTMLElement): Promise<void> {
    this.layout.mount(root);

    // Gate the modules' self-tests before any module activates, so they run
    // serially (default) instead of stampeding the compiler/adapter subprocesses.
    try {
      const info = await window.znxstudio.app.getInfo();
      selfTestCoordinator.configure(info.selftestConcurrency ?? 1);
    } catch {
      selfTestCoordinator.configure(1);
    }

    const context: ModuleContext = {
      services: this.services,
      commands: this.commands,
      layout: this.layout,
      subscriptions: this.subscriptions,
    };

    // Order matters. The status bar comes up first so every producer can push
    // segments into it. Settings precedes the editor (persisted prefs). Workspace
    // precedes the Language Platform (workspace-driven activation), which precedes
    // the editor (the editor consumes the platform's DocumentManager). The
    // explorer/terminal/run modules follow their dependencies. Future Zornux/Zoijs
    // compiler modules attach to the Language Platform without touching this list.
    this.extensions.registerAll([
      new StatusBarModule(),
      new ThemeModule(),
      new SettingsModule(),
      // Logging and telemetry precede every module that might want to log or be
      // timed. They depend on nothing but Settings.
      new LogModule(),
      new TelemetryModule(),
      new LayoutModule(),
      new WorkspaceModule(),
      // Trust follows Workspace (it reads the Workspace service) and precedes the
      // execution-capable modules so its gate/banner is live before they run.
      new TrustModule(),
      new UpdateModule(),
      new ZoomModule(),
      new LanguagePlatformModule(),
      new ToolchainStatusModule(),
      new LspModule(),
      new EditorModule(),
      new MultiCursorModule(),
      new BreadcrumbsModule(),
      new NavHistoryModule(),
      new SnippetsModule(),
      new TasksModule(),
      new CodeGenModule(),
      new MetricsModule(),
      new QuickOpenModule(),
      new TodoModule(),
      new DatabaseModule(),
      new QueryConsoleModule(),
      new MigrationsModule(),
      new DataBrowserModule(),
      new QueryProfilerModule(),
      new OrmExplorerModule(),
      new TestExplorerModule(),
      new CoverageModule(),
      new TestPerfModule(),
      new MockingModule(),
      new ContinuousTestModule(),
      new AiModule(),
      new ChatModule(),
      new CompletionModule(),
      new RefactorModule(),
      new ReviewModule(),
      new DocsModule(),
      new TestGenModule(),
      new DebugAssistModule(),
      new ArchitectureModule(),
      new ExtensionsModule(),
      new ExtensionsManagerModule(),
      new SourceControlModule(),
      new PullRequestsModule(),
      new HistoryModule(),
      new DeploymentModule(),
      new DockerModule(),
      new KubernetesModule(),
      new CloudModule(),
      new CicdModule(),
      new RemoteEnvModule(),
      new PerformanceModule(),
      new CpuProfilerModule(),
      new MemoryProfilerModule(),
      new TimelineModule(),
      new HotspotsModule(),
      new AllocationsModule(),
      new SecurityModule(),
      new SecretsModule(),
      new ScannerModule(),
      new DependencyAuditModule(),
      new SecurityRulesModule(),
      new SecurityDashboardModule(),
      new CollabModule(),
      new LiveShareModule(),
      new PairModule(),
      new TeamModule(),
      new ZoijsModule(),
      new PreviewModule(),
      new FullStackModule(),
      new SearchModule(),
      new ProjectExplorerModule(),
      // Explorer sidebar sections (UX-6). They register into the ExplorerService
      // the Project Explorer just published, so they must follow it. Bookmarks
      // was moved here from the editor cluster for the same reason.
      new OpenEditorsModule(),
      new BookmarksModule(),
      new ProjectReferencesModule(),
      new SolutionExplorerModule(),
      new PackageManagerModule(),
      new ProfilesModule(),
      new TemplatesModule(),
      new WizardsModule(),
      new OutputModule(),
      new DiagnosticsModule(),
      new LiveErrorsModule(),
      new DependencyGraphModule(),
      new ProfilerModule(),
      new DebugModule(),
      new BreakpointModule(),
      new OutlineModule(),
      new QuickPickModule(),
      new InputBoxModule(),
      new ExplorerActionsModule(),
      new TerminalModule(),
      new RunBuildModule(),
      new MobileModule(),
      new CommandPaletteModule(),
      new SearchEverywhereModule(),
      new KeybindingsModule(),
      new WorkbenchUxModule(),
      // Docs (Phase 18). The viewer publishes ServiceKeys.Docs, so it precedes
      // the API reference and the learning center, which render into it. The
      // learning center owns the curriculum, so tutorials follow it.
      // Health (Phase 19). Crash recovery needs the editor and the document
      // manager; the dashboard needs the health service.
      new CrashRecoveryModule(),
      new HealthModule(),
      new HealthDashboardModule(),
      new DocsViewerModule(),
      new ApiReferenceModule(),
      new SamplesModule(),
      new LearningCenterModule(),
      new TutorialsModule(),
      new WelcomeModule(),
    ]);

    await this.extensions.activateAll(context);

    // Startup timings only exist once activation has FINISHED, so they are
    // pushed in here rather than pulled by the module during its own activate.
    // `setStartup` is deliberately not on TelemetryService — only the shell,
    // which owns the extension host, is in a position to report them.
    const telemetry = this.services.tryGet<TelemetryModule>(ServiceKeys.Telemetry);
    telemetry?.setStartup(this.extensions.activationRecords(), this.extensions.startupDuration());
    // A single startup-timing line (IDE-standard diagnostic, low volume).
    console.info(`[perf] startup: ${this.extensions.startupDuration().toFixed(0)}ms across ${this.extensions.activationRecords().length} modules`);

    // Likewise, the health report needs the crash module's session state, and
    // only the shell can hand one module to another.
    const health = this.services.tryGet<HealthModule>(ServiceKeys.Health);
    const crash = this.extensions.getModules().find((module) => module instanceof CrashRecoveryModule);
    if (health && crash instanceof CrashRecoveryModule) health.useCrashRecovery(crash);

    // Show the welcome/start screen only on a truly empty startup — not when a
    // project folder or editor session was restored (the IDE should reflect it).
    const hasFolder = (this.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.folders().length ?? 0) > 0;
    const hasEditors = (this.services.tryGet<EditorService>(ServiceKeys.Editor)?.openEditors().length ?? 0) > 0;
    if (!hasFolder && !hasEditors && this.commands.has(CommandIds.ViewWelcome)) {
      await this.commands.execute(CommandIds.ViewWelcome);
    }

    await this.auditPaletteCoverage();
    await this.auditAccessibility();
    await this.auditSecurity();
    await this.auditStartup();
  }

  /** 20D: log the startup cost + slowest module activations. Self-test only. */
  private async auditStartup(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;

    const records = this.extensions.activationRecords();
    const total = this.extensions.startupDuration();
    const slowest = [...records]
      .sort((a, b) => b.milliseconds - a.milliseconds)
      .slice(0, 8)
      .map((r) => `${r.moduleId}=${r.milliseconds.toFixed(1)}ms`);
    console.info(
      `[selftest] startup REAL: modules=${records.length} total=${total.toFixed(0)}ms slowest=[${slowest.join(', ')}]`,
    );
  }

  /**
   * 20C runtime audit: prove the renderer really is isolated — no Node globals
   * leak in (contextIsolation + nodeIntegration:false), the context bridge is the
   * only privileged surface, and `window.open` is denied by the main process.
   * Only runs under the headless self-test.
   */
  private async auditSecurity(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;

    const w = window as unknown as Record<string, unknown>;
    const nodeGlobalsLeaked =
      typeof w.require !== 'undefined' || typeof w.module !== 'undefined' || typeof w.process !== 'undefined';
    const bridgePresent = typeof window.znxstudio === 'object' && window.znxstudio !== null;

    let windowOpenBlocked = true;
    try {
      const opened = window.open('https://example.com/znxstudio-audit', '_blank');
      windowOpenBlocked = opened === null;
      opened?.close();
    } catch {
      windowOpenBlocked = true; // throwing is also "not a usable window"
    }

    console.info(
      `[selftest] security REAL: nodeGlobalsLeaked=${nodeGlobalsLeaked} bridgePresent=${bridgePresent} ` +
        `windowOpenBlocked=${windowOpenBlocked}`,
    );
  }

  /**
   * 20A audit: once the whole workbench is mounted, walk the real DOM and flag any
   * interactive control that a screen reader would announce with no name. Only
   * runs under the headless self-test.
   */
  private async auditAccessibility(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;

    const nodes = document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role]');
    const elements: A11yElement[] = [];
    for (const node of nodes) {
      const hidden = node.getAttribute('aria-hidden') === 'true' || node.closest('[aria-hidden="true"]') !== null;
      elements.push({
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') ?? undefined,
        ariaLabel: node.getAttribute('aria-label') ?? undefined,
        ariaLabelledby: node.getAttribute('aria-labelledby') ?? undefined,
        title: node.getAttribute('title') ?? undefined,
        alt: node.getAttribute('alt') ?? undefined,
        placeholder: node.getAttribute('placeholder') ?? undefined,
        text: (node.textContent ?? '').trim() || undefined,
        className: node.classList[0],
        // A control wrapped in (or pointed at by) a <label> is named by it.
        hasLabel: node.closest('label') !== null,
        hidden,
      });
    }
    const report = auditA11y(elements);
    const sample = report.unnamed.slice(0, 20).map((f) => `${f.tag}.${f.className ?? '?'}`);
    console.info(
      `[selftest] a11y-audit REAL DOM: interactive=${report.interactive} unnamed=${report.unnamed.length} ` +
        `sample=[${sample.join(', ')}]`,
    );
  }

  /**
   * SB-7 audit: once every module has activated, confirm the whole command
   * surface is discoverable — each panel has a "Show Panel: …" command, and every
   * feature launcher that SB-1 removed from the status bar still has its command
   * (so nothing became harder to reach). Only runs under the headless self-test.
   */
  private async auditPaletteCoverage(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      return;
    }
    if (!enabled) return;

    const ids = new Set(this.commands.list().map((command) => command.id));
    const panelShow = [...ids].filter((id) => id.startsWith('znxstudio.panel.show.')).length;

    // The commands the SB-1-hidden status launchers used — must still be present.
    const launcherCommands = [
      CommandIds.OrmExplorerShow, CommandIds.AiConfigure, CommandIds.MetricsShow, CommandIds.ViewProfiler,
      CommandIds.DatabaseShow, CommandIds.CoverageShow, CommandIds.TestExplorerShow, CommandIds.ContinuousShow,
      CommandIds.TodoShow, CommandIds.BookmarksShow, CommandIds.ViewDependencies, CommandIds.SecurityShow,
      CommandIds.PerfShow, CommandIds.RunStart, CommandIds.BuildStart,
    ];
    const launchersPresent = launcherCommands.filter((id) => ids.has(id)).length;

    console.info(
      `[selftest] palettecoverage REAL: totalCommands=${ids.size} panelShowCommands=${panelShow} ` +
        `launchersReachable=${launchersPresent}/${launcherCommands.length} (nothing became menu-only)`,
    );
  }
}
