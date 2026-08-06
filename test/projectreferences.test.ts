import { describe, expect, test } from './harness';
import { resolveProjectReferences, type ProjectNode } from '../src/renderer/solution/projectReferences';
import type { PackageDependency } from '../src/renderer/solution/zornuxManifest';

function node(root: string, name: string, deps: PackageDependency[] = [], hasManifest = true, version = '1.0.0'): ProjectNode {
  return { root, name, version, hasManifest, dependencies: deps };
}
const dep = (name: string, constraint = '^1.0.0', registry?: string): PackageDependency =>
  registry ? { name, constraint, registry } : { name, constraint };

describe('resolveProjectReferences', () => {
  test('classifies a dependency that matches another open project as internal', () => {
    const graph = resolveProjectReferences([
      node('C:/app', 'greeter-app', [dep('Greetings', '^1.0.0', 'store')]),
      node('C:/lib', 'Greetings', [], true, '1.0.0'),
    ]);
    const appRefs = graph.references.get('C:/app')!;
    expect(appRefs).toHaveLength(1);
    expect(appRefs[0].internal).toBeTruthy();
    expect(appRefs[0].targetRoot).toBe('C:/lib');
    expect(appRefs[0].targetVersion).toBe('1.0.0');
  });

  test('a dependency with no matching open project is external', () => {
    const graph = resolveProjectReferences([node('C:/app', 'app', [dep('SomeRegistryPkg')])]);
    expect(graph.references.get('C:/app')![0].internal).toBeFalsy();
  });

  test('matches package names case-insensitively', () => {
    const graph = resolveProjectReferences([
      node('C:/a', 'a', [dep('greetings')]),
      node('C:/lib', 'Greetings'),
    ]);
    expect(graph.references.get('C:/a')![0].internal).toBeTruthy();
  });

  test('a folder without a manifest is never a reference target', () => {
    const graph = resolveProjectReferences([
      node('C:/a', 'a', [dep('plain')]),
      node('C:/plain', 'plain', [], /* hasManifest */ false),
    ]);
    expect(graph.references.get('C:/a')![0].internal).toBeFalsy();
  });

  test('build order lists dependencies before dependents', () => {
    const graph = resolveProjectReferences([
      node('C:/app', 'app', [dep('lib')]),
      node('C:/lib', 'lib', [dep('base')]),
      node('C:/base', 'base'),
    ]);
    expect(graph.cycles).toHaveLength(0);
    expect(graph.order.indexOf('C:/base')).toBeLessThan(graph.order.indexOf('C:/lib'));
    expect(graph.order.indexOf('C:/lib')).toBeLessThan(graph.order.indexOf('C:/app'));
  });

  test('detects a reference cycle', () => {
    const graph = resolveProjectReferences([
      node('C:/a', 'a', [dep('b')]),
      node('C:/b', 'b', [dep('a')]),
    ]);
    expect(graph.cycles.length).toBeGreaterThan(0);
  });
});
