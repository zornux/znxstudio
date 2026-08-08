import {
  ServiceKeys,
  type OutputService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  mergeTasks,
  parsePackageScripts,
  parseProjectScripts,
  parseTasksFile,
  resolveTaskCwd,
  type TaskGroup,
  type WorkspaceTask,
} from './taskDiscovery';

const GROUP_ICON: Record<TaskGroup, string> = {
  build: '⚙',
  test: '🧪',
  run: '▶',
  other: '•',
};

const GROUP_LABEL: Record<TaskGroup, string> = {
  build: 'Build',
  test: 'Test',
  run: 'Run',
  other: 'Other',
};

/**
 * Workspace Tasks (Phase 7G). Discovers tasks from the workspace's
 * znxstudio.tasks.json (explicit), znxstudio.project.json scripts and package.json
 * scripts, lists them in a bottom-panel view grouped by kind, and runs the
 * chosen one through the streaming Task service (output flows to the Output
 * panel automatically). Discovery is pure; the module only reads files + spawns.
 */
export class TasksModule implements IModule {
  readonly id = 'znxstudio.tasks';
  readonly displayName = 'Tasks';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private output: OutputService | undefined;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private tasks: WorkspaceTask[] = [];
  private readonly running = new Set<string>();

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.output = context.services.tryGet<OutputService>(ServiceKeys.Output);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-tasks';
    context.layout.addPanelView({ id: 'tasks', title: 'Tasks', element: this.panel });

    context.commands.register(CommandIds.TasksShow, () => this.reveal(), 'Tasks: Show Tasks');
    context.commands.register(CommandIds.TasksRefresh, () => this.discover(), 'Tasks: Refresh Tasks');

    window.znxstudio.task.onExit((event) => this.onTaskExit(event.id, event.code));
    this.workspace.onDidChangeWorkspace(() => void this.discover());

    void this.discover();
    void selfTestCoordinator.run('tasks', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.showPanelView('tasks');
  }

  private async discover(): Promise<void> {
    const root = this.workspace.currentFolder();
    if (!root) {
      this.tasks = [];
      this.renderPanel();
      return;
    }
    const [tasksFile, project, pkg] = await Promise.all([
      this.readFile(`${root}/znxstudio.tasks.json`),
      this.readFile(`${root}/znxstudio.project.json`),
      this.readFile(`${root}/package.json`),
    ]);
    // Explicit tasks first so they win on duplicate labels.
    this.tasks = mergeTasks(
      parseTasksFile(tasksFile),
      parseProjectScripts(project),
      parsePackageScripts(pkg),
    );
    this.renderPanel();
  }

  private async readFile(path: string): Promise<string> {
    try {
      return await window.znxstudio.fs.readFile(path);
    } catch {
      return '';
    }
  }

  private async runTask(task: WorkspaceTask): Promise<void> {
    const root = this.workspace.currentFolder();
    if (!root) return;
    const id = `usertask-${task.label}`;
    const cwd = resolveTaskCwd(root, task.cwd);

    this.output?.show();
    this.output?.appendLine(`> ${task.command}   (${task.source})`);
    this.running.add(id);
    this.status?.setItem('tasks.status', { text: `⏳ ${task.label}…`, side: 'right', priority: 29 });

    try {
      await window.znxstudio.task.run({ id, command: task.command, cwd });
    } catch (error) {
      this.output?.appendLine(`Failed to start task: ${(error as Error).message}`);
      this.running.delete(id);
    }
  }

  private onTaskExit(id: string, code: number | null): void {
    if (!this.running.has(id)) return;
    this.running.delete(id);
    const label = id.replace(/^usertask-/, '');
    this.status?.setItem('tasks.status', {
      text: code === 0 ? `✓ ${label}` : `✗ ${label} (${code ?? '—'})`,
      side: 'right',
      priority: 29,
      autoHideMs: 4000,
    });
  }

  private renderPanel(): void {
    this.panel.replaceChildren();

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-tasks-toolbar';
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = '⟳ Refresh';
    refresh.addEventListener('click', () => void this.discover());
    toolbar.appendChild(refresh);
    this.panel.appendChild(toolbar);

    if (this.tasks.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-tasks-empty';
      empty.textContent =
        'No tasks. Add scripts to znxstudio.project.json / package.json, or a znxstudio.tasks.json.';
      this.panel.appendChild(empty);
      return;
    }

    let lastGroup: TaskGroup | '' = '';
    for (const task of this.tasks) {
      if (task.group !== lastGroup) {
        lastGroup = task.group;
        const header = document.createElement('div');
        header.className = 'znxstudio-tasks-group';
        header.textContent = GROUP_LABEL[task.group];
        this.panel.appendChild(header);
      }
      const row = document.createElement('div');
      row.className = 'znxstudio-tasks-row';
      const icon = document.createElement('span');
      icon.className = 'znxstudio-icon';
      icon.textContent = GROUP_ICON[task.group];
      const name = document.createElement('span');
      name.className = 'znxstudio-tasks-label';
      name.textContent = task.label;
      const cmd = document.createElement('code');
      cmd.className = 'znxstudio-tasks-cmd';
      cmd.textContent = task.command;
      cmd.title = `${task.command}  ·  ${task.source}`;
      const run = document.createElement('button');
      run.className = 'znxstudio-btn-small znxstudio-tasks-run';
      run.textContent = '▶ Run';
      run.addEventListener('click', () => void this.runTask(task));
      row.append(icon, name, cmd, run);
      this.panel.appendChild(row);
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

    // Pure discovery over real files in an ISOLATED temp dir (pre-created by the
    // harness — fs.writeFile can't mkdir), then RUN a real task through the service.
    const tmp = 'C:\\Users\\jerem\\AppData\\Local\\Temp\\znxstudio-7g';
    try {
      await window.znxstudio.fs.writeFile(
        `${tmp}\\package.json`,
        JSON.stringify({ scripts: { build: 'tsc', test: 'jest', dev: 'vite' } }),
      );
      await window.znxstudio.fs.writeFile(
        `${tmp}\\znxstudio.tasks.json`,
        JSON.stringify({ tasks: [{ label: 'deploy', command: 'echo deploy' }, { label: 'build', command: 'custom build', group: 'build' }] }),
      );
      const pkg = parsePackageScripts(await window.znxstudio.fs.readFile(`${tmp}\\package.json`));
      const explicit = parseTasksFile(await window.znxstudio.fs.readFile(`${tmp}\\znxstudio.tasks.json`));
      const merged = mergeTasks(explicit, pkg);
      log(`tasks discover: total=${merged.length} labels=[${merged.map((t) => t.label).join(',')}] buildCmd="${merged.find((t) => t.label === 'build')?.command}" buildSrc=${merged.find((t) => t.label === 'build')?.source}`);
      log(`tasks classify: dev=${merged.find((t) => t.label === 'dev')?.group} test=${merged.find((t) => t.label === 'test')?.group}`);
      log(`tasks resolveCwd: "${resolveTaskCwd('C:\\proj', 'web')}" abs="${resolveTaskCwd('C:\\proj', 'D:\\x')}"`);

      // Run a real, fast task and observe its exit code through the Task service.
      const id = 'usertask-selftest';
      const done = new Promise<number | null>((resolve) => {
        const unsubscribe = window.znxstudio.task.onExit((event) => {
          if (event.id === id) {
            unsubscribe();
            resolve(event.code);
          }
        });
      });
      await window.znxstudio.task.run({ id, command: 'node --version', cwd: tmp });
      log(`tasks run(node --version): exit=${await done}`);
    } catch (error) {
      log(`tasks self-test failed: ${(error as Error).message}`);
    }
  }
}
