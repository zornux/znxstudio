/**
 * Pure workspace-task discovery (Phase 7G). Parses task definitions from the
 * three sources ZnxStudio understands and merges them into a normalized list. No
 * DOM / no Node — TasksModule reads the files and streams the chosen command.
 *
 *   - znxstudio.tasks.json  — explicit `{ tasks: [{label, command, cwd?, group?}] }`
 *   - znxstudio.project.json — `scripts: { name: command }` (literal commands)
 *   - package.json        — `scripts: { name: cmd }` → `npm run <name>`
 */
export type TaskGroup = 'build' | 'test' | 'run' | 'other';

export interface WorkspaceTask {
  label: string;
  command: string;
  /** Working directory relative to the workspace root (or absolute); root if omitted. */
  cwd?: string;
  group: TaskGroup;
  /** The file the task was discovered in. */
  source: string;
}

const TASK_GROUPS: readonly TaskGroup[] = ['build', 'test', 'run', 'other'];

export function isTaskGroup(value: unknown): value is TaskGroup {
  return typeof value === 'string' && (TASK_GROUPS as readonly string[]).includes(value);
}

/** Guess a task's group from its name (VS Code style). */
export function classifyGroup(name: string): TaskGroup {
  const n = name.toLowerCase();
  if (/(^|[-_:.])(build|compile|bundle|pack)/.test(n)) return 'build';
  if (/(test|spec|lint|check|typecheck|coverage)/.test(n)) return 'test';
  if (/^(run|start|dev|serve|watch|preview)/.test(n)) return 'run';
  return 'other';
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function scriptRecord(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== 'object') return null;
  const scripts = (json as Record<string, unknown>).scripts;
  return scripts && typeof scripts === 'object' ? (scripts as Record<string, unknown>) : null;
}

/** package.json scripts → `npm run <name>` tasks. */
export function parsePackageScripts(text: string): WorkspaceTask[] {
  const scripts = scriptRecord(safeParse(text));
  if (!scripts) return [];
  const tasks: WorkspaceTask[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    tasks.push({ label: name, command: `npm run ${name}`, group: classifyGroup(name), source: 'package.json' });
  }
  return tasks;
}

/** znxstudio.project.json scripts (name → literal command). */
export function parseProjectScripts(text: string): WorkspaceTask[] {
  const scripts = scriptRecord(safeParse(text));
  if (!scripts) return [];
  const tasks: WorkspaceTask[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (typeof command !== 'string') continue;
    tasks.push({ label: name, command, group: classifyGroup(name), source: 'znxstudio.project.json' });
  }
  return tasks;
}

/** Explicit znxstudio.tasks.json: `{ tasks: [{label, command, cwd?, group?}] }`. */
export function parseTasksFile(text: string): WorkspaceTask[] {
  const json = safeParse(text);
  const list = json && typeof json === 'object' && Array.isArray((json as Record<string, unknown>).tasks)
    ? ((json as Record<string, unknown>).tasks as unknown[])
    : [];
  const tasks: WorkspaceTask[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    if (typeof record.label !== 'string' || typeof record.command !== 'string') continue;
    tasks.push({
      label: record.label,
      command: record.command,
      cwd: typeof record.cwd === 'string' ? record.cwd : undefined,
      group: isTaskGroup(record.group) ? record.group : classifyGroup(record.label),
      source: 'znxstudio.tasks.json',
    });
  }
  return tasks;
}

/**
 * Merge task lists, de-duplicating by label (the first list wins — pass explicit
 * tasks first so they override auto-discovered scripts). Sorted by group then label.
 */
export function mergeTasks(...lists: WorkspaceTask[][]): WorkspaceTask[] {
  const byLabel = new Map<string, WorkspaceTask>();
  for (const list of lists) {
    for (const task of list) {
      if (!byLabel.has(task.label)) byLabel.set(task.label, task);
    }
  }
  return [...byLabel.values()].sort(
    (a, b) => TASK_GROUPS.indexOf(a.group) - TASK_GROUPS.indexOf(b.group) || a.label.localeCompare(b.label),
  );
}

/** Resolve a task's working directory against the workspace root. */
export function resolveTaskCwd(root: string, cwd?: string): string {
  if (!cwd) return root;
  const isAbsolute = /^[a-zA-Z]:[\\/]/.test(cwd) || cwd.startsWith('/') || cwd.startsWith('\\\\');
  if (isAbsolute) return cwd;
  return `${root.replace(/[\\/]+$/, '')}/${cwd.replace(/^[\\/]+/, '')}`;
}
