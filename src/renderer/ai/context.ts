import type { AiMessage } from '../../shared/ai/providers';

/**
 * Project context infrastructure for AI features. Collects workspace-level
 * context (file listing, symbol extraction, dependency summary, diagnostics)
 * into a structured representation that every AI feature can include in its
 * prompts. The context store is additive: users can pin files and AI features
 * can contribute relevant context items.
 */

export interface ContextItem {
  /** Unique key for dedup (e.g. 'file:src/main.zx' or 'diagnostic:ZX0110:3'). */
  id: string;
  kind: 'file' | 'selection' | 'diagnostic' | 'symbol' | 'dependency' | 'terminal';
  /** Short display label (file name, symbol name, etc.). */
  label: string;
  /** The actual content included in the prompt. */
  content: string;
  /** Where this item came from (auto-collected vs user-pinned). */
  source: 'auto' | 'pinned';
  /** Character count of `content`. */
  chars: number;
}

export interface ProjectSummary {
  /** Total .zx files discovered. */
  fileCount: number;
  /** Top-level declarations found across the project. */
  declarations: DeclarationSummary[];
  /** Module dependency edges (import graph). */
  dependencies: string[];
  /** Active diagnostics summary. */
  diagnosticsSummary: string;
}

export interface DeclarationSummary {
  file: string;
  name: string;
  kind: string;
  line: number;
}

const MAX_FILE_CONTEXT_CHARS = 8000;
const MAX_TOTAL_CONTEXT_CHARS = 32000;

const ZX_DECLARATION_RE =
  /^(function|class|record|service|module|enum|interface|trait|component|screen|extension|capability|query|migration)\s+(\w+)/;

/** Scan a Zornux source file for top-level declarations (column-0 keywords). */
export function scanDeclarations(source: string, file: string): DeclarationSummary[] {
  const results: DeclarationSummary[] = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(ZX_DECLARATION_RE);
    if (match) {
      results.push({ file, name: match[2], kind: match[1], line: i + 1 });
    }
  }
  return results;
}

/** Format declarations into a compact project map for the AI prompt. */
export function formatProjectMap(declarations: DeclarationSummary[]): string {
  if (declarations.length === 0) return '(no declarations found)';
  const byFile = new Map<string, DeclarationSummary[]>();
  for (const d of declarations) {
    const list = byFile.get(d.file) ?? [];
    list.push(d);
    byFile.set(d.file, list);
  }
  const lines: string[] = [];
  for (const [file, decls] of byFile) {
    const items = decls.map((d) => `${d.kind} ${d.name} (L${d.line})`).join(', ');
    lines.push(`${file}: ${items}`);
  }
  return lines.join('\n');
}

/** Format dependency edges into a compact summary. */
export function formatDependencies(edges: string[]): string {
  if (edges.length === 0) return '(no dependencies)';
  return edges.slice(0, 50).join('\n') + (edges.length > 50 ? `\n… (${edges.length - 50} more)` : '');
}

/** Truncate file content for context inclusion. */
export function truncateForContext(content: string, max = MAX_FILE_CONTEXT_CHARS): string {
  if (content.length <= max) return content;
  return content.slice(0, max) + `\n… (${content.length - max} more characters truncated)`;
}

/** Build a context item from a file path and its source. */
export function fileContextItem(path: string, source: string, pinned = false): ContextItem {
  const label = path.split(/[\\/]/).pop() ?? path;
  const content = truncateForContext(source);
  return {
    id: `file:${path}`,
    kind: 'file',
    label,
    content: `File: ${path}\n\`\`\`\n${content}\n\`\`\``,
    source: pinned ? 'pinned' : 'auto',
    chars: content.length,
  };
}

/** Build a context item from a code selection. */
export function selectionContextItem(
  path: string,
  selection: string,
  startLine: number,
): ContextItem {
  const label = `${path.split(/[\\/]/).pop() ?? path}:${startLine}`;
  return {
    id: `selection:${path}:${startLine}`,
    kind: 'selection',
    label,
    content: `Selected code in ${path} (line ${startLine}):\n\`\`\`\n${selection}\n\`\`\``,
    source: 'auto',
    chars: selection.length,
  };
}

/** Build a context item from a compiler diagnostic. */
export function diagnosticContextItem(
  code: string,
  message: string,
  file: string,
  line: number,
  snippet?: string,
): ContextItem {
  const parts = [`[${code}] ${message} — ${file}:${line}`];
  if (snippet) parts.push(snippet);
  const content = parts.join('\n');
  return {
    id: `diagnostic:${code}:${line}`,
    kind: 'diagnostic',
    label: `${code} at ${file}:${line}`,
    content,
    source: 'auto',
    chars: content.length,
  };
}

/** Build a context item from terminal output. */
export function terminalContextItem(label: string, output: string): ContextItem {
  const truncated = output.length > 2000 ? output.slice(-2000) : output;
  return {
    id: `terminal:${label}:${Date.now()}`,
    kind: 'terminal',
    label,
    content: `Terminal output (${label}):\n\`\`\`\n${truncated}\n\`\`\``,
    source: 'auto',
    chars: truncated.length,
  };
}

/**
 * The context store: an ordered list of context items that AI features can
 * read and the user can manage. Items are deduped by id, and the total
 * character budget is enforced on assembly.
 */
export class ContextStore {
  private items = new Map<string, ContextItem>();

  add(item: ContextItem): void {
    this.items.set(item.id, item);
  }

  remove(id: string): void {
    this.items.delete(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  clear(keepPinned = true): void {
    if (!keepPinned) {
      this.items.clear();
      return;
    }
    for (const [id, item] of this.items) {
      if (item.source !== 'pinned') this.items.delete(id);
    }
  }

  all(): ContextItem[] {
    return [...this.items.values()];
  }

  pinned(): ContextItem[] {
    return this.all().filter((i) => i.source === 'pinned');
  }

  /** Total characters across all items. */
  totalChars(): number {
    let total = 0;
    for (const item of this.items.values()) total += item.chars;
    return total;
  }

  /** Assemble all items into a single context block, respecting the budget. */
  assemble(maxChars = MAX_TOTAL_CONTEXT_CHARS): string {
    const parts: string[] = [];
    let budget = maxChars;
    // Pinned items first, then auto items
    const sorted = [...this.items.values()].sort((a, b) => {
      if (a.source === 'pinned' && b.source !== 'pinned') return -1;
      if (a.source !== 'pinned' && b.source === 'pinned') return 1;
      return 0;
    });
    for (const item of sorted) {
      if (item.chars > budget) continue;
      parts.push(item.content);
      budget -= item.chars;
    }
    return parts.join('\n\n');
  }
}

/** Build a system prompt enriched with project context. */
export function composeEnrichedSystemPrompt(
  basePrompt: string,
  projectMap?: string,
  contextBlock?: string,
): string {
  const parts = [basePrompt];
  if (projectMap) {
    parts.push('', 'Project structure:', projectMap);
  }
  if (contextBlock) {
    parts.push('', 'Relevant context:', contextBlock);
  }
  return parts.join('\n');
}

/** Filter secrets from text before including in AI context. */
export function filterSecrets(text: string): string {
  return text
    .replace(/(['"])[A-Za-z0-9+/=_-]{32,}(['"])/g, '$1[REDACTED]$2')
    .replace(/(api[_-]?key|secret|token|password|credential)\s*[:=]\s*['"][^'"]+['"]/gi, '$1=[REDACTED]')
    .replace(/-----BEGIN [A-Z ]+-----[\s\S]*?-----END [A-Z ]+-----/g, '[REDACTED CERTIFICATE]');
}
