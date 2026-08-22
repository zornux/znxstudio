import * as monaco from 'monaco-editor';
import { tp } from '../i18n';
import {
  ServiceKeys,
  type CompilerService,
  type DependencyGraphService,
  type EditorService,
  type SettingsService,
  type StatusService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { examplePath } from '../core/selftestFixtures';
import { CommandIds } from '../commands/CommandIds';
import type { WorkspaceInfo } from '../../shared/types';
import type { CompilerDiagnostic } from '../../shared/compilerProtocol';
import { affectedFiles, type DependencyGraphSnapshot } from '../../shared/dependencyGraph';
import { LanguageServiceKeys, type DiagnosticSink } from '../language/api';
import { DiagnosticSources } from '../language/diagnosticSources';
import { DocumentManager } from '../language/DocumentManager';
import { toPlatformDiagnostics } from '../compiler/compilerDiagnostics';
import { groupByFile } from '../run/buildDiagnostics';
import { isMobileZornux } from '../language/languages/zornux/mobileSyntax';

const MODULE_CODE = /^ZX13\d\d$/i; // cross-file / import diagnostics (ZX1300–1399)

/**
 * Project Dependency Graph. Scans the workspace's Zornux modules into a graph
 * (via the main process), renders it in a "Dependencies" panel with navigation,
 * and runs the module-aware whole-project check to surface cross-file import
 * errors (ZX13xx) that the single-file live layer can't see. Registered as
 * DependencyGraphService so other features can query `affected(path)`.
 */
export class DependencyGraphModule implements IModule, DependencyGraphService {
  readonly id = 'znxstudio.dependencyGraph';
  readonly displayName = 'Dependency Graph';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private compiler: CompilerService | undefined;
  private trust: TrustService | undefined;
  private current: DependencyGraphSnapshot | null = null;
  private lastCheckedHash: string | null = null;
  private lastDiagnosticUris: string[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshSequence = 0;
  private refreshing = false;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.compiler = context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    this.trust = context.services.tryGet<TrustService>(ServiceKeys.Trust);

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-deps';
    context.layout.addPanelView({ id: 'dependencies', title: 'Dependencies', element: this.surface });
    context.services.register<DependencyGraphService>(ServiceKeys.DependencyGraph, this);

    context.commands.register(CommandIds.CheckProject, () => this.refresh(true), 'Zornux: Check Project');
    context.commands.register(
      CommandIds.ViewDependencies,
      () => context.layout.showPanelView('dependencies'),
      'Zornux: Show Dependencies',
    );
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (id === CommandIds.CheckProject) return Boolean(this.workspaceInfo()) && !this.refreshing;
        return undefined;
      }),
    );

    const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    workspace?.onDidChangeWorkspace(() => this.schedule(true, 0));

    if (this.trust) {
      context.subscriptions.push(this.trust.onDidChange((state) => {
        if (state.trusted && this.workspaceInfo() && !this.current) this.schedule(true, 0);
      }));
    }

    // Rebuild the graph + re-check the project when a Zornux file is saved.
    const documents = context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    if (documents) context.subscriptions.push(documents.onDidSave((doc) => {
      if (doc.path.toLowerCase().endsWith('.zx')) this.schedule(false, 800);
    }));

    this.renderEmpty('No workspace open.');
    if (workspace?.currentWorkspace()) this.schedule(true, 0);
    void selfTestCoordinator.run('dependency-graph', () => this.maybeSelfTest());
  }

  /* ----- DependencyGraphService ----- */
  snapshot(): DependencyGraphSnapshot | null {
    return this.current;
  }
  affected(path: string): string[] {
    return this.current ? affectedFiles(this.current, path) : [];
  }

  /* ----- refresh pipeline ----- */
  private schedule(force: boolean, delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refresh(force), delay);
  }

  private async refresh(force: boolean): Promise<void> {
    const sequence = ++this.refreshSequence;
    const info = this.workspaceInfo();
    if (!info) {
      this.refreshing = false;
      this.current = null;
      this.clearDiagnostics();
      this.renderEmpty('No workspace open.');
      this.removeStatus();
      this.context.commands.notifyEnablementChanged();
      return;
    }

    if (this.trust && !this.trust.isTrusted()) {
      this.renderEmpty('Workspace is not trusted.');
      this.removeStatus();
      return;
    }

    this.refreshing = true;
    this.context.commands.notifyEnablementChanged();
    if (force) this.renderEmpty('Building dependency graph…', true);
    const sourceDir = this.resolveSourceDir(info);
    let graphBuilt = false;
    try {
      const snapshot = await window.znxstudio.graph.build({ root: info.root, sourceDir });
      if (!this.isCurrent(sequence, info.root)) return;
      this.current = snapshot;
      this.render(snapshot);
      this.updateStatus(snapshot);
      graphBuilt = true;

      if (snapshot.fileCount === 0) {
        this.clearDiagnostics();
        return;
      }

      // Module-aware project check — skip when nothing changed since last check.
      if (!force && snapshot.contentHash && snapshot.contentHash === this.lastCheckedHash) return;
      if (!this.compiler || !(await this.compiler.info()).available) return;
      if (!this.isCurrent(sequence, info.root)) return;

      const result = await this.compiler.checkProject({
        sourceDir,
        workspaceRoot: info.root,
        compilerPath: this.compilerPathOverride(),
      });
      if (!this.isCurrent(sequence, info.root) || !result.available || !result.ran) return;
      this.lastCheckedHash = snapshot.contentHash ?? null;
      this.publishProjectDiagnostics(result.diagnostics, info.root);
    } catch (error) {
      if (!this.isCurrent(sequence, info.root)) return;
      if (graphBuilt) {
        this.context.layout.showToast(`Project check failed: ${(error as Error).message}`, 'error');
      } else {
        this.current = null;
        this.clearDiagnostics();
        this.removeStatus();
        this.renderEmpty(`Could not refresh dependencies: ${(error as Error).message}`, false, true);
        this.context.layout.showToast('Dependency graph refresh failed.', 'error');
      }
    } finally {
      if (sequence === this.refreshSequence) {
        this.refreshing = false;
        this.context.commands.notifyEnablementChanged();
      }
    }
  }

  /**
   * Publish project-check diagnostics per file. Open files are covered by the
   * single-file live layer, so for them we keep only cross-file module codes
   * (ZX13xx); closed files show the full picture. Disjoint from other layers.
   */
  private publishProjectDiagnostics(diagnostics: CompilerDiagnostic[], workspaceRoot: string): void {
    const engine = this.engine();
    if (!engine) return;
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);

    for (const uri of this.lastDiagnosticUris) engine.clear(uri, DiagnosticSources.ZornuxProject);
    this.lastDiagnosticUris = [];

    for (const [path, list] of groupByFile(diagnostics, workspaceRoot)) {
      const uri = monaco.Uri.file(path).toString();
      const doc = documents?.get(uri);
      if (doc && isMobileZornux(doc.getText())) continue;
      const isOpen = Boolean(doc);
      const filtered = isOpen ? list.filter((d) => MODULE_CODE.test(d.code)) : list;
      if (!filtered.length) continue;
      engine.set(uri, DiagnosticSources.ZornuxProject, toPlatformDiagnostics(filtered, DiagnosticSources.ZornuxProject));
      this.lastDiagnosticUris.push(uri);
    }
  }

  private clearDiagnostics(): void {
    const engine = this.engine();
    for (const uri of this.lastDiagnosticUris) engine?.clear(uri, DiagnosticSources.ZornuxProject);
    this.lastDiagnosticUris = [];
  }

  /* ----- rendering ----- */
  private render(snapshot: DependencyGraphSnapshot): void {
    if (snapshot.fileCount === 0) {
      this.renderEmpty('No Zornux modules found in this workspace.');
      return;
    }
    const container = document.createElement('div');
    container.className = 'znxstudio-deps-list';

    const moduleCount = Object.keys(snapshot.moduleToFile).length;
    container.appendChild(
      this.summary(
        `${tp('modules.count', moduleCount)} · ${tp('files.count', snapshot.fileCount)}` +
          (snapshot.cycles.length ? ` · ⚠️ ${snapshot.cycles.length} cycle(s)` : ''),
      ),
    );

    for (const file of snapshot.files) {
      const label = file.module ?? fileName(file.path);
      const row = this.node('znxstudio-deps-file', `□ ${label}`, () => void this.open(file.path));
      container.appendChild(row);

      for (const imp of file.imports) {
        const target = snapshot.moduleToFile[imp.module];
        if (target) {
          container.appendChild(
            this.node('znxstudio-deps-import', `↳ ${imp.module}`, () => void this.open(target)),
          );
        } else {
          container.appendChild(this.node('znxstudio-deps-import znxstudio-deps-import--missing', `↳ ${imp.module}  ⛔ not found`));
        }
      }
    }

    if (snapshot.cycles.length) {
      container.appendChild(this.summary('Import cycles'));
      for (const cycle of snapshot.cycles) {
        container.appendChild(this.node('znxstudio-deps-cycle', `⟳ ${cycle.map(fileName).join(' → ')}`));
      }
    }

    this.surface.replaceChildren(container);
  }

  private renderEmpty(message: string, busy = false, retry = false): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-deps-empty';
    if (busy) empty.setAttribute('aria-live', 'polite');
    const text = document.createElement('span');
    text.textContent = message;
    empty.appendChild(text);
    if (retry) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'znxstudio-btn-small';
      button.textContent = 'Retry';
      button.addEventListener('click', () => void this.refresh(true));
      empty.appendChild(button);
    }
    this.surface.replaceChildren(empty);
  }

  private summary(text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = 'znxstudio-deps-group';
    el.textContent = text;
    return el;
  }

  private node(className: string, text: string, onClick?: () => void): HTMLElement {
    const el = document.createElement('div');
    el.className = className;
    el.textContent = text;
    if (onClick) {
      el.classList.add('is-clickable');
      el.addEventListener('click', onClick);
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick();
        }
      });
    }
    return el;
  }

  private async open(path: string): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    try {
      await editor.openFile(path);
    } catch (error) {
      this.context.layout.showToast(`Could not open dependency: ${(error as Error).message}`, 'error');
    }
  }

  private updateStatus(snapshot: DependencyGraphSnapshot): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;
    if (snapshot.fileCount === 0) {
      status.removeItem('dependencies');
      return;
    }
    const cycles = snapshot.cycles.length;
    status.setItem('dependencies', {
      text: cycles ? `Modules ⚠${cycles}` : 'Modules',
      tooltip: 'Project dependency graph — click to view',
      command: CommandIds.ViewDependencies,
      side: 'right',
      priority: 15,
    });
  }

  private removeStatus(): void {
    this.context.services.tryGet<StatusService>(ServiceKeys.Status)?.removeItem('dependencies');
  }

  private isCurrent(sequence: number, root: string): boolean {
    return sequence === this.refreshSequence && this.workspaceInfo()?.root === root;
  }

  /* ----- helpers ----- */
  private resolveSourceDir(info: WorkspaceInfo): string {
    const root = info.root.replace(/[\\/]+$/, '');
    const declared = info.project?.workspace?.sourceDirs?.[0];
    return declared ? `${root}/${declared}` : root;
  }

  private compilerPathOverride(): string | null {
    const value = this.context.services
      .tryGet<SettingsService>(ServiceKeys.Settings)
      ?.get('zornux.compiler.path', '');
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private workspaceInfo(): WorkspaceInfo | null {
    return this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.currentWorkspace() ?? null;
  }

  private engine(): DiagnosticSink | undefined {
    return this.context.services.tryGet<DiagnosticSink>(LanguageServiceKeys.Diagnostics);
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);
    try {
      const dir = await examplePath('modules');
      if (!dir) {
        log('dependency-graph: skipped (no examples root)');
        return;
      }
      const snapshot = await window.znxstudio.graph.build({ root: dir, sourceDir: dir });
      const mathPath = snapshot.moduleToFile['Math'];
      log(
        `graph: files=${snapshot.fileCount} modules=${Object.keys(snapshot.moduleToFile).length} ` +
          `unresolved=${snapshot.unresolved.length} cycles=${snapshot.cycles.length}; ` +
          `Math→${mathPath ? fileName(mathPath) : 'none'}; ` +
          `affected(Math)=[${mathPath ? affectedFiles(snapshot, mathPath).map(fileName).join(', ') : ''}]`,
      );
      if (this.compiler && (await this.compiler.info()).available) {
        const result = await this.compiler.checkProject({ sourceDir: dir, workspaceRoot: dir, compilerPath: this.compilerPathOverride() });
        const moduleDiags = result.diagnostics.filter((d) => MODULE_CODE.test(d.code));
        log(
          `project check: ran=${result.ran} outcome=${result.outcome} totalDiags=${result.diagnostics.length} ` +
            `moduleDiags=${moduleDiags.length} (${result.durationMs.toFixed(0)}ms)`,
        );
      }
    } catch (error) {
      log(`dependency-graph self-test failed: ${(error as Error).message}`);
    }
  }
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}
