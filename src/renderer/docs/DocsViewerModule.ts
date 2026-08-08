import {
  ServiceKeys,
  type DocsService,
  type DocsSource,
  type EditorService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { classifyLink, headingSlug, inlineText, parseMarkdown, renderMarkdown, resolveDocPath } from './markdown';
import { PRODUCT_GUIDE } from './productGuide';

/** A document currently on the viewer's history stack. */
interface HistoryEntry {
  source: DocsSource;
  /** Path relative to `source.root`, forward-slashed. Empty for in-memory docs. */
  path: string;
  title: string;
  markdown: string;
  anchor?: string;
}

/** Documents larger than this are truncated: the viewer is not a text editor. */
const MAX_DOCUMENT_BYTES = 2_000_000;

/**
 * Documentation viewer (Phase 18A).
 *
 * Renders Markdown from three places — a folder of `.md` files on disk, the
 * output of `zornux doc` (18B), and lesson content (18E) — through one safe
 * renderer that never builds HTML from text.
 *
 * Reads are CONFINED to the source root a document was opened from. Relative
 * links resolve within that root and cannot climb out of it; `..` segments that
 * would escape are dropped, and the resulting path is re-joined to the root
 * rather than concatenated. A document on disk cannot make the viewer read an
 * arbitrary file.
 */
export class DocsViewerModule implements IModule, DocsService {
  readonly id = 'znxstudio.docs.viewer';
  readonly displayName = 'Documentation Viewer';

  private moduleContext!: ModuleContext;
  private editor: EditorService | undefined;
  private workspace: WorkspaceService | undefined;
  private view!: HTMLElement;
  private body!: HTMLElement;
  private titleBar!: HTMLElement;

  private history: HistoryEntry[] = [];
  private cursor = -1;
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.moduleContext = context;
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    context.services.register(ServiceKeys.Docs, this);

    this.view = document.createElement('div');
    this.view.className = 'znxstudio-docs-viewer';
    this.titleBar = document.createElement('div');
    this.titleBar.className = 'znxstudio-docs-titlebar';
    this.body = document.createElement('article');
    this.body.className = 'znxstudio-md';
    this.view.append(this.titleBar, this.body);

    context.commands.register(CommandIds.DocsBack, () => this.back(), 'Docs: Back');
    context.commands.register(CommandIds.DocsForward, () => this.forward(), 'Docs: Forward');
    context.commands.register(CommandIds.DocsOpenProductGuide, () => this.openProductGuide(), 'Help: ZnxStudio Documentation');
    context.commands.register(CommandIds.DocsOpenWorkspaceReadme, () => this.openWorkspaceReadme(), 'Docs: Open README');

    void selfTestCoordinator.run('docs-viewer', () => this.maybeSelfTest());
  }

  /* ----- DocsService ----- */

  current(): { title: string; path: string } | null {
    const entry = this.history[this.cursor];
    return entry ? { title: entry.title, path: entry.path } : null;
  }

  canGoBack(): boolean {
    return this.cursor > 0;
  }

  canGoForward(): boolean {
    return this.cursor >= 0 && this.cursor < this.history.length - 1;
  }

  async openFile(source: DocsSource, relativePath: string): Promise<void> {
    const path = resolveDocPath('', relativePath);
    if (!path) {
      this.moduleContext.layout.showToast('That document link is empty.', 'error');
      return;
    }
    let markdown: string;
    try {
      markdown = await window.znxstudio.fs.readFile(this.absolute(source, path));
    } catch {
      this.moduleContext.layout.showToast(`Could not open "${path}".`, 'error');
      return;
    }
    this.push({ source, path, title: this.titleOf(markdown, path), markdown });
  }

  openText(title: string, markdown: string, source?: DocsSource): void {
    this.push({ source: source ?? { label: title, root: null }, path: '', title, markdown });
  }

  back(): void {
    if (!this.canGoBack()) return;
    this.cursor -= 1;
    this.show();
  }

  forward(): void {
    if (!this.canGoForward()) return;
    this.cursor += 1;
    this.show();
  }

  /* ----- navigation ----- */

  /**
   * Rejoin a confined relative path to its root. `resolveDocPath` has already
   * dropped any `..` that would climb above it, so the result is always inside.
   */
  private absolute(source: DocsSource, path: string): string {
    if (!source.root) throw new Error('This document has no folder on disk.');
    return `${source.root.replace(/[\\/]+$/, '')}/${path}`;
  }

  private titleOf(markdown: string, fallback: string): string {
    for (const block of parseMarkdown(markdown.slice(0, 4000))) {
      if (block.kind === 'heading') return inlineText(block.children);
    }
    return fallback.split('/').pop() ?? fallback;
  }

  private push(entry: HistoryEntry): void {
    // A new document truncates the forward history, the way a browser does.
    this.history = [...this.history.slice(0, this.cursor + 1), entry];
    this.cursor = this.history.length - 1;
    this.show();
  }

  private async navigate(href: string): Promise<void> {
    const entry = this.history[this.cursor];
    if (!entry) return;
    if (!entry.source.root) {
      this.moduleContext.layout.showToast('This document is generated in memory; its links have no folder to resolve against.', 'info');
      return;
    }
    const target = resolveDocPath(entry.path, href);
    if (!target) {
      this.moduleContext.layout.showToast('That link points outside the documentation folder.', 'error');
      return;
    }
    await this.openFile(entry.source, target);
    const hash = href.indexOf('#');
    if (hash !== -1) this.scrollToAnchor(href.slice(hash + 1));
  }

  private scrollToAnchor(anchor: string): void {
    const slug = headingSlug(anchor);
    const target = Array.from(this.body.querySelectorAll('h1,h2,h3,h4,h5,h6')).find((h) => h.id === slug);
    target?.scrollIntoView({ block: 'start' });
  }

  private async openExternal(href: string): Promise<void> {
    // `classifyLink` already proved this is http(s); the main process opens it.
    if (classifyLink(href) !== 'external') return;
    try {
      await window.znxstudio.shell.openExternal(href);
    } catch {
      this.moduleContext.layout.showToast(`Could not open ${href}.`, 'error');
    }
  }

  private async openWorkspaceReadme(): Promise<void> {
    const root = this.workspace?.currentFolder();
    if (!root) {
      this.moduleContext.layout.showToast('Open a folder first.', 'info');
      return;
    }
    await this.openFile({ label: 'Workspace', root }, 'README.md');
    this.reveal();
  }

  private openProductGuide(): void {
    this.openText('ZnxStudio Documentation', PRODUCT_GUIDE, { label: 'ZnxStudio', root: null });
  }

  /* ----- UI ----- */

  reveal(): void {
    this.editor?.showView(this.view);
  }

  private show(): void {
    const entry = this.history[this.cursor];
    if (!entry) return;

    this.titleBar.replaceChildren();
    for (const [label, enabled, run] of [
      ['← Back', this.canGoBack(), () => this.back()],
      ['Forward →', this.canGoForward(), () => this.forward()],
    ] as [string, boolean, () => void][]) {
      const button = document.createElement('button');
      button.className = 'znxstudio-btn-small';
      button.textContent = label;
      button.disabled = !enabled;
      button.addEventListener('click', run);
      this.titleBar.appendChild(button);
    }
    const crumb = document.createElement('span');
    crumb.className = 'znxstudio-docs-crumb';
    crumb.textContent = entry.path ? `${entry.source.label} · ${entry.path}` : entry.source.label;
    this.titleBar.appendChild(crumb);

    const truncated = entry.markdown.length > MAX_DOCUMENT_BYTES;
    const text = truncated ? entry.markdown.slice(0, MAX_DOCUMENT_BYTES) : entry.markdown;

    this.body.replaceChildren();
    this.body.appendChild(
      renderMarkdown(parseMarkdown(text), {
        onNavigate: (href) => void this.navigate(href),
        onExternal: (href) => void this.openExternal(href),
        onAnchor: (anchor) => this.scrollToAnchor(anchor),
      }),
    );
    if (truncated) {
      const note = document.createElement('p');
      note.className = 'znxstudio-docs-note';
      note.textContent = `Document truncated at ${MAX_DOCUMENT_BYTES.toLocaleString()} characters.`;
      this.body.appendChild(note);
    }
    this.body.scrollTop = 0;
    this.reveal();
    this.changeEmitter.fire();
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    let tempDir = '';
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
      tempDir = info.tempDir;
    } catch {
      return;
    }
    if (!enabled || !tempDir) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      const root = `${tempDir}\\znxstudio-docs-selftest`;
      await window.znxstudio.fs.writeFile(
        `${root}\\index.md`,
        '# Index\n\nSee [the guide](guide/intro.md).\n\n[evil](javascript:alert(1))\n',
      );
      await window.znxstudio.fs.writeFile(`${root}\\guide\\intro.md`, '# Intro\n\nBack to [index](../index.md).\n');

      const source = { label: 'Self-test', root };
      await this.openFile(source, 'index.md');
      log(`docs REAL open: title="${this.current()?.title}" back=${this.canGoBack()} (expect back=false)`);

      const unsafe = this.body.querySelectorAll('.znxstudio-md-unsafe').length;
      const links = this.body.querySelectorAll('a.znxstudio-md-link').length;
      log(`docs REAL link safety: javascript: rendered as text (unsafe spans=${unsafe}, anchors=${links}) — expect 1 and 1`);

      await this.navigate('guide/intro.md');
      log(`docs REAL navigate: now "${this.current()?.path}" back=${this.canGoBack()} (expect guide/intro.md, true)`);

      await this.navigate('../index.md');
      log(`docs REAL relative up: now "${this.current()?.path}" (expect index.md)`);

      this.back();
      log(`docs REAL back: "${this.current()?.path}" forward=${this.canGoForward()} (expect guide/intro.md, true)`);

      const escaped = resolveDocPath('guide/intro.md', '../../../../etc/passwd');
      log(`docs confinement: "../../../../etc/passwd" from guide/intro.md → "${escaped}" (never climbs above the root)`);
    } catch (error) {
      log(`docs REAL failed: ${(error as Error).message}`);
    }
  }
}
