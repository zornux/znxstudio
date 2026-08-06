/**
 * The `zornux doc` contract (Phase 18B).
 *
 * `zornux doc <path> --output <dir> --json` runs the compiler's REAL
 * documentation generator (`src/Zornux.Documentation`). It reads the parsed AST
 * — it never executes the program — and writes a navigable Markdown or HTML tree.
 *
 * FOUR GROUND TRUTHS, verified against the compiler:
 *
 * 1. The rc.8 envelope carries the summary in `result` and the reduced
 *    diagnostics at the top level, with severity lowercase. `ok:false` (an
 *    unknown `--format`, a missing path) is a real failure, distinct from an
 *    empty API surface, which is `ok:true` with `modules: 0`. A parser that
 *    reads a failure as an empty summary silently loses the error.
 *
 * 2. Doc diagnostics carry NO file or line. ZX1601 says which symbol is
 *    undocumented in its message and nothing more, so these cannot become editor
 *    squiggles. The coverage list is the honest presentation.
 *
 * 3. `--fail-on-missing-comments` escalates ZX1601 Warning → Error, exits 1, and
 *    WRITES NOTHING (`written: false`) — but `files[]` still lists what it would
 *    have written. Reading `files[]` as "these exist on disk" is wrong.
 *
 * 4. A path that does not exist is NOT an error: the generator reports zero
 *    modules, exit 0. So ZnxStudio validates the path itself — otherwise a typo
 *    reads as "this project has no public API".
 *
 * Also: only PUBLIC symbols are documented by default. A file with no `module` /
 * `public` declarations documents nothing until `--include-private` is passed.
 */

import { parseEnvelope } from '../../shared/cli/envelope';
import { enumOr } from '../../shared/cli/tolerant';

export type DocFormat = 'markdown' | 'html';

export interface DocOptions {
  format: DocFormat;
  /** Document non-public symbols too. */
  includePrivate: boolean;
  /** Document `test … end` blocks as specifications. */
  includeTests: boolean;
  /** Document public symbols from resolved dependencies. */
  includePackages: boolean;
  /** Escalate ZX1601 to an error — and write nothing. */
  failOnMissingComments: boolean;
}

export const DEFAULT_DOC_OPTIONS: DocOptions = {
  format: 'markdown',
  includePrivate: false,
  includeTests: false,
  includePackages: false,
  failOnMissingComments: false,
};

/** A diagnostic as it appears inside the SUMMARY object: no file, no range. */
export interface DocDiagnostic {
  code: string;
  severity: 'Info' | 'Warning' | 'Error';
  message: string;
}

/** A diagnostic from the BARE ARRAY shape: the generator refused to run at all. */
export interface DocFailure {
  code: string;
  severity: string;
  message: string;
  file?: string;
  help?: string;
}

export interface DocSummary {
  project: string;
  version: string;
  format: string;
  /** The folder the generator wrote into (absolute). */
  output: string;
  /** False when `--fail-on-missing-comments` tripped: `files` were NOT written. */
  written: boolean;
  modules: number;
  /** Paths relative to `output`, in generation order. */
  files: string[];
  diagnostics: DocDiagnostic[];
}

export type DocResult =
  | { ok: true; summary: DocSummary }
  | { ok: false; failures: DocFailure[]; output: string };

/** Build the argv for `zornux doc`. `output` is mandatory here on purpose. */
export function buildDocArgs(path: string, output: string, options: DocOptions = DEFAULT_DOC_OPTIONS): string[] {
  const args = ['doc', path, '--output', output, '--format', options.format];
  if (options.includePrivate) args.push('--include-private');
  if (options.includeTests) args.push('--include-tests');
  if (options.includePackages) args.push('--include-packages');
  if (options.failOnMissingComments) args.push('--fail-on-missing-comments');
  args.push('--json');
  return args;
}

/** Build a `DocSummary` from the doc payload object (the envelope's `result`). */
function summaryFrom(raw: Record<string, unknown>, diagnostics: DocDiagnostic[]): DocSummary {
  return {
    project: String(raw.project ?? 'Zornux Project'),
    version: String(raw.version ?? ''),
    format: String(raw.format ?? 'markdown'),
    output: String(raw.output ?? ''),
    written: raw.written === true,
    modules: typeof raw.modules === 'number' ? raw.modules : 0,
    files: Array.isArray(raw.files) ? raw.files.filter((f): f is string => typeof f === 'string') : [],
    diagnostics,
  };
}

function docDiagnostic(entry: Record<string, unknown>): DocDiagnostic {
  return { code: String(entry.code ?? ''), severity: normalizeSeverity(entry.severity), message: String(entry.message ?? '') };
}

function docFailure(entry: Record<string, unknown>): DocFailure {
  return {
    code: String(entry.code ?? 'ZX1600'),
    severity: String(entry.severity ?? 'error'),
    message: String(entry.message ?? 'Documentation generation failed.'),
    file: typeof entry.file === 'string' ? entry.file : undefined,
    help: typeof entry.help === 'string' ? entry.help : undefined,
  };
}

/**
 * Parse `zornux doc --json`. Never throws.
 *
 * The envelope carries the summary in `result` and the reduced diagnostics at
 * the top level. `ok:false` means the generator produced nothing (a bad
 * `--format`, a missing path) — reported as failures, distinct from an empty
 * API surface, which is `ok:true` with `modules: 0`. Output that is not an
 * envelope (a crash, no JSON) is itself a failure, never a silent success.
 */
export function parseDocResult(output: string): DocResult {
  const envelope = parseEnvelope(output);
  if (!envelope) {
    return {
      ok: false,
      output,
      failures: [{ code: 'ZX1600', severity: 'error', message: 'The documentation generator printed no JSON summary.' }],
    };
  }
  if (!envelope.ok) {
    const failures = envelope.diagnostics.map((diagnostic) =>
      docFailure({ code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message, file: diagnostic.file ?? undefined, help: diagnostic.help ?? undefined }),
    );
    return { ok: false, failures: failures.length ? failures : [docFailure({})], output };
  }
  const result = envelope.result && typeof envelope.result === 'object' && !Array.isArray(envelope.result) ? (envelope.result as Record<string, unknown>) : {};
  return { ok: true, summary: summaryFrom(result, envelope.diagnostics.map((d) => docDiagnostic({ code: d.code, severity: d.severity, message: d.message }))) };
}

function normalizeSeverity(value: unknown): DocDiagnostic['severity'] {
  // Doc diagnostics are advisories — an unknown severity coerces to 'Warning'.
  return enumOr(value, ['Info', 'Warning', 'Error'] as const, 'Warning');
}

/* ------------------------------------------------------------- navigation */

export type DocSectionName = 'Modules' | 'Classes' | 'Services' | 'Other';

export interface DocSection {
  name: DocSectionName;
  files: string[];
}

/**
 * Group the generated files by their folder — `modules/`, `classes/`,
 * `services/` — the way the generated index page does. `index.*` and the HTML
 * stylesheet are not pages the reader browses to, so they are excluded.
 */
export function docSections(files: string[]): DocSection[] {
  const buckets: Record<DocSectionName, string[]> = { Modules: [], Classes: [], Services: [], Other: [] };
  for (const file of files) {
    const path = file.replace(/\\/g, '/');
    if (path.startsWith('assets/') || /^index\.\w+$/.test(path)) continue;
    if (path.startsWith('modules/')) buckets.Modules.push(path);
    else if (path.startsWith('classes/')) buckets.Classes.push(path);
    else if (path.startsWith('services/')) buckets.Services.push(path);
    else buckets.Other.push(path);
  }
  return (['Modules', 'Classes', 'Services', 'Other'] as DocSectionName[])
    .map((name) => ({ name, files: buckets[name] }))
    .filter((section) => section.files.length > 0);
}

/** The generated entry page for a format, or null when it was not written. */
export function indexFile(summary: DocSummary): string | null {
  const wanted = summary.format === 'html' ? 'index.html' : 'index.md';
  return summary.files.includes(wanted) ? wanted : null;
}

/** The symbol name a page documents, for a sidebar label. */
export function pageTitle(file: string): string {
  return (file.replace(/\\/g, '/').split('/').pop() ?? file).replace(/\.(md|html)$/i, '');
}

/* --------------------------------------------------------------- coverage */

export const MISSING_COMMENT_RULE = 'ZX1601';
export const INVALID_TAG_RULE = 'ZX1602';

export interface DocCoverage {
  /** Public symbols the generator found no comment on. */
  undocumented: string[];
  /** Malformed tags (`param` with no name, …). */
  invalidTags: string[];
  /** Everything else the generator complained about. */
  other: DocDiagnostic[];
  /** True when a `--fail-on-missing-comments` run would fail. */
  wouldFail: boolean;
}

/**
 * ZX1601's message is the only place the symbol name appears — there is no
 * structured field for it. Pull the quoted name out, and fall back to the whole
 * message rather than dropping a finding we could not parse.
 */
export function undocumentedSymbol(message: string): string {
  const quoted = /['‘’"]([^'‘’"]+)['‘’"]/.exec(message);
  return quoted?.[1] ?? message;
}

export function docCoverage(diagnostics: DocDiagnostic[]): DocCoverage {
  const undocumented: string[] = [];
  const invalidTags: string[] = [];
  const other: DocDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    if (diagnostic.code === MISSING_COMMENT_RULE) undocumented.push(undocumentedSymbol(diagnostic.message));
    else if (diagnostic.code === INVALID_TAG_RULE) invalidTags.push(diagnostic.message);
    else other.push(diagnostic);
  }
  return {
    undocumented,
    invalidTags,
    other,
    wouldFail: undocumented.length > 0 || other.some((d) => d.severity === 'Error'),
  };
}

export function coverageLine(summary: DocSummary, coverage: DocCoverage): string {
  const pages = docSections(summary.files).reduce((total, section) => total + section.files.length, 0);
  const written = summary.written ? 'written' : 'NOT written (nothing was saved)';
  const undocumented = coverage.undocumented.length
    ? `${coverage.undocumented.length} public symbol(s) undocumented`
    : 'every public symbol documented';
  return `${summary.modules} module(s) · ${pages} page(s) · ${written} · ${undocumented}`;
}
