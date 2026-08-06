import { describe, expect, test } from './harness';
import {
  classifyGroup,
  mergeTasks,
  parsePackageScripts,
  parseProjectScripts,
  parseTasksFile,
  resolveTaskCwd,
} from '../src/renderer/tasks/taskDiscovery';

describe('classifyGroup', () => {
  test('maps names to task groups', () => {
    expect(classifyGroup('build')).toBe('build');
    expect(classifyGroup('build:web')).toBe('build');
    expect(classifyGroup('test')).toBe('test');
    expect(classifyGroup('lint')).toBe('test');
    expect(classifyGroup('dev')).toBe('run');
    expect(classifyGroup('start')).toBe('run');
    expect(classifyGroup('deploy')).toBe('other');
  });
});

describe('parsePackageScripts', () => {
  test('turns scripts into npm run tasks', () => {
    const tasks = parsePackageScripts(JSON.stringify({ scripts: { build: 'tsc', dev: 'vite' } }));
    expect(tasks).toHaveLength(2);
    const build = tasks.find((t) => t.label === 'build')!;
    expect(build.command).toBe('npm run build');
    expect(build.group).toBe('build');
    expect(build.source).toBe('package.json');
  });

  test('bad JSON or no scripts yields nothing', () => {
    expect(parsePackageScripts('not json')).toHaveLength(0);
    expect(parsePackageScripts(JSON.stringify({ name: 'x' }))).toHaveLength(0);
  });
});

describe('parseProjectScripts', () => {
  test('keeps the literal command', () => {
    const tasks = parseProjectScripts(JSON.stringify({ scripts: { run: 'zornux run src/main.zx' } }));
    expect(tasks[0].command).toBe('zornux run src/main.zx');
    expect(tasks[0].source).toBe('znxstudio.project.json');
  });
});

describe('parseTasksFile', () => {
  test('reads explicit tasks with cwd and group', () => {
    const tasks = parseTasksFile(
      JSON.stringify({ tasks: [{ label: 'e2e', command: 'playwright test', cwd: 'web', group: 'test' }] }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual({ label: 'e2e', command: 'playwright test', cwd: 'web', group: 'test', source: 'znxstudio.tasks.json' });
  });

  test('drops entries missing a label or command; infers group', () => {
    const tasks = parseTasksFile(
      JSON.stringify({ tasks: [{ command: 'x' }, { label: 'buildAll', command: 'make' }] }),
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].group).toBe('build');
  });
});

describe('mergeTasks', () => {
  test('explicit tasks win on duplicate labels; sorted by group', () => {
    const explicit = parseTasksFile(JSON.stringify({ tasks: [{ label: 'build', command: 'custom' }] }));
    const pkg = parsePackageScripts(JSON.stringify({ scripts: { build: 'tsc', test: 'jest', deploy: 'sh d.sh' } }));
    const merged = mergeTasks(explicit, pkg);
    // build (explicit) + test + deploy = 3 unique
    expect(merged).toHaveLength(3);
    expect(merged.find((t) => t.label === 'build')!.command).toBe('custom');
    // group order: build, test, then other(deploy)
    expect(merged.map((t) => t.label)).toEqual(['build', 'test', 'deploy']);
  });
});

describe('resolveTaskCwd', () => {
  test('joins a relative cwd to the root (root separators preserved)', () => {
    expect(resolveTaskCwd('C:\\proj', 'web')).toBe('C:\\proj/web');
    expect(resolveTaskCwd('C:\\proj\\', 'packages/api')).toBe('C:\\proj/packages/api');
    expect(resolveTaskCwd('/home/u/proj', 'web')).toBe('/home/u/proj/web');
  });

  test('passes absolute cwd through and defaults to root', () => {
    expect(resolveTaskCwd('C:\\proj', 'D:\\other')).toBe('D:\\other');
    expect(resolveTaskCwd('C:\\proj', undefined)).toBe('C:\\proj');
  });
});
