import { ServiceKeys, type EditorService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { parseTaskTag, TASK_TAG_REGEX, type TaskTag } from './todoScan';

interface TodoEntry {
  tag: TaskTag;
  message: string;
  file: string;
  line: number;
}

const TAG_CLASS: Record<TaskTag, string> = {
  TODO: 'todo',
  FIXME: 'fixme',
  HACK: 'hack',
  XXX: 'xxx',
  BUG: 'bug',
  NOTE: 'note',
};

/**
 * TODO / task-comment scanner (Phase 7J). Reuses the 7A workspace text search
 * with a tag regex, parses each hit into a tag + message, and lists them in a
 * bottom-panel view grouped by tag (click to navigate). No new IPC.
 */
export class TodoModule implements IModule {
  readonly id = 'znxstudio.todo';
  readonly displayName = 'Task Comments';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private entries: TodoEntry[] = [];

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-todo';
    context.layout.addPanelView({ id: 'todo', title: 'TODOs', element: this.panel });

    context.commands.register(CommandIds.TodoScan, () => void this.scan(), 'Todo: Scan for Task Comments');
    context.commands.register(CommandIds.TodoShow, () => this.context.layout.showPanelView('todo'), 'Todo: Show Task Comments');

    this.workspace.onDidChangeWorkspace(() => void this.scan());
    this.renderMessage('Run “Scan for Task Comments” to find TODO/FIXME/… tags.');
    void this.scan();
    void selfTestCoordinator.run('todo', () => this.maybeSelfTest());
  }

  private async scan(): Promise<void> {
    const root = this.workspace.currentFolder();
    if (!root) {
      this.entries = [];
      this.renderMessage('Open a folder to scan for task comments.');
      this.updateStatus();
      return;
    }
    this.renderMessage('Scanning…');
    const result = await window.znxstudio.search.text({ root, query: TASK_TAG_REGEX, isRegex: true, caseSensitive: true });

    const entries: TodoEntry[] = [];
    for (const file of result.files) {
      for (const match of file.matches) {
        const parsed = parseTaskTag(match.text);
        if (parsed) entries.push({ tag: parsed.tag, message: parsed.message, file: file.file, line: match.line });
      }
    }
    this.entries = entries;
    this.renderPanel();
    this.updateStatus();
  }

  private updateStatus(): void {
    if (!this.status) return;
    if (this.entries.length === 0) {
      this.status.removeItem('editor.todos');
      return;
    }
    this.status.setItem('editor.todos', {
      text: `☑ ${this.entries.length}`,
      tooltip: 'Task comments — click to view',
      command: CommandIds.TodoShow,
      side: 'right',
      priority: 24,
    });
  }

  private renderMessage(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-todo-empty';
    empty.textContent = message;
    this.panel.replaceChildren(empty);
  }

  private renderPanel(): void {
    if (this.entries.length === 0) {
      this.renderMessage('No task comments found. 🎉');
      return;
    }
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-todo-toolbar';
    const rescan = document.createElement('button');
    rescan.className = 'znxstudio-btn-small';
    rescan.textContent = '⟳ Rescan';
    rescan.addEventListener('click', () => void this.scan());
    const summary = document.createElement('span');
    summary.className = 'znxstudio-todo-summary';
    summary.textContent = `${this.entries.length} in ${new Set(this.entries.map((e) => e.file)).size} files`;
    toolbar.append(rescan, summary);
    this.panel.appendChild(toolbar);

    const ordered = [...this.entries].sort(
      (a, b) => a.tag.localeCompare(b.tag) || a.file.localeCompare(b.file) || a.line - b.line,
    );
    let lastTag: TaskTag | '' = '';
    for (const entry of ordered) {
      if (entry.tag !== lastTag) {
        lastTag = entry.tag;
        const header = document.createElement('div');
        header.className = 'znxstudio-todo-group';
        header.textContent = entry.tag;
        this.panel.appendChild(header);
      }
      const row = document.createElement('div');
      row.className = 'znxstudio-tree-row znxstudio-todo-row';
      const badge = document.createElement('span');
      badge.className = `znxstudio-todo-badge znxstudio-todo-badge--${TAG_CLASS[entry.tag]}`;
      badge.textContent = entry.tag;
      const msg = document.createElement('span');
      msg.className = 'znxstudio-todo-msg';
      msg.textContent = entry.message || '(no description)';
      const loc = document.createElement('span');
      loc.className = 'znxstudio-todo-loc';
      loc.textContent = `${this.basename(entry.file)}:${entry.line + 1}`;
      row.append(badge, msg, loc);
      row.title = entry.file;
      row.addEventListener('click', () => void this.openEntry(entry));
      this.panel.appendChild(row);
    }
  }

  private async openEntry(entry: TodoEntry): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    await editor.openFile(entry.file);
    editor.revealPosition(entry.line, 0);
  }

  private basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
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

    // Pure parser: tags in comments count, tags in strings/identifiers don't.
    log(`todo parse('# TODO: fix the walk'): ${JSON.stringify(parseTaskTag('# TODO: fix the walk'))}`);
    log(`todo parse('// FIXME - broken'): ${JSON.stringify(parseTaskTag('    // FIXME - broken'))}`);
    log(`todo parse('create x = "TODO later"') → ${parseTaskTag('create x = "TODO later"')}`);
    log(`todo parse('aTODOx = 1') → ${parseTaskTag('const aTODOx = 1')}`);

    // Real workspace scan via the 7A text search, then parse.
    try {
      const root = 'C:\\Studio Apps\\xojin\\examples';
      const result = await window.znxstudio.search.text({ root, query: TASK_TAG_REGEX, isRegex: true, caseSensitive: true });
      let parsed = 0;
      const tags = new Set<string>();
      for (const file of result.files) {
        for (const match of file.matches) {
          const tag = parseTaskTag(match.text);
          if (tag) {
            parsed += 1;
            tags.add(tag.tag);
          }
        }
      }
      log(`todo scan(examples): rawLines=${result.totalMatches} parsed=${parsed} tags=[${[...tags].sort().join(',')}]`);
    } catch (error) {
      log(`todo scan failed: ${(error as Error).message}`);
    }
  }
}
