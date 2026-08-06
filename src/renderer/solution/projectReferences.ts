import type { WorkspaceInfo } from '../../shared/types';
import type { PackageDependency } from './zornuxManifest';

/**
 * Resolves references BETWEEN the projects open in a solution. A project's
 * declared dependencies (from its `zornux.project`) are classified as INTERNAL
 * — the dependency name matches another open project's package name — or
 * EXTERNAL (a registry/package the workspace doesn't contain). From the internal
 * edges it derives a build order (dependencies first) and detects cycles. Pure
 * and IPC-free; the module loads manifests and hands nodes in.
 */
export interface ProjectNode {
  root: string;
  /** Package name from the manifest, or the folder base name when there's no manifest. */
  name: string;
  version: string;
  /** True when the folder has a `zornux.project` (only such folders can be reference TARGETS). */
  hasManifest: boolean;
  dependencies: PackageDependency[];
}

export interface ResolvedReference {
  dependency: PackageDependency;
  /** True when the dependency resolves to another open project. */
  internal: boolean;
  targetRoot?: string;
  targetVersion?: string;
}

export interface ProjectReferenceGraph {
  nodes: ProjectNode[];
  /** root → its resolved references (same order as declared). */
  references: Map<string, ResolvedReference[]>;
  /** Roots in build order (a project's internal dependencies come before it). */
  order: string[];
  /** Cycles of roots via internal references (empty when acyclic). */
  cycles: string[][];
}

/** Interface registered under ServiceKeys.ProjectReferences (see ProjectReferencesModule). */
export interface ProjectReferencesService {
  graphFor(folders: WorkspaceInfo[]): Promise<ProjectReferenceGraph>;
}

export function resolveProjectReferences(nodes: ProjectNode[]): ProjectReferenceGraph {
  const byName = new Map<string, ProjectNode>();
  for (const node of nodes) {
    if (node.hasManifest) byName.set(node.name.toLowerCase(), node);
  }

  const references = new Map<string, ResolvedReference[]>();
  const edges = new Map<string, string[]>();
  for (const node of nodes) {
    const resolved: ResolvedReference[] = [];
    const targets: string[] = [];
    for (const dependency of node.dependencies) {
      const target = byName.get(dependency.name.toLowerCase());
      if (target && target.root !== node.root) {
        resolved.push({ dependency, internal: true, targetRoot: target.root, targetVersion: target.version });
        targets.push(target.root);
      } else {
        resolved.push({ dependency, internal: false });
      }
    }
    references.set(node.root, resolved);
    edges.set(node.root, targets);
  }

  const { order, cycles } = topoSort(
    nodes.map((node) => node.root),
    edges,
  );
  return { nodes, references, order, cycles };
}

/** DFS post-order (dependencies before dependents) with in-stack cycle detection. */
function topoSort(roots: string[], edges: Map<string, string[]>): { order: string[]; cycles: string[][] } {
  const order: string[] = [];
  const cycles: string[][] = [];
  const state = new Map<string, 'active' | 'done'>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    const status = state.get(node);
    if (status === 'done') return;
    if (status === 'active') {
      const start = stack.indexOf(node);
      if (start >= 0) cycles.push([...stack.slice(start), node]);
      return;
    }
    state.set(node, 'active');
    stack.push(node);
    for (const target of edges.get(node) ?? []) visit(target);
    stack.pop();
    state.set(node, 'done');
    order.push(node);
  };

  for (const root of roots) visit(root);
  return { order, cycles };
}
