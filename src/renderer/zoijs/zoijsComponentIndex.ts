/**
 * Cross-file Zoijs component index + auto-import (Phase 6B, cross-file).
 *
 * Zoijs has no compiler/LSP, so component discovery is text-based. `scanZoijsComponents`
 * finds the components declared in ONE file; this module builds a workspace-wide
 * index of the EXPORTED ones (only those can be imported elsewhere) and turns them
 * into completions that, when accepted, insert `Name()` in the markup AND add the
 * `import { Name } from './rel/path'` if the current file doesn't already have it.
 *
 * Everything here is pure (no DOM, no IPC): the module owns file reading and hands
 * this `{ path, text }` pairs; relative-path and import-edit maths are unit-tested.
 */
import { scanZoijsComponents } from './zoijsComponents';
import type { ComponentImportEdit, ZoijsCompletion } from './zoijsCompletions';

export interface IndexedComponent {
  name: string;
  /** Absolute path of the file that exports it. */
  file: string;
  params: string[];
}

/** Build the exported-component index from a set of scanned files. */
export function buildComponentIndex(files: readonly { path: string; text: string }[]): IndexedComponent[] {
  const out: IndexedComponent[] = [];
  for (const { path, text } of files) {
    for (const component of scanZoijsComponents(text)) {
      if (component.exported) out.push({ name: component.name, file: path, params: component.params });
    }
  }
  return out;
}

const toPosix = (p: string): string => p.replace(/\\/g, '/');
const dropExt = (p: string): string => p.replace(/\.(?:js|ts|jsx|tsx|mjs|cjs)$/i, '');
export const samePath = (a: string, b: string): boolean => toPosix(a).toLowerCase() === toPosix(b).toLowerCase();

/** Base file name (for a completion detail label). */
export function baseName(path: string): string {
  return toPosix(path).split('/').pop() ?? path;
}

/**
 * A relative ES module specifier from `fromFile` to `toFile` (POSIX, no extension,
 * always dot-prefixed): e.g. `/app/pages/home.js` → `/app/ui/Card.js` = `../ui/Card`.
 */
export function importSpecifier(fromFile: string, toFile: string): string {
  const from = toPosix(fromFile).split('/');
  from.pop(); // drop the file name → directory segments
  const to = dropExt(toPosix(toFile)).split('/');
  const toName = to.pop() ?? '';

  // Compare directories case-insensitively (Windows) to find the shared prefix.
  let i = 0;
  while (i < from.length && i < to.length && from[i].toLowerCase() === to[i].toLowerCase()) i++;

  const up = from.slice(i).map(() => '..');
  const down = to.slice(i);
  const parts = [...up, ...down, toName].filter((s) => s.length > 0);
  const specifier = parts.join('/');
  return specifier.startsWith('.') ? specifier : `./${specifier}`;
}

/** Is `name` already usable in `text` — imported at top, or declared locally? */
export function alreadyAvailable(text: string, name: string): boolean {
  const n = escapeRegExp(name);
  // Named / default / namespace import of `name`.
  const imported = new RegExp(
    `import\\s+(?:[A-Za-z_$][\\w$]*\\s*,\\s*)?(?:\\*\\s+as\\s+${n}\\b|${n}\\b|\\{[^}]*\\b${n}\\b[^}]*\\})`,
  );
  if (imported.test(text)) return true;
  // Local declaration (function / const / let / var).
  return new RegExp(`\\b(?:function|const|let|var)\\s+${n}\\b`).test(text);
}

/**
 * The edit that adds `import { name } from 'specifier'` to `text`, or null if it is
 * already available. Merges into an existing named import from the same specifier
 * when present; otherwise inserts a new import line after the last import (or at the
 * top of the file).
 */
export function computeImportEdit(text: string, name: string, specifier: string): ComponentImportEdit | null {
  if (alreadyAvailable(text, name)) return null;
  const lines = text.split(/\r?\n/);

  // Merge into an existing `import { … } from 'specifier'` (same module).
  const spec = escapeRegExp(specifier);
  const mergeRe = new RegExp(`^(\\s*import\\s*\\{)([^}]*)(\\}\\s*from\\s*['"])${spec}['"]`);
  for (let line = 0; line < lines.length; line++) {
    const match = lines[line].match(mergeRe);
    if (!match) continue;
    const bracePos = match[1].length; // index just after `{`
    const inner = match[2];
    if (inner.trim().length === 0) {
      // Empty braces `{}` → `{ name }`.
      return { start: { line, character: bracePos }, end: { line, character: bracePos }, newText: ` ${name} ` };
    }
    // Insert `, name` just after the last non-space of the existing list.
    const insertAt = bracePos + inner.replace(/\s+$/, '').length;
    return { start: { line, character: insertAt }, end: { line, character: insertAt }, newText: `, ${name}` };
  }

  // Otherwise, a new import line after the last top-of-file import.
  let lastImport = -1;
  for (let line = 0; line < lines.length; line++) {
    if (/^\s*import\b/.test(lines[line])) lastImport = line;
    else if (lastImport >= 0 && lines[line].trim().length > 0 && !/^\s*import\b/.test(lines[line])) break;
  }
  const importLine = `import { ${name} } from '${specifier}';`;
  if (lastImport >= 0) {
    const col = lines[lastImport].length;
    return { start: { line: lastImport, character: col }, end: { line: lastImport, character: col }, newText: `\n${importLine}` };
  }
  return { start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, newText: `${importLine}\n` };
}

/**
 * Completions for components declared in OTHER files: insert `Name()` and, unless
 * the current file already has it, auto-import from the relative specifier. Skips
 * the current file and any name already available locally.
 */
export function crossFileComponentCompletions(
  index: readonly IndexedComponent[],
  currentPath: string,
  currentText: string,
  localNames: ReadonlySet<string>,
): ZoijsCompletion[] {
  const out: ZoijsCompletion[] = [];
  const seen = new Set<string>(localNames);
  for (const component of index) {
    if (samePath(component.file, currentPath) || seen.has(component.name)) continue;
    seen.add(component.name);
    const specifier = importSpecifier(currentPath, component.file);
    const edit = computeImportEdit(currentText, component.name, specifier) ?? undefined;
    out.push({
      label: component.name,
      kind: 'function',
      detail: `Zoijs component — ${baseName(component.file)}`,
      documentation: edit
        ? `Render \`${component.name}\` (auto-imports from \`${specifier}\`).`
        : `Render the \`${component.name}\` component.`,
      insertText: `${component.name}()`,
      additionalEdit: edit,
    });
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
