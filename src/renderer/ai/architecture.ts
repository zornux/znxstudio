import type { AiMessage } from '../../shared/ai/providers';
import type { DependencyGraphSnapshot } from '../../shared/dependencyGraph';

/**
 * Pure core for AI Architecture analysis (Phase 10H — the Phase 10 finale).
 * Builds a compact, grounded map of the real project (top-level components per
 * file + the module dependency graph) and frames an architect-level request.
 * Everything the AI sees comes from actually scanning the workspace — no guesses.
 */

// `module` is captured separately (as the file's module), not as a component.
const STRUCTURAL_KINDS = [
  'class',
  'record',
  'repository',
  'service',
  'application',
  'migration',
  'database',
  'enum',
  'function',
];
// Column-0 declarations only — the architectural altitude (skip nested methods).
const TOP_DECL_RE = new RegExp(`^(${STRUCTURAL_KINDS.join('|')})\\b\\s*([A-Za-z_]\\w*)?`);
const MODULE_RE = /^module\s+([A-Za-z_][\w.]*)/;

export interface Declaration {
  kind: string;
  name: string;
}

export interface FileArchitecture {
  file: string;
  module: string | null;
  declarations: Declaration[];
}

/** Extract the top-level (column-0) declarations + declared module of one file. */
export function scanFileDeclarations(text: string): { module: string | null; declarations: Declaration[] } {
  let module: string | null = null;
  const declarations: Declaration[] = [];
  for (const line of text.split('\n')) {
    const mod = line.match(MODULE_RE);
    if (mod) module = mod[1];
    const match = line.match(TOP_DECL_RE);
    if (match && match[2]) declarations.push({ kind: match[1], name: match[2] });
  }
  return { module, declarations };
}

/** Scan a set of (relative-labeled) files into per-file architecture records. */
export function scanProject(files: { file: string; text: string }[]): FileArchitecture[] {
  return files.map(({ file, text }) => {
    const { module, declarations } = scanFileDeclarations(text);
    return { file, module, declarations };
  });
}

export interface ProjectMap {
  fileCount: number;
  byKind: Record<string, number>;
  componentCount: number;
  files: FileArchitecture[];
}

export function buildProjectMap(archs: FileArchitecture[]): ProjectMap {
  const byKind: Record<string, number> = {};
  let componentCount = 0;
  for (const arch of archs) {
    for (const decl of arch.declarations) {
      byKind[decl.kind] = (byKind[decl.kind] ?? 0) + 1;
      componentCount++;
    }
  }
  return { fileCount: archs.length, byKind, componentCount, files: archs };
}

function base(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/**
 * Render the project map (+ optional dependency graph) into a compact text block
 * for the model. Bounded so a large project can't blow the request size.
 */
export function summarizeProjectMap(
  map: ProjectMap,
  graph?: DependencyGraphSnapshot | null,
  maxFiles = 60,
  maxEdges = 40,
): string {
  const lines: string[] = [];
  lines.push(`Project: ${map.fileCount} file${map.fileCount === 1 ? '' : 's'}, ${map.componentCount} top-level components.`);

  const kinds = Object.entries(map.byKind)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind} ×${count}`);
  if (kinds.length) lines.push(`Components by kind: ${kinds.join(', ')}.`);

  lines.push('', 'Files:');
  for (const file of map.files.slice(0, maxFiles)) {
    const decls = file.declarations.map((d) => `${d.kind} ${d.name}`).join(', ') || '(no top-level components)';
    const mod = file.module ? ` [module ${file.module}]` : '';
    lines.push(`- ${file.file}${mod}: ${decls}`);
  }
  if (map.files.length > maxFiles) lines.push(`- … and ${map.files.length - maxFiles} more files`);

  if (graph) {
    const edgeEntries = Object.entries(graph.edges).filter(([, targets]) => targets.length > 0);
    if (edgeEntries.length) {
      lines.push('', 'Module dependencies (file → imports):');
      for (const [from, targets] of edgeEntries.slice(0, maxEdges)) {
        lines.push(`- ${base(from)} → ${targets.map(base).join(', ')}`);
      }
      if (edgeEntries.length > maxEdges) lines.push(`- … and ${edgeEntries.length - maxEdges} more`);
    }
    if (graph.cycles.length) {
      lines.push('', `Import cycles: ${graph.cycles.map((cycle) => cycle.map(base).join(' → ')).join(' | ')}`);
    }
    if (graph.unresolved.length) {
      lines.push(`Unresolved imports: ${graph.unresolved.length} (e.g. ${graph.unresolved.slice(0, 3).map((u) => u.module).join(', ')})`);
    }
    if (graph.duplicateModules.length) {
      lines.push(`Duplicate module declarations: ${graph.duplicateModules.map((d) => d.module).join(', ')}`);
    }
  }
  return lines.join('\n');
}

/** Build the architect-level analysis request. */
export function buildArchitectureMessages(
  summary: string,
  projectName: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You are a software architect reviewing a Zornux project (an English-readable, statically-typed language).',
    'From the provided map of files, components, and module dependencies, describe the architecture:',
    'the layers and responsibilities you can infer, how components relate, and the overall shape.',
    'Then note strengths, risks (tight coupling, import cycles, god-modules, missing layers, unresolved imports),',
    'and give concrete, prioritized recommendations.',
    'Ground everything in the map — do not invent files or components that are not listed.',
  ].join('\n');
  const name = projectName ? `Project: ${projectName}\n\n` : '';
  return { system, messages: [{ role: 'user', content: `${name}${summary}` }] };
}
