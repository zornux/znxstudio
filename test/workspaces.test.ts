import { describe, expect, test } from './harness';
import { WORKSPACES, workspaceById, workspaceCommandId } from '../src/renderer/layout/workspaces';

// The real registered panel + activity ids (audited from the source).
const PANEL_IDS = new Set([
  'terminal', 'diagnostics', 'output', 'debug', 'log', 'outline', 'bookmarks', 'testresults', 'coverage',
  'continuous', 'testperf', 'mocking', 'query', 'data', 'migrations', 'orm', 'security-dashboard',
  'security-scan', 'security-secrets', 'security-dependencies', 'security-rules', 'cpu-profiler',
  'memory-profiler', 'perf-timeline', 'perf-hotspots', 'perf-allocations', 'profiler', 'ai-review',
  'ai-testgen', 'ai-docs', 'ai-architecture', 'ai-debug', 'remote-envs', 'apidocs', 'samples', 'tutorial',
  'exercises', 'dependencies', 'history', 'pull-requests', 'tasks', 'metrics', 'health', 'todo', 'preview',
  'fullstack',
]);

const ACTIVITY_IDS = new Set([
  'explorer', 'search', 'scm', 'run-debug', 'extensions', 'ai-chat', 'security', 'performance', 'testing',
  'database', 'deploy', 'learning', 'collab',
]);

describe('workspaces (SB-4)', () => {
  test('the 12 spec workspaces are all defined with unique ids', () => {
    expect(WORKSPACES.map((w) => w.label)).toEqual([
      'Code', 'Debugging', 'Testing', 'Database', 'Security', 'Performance', 'AI', 'Cloud', 'Documentation', 'Architecture', 'Git', 'Extensions',
    ]);
    expect(new Set(WORKSPACES.map((w) => w.id)).size).toBe(WORKSPACES.length);
  });

  test('every workspace panel id is a real registered panel', () => {
    for (const workspace of WORKSPACES) {
      for (const panel of workspace.panels) {
        expect(PANEL_IDS.has(panel)).toBe(true);
      }
    }
  });

  test('every workspace activity id is a real registered activity item', () => {
    for (const workspace of WORKSPACES) {
      if (workspace.activity) expect(ACTIVITY_IDS.has(workspace.activity)).toBe(true);
    }
  });

  test('the focus panel is always one of the workspace panels', () => {
    for (const workspace of WORKSPACES) {
      if (workspace.focus) expect(workspace.panels.includes(workspace.focus)).toBe(true);
    }
  });

  test('lookup + command id helpers', () => {
    expect(workspaceById('testing')?.label).toBe('Testing');
    expect(workspaceById('nope')).toBe(undefined);
    expect(workspaceCommandId('security')).toBe('znxstudio.workspace.activate.security');
  });

  test('workspace toolbars (SB-6) carry well-formed actions', () => {
    const withToolbars = WORKSPACES.filter((w) => w.toolbar?.length);
    // The five spec examples plus a few more all have toolbars.
    expect(withToolbars.length).toBeGreaterThan(4);
    for (const workspace of withToolbars) {
      for (const action of workspace.toolbar ?? []) {
        expect(action.icon.length).toBeGreaterThan(0);
        expect(action.label.length).toBeGreaterThan(0);
        expect(action.command.startsWith('znxstudio.')).toBe(true);
      }
    }
    // AI workspace matches the spec's action set.
    expect(workspaceById('ai')?.toolbar?.map((a) => a.label)).toEqual(['Chat', 'Explain', 'Review', 'Generate Tests', 'Refactor']);
  });
});
