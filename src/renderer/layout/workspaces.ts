/**
 * Workspaces — the pure model (SB-4).
 *
 * A workspace is a purpose-built environment. Activating one reveals the right
 * primary view (an Activity Bar item), opens the panels that matter for that
 * task, and focuses the most relevant one — so "Testing", "Security", "Database"
 * etc. each set the IDE up for that job instead of leaving the developer to
 * assemble it by hand. This file is DOM-free: it only declares the mapping from a
 * workspace to real activity/panel ids (audited against the registered set) and
 * each workspace's own toolbar of commands. The module applies it.
 */
import { CommandIds } from '../commands/CommandIds';

/** A button in a workspace's toolbar (SB-6): dispatches a command. */
export interface WorkspaceAction {
  icon: string;
  label: string;
  command: string;
}

export interface WorkspaceDef {
  id: string;
  label: string;
  /** Activity Bar item to reveal (the workspace's primary side view). */
  activity?: string;
  /** Bottom panels to open for this workspace (ids may be absent → ignored). */
  panels: string[];
  /** The panel to focus once open (must be one of `panels`). */
  focus?: string;
  /** The workspace's own toolbar, shown in the sidebar header (SB-6). */
  toolbar?: WorkspaceAction[];
}

export const WORKSPACES: WorkspaceDef[] = [
  { id: 'code', label: 'Code', activity: 'explorer', panels: ['diagnostics', 'output'], focus: 'diagnostics' },
  {
    id: 'debugging', label: 'Debugging', activity: 'run-debug', panels: ['debug', 'diagnostics'], focus: 'debug',
    toolbar: [
      { icon: '▷', label: 'Start', command: CommandIds.DebugStart },
      { icon: '■', label: 'Stop', command: CommandIds.DebugStop },
      { icon: '⤼', label: 'Step Over', command: CommandIds.DebugStepOver },
      { icon: '⏵', label: 'Continue', command: CommandIds.DebugContinue },
    ],
  },
  {
    id: 'testing', label: 'Testing', activity: 'testing', panels: ['testresults', 'coverage', 'continuous', 'testperf', 'mocking'], focus: 'testresults',
    toolbar: [
      { icon: '▶', label: 'Run Tests', command: CommandIds.TestRunAll },
      { icon: '▤', label: 'Coverage', command: CommandIds.CoverageShow },
      { icon: '∞', label: 'Continuous', command: CommandIds.ContinuousToggle },
    ],
  },
  {
    id: 'database', label: 'Database', activity: 'database', panels: ['query', 'data', 'migrations', 'orm'], focus: 'query',
    toolbar: [
      { icon: '⌘', label: 'New Query', command: CommandIds.QueryConsoleShow },
      { icon: '⟳', label: 'Refresh', command: CommandIds.DatabaseRefresh },
      { icon: '⇧', label: 'Migrations', command: CommandIds.MigrationsShow },
      { icon: '▦', label: 'Data', command: CommandIds.DataBrowserShow },
    ],
  },
  {
    id: 'security', label: 'Security', activity: 'security', panels: ['security-dashboard', 'security-scan', 'security-secrets', 'security-dependencies', 'security-rules'], focus: 'security-dashboard',
    toolbar: [
      { icon: '◈', label: 'Scan', command: CommandIds.SecurityScanWorkspace },
      { icon: '⚖', label: 'Audit', command: CommandIds.SecurityDependencyAudit },
      { icon: '◆', label: 'Secrets', command: CommandIds.SecuritySecretsShow },
      { icon: '□', label: 'Report', command: CommandIds.SecurityExportReport },
    ],
  },
  {
    id: 'performance', label: 'Performance', activity: 'performance', panels: ['cpu-profiler', 'memory-profiler', 'perf-timeline', 'perf-hotspots', 'perf-allocations'], focus: 'cpu-profiler',
    toolbar: [
      { icon: 'C', label: 'CPU', command: CommandIds.PerfCpuShow },
      { icon: 'M', label: 'Memory', command: CommandIds.PerfMemoryShow },
      { icon: '⏱', label: 'Timeline', command: CommandIds.PerfTimelineShow },
      { icon: '▲', label: 'Hotspots', command: CommandIds.PerfHotspotsShow },
    ],
  },
  {
    id: 'ai', label: 'AI', activity: 'ai-chat', panels: ['ai-review', 'ai-testgen', 'ai-docs', 'ai-architecture', 'ai-debug'], focus: 'ai-review',
    toolbar: [
      { icon: '◇', label: 'Chat', command: CommandIds.AiChatShow },
      { icon: '❓', label: 'Explain', command: CommandIds.AiExplainError },
      { icon: '⌕', label: 'Review', command: CommandIds.AiReview },
      { icon: 'T', label: 'Generate Tests', command: CommandIds.AiTestGen },
      { icon: '✎', label: 'Refactor', command: CommandIds.AiRefactor },
    ],
  },
  { id: 'cloud', label: 'Cloud', activity: 'deploy', panels: ['remote-envs'], focus: 'remote-envs' },
  {
    id: 'documentation', label: 'Documentation', activity: 'learning', panels: ['apidocs', 'samples', 'tutorial', 'exercises'], focus: 'apidocs',
    toolbar: [
      { icon: 'A', label: 'Generate API', command: CommandIds.DocsGenerateApi },
      { icon: 'S', label: 'Samples', command: CommandIds.DocsSamplesShow },
      { icon: 'L', label: 'Tutorials', command: CommandIds.TutorialOpen },
    ],
  },
  { id: 'architecture', label: 'Architecture', panels: ['dependencies', 'ai-architecture'], focus: 'dependencies' },
  {
    id: 'git', label: 'Git', activity: 'scm', panels: ['history', 'pull-requests'], focus: 'history',
    toolbar: [
      { icon: '✓', label: 'Commit', command: CommandIds.ScmCommit },
      { icon: '⟳', label: 'Refresh', command: CommandIds.ScmRefresh },
      { icon: '⑂', label: 'New Branch', command: CommandIds.ScmCreateBranch },
      { icon: '⌛', label: 'History', command: CommandIds.HistoryShow },
    ],
  },
  { id: 'extensions', label: 'Extensions', activity: 'extensions', panels: [] },
];

export function workspaceById(id: string): WorkspaceDef | undefined {
  return WORKSPACES.find((workspace) => workspace.id === id);
}

/** The command id a workspace is registered under (palette / Search Everywhere). */
export function workspaceCommandId(id: string): string {
  return `znxstudio.workspace.activate.${id}`;
}
