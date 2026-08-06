import type { ScannedImport, SourceRange } from './moduleScanner';

/**
 * Pure module dependency-graph builder + queries. Operates on plain, JSON-
 * serializable structures so the same code runs in the main process (which
 * scans the files), crosses IPC untouched, and is used by the renderer + tests.
 *
 * Zornux imports reference module NAMES; resolution maps each import to the file
 * that declares that module. Missing modules become `unresolved`, import cycles
 * become `cycles`, and `affectedFiles` answers "if this file changes, which
 * other files depend on it (transitively) and may need re-checking".
 */

export interface GraphFile {
  path: string;
  module: string | null;
  imports: ScannedImport[];
}

export interface UnresolvedImport {
  path: string;
  module: string;
  range: SourceRange;
}

export interface DependencyGraphSnapshot {
  /** The scanned files (path, declared module, imports) — drives the panel. */
  files: GraphFile[];
  /** Module name → declaring file path (first declaration wins). */
  moduleToFile: Record<string, string>;
  /** Modules declared by more than one file. */
  duplicateModules: { module: string; paths: string[] }[];
  /** File path → resolved imported file paths. */
  edges: Record<string, string[]>;
  /** File path → paths that import it. */
  reverse: Record<string, string[]>;
  /** Imports that reference a module no file declares. */
  unresolved: UnresolvedImport[];
  /** Import cycles, each a list of file paths (strongly-connected). */
  cycles: string[][];
  fileCount: number;
  /** Hash of all scanned content; set by the scanner, used to skip redundant work. */
  contentHash?: string;
}

export function buildDependencyGraph(files: GraphFile[]): DependencyGraphSnapshot {
  const moduleToFile: Record<string, string> = {};
  const declarers = new Map<string, string[]>();
  for (const file of files) {
    if (!file.module) continue;
    const list = declarers.get(file.module) ?? [];
    list.push(file.path);
    declarers.set(file.module, list);
    if (!(file.module in moduleToFile)) moduleToFile[file.module] = file.path;
  }

  const duplicateModules = [...declarers.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([module, paths]) => ({ module, paths }));

  const edges: Record<string, string[]> = {};
  const reverse: Record<string, string[]> = {};
  const unresolved: UnresolvedImport[] = [];
  for (const file of files) {
    edges[file.path] ??= [];
    reverse[file.path] ??= [];
  }

  for (const file of files) {
    for (const imp of file.imports) {
      const target = moduleToFile[imp.module];
      if (!target) {
        unresolved.push({ path: file.path, module: imp.module, range: imp.range });
        continue;
      }
      if (target === file.path) continue; // self-import: not an edge
      if (!edges[file.path].includes(target)) edges[file.path].push(target);
      (reverse[target] ??= []).push(file.path);
    }
  }
  // Dedupe reverse edges.
  for (const path of Object.keys(reverse)) {
    reverse[path] = [...new Set(reverse[path])];
  }

  return {
    files,
    moduleToFile,
    duplicateModules,
    edges,
    reverse,
    unresolved,
    cycles: findCycles(edges),
    fileCount: files.length,
  };
}

/**
 * Files that transitively depend on `path` (via reverse edges) — the set that
 * may need re-checking when `path` changes. Excludes `path` itself.
 */
export function affectedFiles(snapshot: DependencyGraphSnapshot, path: string): string[] {
  const result = new Set<string>();
  const stack = [path];
  while (stack.length) {
    const current = stack.pop() as string;
    for (const importer of snapshot.reverse[current] ?? []) {
      if (!result.has(importer)) {
        result.add(importer);
        stack.push(importer);
      }
    }
  }
  result.delete(path);
  return [...result].sort();
}

/** Tarjan strongly-connected components; components of size > 1 (or self-loops) are cycles. */
function findCycles(edges: Record<string, string[]>): string[][] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  let counter = 0;

  const strongConnect = (node: string): void => {
    index.set(node, counter);
    low.set(node, counter);
    counter++;
    stack.push(node);
    onStack.add(node);

    for (const next of edges[node] ?? []) {
      if (!index.has(next)) {
        strongConnect(next);
        low.set(node, Math.min(low.get(node)!, low.get(next)!));
      } else if (onStack.has(next)) {
        low.set(node, Math.min(low.get(node)!, index.get(next)!));
      }
    }

    if (low.get(node) === index.get(node)) {
      const component: string[] = [];
      let member: string;
      do {
        member = stack.pop() as string;
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      const selfLoop = (edges[node] ?? []).includes(node);
      if (component.length > 1 || selfLoop) cycles.push(component.sort());
    }
  };

  for (const node of Object.keys(edges)) {
    if (!index.has(node)) strongConnect(node);
  }
  return cycles;
}
