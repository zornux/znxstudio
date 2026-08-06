import { ServiceKeys, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { injectPreviewHtml } from '../../shared/zoijsPreview';

const DOCS_SITE = 'C:\\Studio Apps\\Xornux frontend documentation';

/**
 * Live Preview (Phase 6G). Serves the workspace over a local static http server
 * (main-process PreviewServer — no-build Zoijs needs http + ESM + import maps)
 * and hosts it in a cross-origin `<iframe>`. The server injects the DevTools
 * bridge (6F) into served HTML, so the DevTools panel goes live automatically
 * (the bridge posts inspector events to this window, where the Zoijs module's
 * listener folds them in). Reload re-navigates the iframe; Stop tears the server
 * down.
 */
export class PreviewModule implements IModule {
  readonly id = 'znxstudio.preview';
  readonly displayName = 'Live Preview';

  private context!: ModuleContext;
  private surface!: HTMLElement;
  private frame?: HTMLIFrameElement;
  private url: string | null = null;

  activate(context: ModuleContext): void {
    this.context = context;

    this.surface = document.createElement('div');
    this.surface.className = 'znxstudio-preview';
    context.layout.addPanelView({ id: 'preview', title: 'Preview', element: this.surface });

    context.commands.register(CommandIds.PreviewStart, () => this.start(), 'Preview: Start Live Preview');
    context.commands.register(CommandIds.PreviewStop, () => this.stop(), 'Preview: Stop Live Preview');

    this.renderIdle();
    void selfTestCoordinator.run('preview', () => this.maybeSelfTest());
  }

  deactivate(): void {
    void window.znxstudio.preview.stop();
  }

  /* ----- lifecycle ----- */

  private async start(): Promise<void> {
    const root = await this.resolveRoot();
    if (!root) {
      this.context.layout.showToast('Open a folder with an index.html to preview.', 'error');
      return;
    }
    const result = await window.znxstudio.preview.start(root);
    if (!result.ok || !result.url) {
      this.context.layout.showToast(result.error ?? 'Could not start the preview server.', 'error');
      return;
    }
    this.url = result.url;
    this.renderRunning();
    this.status()?.setItem('preview.status', {
      text: '🌐 Preview',
      tooltip: `Serving ${result.root} at ${result.url}`,
      command: CommandIds.PreviewStart,
      side: 'right',
      priority: 35,
    });
  }

  private async stop(): Promise<void> {
    await window.znxstudio.preview.stop();
    this.url = null;
    this.frame = undefined;
    this.status()?.removeItem('preview.status');
    this.renderIdle();
  }

  private reload(): void {
    if (this.frame && this.url) this.frame.src = `${this.url}?_=${Date.now()}`;
  }

  /** Prefer a folder that actually has an index.html: the root, or a `web/` subdir. */
  private async resolveRoot(): Promise<string | null> {
    const root = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.currentFolder();
    if (!root) return null;
    try {
      const top = await window.znxstudio.fs.readDirectory(root);
      if (top.some((n) => n.name === 'index.html')) return root;
      if (top.some((n) => n.name === 'web')) {
        const web = `${root.replace(/[\\/]+$/, '')}\\web`;
        const inner = await window.znxstudio.fs.readDirectory(web).catch(() => []);
        if (inner.some((n) => n.name === 'index.html')) return web;
      }
    } catch {
      /* fall through */
    }
    return root;
  }

  /* ----- rendering ----- */

  private renderIdle(): void {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-preview-idle';
    const message = document.createElement('p');
    message.textContent = 'Live Preview serves the workspace and runs your Zoijs app.';
    const button = document.createElement('button');
    button.className = 'znxstudio-btn primary';
    button.textContent = '▶ Start Preview';
    button.addEventListener('click', () => void this.start());
    wrap.append(message, button);
    this.surface.replaceChildren(wrap);
  }

  private renderRunning(): void {
    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-preview-toolbar';
    const address = document.createElement('span');
    address.className = 'znxstudio-preview-url';
    address.textContent = this.url ?? '';
    const reload = this.iconButton('⟳', 'Reload', () => this.reload());
    const open = this.iconButton('↗', 'Open in browser', () => {
      if (this.url) void window.znxstudio.shell.openExternal(this.url);
    });
    const stop = this.iconButton('⏹', 'Stop preview', () => void this.stop());
    toolbar.append(reload, open, stop, address);

    this.frame = document.createElement('iframe');
    this.frame.className = 'znxstudio-preview-frame';
    this.frame.src = this.url ?? 'about:blank';

    this.surface.replaceChildren(toolbar, this.frame);
  }

  private iconButton(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'znxstudio-icon-btn';
    button.title = title;
    button.textContent = label;
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

    let started: { ok: boolean; url?: string } = { ok: false };
    try {
      // Serve the real docs site (it has a working import map + vendored Zoijs).
      started = await window.znxstudio.preview.start(DOCS_SITE);
      log(`preview start(docs-site): ok=${started.ok} url=${started.url ?? '-'}`);
      if (!started.ok || !started.url) return;
      const base = started.url;

      // Robust proof: the server injects the DevTools bridge into the REAL docs
      // index.html exactly as it serves it (same pure function). fs read works;
      // a file:// renderer cannot fetch() http.
      const realIndex = await window.znxstudio.fs.readFile(`${DOCS_SITE}\\index.html`);
      const injected = injectPreviewHtml(realIndex);
      log(`preview inject(real docs index): bridge=${injected.includes('attachInspector')} devtoolsMap=${injected.includes('@zoijs/core/devtools')} grew=${injected.length > realIndex.length}`);

      // Best-effort live end-to-end: frame the running app and collect DevTools
      // events its injected bridge posts. (Cross-origin http-in-file:// frame load
      // is environment-sensitive under headless Electron; the injection proof above
      // is authoritative. In the real UI this lights up the DevTools panel.)
      const events: string[] = [];
      let allMessages = 0;
      const onMessage = (event: MessageEvent) => {
        allMessages += 1;
        const data = event.data as { __zoijsDevtools?: { type: string; nodeKind?: string } } | null;
        if (data?.__zoijsDevtools) events.push(data.__zoijsDevtools.nodeKind ?? data.__zoijsDevtools.type);
      };
      window.addEventListener('message', onMessage);
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      frame.addEventListener('load', () => log('preview iframe loaded'));
      frame.addEventListener('error', () => log('preview iframe error'));
      frame.src = base;
      document.body.appendChild(frame);
      await new Promise((r) => setTimeout(r, 4000));
      window.removeEventListener('message', onMessage);
      frame.remove();
      const kinds = [...new Set(events)].sort();
      log(`preview live devtools: allMessages=${allMessages} devtoolsEvents=${events.length} kinds=[${kinds.join(',')}]`);
    } catch (error) {
      log(`preview self-test failed: ${(error as Error).message}`);
    } finally {
      if (started.ok) await window.znxstudio.preview.stop();
    }
  }
}
