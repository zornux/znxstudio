import { ServiceKeys, type OutputService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { Unsubscribe } from '../../shared/types';
import { backendUsesServe, buildProxy, isFullStackWorkspace, parseServeLine, resolveFullStack } from './fullstack';
import { examplePath, examplesParent } from '../core/selftestFixtures';

const BACKEND_ID = 'fullstack-backend';

/**
 * Full-Stack orchestration (Phase 6H, the Zoijs capstone). One command runs the
 * whole stack: the Zornux backend (`zornux serve` — or `run` if it publishes no
 * service) streamed through the Task service, and the Zoijs frontend served by
 * the PreviewServer (6G). It discovers the backend's endpoint from its startup
 * output and starts the frontend with a dev proxy (`/api` → backend) so the two
 * are wired same-origin. Stop tears both down.
 */
export class FullStackModule implements IModule {
  readonly id = 'znxstudio.fullstack';
  readonly displayName = 'Full-Stack';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private frame?: HTMLIFrameElement;
  private outputSub?: Unsubscribe;
  private running = false;
  private backendUrl: string | null = null;
  private readonly routes: { method: string; path: string }[] = [];
  private lineBuffer = '';

  activate(context: ModuleContext): void {
    this.context = context;
    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-fullstack';
    context.layout.addPanelView({ id: 'fullstack', title: 'Full-Stack', element: this.surface });

    context.commands.register(CommandIds.FullStackStart, () => this.start(), 'Preview: Start Full-Stack');
    context.commands.register(CommandIds.FullStackStop, () => this.stop(), 'Preview: Stop Full-Stack');

    this.renderIdle();
    void selfTestCoordinator.run('fullstack', () => this.maybeSelfTest());
  }

  deactivate(): void {
    void this.stop();
  }

  private workspace(): WorkspaceService | undefined {
    return this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
  }

  private async start(): Promise<void> {
    const info = this.workspace()?.currentWorkspace() ?? null;
    const root = this.workspace()?.currentFolder();
    if (!root || !isFullStackWorkspace(info)) {
      this.context.layout.showToast('Open a Zornux + Zoijs full-stack workspace.', 'error');
      return;
    }
    const compiler = await window.znxstudio.compiler.info();
    if (!compiler.available) {
      this.context.layout.showToast('Zornux compiler not available.', 'error');
      return;
    }

    const webHasIndex = await this.hasWebIndex(root);
    const layout = resolveFullStack(root, webHasIndex);
    const backendSource = await window.znxstudio.fs.readFile(layout.backendEntry).catch(() => '');
    const useServe = backendUsesServe(backendSource);

    this.running = true;
    this.backendUrl = null;
    this.routes.length = 0;
    this.lineBuffer = '';

    // Start the backend, streamed. Parse its output for the endpoint + routes.
    const output = this.context.services.tryGet<OutputService>(ServiceKeys.Output);
    output?.show();
    output?.appendLine(`> zornux ${useServe ? 'serve' : 'run'} ${layout.backendEntry}`);
    this.outputSub = window.znxstudio.task.onOutput((event) => {
      if (event.id !== BACKEND_ID) return;
      output?.append(event.data);
      this.consume(event.data, layout.frontendDir);
    });
    void window.znxstudio.task.run({
      id: BACKEND_ID,
      command: `"${compiler.path}" ${useServe ? 'serve' : 'run'} "${layout.backendEntry}"`,
      cwd: root,
    });

    this.renderRunning('starting backend…');

    // A plain `run` backend has no endpoint — start the frontend right away.
    if (!useServe) await this.startFrontend(layout.frontendDir);
  }

  /** Feed streamed backend output line-by-line; react when the endpoint appears. */
  private consume(chunk: string, frontendDir: string): void {
    this.lineBuffer += chunk;
    const lines = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const parsed = parseServeLine(line);
      if (parsed.route) this.routes.push(parsed.route);
      if (parsed.url && !this.backendUrl) {
        this.backendUrl = parsed.url;
        void this.startFrontend(frontendDir);
      }
    }
    if (this.running) this.renderRunning();
  }

  private async startFrontend(frontendDir: string): Promise<void> {
    const proxy = this.backendUrl ? buildProxy(this.backendUrl) : undefined;
    const result = await window.znxstudio.preview.start(frontendDir, proxy);
    if (!result.ok || !result.url) {
      this.context.layout.showToast(result.error ?? 'Could not start the frontend preview.', 'error');
      return;
    }
    this.status()?.setItem('fullstack.status', {
      text: 'Full-Stack',
      tooltip: `Backend ${this.backendUrl ?? '(run)'} · Frontend ${result.url}`,
      command: CommandIds.FullStackStart,
      side: 'right',
      priority: 36,
    });
    this.renderRunning(undefined, result.url);
  }

  private async stop(): Promise<void> {
    this.running = false;
    this.outputSub?.();
    this.outputSub = undefined;
    window.znxstudio.task.kill(BACKEND_ID);
    await window.znxstudio.preview.stop();
    this.backendUrl = null;
    this.frame = undefined;
    this.status()?.removeItem('fullstack.status');
    this.renderIdle();
  }

  private async hasWebIndex(root: string): Promise<boolean> {
    try {
      const web = `${root.replace(/[\\/]+$/, '')}/web`;
      const inner = await window.znxstudio.fs.readDirectory(web);
      return inner.some((n) => n.name === 'index.html');
    } catch {
      return false;
    }
  }

  /* ----- rendering ----- */

  private renderIdle(): void {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-preview-idle';
    const message = document.createElement('p');
    message.textContent = 'Run the Zornux backend and Zoijs frontend together.';
    const button = document.createElement('button');
    button.className = 'znxstudio-btn primary';
    button.textContent = '▶ Start Full-Stack';
    button.addEventListener('click', () => void this.start());
    wrap.append(message, button);
    this.surface.replaceChildren(wrap);
  }

  private renderRunning(backendStatus?: string, frontendUrl?: string): void {
    const fragment = document.createDocumentFragment();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-preview-toolbar';
    const label = document.createElement('span');
    label.className = 'znxstudio-fullstack-label';
    const backend = this.backendUrl ? `backend ${this.backendUrl}` : backendStatus ?? 'backend (run)';
    label.textContent = `${backend}${this.routes.length ? ` · ${this.routes.length} route(s)` : ''}`;
    const reload = this.iconButton('⟳', 'Reload frontend', () => {
      if (this.frame && frontendUrl) this.frame.src = `${frontendUrl}?_=${Date.now()}`;
    });
    const stop = this.iconButton('⏹', 'Stop full-stack', () => void this.stop());
    toolbar.append(label, reload, stop);
    fragment.appendChild(toolbar);

    if (this.routes.length) {
      const routes = document.createElement('div');
      routes.className = 'znxstudio-fullstack-routes';
      routes.textContent = this.routes.map((r) => `${r.method} ${r.path}`).join('  ·  ');
      fragment.appendChild(routes);
    }

    if (frontendUrl) {
      this.frame = document.createElement('iframe');
      this.frame.className = 'znxstudio-preview-frame';
      this.frame.src = frontendUrl;
      fragment.appendChild(this.frame);
    } else {
      const waiting = document.createElement('div');
      waiting.className = 'znxstudio-preview-idle';
      waiting.textContent = 'Waiting for the backend to come up…';
      fragment.appendChild(waiting);
    }

    this.surface.replaceChildren(fragment);
  }

  private iconButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'znxstudio-icon-btn';
    button.title = title;
    button.textContent = text;
    button.addEventListener('click', onClick);
    return button;
  }

  private status(): StatusService | undefined {
    return this.context.services.tryGet<StatusService>(ServiceKeys.Status);
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

    // Parser conformance against the REAL captured serve output.
    const lines = [
      'Zornux serving on http://localhost:8080/',
      'Service Greeter on port 8080',
      '  GET    /greeting',
      'Listening on http://localhost:8080/',
    ];
    const parsed = lines.map(parseServeLine);
    log(`fullstack parse: url=${parsed.find((p) => p.url)?.url ?? '-'} service=${parsed.find((p) => p.service)?.service?.name ?? '-'} route=${parsed.find((p) => p.route) ? `${parsed[2].route?.method} ${parsed[2].route?.path}` : '-'}`);
    log(`fullstack proxy: ${JSON.stringify(buildProxy('http://localhost:8080/'))}`);

    // E2E: run the REAL Zornux backend via the task service, capture its endpoint.
    try {
      const compiler = await window.znxstudio.compiler.info();
      if (!compiler.available) {
        log('fullstack backend skipped: compiler unavailable');
        return;
      }
      const serviceRoute = await examplePath('debug', 'service_route.zx');
      const cwd = await examplesParent();
      if (!serviceRoute) {
        log('fullstack backend skipped: examples root unavailable');
        return;
      }
      let endpoint: string | null = null;
      const routes: string[] = [];
      let buffer = '';
      const sub = window.znxstudio.task.onOutput((event) => {
        if (event.id !== 'fullstack-selftest') return;
        buffer += event.data;
        const parts = buffer.split(/\r?\n/);
        buffer = parts.pop() ?? '';
        for (const line of parts) {
          const p = parseServeLine(line);
          if (p.url && !endpoint) endpoint = p.url;
          if (p.route) routes.push(`${p.route.method} ${p.route.path}`);
        }
      });
      void window.znxstudio.task.run({ id: 'fullstack-selftest', command: `"${compiler.path}" serve "${serviceRoute}"`, cwd });
      for (let i = 0; i < 40 && !endpoint; i += 1) await new Promise((r) => setTimeout(r, 250));
      window.znxstudio.task.kill('fullstack-selftest');
      sub();
      log(`fullstack backend(real serve): endpoint=${endpoint ?? 'none'} routes=[${routes.join(', ')}]`);
    } catch (error) {
      log(`fullstack backend failed: ${(error as Error).message}`);
    }
  }
}
