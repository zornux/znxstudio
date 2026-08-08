import { ServiceKeys, type SourceControlService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { PullRequest } from './pullRequests';

/**
 * Pull Requests (Phase 12C). A panel over the SourceControlService: lists open
 * PRs via the `gh` CLI when it is installed + authenticated, and always offers a
 * "Create Pull Request" button that opens GitHub's compare page for the current
 * branch — so the feature is useful even without `gh`.
 */
export class PullRequestsModule implements IModule {
  readonly id = 'znxstudio.scm.pullRequests';
  readonly displayName = 'Pull Requests';

  private context!: ModuleContext;
  private scm!: SourceControlService;
  private panel!: HTMLElement;
  private prs: PullRequest[] = [];
  private loading = false;
  private loaded = false;
  private refreshSequence = 0;
  private error = '';

  activate(context: ModuleContext): void {
    this.context = context;
    this.scm = context.services.get<SourceControlService>(ServiceKeys.SourceControl);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-prs';
    context.layout.addPanelView({ id: 'pull-requests', title: 'Pull Requests', element: this.panel });

    context.commands.register(CommandIds.PrShow, () => this.reveal(), 'Pull Requests: Show');
    context.commands.register(CommandIds.PrRefresh, () => this.refresh(), 'Pull Requests: Refresh');

    context.subscriptions.push(this.scm.onDidChange(() => {
      if (this.loaded) void this.refresh();
      else this.render();
    }));
    this.render();
    void selfTestCoordinator.run('pullrequests', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.showPanelView('pull-requests');
    void this.refresh();
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence;
    if (!this.scm.gitHub()) {
      this.prs = [];
      this.loaded = false;
      this.loading = false;
      this.error = '';
      this.render();
      return;
    }
    this.loading = true;
    this.render();
    this.error = '';
    try {
      const prs = await this.scm.listPullRequests();
      if (sequence !== this.refreshSequence) return;
      this.prs = prs;
      this.loaded = true;
    } catch (error) {
      if (sequence !== this.refreshSequence) return;
      this.error = error instanceof Error ? error.message : String(error);
    } finally {
      if (sequence === this.refreshSequence) {
        this.loading = false;
        this.render();
      }
    }
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-prs-toolbar';
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = this.loading ? 'Loading…' : '⟳ Refresh';
    refresh.disabled = this.loading;
    refresh.addEventListener('click', () => void this.refresh());
    toolbar.appendChild(refresh);

    const prUrl = this.scm.pullRequestUrl();
    if (prUrl) {
      const create = document.createElement('button');
      create.className = 'znxstudio-btn-small';
      create.textContent = '⇅ Create Pull Request';
      create.addEventListener('click', () => void this.openExternal(prUrl));
      toolbar.appendChild(create);
    }
    const info = document.createElement('span');
    info.className = 'znxstudio-prs-info';
    const gh = this.scm.gitHub();
    info.textContent = gh ? `${gh.owner}/${gh.repo}` : 'No GitHub remote';
    toolbar.appendChild(info);
    this.panel.appendChild(toolbar);

    const body = document.createElement('div');
    body.className = 'znxstudio-prs-body';
    if (!gh) {
      body.textContent = 'This repository has no GitHub remote.';
      body.classList.add('is-muted');
    } else if (this.loading) {
      body.textContent = 'Loading pull requests…';
      body.classList.add('is-muted');
    } else if (this.error) {
      body.textContent = `Could not load pull requests: ${this.error}`;
      body.setAttribute('role', 'alert');
    } else if (!this.loaded) {
      body.textContent = 'Refresh to load open pull requests (requires the GitHub CLI `gh`).';
      body.classList.add('is-muted');
    } else if (this.prs.length === 0) {
      body.textContent = 'No open pull requests found (or the `gh` CLI is not installed / authenticated).';
      body.classList.add('is-muted');
    } else {
      for (const pr of this.prs) body.appendChild(this.row(pr));
    }
    this.panel.appendChild(body);
  }

  private row(pr: PullRequest): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-prs-row';
    row.tabIndex = 0;
    row.setAttribute('role', 'link');
    const num = document.createElement('span');
    num.className = 'znxstudio-prs-num';
    num.textContent = `#${pr.number}`;
    const title = document.createElement('span');
    title.className = 'znxstudio-prs-title';
    title.textContent = `${pr.title}${pr.isDraft ? ' (draft)' : ''}`;
    const meta = document.createElement('span');
    meta.className = 'znxstudio-prs-meta';
    meta.textContent = `${pr.author} · ${pr.headRefName} → ${pr.baseRefName}`;
    row.append(num, title, meta);
    row.addEventListener('click', () => {
      if (pr.url) void this.openExternal(pr.url);
    });
    row.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && pr.url) {
        event.preventDefault();
        void this.openExternal(pr.url);
      }
    });
    return row;
  }

  private async openExternal(url: string): Promise<void> {
    try {
      await window.znxstudio.shell.openExternal(url);
    } catch (error) {
      this.context.layout.showToast(`Could not open GitHub: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
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
    log(`pullrequests: gitHub=${this.scm.gitHub() !== null} prUrl=${this.scm.pullRequestUrl() ?? '(none)'}`);
  }
}
