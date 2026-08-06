import { describe, expect, test } from './harness';
import { buildSolution } from '../src/renderer/solution/solutionModel';
import type { WorkspaceInfo, ZnxStudioProject } from '../src/shared/types';

function folder(root: string, project?: Partial<ZnxStudioProject> | null, extra: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  const isProject = project !== null && project !== undefined;
  return {
    root,
    isZnxStudioProject: isProject,
    project: isProject ? ({ name: 'p', type: 'zornux', version: '1.0.0', ...project } as ZnxStudioProject) : null,
    detectedType: 'generic',
    diagnostics: [],
    ...extra,
  };
}

describe('buildSolution', () => {
  test('maps folders to projects with type, version, targets, scripts, problems', () => {
    const solution = buildSolution([
      folder(
        'C:/api',
        {
          name: 'orders-api',
          version: '2.1.0',
          languageTargets: ['zornux'],
          frameworkTargets: ['zoijs'],
          scripts: { dev: 'zornux run', test: 'zornux test' },
        },
        { detectedType: 'zornux-api', diagnostics: [{ severity: 'error', code: 'ZP1', message: 'x' }] },
      ),
    ]);
    const p = solution.projects[0];
    expect(p.name).toBe('orders-api');
    expect(p.type).toBe('zornux-api');
    expect(p.isProject).toBeTruthy();
    expect(p.version).toBe('2.1.0');
    expect(p.targets).toEqual(['zornux', 'zoijs']);
    expect(p.scripts).toEqual(['dev', 'test']);
    expect(p.problemCount).toBe(1);
  });

  test('a folder without a manifest is not a project and falls back to its base name', () => {
    const solution = buildSolution([folder('C:/some/plain-folder', null, { detectedType: 'generic' })]);
    const p = solution.projects[0];
    expect(p.isProject).toBeFalsy();
    expect(p.name).toBe('plain-folder');
    expect(p.version).toBeNull();
    expect(p.targets).toHaveLength(0);
    expect(p.scripts).toHaveLength(0);
  });

  test('projectCount counts only manifest folders; folder count is all', () => {
    const solution = buildSolution([
      folder('C:/api', { name: 'api' }, { detectedType: 'zornux-api' }),
      folder('C:/libs', null),
      folder('C:/web', { name: 'web' }, { detectedType: 'zoijs-frontend' }),
    ]);
    expect(solution.projects).toHaveLength(3);
    expect(solution.projectCount).toBe(2);
  });

  test('solution name is the first project with a manifest, else the first folder, else Workspace', () => {
    expect(buildSolution([folder('C:/x', null), folder('C:/api', { name: 'api' })]).name).toBe('api');
    expect(buildSolution([folder('C:/only-folder', null)]).name).toBe('only-folder');
    expect(buildSolution([]).name).toBe('Workspace');
  });

  test('an explicit solution name overrides detection', () => {
    expect(buildSolution([folder('C:/api', { name: 'api' })], 'MySolution').name).toBe('MySolution');
  });
});
