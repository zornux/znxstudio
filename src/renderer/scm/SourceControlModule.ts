import {
  ServiceKeys,
  type EditorService,
  type GitCommitResult,
  type SourceControlService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { GitExecResult } from '../../shared/types';
import { groupStatus, parseStatus, statusLetter, type GitFileStatus } from './gitStatus';
import {
  blobUrl,
  detectGitHub,
  newPullRequestUrl,
  parseRemotes,
  repoUrl,
  type GitHubRepo,
  type GitRemote,
} from './github';
import { GH_PR_FIELDS, parseGhPrList, type PullRequest } from './pullRequests';
import { countConflicts, hasConflictMarkers, resolveConflicts, type ConflictChoice } from './conflicts';
import { localBranches, parseBranches, validateBranchName, type Branch } from './branches';
import { LOG_FORMAT, parseLog, parseNumstat, type Commit, type CommitFile } from './history';

/**
 * Source Control (Phase 12A). The Git view: detects the repo for the active
 * workspace folder, lists staged / changed / conflicted files parsed from real
 * `git status`, and stages / unstages / commits — all through the main-process
 * git seam. Publishes SourceControlService, the base later SCM phases build on.
 */
export class SourceControlModule implements IModule, SourceControlService {
  readonly id = 'znxstudio.sourceControl';
  readonly displayName = 'Source Control';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private editor: EditorService | undefined;
  private statusBar: StatusService | undefined;
  private view!: HTMLElement;
  private repoRoot: string | null = null;
  private currentBranch: string | null = null;
  private entries: GitFileStatus[] = [];
  private remoteList: GitRemote[] = [];
  private gitHubRepo: GitHubRepo | null = null;
  private defaultBase = 'main';
  private branchList: Branch[] = [];
  private commitMessage = '';
  private readonly changeEmitter = new Emitter<void>();
  readonly onDidChange = this.changeEmitter.event;

  async activate(context: ModuleContext): Promise<void> {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    this.statusBar = context.services.tryGet<StatusService>(ServiceKeys.Status);

    context.services.register(ServiceKeys.SourceControl, this);
    this.view = document.createElement('div');
    this.view.className = 'znxstudio-scm';

    context.layout.addActivityItem({ id: 'scm', label: 'Source Control', icon: '⎇', onSelect: () => this.reveal() });
    context.commands.register(CommandIds.ScmShow, () => this.reveal(), 'Source Control: Show');
    context.commands.register(CommandIds.ScmRefresh, () => void this.refresh(), 'Source Control: Refresh');
    context.commands.register(CommandIds.ScmCommit, () => void this.commitFromInput(), 'Source Control: Commit');
    context.commands.register(CommandIds.ScmStageAll, () => void this.stageAll(), 'Source Control: Stage All');
    context.commands.register(CommandIds.ScmOpenOnGitHub, () => this.openActiveOnGitHub(), 'Source Control: Open File on GitHub');
    context.commands.register(CommandIds.ScmAcceptOurs, () => void this.resolveActive('ours'), 'Source Control: Accept Ours');
    context.commands.register(CommandIds.ScmAcceptTheirs, () => void this.resolveActive('theirs'), 'Source Control: Accept Theirs');
    context.commands.register(CommandIds.ScmAcceptBoth, () => void this.resolveActive('both'), 'Source Control: Accept Both');
    context.commands.register(CommandIds.ScmCheckout, () => this.showBranchPicker(), 'Source Control: Checkout Branch');
    context.commands.register(CommandIds.ScmCreateBranch, () => void this.createBranchPrompt(), 'Source Control: Create Branch');

    this.workspace.onDidChangeWorkspace(() => void this.detectAndRefresh());
    await this.detectAndRefresh();

    void selfTestCoordinator.run('sourcecontrol', () => this.maybeSelfTest());
  }

  /* ----- SourceControlService ----- */
  isRepo(): boolean {
    return this.repoRoot !== null;
  }
  root(): string | null {
    return this.repoRoot;
  }
  branch(): string | null {
    return this.currentBranch;
  }
  status(): GitFileStatus[] {
    return this.entries;
  }
  remotes(): GitRemote[] {
    return this.remoteList;
  }
  gitHub(): GitHubRepo | null {
    return this.gitHubRepo;
  }

  exec(args: string[]): Promise<GitExecResult> {
    const cwd = this.repoRoot ?? this.workspace.currentFolder() ?? '.';
    return window.znxstudio.git.exec({ args, cwd });
  }
  gh(args: string[]): Promise<GitExecResult> {
    const cwd = this.repoRoot ?? this.workspace.currentFolder() ?? '.';
    return window.znxstudio.github.exec({ args, cwd });
  }

  async listPullRequests(): Promise<PullRequest[]> {
    if (!this.gitHubRepo) return [];
    const result = await this.gh(['pr', 'list', '--json', GH_PR_FIELDS, '--limit', '30']);
    return result.code === 0 ? parseGhPrList(result.stdout) : [];
  }

  pullRequestUrl(): string | null {
    if (!this.gitHubRepo || !this.currentBranch || this.currentBranch === this.defaultBase) return null;
    return newPullRequestUrl(this.gitHubRepo, this.defaultBase, this.currentBranch);
  }

  branches(): Branch[] {
    return this.branchList;
  }
  private async branchOp(args: string[]): Promise<GitCommitResult> {
    const result = await this.exec(args);
    await this.detectAndRefresh();
    return result.code === 0 ? { ok: true } : { ok: false, error: (result.stderr || result.stdout || 'git failed').trim() };
  }
  checkout(name: string): Promise<GitCommitResult> {
    return this.branchOp(['checkout', name]);
  }
  createBranch(name: string): Promise<GitCommitResult> {
    const invalid = validateBranchName(name);
    if (invalid) return Promise.resolve({ ok: false, error: invalid });
    return this.branchOp(['checkout', '-b', name]);
  }
  deleteBranch(name: string): Promise<GitCommitResult> {
    return this.branchOp(['branch', '-d', name]);
  }
  mergeBranch(name: string): Promise<GitCommitResult> {
    return this.branchOp(['merge', name]);
  }

  async log(limit = 50): Promise<Commit[]> {
    if (!this.repoRoot) return [];
    const result = await this.exec(['log', LOG_FORMAT, '--date=short', '-n', String(limit)]);
    return result.code === 0 ? parseLog(result.stdout) : [];
  }
  async commitFiles(hash: string): Promise<CommitFile[]> {
    if (!this.repoRoot) return [];
    const result = await this.exec(['show', '--numstat', '--format=', hash]);
    return result.code === 0 ? parseNumstat(result.stdout) : [];
  }

  private async detectAndRefresh(): Promise<void> {
    const folder = this.workspace.currentFolder();
    if (!folder) {
      this.repoRoot = null;
      this.entries = [];
      this.render();
      this.updateStatusBar();
      return;
    }
    const top = await window.znxstudio.git.exec({ args: ['rev-parse', '--show-toplevel'], cwd: folder });
    this.repoRoot = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : null;
    if (this.repoRoot) {
      const remotes = await this.exec(['remote', '-v']);
      this.remoteList = remotes.code === 0 ? parseRemotes(remotes.stdout) : [];
      this.gitHubRepo = detectGitHub(this.remoteList);
      const head = await this.exec(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
      this.defaultBase = head.code === 0 && head.stdout.trim() ? head.stdout.trim().replace(/^origin\//, '') : 'main';
    } else {
      this.remoteList = [];
      this.gitHubRepo = null;
    }
    await this.refresh();
  }

  async refresh(): Promise<void> {
    if (!this.repoRoot) {
      this.entries = [];
      this.render();
      this.updateStatusBar();
      return;
    }
    const [status, branch, branches] = await Promise.all([
      this.exec(['status', '--porcelain=v1']),
      this.exec(['rev-parse', '--abbrev-ref', 'HEAD']),
      this.exec(['branch', '--all']),
    ]);
    this.entries = status.code === 0 ? parseStatus(status.stdout) : [];
    this.currentBranch = branch.code === 0 ? branch.stdout.trim() : null;
    this.branchList = branches.code === 0 ? parseBranches(branches.stdout) : [];
    this.changeEmitter.fire();
    this.render();
    this.updateStatusBar();
  }

  async stage(path: string): Promise<void> {
    await this.exec(['add', '--', path]);
    await this.refresh();
  }
  async unstage(path: string): Promise<void> {
    await this.exec(['restore', '--staged', '--', path]);
    await this.refresh();
  }
  async stageAll(): Promise<void> {
    await this.exec(['add', '-A']);
    await this.refresh();
  }

  async commit(message: string): Promise<GitCommitResult> {
    if (!message.trim()) return { ok: false, error: 'A commit message is required.' };
    const result = await this.exec(['commit', '-m', message]);
    await this.refresh();
    if (result.code === 0) return { ok: true };
    return { ok: false, error: (result.stderr || result.stdout || 'commit failed').trim() };
  }

  private async commitFromInput(): Promise<void> {
    const staged = this.entries.some((e) => e.staged);
    if (!staged) {
      this.context.layout.showToast('Stage changes before committing.', 'info');
      return;
    }
    const result = await this.commit(this.commitMessage);
    if (result.ok) {
      this.commitMessage = '';
      this.context.layout.showToast('Committed.', 'success');
      this.render();
    } else {
      this.context.layout.showToast(`Commit failed: ${result.error}`, 'error');
    }
  }

  /* ----- UI ----- */
  private reveal(): void {
    this.render();
    this.context.layout.setSideBar('Source Control', this.view);
    this.context.layout.focusSideBar();
    void this.refresh();
  }

  private updateStatusBar(): void {
    if (!this.statusBar) return;
    if (!this.repoRoot) {
      this.statusBar.removeItem('editor.scm');
      return;
    }
    const changed = this.entries.length;
    this.statusBar.setItem('editor.scm', {
      text: `⎇ ${this.currentBranch ?? '—'}${changed ? ` ●${changed}` : ''}`,
      tooltip: 'Source Control',
      command: CommandIds.ScmShow,
      side: 'left',
      priority: 8,
    });
  }

  private render(): void {
    this.view.replaceChildren();

    if (!this.repoRoot) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-scm-empty';
      empty.textContent = 'The open folder is not a Git repository.';
      this.view.appendChild(empty);
      return;
    }

    const header = document.createElement('div');
    header.className = 'znxstudio-scm-header';
    const branch = document.createElement('button');
    branch.className = 'znxstudio-scm-branch';
    branch.textContent = `⎇ ${this.currentBranch ?? 'detached'} ▾`;
    branch.title = 'Switch branch';
    branch.addEventListener('click', () => this.showBranchPicker());
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = '⟳';
    refresh.title = 'Refresh';
    refresh.addEventListener('click', () => void this.refresh());
    header.append(branch, refresh);
    if (this.gitHubRepo) {
      const gh = document.createElement('button');
      gh.className = 'znxstudio-btn-small';
      gh.textContent = '⧉ GitHub';
      gh.title = `Open ${this.gitHubRepo.owner}/${this.gitHubRepo.repo} on GitHub`;
      gh.addEventListener('click', () => void window.znxstudio.shell.openExternal(repoUrl(this.gitHubRepo!)));
      header.appendChild(gh);
    }
    this.view.appendChild(header);

    const prUrl = this.pullRequestUrl();
    if (prUrl) {
      const createPr = document.createElement('button');
      createPr.className = 'znxstudio-btn-small znxstudio-scm-pr';
      createPr.textContent = `⇅ Create Pull Request (${this.currentBranch} → ${this.defaultBase})`;
      createPr.addEventListener('click', () => void window.znxstudio.shell.openExternal(prUrl));
      this.view.appendChild(createPr);
    }

    const input = document.createElement('textarea');
    input.className = 'znxstudio-scm-message';
    input.rows = 2;
    input.placeholder = `Message (commit on ${this.currentBranch ?? 'HEAD'})`;
    input.value = this.commitMessage;
    input.addEventListener('input', () => (this.commitMessage = input.value));
    this.view.appendChild(input);

    const commit = document.createElement('button');
    commit.className = 'znxstudio-btn';
    const stagedCount = this.entries.filter((e) => e.staged).length;
    commit.textContent = `✓ Commit${stagedCount ? ` (${stagedCount})` : ''}`;
    commit.disabled = stagedCount === 0;
    commit.addEventListener('click', () => void this.commitFromInput());
    this.view.appendChild(commit);

    const groups = groupStatus(this.entries);
    this.renderConflicts(groups.conflicts);
    this.renderGroup('Staged Changes', groups.staged, 'unstage');
    this.renderGroup('Changes', groups.changes, 'stage');

    if (this.entries.length === 0) {
      const clean = document.createElement('div');
      clean.className = 'znxstudio-scm-empty';
      clean.textContent = 'No changes.';
      this.view.appendChild(clean);
    }
  }

  private renderGroup(title: string, files: GitFileStatus[], action: 'stage' | 'unstage' | null): void {
    if (files.length === 0) return;
    const header = document.createElement('div');
    header.className = 'znxstudio-scm-group';
    header.textContent = `${title} — ${files.length}`;
    this.view.appendChild(header);

    for (const file of files) {
      const row = document.createElement('div');
      row.className = `znxstudio-scm-row is-${file.type}`;
      const letter = document.createElement('span');
      letter.className = 'znxstudio-scm-letter';
      letter.textContent = statusLetter(file);
      const name = document.createElement('span');
      name.className = 'znxstudio-scm-file';
      name.textContent = file.path.split('/').pop() ?? file.path;
      name.title = file.path;
      name.addEventListener('click', () => this.openFile(file.path));
      row.append(letter, name);
      if (action) {
        const button = document.createElement('button');
        button.className = 'znxstudio-btn-small';
        button.textContent = action === 'stage' ? '+' : '−';
        button.title = action === 'stage' ? 'Stage' : 'Unstage';
        button.addEventListener('click', () => void (action === 'stage' ? this.stage(file.path) : this.unstage(file.path)));
        row.appendChild(button);
      }
      this.view.appendChild(row);
    }
  }

  private renderConflicts(files: GitFileStatus[]): void {
    if (files.length === 0) return;
    const header = document.createElement('div');
    header.className = 'znxstudio-scm-group';
    header.textContent = `Merge Changes — ${files.length}`;
    this.view.appendChild(header);

    for (const file of files) {
      const row = document.createElement('div');
      row.className = 'znxstudio-scm-row is-conflicted';
      const letter = document.createElement('span');
      letter.className = 'znxstudio-scm-letter';
      letter.textContent = '!';
      const name = document.createElement('span');
      name.className = 'znxstudio-scm-file';
      name.textContent = file.path.split('/').pop() ?? file.path;
      name.title = file.path;
      name.addEventListener('click', () => this.openFile(file.path));
      row.append(letter, name);
      for (const choice of ['ours', 'theirs', 'both'] as ConflictChoice[]) {
        const button = document.createElement('button');
        button.className = 'znxstudio-btn-small';
        button.textContent = choice === 'ours' ? 'Ours' : choice === 'theirs' ? 'Theirs' : 'Both';
        button.addEventListener('click', () => void this.resolveFile(file.path, choice));
        row.appendChild(button);
      }
      this.view.appendChild(row);
    }
  }

  /** Resolve the active editor's conflicted file, taking one side (or both). */
  private async resolveActive(choice: ConflictChoice): Promise<void> {
    const file = this.editor?.currentFile();
    if (!file || !this.repoRoot) {
      this.context.layout.showToast('Open the conflicted file first.', 'info');
      return;
    }
    const rel = file.replace(/\\/g, '/').replace(this.repoRoot.replace(/\\/g, '/'), '').replace(/^\/+/, '');
    await this.resolveFile(rel, choice);
  }

  /** Read a conflicted file, resolve every block, write it back, and stage it. */
  private async resolveFile(relPath: string, choice: ConflictChoice): Promise<void> {
    if (!this.repoRoot) return;
    const abs = `${this.repoRoot}/${relPath}`.replace(/\//g, '\\');
    try {
      const text = await window.znxstudio.fs.readFile(abs);
      if (!hasConflictMarkers(text)) {
        this.context.layout.showToast('No conflict markers found in this file.', 'info');
        return;
      }
      await window.znxstudio.fs.writeFile(abs, resolveConflicts(text, choice));
      await this.exec(['add', '--', relPath]);
      await this.refresh();
      if (this.editor?.currentFile() === abs) void this.editor.openFile(abs);
      this.context.layout.showToast(`Resolved ${relPath.split('/').pop()} (${choice}).`, 'success');
    } catch (error) {
      this.context.layout.showToast(`Resolve failed: ${(error as Error).message}`, 'error');
    }
  }

  /* ----- branch picker (12E) ----- */
  private showBranchPicker(): void {
    if (!this.repoRoot) return;
    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-scm-picker';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) overlay.remove();
    });
    const box = document.createElement('div');
    box.className = 'znxstudio-scm-picker-box';
    const title = document.createElement('div');
    title.className = 'znxstudio-scm-picker-title';
    title.textContent = 'Switch branch';
    box.appendChild(title);

    const create = document.createElement('button');
    create.className = 'znxstudio-scm-picker-item is-create';
    create.textContent = '＋ Create new branch…';
    create.addEventListener('click', () => {
      overlay.remove();
      void this.createBranchPrompt();
    });
    box.appendChild(create);

    for (const b of localBranches(this.branchList)) {
      const item = document.createElement('button');
      item.className = `znxstudio-scm-picker-item${b.current ? ' is-current' : ''}`;
      item.textContent = `${b.current ? '● ' : '   '}${b.name}`;
      if (!b.current) {
        item.addEventListener('click', () => {
          overlay.remove();
          void this.doCheckout(b.name);
        });
      }
      box.appendChild(item);
    }
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }

  private async doCheckout(name: string): Promise<void> {
    const result = await this.checkout(name);
    this.context.layout.showToast(result.ok ? `Switched to ${name}.` : `Checkout failed: ${result.error}`, result.ok ? 'success' : 'error');
  }

  private async createBranchPrompt(): Promise<void> {
    const name = window.prompt('New branch name:');
    if (!name) return;
    const result = await this.createBranch(name.trim());
    this.context.layout.showToast(result.ok ? `Created and switched to ${name.trim()}.` : `Create failed: ${result.error}`, result.ok ? 'success' : 'error');
  }

  private openFile(relPath: string): void {
    if (!this.repoRoot || !this.editor) return;
    const abs = `${this.repoRoot}/${relPath}`.replace(/\//g, '\\');
    void this.editor.openFile(abs);
  }

  /** Open the active file at the cursor line on GitHub. */
  private openActiveOnGitHub(): void {
    if (!this.gitHubRepo) {
      this.context.layout.showToast('No GitHub remote detected.', 'info');
      return;
    }
    const file = this.editor?.currentFile();
    if (!file || !this.repoRoot) {
      this.context.layout.showToast('Open a file in the repository first.', 'info');
      return;
    }
    const rel = file
      .replace(/\\/g, '/')
      .replace(this.repoRoot.replace(/\\/g, '/'), '')
      .replace(/^\/+/, '');
    const line = (this.editor?.cursorPosition()?.line ?? 0) + 1;
    const ref = this.currentBranch ?? 'HEAD';
    void window.znxstudio.shell.openExternal(blobUrl(this.gitHubRepo, ref, rel, line));
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
      enabled = false;
    }
    if (!enabled || !tempDir) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Pure parse check.
    const parsed = parseStatus(' M src/a.zx\nA  src/b.zx\n?? new.txt\nUU merge.zx');
    const g = groupStatus(parsed);
    log(`scm parse: entries=${parsed.length} staged=${g.staged.length} changes=${g.changes.length} conflicts=${g.conflicts.length}`);

    // REAL git on a throwaway temp repo (never touches user repos).
    try {
      const repo = `${tempDir}\\znxstudio-scm-${Date.now()}`;
      const run = (args: string[], cwd = repo) => window.znxstudio.git.exec({ args, cwd });
      await window.znxstudio.git.exec({ args: ['init', '-q', repo], cwd: tempDir }); // creates + inits the dir
      await run(['config', 'user.email', 'selftest@znxstudio.dev']);
      await run(['config', 'user.name', 'ZnxStudio Selftest']);
      await window.znxstudio.fs.writeFile(`${repo}\\hello.zx`, 'function main\n    print "hi"\nend\n');
      const before = parseStatus((await run(['status', '--porcelain=v1'])).stdout);
      await run(['add', '-A']);
      const afterStage = parseStatus((await run(['status', '--porcelain=v1'])).stdout);
      const commit = await run(['commit', '-m', 'initial']);
      await window.znxstudio.fs.writeFile(`${repo}\\hello.zx`, 'function main\n    print "hello"\nend\n');
      const afterEdit = parseStatus((await run(['status', '--porcelain=v1'])).stdout);
      const branch = (await run(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
      log(`scm REAL: untrackedBefore=${before.some((e) => e.type === 'untracked')} stagedAfterAdd=${afterStage.filter((e) => e.staged).length} committed=${commit.code === 0} modifiedAfterEdit=${afterEdit.some((e) => e.type === 'modified' && e.unstaged)} branch=${branch}`);

      // 12B — add a real GitHub remote and detect it.
      await run(['remote', 'add', 'origin', 'https://github.com/acme/demo.git']);
      const remotes = parseRemotes((await run(['remote', '-v'])).stdout);
      const gh = detectGitHub(remotes);
      log(`scm REAL github: remotes=${remotes.length} owner=${gh?.owner} repo=${gh?.repo} blob=${gh ? blobUrl(gh, branch, 'src/a.zx', 12) : ''}`);

      // 12C — PR list parse (pure) + real `gh` availability probe + PR url.
      const samplePrs = parseGhPrList('[{"number":7,"title":"Add feature","author":{"login":"kim"},"state":"OPEN","headRefName":"feat","baseRefName":"main","url":"https://github.com/acme/demo/pull/7","isDraft":false}]');
      const ghVersion = await window.znxstudio.github.exec({ args: ['--version'], cwd: repo });
      const prUrl = gh ? newPullRequestUrl(gh, 'main', branch) : '';
      log(`scm REAL pr: parsed=${samplePrs.length} first=#${samplePrs[0]?.number}/${samplePrs[0]?.author} ghInstalled=${ghVersion.code === 0} prUrl=${prUrl}`);

      // 12D — create a REAL merge conflict and resolve it.
      const cfile = `${repo}\\conflict.zx`;
      await window.znxstudio.fs.writeFile(cfile, 'line1\nshared\nline3\n');
      await run(['add', '-A']);
      await run(['commit', '-m', 'base']);
      await run(['checkout', '-q', '-b', 'feature']);
      await window.znxstudio.fs.writeFile(cfile, 'line1\nTHEIRS\nline3\n');
      await run(['commit', '-qam', 'theirs']);
      await run(['checkout', '-q', branch]);
      await window.znxstudio.fs.writeFile(cfile, 'line1\nOURS\nline3\n');
      await run(['commit', '-qam', 'ours']);
      const merge = await run(['merge', 'feature']);
      const conflictedText = await window.znxstudio.fs.readFile(cfile);
      const isConflicted = parseStatus((await run(['status', '--porcelain=v1'])).stdout).some((e) => e.conflicted);
      const oursResolved = resolveConflicts(conflictedText, 'ours');
      const bothResolved = resolveConflicts(conflictedText, 'both');
      await window.znxstudio.fs.writeFile(cfile, oursResolved);
      await run(['add', '--', 'conflict.zx']);
      const stillConflicted = parseStatus((await run(['status', '--porcelain=v1'])).stdout).some((e) => e.conflicted);
      log(`scm REAL conflict: mergeFailed=${merge.code !== 0} hasMarkers=${hasConflictMarkers(conflictedText)} blocks=${countConflicts(conflictedText)} statusConflicted=${isConflicted} oursHasOURS=${oursResolved.includes('OURS') && !oursResolved.includes('THEIRS')} bothHasBoth=${bothResolved.includes('OURS') && bothResolved.includes('THEIRS')} resolvedClear=${!stillConflicted}`);

      // 12E — finish the merge, then real branch ops.
      await run(['commit', '-qam', 'resolve merge']);
      const beforeBranches = parseBranches((await run(['branch', '--all'])).stdout);
      await run(['checkout', '-q', '-b', 'topic']);
      const afterCreate = parseBranches((await run(['branch', '--all'])).stdout);
      const cur = afterCreate.find((b) => b.current)?.name;
      await run(['checkout', '-q', branch]);
      log(`scm REAL branches: before=${localBranches(beforeBranches).map((b) => b.name).join('/')} createdCurrent=${cur} count=${localBranches(afterCreate).length} validReject=${validateBranchName('bad name') !== null} validOk=${validateBranchName('feature/x') === null}`);

      // 12F — real commit log + numstat of a non-merge commit (root 'initial').
      const commits = parseLog((await run(['log', LOG_FORMAT, '--date=short', '-n', '20'])).stdout);
      const root = commits[commits.length - 1];
      const numstat = root ? parseNumstat((await run(['show', '--numstat', '--format=', root.hash])).stdout) : [];
      log(`scm REAL history: commits=${commits.length} latest="${commits[0]?.subject}" by=${commits[0]?.author} rootFiles=${numstat.length} firstFile=${numstat[0]?.path}(+${numstat[0]?.additions}/-${numstat[0]?.deletions})`);
    } catch (error) {
      log(`scm REAL failed: ${(error as Error).message}`);
    }
  }
}
