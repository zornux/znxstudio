import { describe, expect, test } from './harness';
import { scanModuleInfo } from '../src/shared/moduleScanner';
import {
  affectedFiles,
  buildDependencyGraph,
  type GraphFile,
} from '../src/shared/dependencyGraph';

describe('module scanner', () => {
  test('reads a module declaration and its range', () => {
    const info = scanModuleInfo('module Products.Inventory\n\npublic task list_all with x\nend\n');
    expect(info.module).toBe('Products.Inventory');
    expect(info.moduleRange?.startLine).toBe(0);
    expect(info.moduleRange?.startCharacter).toBe(7);
  });

  test('parses all import forms', () => {
    const info = scanModuleInfo(
      'import Math\n' +
        'import Products.Inventory as Inv\n' +
        'import Math showing square, cube\n' +
        'import Products.Inventory as Inv showing Product, list_all\n',
    );
    expect(info.imports).toHaveLength(4);
    expect(info.imports[0].module).toBe('Math');
    expect(info.imports[1].alias).toBe('Inv');
    expect(info.imports[2].showing).toEqual(['square', 'cube']);
    expect(info.imports[3].alias).toBe('Inv');
    expect(info.imports[3].showing).toEqual(['Product', 'list_all']);
  });

  test('captures the imported module name range for navigation', () => {
    const info = scanModuleInfo('import Math showing square\n');
    expect(info.imports[0].range).toEqual({
      startLine: 0,
      startCharacter: 7,
      endLine: 0,
      endCharacter: 11,
    });
  });

  test('ignores commented-out and non-import lines', () => {
    const info = scanModuleInfo('# import Ghost\nshow "import Not"\nimport Real\n');
    expect(info.imports).toHaveLength(1);
    expect(info.imports[0].module).toBe('Real');
    expect(info.module).toBeNull();
  });
});

const file = (path: string, module: string | null, imports: string[]): GraphFile => ({
  path,
  module,
  imports: imports.map((m) => ({
    module: m,
    showing: [],
    range: { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 },
  })),
});

describe('dependency graph: resolution', () => {
  test('resolves imports to declaring files (forward + reverse edges)', () => {
    const graph = buildDependencyGraph([
      file('/p/app.zx', null, ['Math']),
      file('/p/math.zx', 'Math', []),
    ]);
    expect(graph.moduleToFile['Math']).toBe('/p/math.zx');
    expect(graph.edges['/p/app.zx']).toEqual(['/p/math.zx']);
    expect(graph.reverse['/p/math.zx']).toEqual(['/p/app.zx']);
    expect(graph.unresolved).toHaveLength(0);
  });

  test('flags imports of undeclared modules', () => {
    const graph = buildDependencyGraph([file('/p/app.zx', null, ['Ghost'])]);
    expect(graph.unresolved).toHaveLength(1);
    expect(graph.unresolved[0].module).toBe('Ghost');
    expect(graph.edges['/p/app.zx']).toEqual([]);
  });

  test('detects duplicate module declarations', () => {
    const graph = buildDependencyGraph([
      file('/p/a.zx', 'Dup', []),
      file('/p/b.zx', 'Dup', []),
    ]);
    expect(graph.duplicateModules).toHaveLength(1);
    expect(graph.duplicateModules[0].paths).toEqual(['/p/a.zx', '/p/b.zx']);
  });
});

describe('dependency graph: cycles', () => {
  test('finds an import cycle', () => {
    const graph = buildDependencyGraph([
      file('/p/a.zx', 'A', ['B']),
      file('/p/b.zx', 'B', ['A']),
    ]);
    expect(graph.cycles).toHaveLength(1);
    expect(graph.cycles[0]).toEqual(['/p/a.zx', '/p/b.zx']);
  });

  test('acyclic graphs report no cycles', () => {
    const graph = buildDependencyGraph([
      file('/p/a.zx', 'A', ['B']),
      file('/p/b.zx', 'B', ['C']),
      file('/p/c.zx', 'C', []),
    ]);
    expect(graph.cycles).toHaveLength(0);
  });
});

describe('dependency graph: affected set', () => {
  test('returns transitive dependents (who to re-check on change)', () => {
    // c ← b ← a  (a imports b, b imports c)
    const graph = buildDependencyGraph([
      file('/p/a.zx', 'A', ['B']),
      file('/p/b.zx', 'B', ['C']),
      file('/p/c.zx', 'C', []),
    ]);
    expect(affectedFiles(graph, '/p/c.zx')).toEqual(['/p/a.zx', '/p/b.zx']);
    expect(affectedFiles(graph, '/p/b.zx')).toEqual(['/p/a.zx']);
    expect(affectedFiles(graph, '/p/a.zx')).toEqual([]);
  });
});
