import { describe, expect, test } from './harness';
import {
  buildArchitectureMessages,
  buildProjectMap,
  scanFileDeclarations,
  scanProject,
  summarizeProjectMap,
} from '../src/renderer/ai/architecture';
import type { DependencyGraphSnapshot } from '../src/shared/dependencyGraph';

describe('scanFileDeclarations', () => {
  test('captures the module and column-0 declarations', () => {
    const { module, declarations } = scanFileDeclarations('module app\nservice Greeter\n    use Repo\n    function m with x\n        give back x\n    end\nend\nclass User\nend\n');
    expect(module).toBe('app');
    expect(declarations).toEqual([
      { kind: 'service', name: 'Greeter' },
      { kind: 'class', name: 'User' },
    ]); // the nested `function m` (indented) is NOT a top-level component
  });
  test('ignores unnamed keyword lines', () => {
    expect(scanFileDeclarations('service\n').declarations).toHaveLength(0);
  });
});

describe('buildProjectMap', () => {
  test('tallies components by kind across files', () => {
    const archs = scanProject([
      { file: 'a.zx', text: 'service A\nend\nfunction f\nend\n' },
      { file: 'b.zx', text: 'repository R\nend\nservice B\nend\n' },
    ]);
    const map = buildProjectMap(archs);
    expect(map.fileCount).toBe(2);
    expect(map.componentCount).toBe(4);
    expect(map.byKind).toEqual({ service: 2, function: 1, repository: 1 });
  });
});

describe('summarizeProjectMap', () => {
  const map = buildProjectMap(
    scanProject([
      { file: 'app.zx', text: 'module app\napplication Main\nend\n' },
      { file: 'svc.zx', text: 'service Greeter\nend\n' },
    ]),
  );

  test('lists files, components and the kind tally', () => {
    const summary = summarizeProjectMap(map, null);
    expect(summary).toContain('2 files');
    expect(summary).toContain('application Main');
    expect(summary).toContain('service Greeter');
    expect(summary).toContain('[module app]');
  });

  test('folds in dependency-graph edges, cycles, and unresolved imports', () => {
    const graph = {
      files: [],
      moduleToFile: {},
      duplicateModules: [],
      edges: { 'C:/p/app.zx': ['C:/p/svc.zx'] },
      reverse: {},
      unresolved: [{ path: 'C:/p/app.zx', module: 'Missing', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } } }],
      cycles: [['C:/p/a.zx', 'C:/p/b.zx']],
      fileCount: 2,
    } as unknown as DependencyGraphSnapshot;
    const summary = summarizeProjectMap(map, graph);
    expect(summary).toContain('app.zx → svc.zx'); // basenames
    expect(summary).toContain('Import cycles: a.zx → b.zx');
    expect(summary).toContain('Unresolved imports: 1');
  });
});

describe('buildArchitectureMessages', () => {
  test('frames an architect review grounded in the map', () => {
    const { system, messages } = buildArchitectureMessages('Project: 1 file.', 'Demo');
    expect(system).toContain('software architect');
    expect(system).toContain('do not invent');
    expect(messages[0].content).toContain('Project: Demo');
    expect(messages[0].content).toContain('Project: 1 file.');
  });
});
