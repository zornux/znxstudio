import { ServiceKeys, type SourceControlService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { diffStat, type Commit, type CommitFile } from './history';
import { commitUrl } from './github';

/**
 * Repo Explorer (Phase 12F). A commit-history panel over SourceControlService:
 * lists recent commits parsed from real `git log`, and expands a commit to show
 * the files it changed (line counts from `git show --numstat`), with a link to
 * the commit on GitHub when a GitHub remote is present.
 */
export class HistoryModule implements IModule {
  readonly id = 'znxstudio.scm.history';
  readonly displayName = 'Repo Explorer';

  private context!: ModuleContext;
  private scm!: SourceControlService;
  private panel!: HTMLElement;
  private commits: Commit[] = [];
  private readonly files = new Map<string, CommitFile[]>();
  private expanded: string | null = null;
  private loading = false;
  private loaded = false;
  private refreshSequence = 0;
  private error = '';

  activate(context: ModuleContext): void {
    this.context = context;
    this.scm = context.services.get<SourceControlService>(ServiceKeys.SourceControl);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-history';
    context.layout.addPanelView({ id: 'history', title: 'History', element: this.panel });

    context.commands.register(CommandIds.HistoryShow, () => this.reveal(), 'Repo Explorer: Show History');
    context.commands.register(CommandIds.HistoryRefresh, () => this.refresh(), 'Repo Explorer: Refresh');

    context.subscriptions.push(this.scm.onDidChange(() => {
      if (this.loaded) void this.refresh();
    }));
    this.render();
    void selfTestCoordinator.run('history', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.showPanelView('history');
    if (!this.loaded) void this.refresh();
  }

  private async refresh(): Promise<void> {
    const sequence = ++this.refreshSequence;
    if (!this.scm.isRepo()) {
      this.commits = [];
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
      const commits = await this.scm.log(50);
      if (sequence !== this.refreshSequence) return;
      this.commits = commits;
      this.files.clear();
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

  private async toggle(hash: string): Promise<void> {
    if (this.expanded === hash) {
      this.expanded = null;
      this.render();
      return;
    }
    this.expanded = hash;
    if (!this.files.has(hash)) {
      try {
        const files = await this.scm.commitFiles(hash);
        if (this.expanded !== hash) return;
        this.files.set(hash, files);
      } catch (error) {
        this.context.layout.showToast(`Could not load commit details: ${error instanceof Error ? error.message : String(error)}`, 'error');
        return;
      }
    }
    this.render();
  }

  private render(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-history-toolbar';
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = this.loading ? 'Loading…' : '⟳ Refresh';
    refresh.disabled = this.loading;
    refresh.addEventListener('click', () => void this.refresh());
    const info = document.createElement('span');
    info.className = 'znxstudio-history-info';
    info.textContent = this.scm.isRepo() ? `${this.commits.length} commits · ⎇ ${this.scm.branch() ?? '—'}` : 'Not a Git repository';
    toolbar.append(refresh, info);
    this.panel.appendChild(toolbar);

    if (!this.scm.isRepo()) return;
    if (this.error) {
      const error = document.createElement('div');
      error.className = 'znxstudio-history-empty';
      error.setAttribute('role', 'alert');
      error.textContent = `Could not load history: ${this.error}`;
      this.panel.appendChild(error);
      return;
    }
    if (!this.loaded && !this.loading) {
      const hint = document.createElement('div');
      hint.className = 'znxstudio-history-empty';
      hint.textContent = 'Refresh to load commit history.';
      this.panel.appendChild(hint);
      return;
    }

    for (const commit of this.commits) {
      const row = document.createElement('div');
      row.className = 'znxstudio-history-row';
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.setAttribute('aria-expanded', String(this.expanded === commit.hash));
      const hash = document.createElement('span');
      hash.className = 'znxstudio-history-hash';
      hash.textContent = commit.shortHash;
      const subject = document.createElement('span');
      subject.className = 'znxstudio-history-subject';
      subject.textContent = commit.subject;
      const meta = document.createElement('span');
      meta.className = 'znxstudio-history-meta';
      meta.textContent = `${commit.author} · ${commit.date}`;
      row.append(hash, subject, meta);
      row.addEventListener('click', () => void this.toggle(commit.hash));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void this.toggle(commit.hash);
        }
      });
      this.panel.appendChild(row);

      if (this.expanded === commit.hash) this.panel.appendChild(this.detail(commit));
    }
  }

  private detail(commit: Commit): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-history-detail';
    const files = this.files.get(commit.hash) ?? [];
    const stat = diffStat(files);

    const summary = document.createElement('div');
    summary.className = 'znxstudio-history-summary';
    summary.textContent = `${stat.files} file${stat.files === 1 ? '' : 's'} · +${stat.additions} −${stat.deletions}`;
    const gh = this.scm.gitHub();
    if (gh) {
      const link = document.createElement('button');
      link.className = 'znxstudio-btn-small';
      link.textContent = '⧉ GitHub';
      link.addEventListener('click', (event) => {
        event.stopPropagation();
        void this.openExternal(commitUrl(gh, commit.hash));
      });
      summary.appendChild(link);
    }
    wrap.appendChild(summary);

    for (const file of files) {
      const line = document.createElement('div');
      line.className = 'znxstudio-history-file';
      const counts = document.createElement('span');
      counts.className = 'znxstudio-history-counts';
      counts.textContent = file.binary ? 'bin' : `+${file.additions} −${file.deletions}`;
      const path = document.createElement('span');
      path.className = 'znxstudio-history-path';
      path.textContent = file.path;
      line.append(counts, path);
      wrap.appendChild(line);
    }
    return wrap;
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
    log(`history: isRepo=${this.scm.isRepo()} (log/numstat verified in the SCM self-test)`);
  }
}
