import {
  ServiceKeys,
  type AiService,
  type DependencyGraphService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { renderAiMarkdown } from './aiMarkdown';
import {
  buildArchitectureMessages,
  buildProjectMap,
  scanProject,
  summarizeProjectMap,
  type ProjectMap,
} from './architecture';

const MAX_FILES = 80;

/**
 * AI Architecture (Phase 10H — the Phase 10 finale). Analyzes the WHOLE project,
 * not one buffer: it scans the real workspace .zx files for top-level components,
 * folds in the module dependency graph, and asks the vendor-neutral AiService for
 * an architect-level review (layers, coupling, cycles, recommendations). Every
 * fact the model sees comes from actually scanning the workspace.
 */
export class ArchitectureModule implements IModule {
  readonly id = 'znxstudio.ai.architecture';
  readonly displayName = 'AI Architecture';

  private context!: ModuleContext;
  private ai!: AiService;
  private workspace!: WorkspaceService;
  private panel!: HTMLElement;
  private map: ProjectMap | null = null;
  private analysis = '';
  private running = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.ai = context.services.get<AiService>(ServiceKeys.Ai);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-arch';
    context.layout.addPanelView({ id: 'ai-architecture', title: 'AI Architecture', element: this.panel });

    context.commands.register(CommandIds.AiArchitecture, () => this.analyze(), 'AI: Analyze Architecture');

    this.render();
    void selfTestCoordinator.run('ai-architecture', () => this.maybeSelfTest());
  }

  private async analyze(): Promise<void> {
    if (!this.ai.isEnabled()) {
      this.context.layout.showToast('AI is off — configure a provider to analyze architecture.', 'info');
      return;
    }
    const root = this.workspace.currentFolder();
    if (!root) {
      this.context.layout.showToast('Open a folder to analyze its architecture.', 'info');
      return;
    }

    this.running = true;
    this.analysis = '';
    this.map = null;
    this.render();
    this.context.layout.showPanelView('ai-architecture');

    // Scan the real workspace (read-only).
    const scanned = await this.scanWorkspace(root);
    if (scanned.length === 0) {
      this.running = false;
      this.render();
      this.context.layout.showToast('No .zx files found in this workspace.', 'info');
      return;
    }
    this.map = buildProjectMap(scanProject(scanned));
    this.render();

    const graph = this.context.services.tryGet<DependencyGraphService>(ServiceKeys.DependencyGraph);
    const summary = summarizeProjectMap(this.map, graph?.snapshot() ?? null);
    const projectName = this.workspace.currentWorkspace()?.project?.name ?? this.baseName(root);
    const { system, messages } = buildArchitectureMessages(summary, projectName);
    const result = await this.ai.complete(messages, { system, temperature: 0.3, maxTokens: 2500 });
    this.running = false;
    if (!result.ok) {
      this.render();
      this.context.layout.showToast(`Architecture analysis failed: ${result.error ?? 'unknown error'}`, 'error');
      return;
    }
    this.analysis = result.text.trim();
    this.render();
  }

  private async scanWorkspace(root: string): Promise<{ file: string; text: string }[]> {
    let files: string[] = [];
    try {
      files = (await window.znxstudio.search.files(root)).filter((f) => f.toLowerCase().endsWith('.zx'));
    } catch {
      files = [];
    }
    const rootLen = root.replace(/[\\/]+$/, '').length + 1;
    const out: { file: string; text: string }[] = [];
    for (const path of files.slice(0, MAX_FILES)) {
      try {
        const text = await window.znxstudio.fs.readFile(path);
        out.push({ file: path.slice(rootLen).replace(/\\/g, '/'), text });
      } catch {
        // unreadable file — skip
      }
    }
    return out;
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-arch-toolbar';
    const run = document.createElement('button');
    run.className = 'znxstudio-btn-small';
    run.textContent = this.running ? 'Analyzing…' : '🏛 Analyze Architecture';
    run.disabled = this.running;
    run.addEventListener('click', () => void this.analyze());
    toolbar.appendChild(run);
    if (this.analysis) {
      const copy = document.createElement('button');
      copy.className = 'znxstudio-btn-small';
      copy.textContent = 'Copy';
      copy.addEventListener('click', () => {
        void navigator.clipboard?.writeText(this.analysis);
        this.context.layout.showToast('Analysis copied.', 'success');
      });
      toolbar.appendChild(copy);
    }
    const provider = document.createElement('span');
    provider.className = 'znxstudio-arch-provider';
    provider.textContent = this.ai.isEnabled() ? this.ai.providerLabel() : 'AI off';
    toolbar.appendChild(provider);
    this.panel.appendChild(toolbar);

    if (this.map) {
      const stats = document.createElement('div');
      stats.className = 'znxstudio-arch-stats';
      const kinds = Object.entries(this.map.byKind)
        .sort((a, b) => b[1] - a[1])
        .map(([kind, count]) => `${kind} ×${count}`)
        .join(' · ');
      stats.textContent = `${this.map.fileCount} files · ${this.map.componentCount} components${kinds ? ` · ${kinds}` : ''}`;
      this.panel.appendChild(stats);
    }

    const body = document.createElement('div');
    body.className = 'znxstudio-arch-body';
    if (this.running && !this.analysis) {
      body.textContent = this.map ? `Analyzing ${this.map.fileCount} files with ${this.ai.providerLabel()}…` : 'Scanning workspace…';
      body.classList.add('is-muted');
    } else if (!this.analysis) {
      body.textContent = 'Analyze the whole project: scans the workspace .zx files + module graph, then reviews the architecture (layers, coupling, cycles, recommendations).';
      body.classList.add('is-muted');
    } else {
      const md = document.createElement('div');
      md.className = 'znxstudio-arch-analysis';
      renderAiMarkdown(md, this.analysis);
      body.appendChild(md);
    }
    this.panel.appendChild(body);
  }

  private baseName(path: string): string {
    return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
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

    const synthetic = [
      { file: 'app.zx', text: 'module app\napplication Main\n    use Greeter\nend\n' },
      { file: 'greeter.zx', text: 'module greet\nservice Greeter\n    use UserRepository\nend\nfunction helper\n    give back 1\nend\n' },
      { file: 'users.zx', text: 'module data\nrepository UserRepository\nend\nclass User\n    has field name\nend\n' },
    ];
    const map = buildProjectMap(scanProject(synthetic));
    log(`arch map: files=${map.fileCount} components=${map.componentCount} byKind=${JSON.stringify(map.byKind)}`);
    const summary = summarizeProjectMap(map, null);
    log(`arch summary: hasService=${summary.includes('service Greeter')} hasRepo=${summary.includes('repository UserRepository')} lines=${summary.split('\n').length}`);
    const framed = buildArchitectureMessages(summary, 'Demo');
    log(`arch prompt: isArchitect=${framed.system.includes('software architect')} grounded=${framed.system.includes('do not invent')}`);

    // REAL scan of the actual example project (read-only) — proves the map on real files.
    try {
      const root = 'C:\\Studio Apps\\xojin\\examples';
      const files = (await window.znxstudio.search.files(root)).filter((f) => f.toLowerCase().endsWith('.zx'));
      const rootLen = root.length + 1;
      const scanned: { file: string; text: string }[] = [];
      for (const path of files.slice(0, 25)) {
        try {
          scanned.push({ file: path.slice(rootLen).replace(/\\/g, '/'), text: await window.znxstudio.fs.readFile(path) });
        } catch {
          /* skip */
        }
      }
      const realMap = buildProjectMap(scanProject(scanned));
      const topKinds = Object.entries(realMap.byKind).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, c]) => `${k}×${c}`).join(' ');
      log(`arch REAL scan(examples): files=${realMap.fileCount} components=${realMap.componentCount} top=[${topKinds}]`);
      if (this.ai.isEnabled()) {
        log(`arch REAL analyze available (provider=${this.ai.providerId()}) — exercised via UI`);
      } else {
        log('arch REAL analyze: no provider configured — real-project scan/map proven');
      }
    } catch (error) {
      log(`arch REAL failed: ${(error as Error).message}`);
    }
  }
}
