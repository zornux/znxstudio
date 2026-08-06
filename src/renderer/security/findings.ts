/**
 * The REAL Zornux security-analysis contract (Phase 15), mirrored from
 * `Zornux.Analysis/SecurityFinding.cs` + `Zornux.Cli/SecurityReporter.cs`.
 *
 * CLI: `zornux check <file> --security [--advisories <feed.json>] --json`.
 *
 * The rc.8 envelope — one object on stdout:
 *   • analyzed       → `ok:true`,  `result.findings` (+ `auditProblems`, `unaudited`)
 *   • compile error  → `ok:false`, `result:null`, compile errors in `diagnostics`
 * Findings are camelCase with LOWERCASE severity and 1-based positions.
 *
 * Two properties matter:
 *   1. The analyzer runs ONLY once the program compiles. A compile error means
 *      the security pass never ran — "unanalyzed", not "clean". That is exactly
 *      `ok:false`.
 *   2. `ok:true` does NOT mean "clean" — a blocking finding is `ok:true` with a
 *      non-zero exit. Read `result.findings`, never `ok`, to decide.
 */

import type { EditorDecoration } from '../core/Contracts';
import { envelopeResultObject, parseEnvelope, type EnvelopeDiagnostic } from '../../shared/cli/envelope';
import { enumOr } from '../../shared/cli/tolerant';

export type SecuritySeverity = 'Info' | 'Warning' | 'Error' | 'Critical';
export type Confidence = 'Low' | 'Medium' | 'High';

/** A secondary location a finding points at (a skipped sanitizer, a value's source). */
export interface RelatedLocation {
  message: string;
  line: number;
  column: number;
}

/** One security finding. Richer than a diagnostic: why, how to fix, how sure. */
export interface SecurityFinding {
  code: string;
  category: string;
  severity: SecuritySeverity;
  confidence: Confidence;
  message: string;
  explanation: string;
  suggestedFix: string;
  documentationUrl: string;
  file: string;
  /** 1-based, as the CLI reports it. */
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  related: RelatedLocation[];
}

/** A compiler diagnostic, when the program did not compile and the scan never ran. */
export interface ScanDiagnostic {
  code: string;
  severity: string;
  message: string;
  line: number;
}

/**
 * The outcome of one `check --security` run. `analyzed` is false when the
 * program failed to compile — the honest distinction between "no findings"
 * and "the analyzer never got to look".
 */
export interface ScanResult {
  file: string;
  analyzed: boolean;
  findings: SecurityFinding[];
  diagnostics: ScanDiagnostic[];
  /**
   * The CLI's combined stdout+stderr, as captured. Dependency-audit notes are
   * written to stderr, never into the JSON payload ("a note is not a finding"),
   * so a caller that wants them has to read them out of here.
   */
  output: string;
}

/**
 * Build the argv for `zornux check <file> --security --json`.
 *
 * `advisoryFeed` adds `--advisories <feed>` (rc.4), which makes the compiler load
 * the feed, match it against the resolved lockfile, and emit real ZX3709
 * findings. Without it the compiler runs only its eight built-in rules — it does
 * not fall back to some weaker dependency check.
 */
export function buildSecurityArgs(file: string, json = true, advisoryFeed?: string | null): string[] {
  const args = ['check', file, '--security'];
  if (advisoryFeed) args.push('--advisories', advisoryFeed);
  if (json) args.push('--json');
  return args;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const SEVERITIES: SecuritySeverity[] = ['Info', 'Warning', 'Error', 'Critical'];
const CONFIDENCES: Confidence[] = ['Low', 'Medium', 'High'];

/** Map the envelope's lowercase severity onto the internal PascalCase type. */
function severityOf(value: unknown): SecuritySeverity {
  return enumOr(value, SEVERITIES, 'Info');
}

function confidenceOf(value: unknown): Confidence {
  return enumOr(value, CONFIDENCES, 'Low');
}

/** Parse one finding from the envelope's `result.findings` (camelCase, `range.start.line`/`col`). */
function parseFinding(raw: unknown, fallbackFile: string): SecurityFinding | null {
  const f = asRecord(raw);
  if (typeof f.code !== 'string') return null;
  const range = asRecord(f.range);
  const start = asRecord(range.start);
  const end = asRecord(range.end);
  const startLine = num(start.line, 1);
  const startColumn = num(start.col, 1);
  return {
    code: f.code,
    category: String(f.category ?? ''),
    severity: severityOf(f.severity),
    confidence: confidenceOf(f.confidence),
    message: String(f.message ?? ''),
    explanation: String(f.explanation ?? ''),
    suggestedFix: String(f.suggestedFix ?? ''),
    documentationUrl: String(f.documentationUrl ?? ''),
    file: typeof f.file === 'string' ? f.file : fallbackFile,
    startLine,
    startColumn,
    endLine: num(end.line, startLine),
    endColumn: num(end.col, startColumn),
    related: (Array.isArray(f.related) ? f.related : []).map((r) => {
      const v = asRecord(r);
      return {
        message: String(v.message ?? ''),
        line: num(v.line, 1),
        column: num(v.column, 1),
      };
    }),
  };
}

function findingsFrom(list: unknown, file: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const finding = parseFinding(raw, file);
    if (finding) findings.push(finding);
  }
  return findings;
}

/** An envelope diagnostic → the reduced `ScanDiagnostic` the views carry. */
function scanDiagnostic(diagnostic: EnvelopeDiagnostic): ScanDiagnostic {
  return { code: diagnostic.code, severity: diagnostic.severity, message: diagnostic.message, line: diagnostic.startLine || 1 };
}

/**
 * Parse one `check --security --json` run. Never throws.
 *
 * An `ok:false` envelope means the program did not compile — `analyzed` is
 * false and the compile diagnostics are carried, so a caller can say why. An
 * `ok:true` envelope carries the findings (which may be empty = clean). Output
 * that is not an envelope (a crash, plain-text usage) is treated as unanalyzed.
 */
export function parseScanResult(stdout: string, file: string): ScanResult {
  const envelope = parseEnvelope(stdout);
  if (!envelope) {
    return { file, analyzed: false, findings: [], diagnostics: [], output: stdout };
  }
  if (!envelope.ok) {
    return { file, analyzed: false, findings: [], diagnostics: envelope.diagnostics.map(scanDiagnostic), output: stdout };
  }
  const result = envelopeResultObject(envelope);
  return { file, analyzed: true, findings: findingsFrom(result?.findings, file), diagnostics: [], output: stdout };
}

/* -------------------------------------------------------------- ordering */

const SEVERITY_RANK: Record<SecuritySeverity, number> = { Critical: 0, Error: 1, Warning: 2, Info: 3 };

/** How serious, most serious first (Critical < Error < Warning < Info). */
export function severityRank(severity: SecuritySeverity): number {
  return SEVERITY_RANK[severity];
}

/** Findings most-severe first, then by file and position — a stable review order. */
export function sortFindings(findings: SecurityFinding[]): SecurityFinding[] {
  return [...findings].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.file.localeCompare(b.file) ||
      a.startLine - b.startLine ||
      a.startColumn - b.startColumn ||
      a.code.localeCompare(b.code),
  );
}

/** How many findings at each severity. Always lists every severity. */
export function countBySeverity(findings: SecurityFinding[]): Record<SecuritySeverity, number> {
  const counts: Record<SecuritySeverity, number> = { Critical: 0, Error: 0, Warning: 0, Info: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

/** Findings grouped by their rule's category, most-populated group first. */
export function groupByCategory(findings: SecurityFinding[]): { category: string; findings: SecurityFinding[] }[] {
  const groups = new Map<string, SecurityFinding[]>();
  for (const finding of sortFindings(findings)) {
    const bucket = groups.get(finding.category);
    if (bucket) bucket.push(finding);
    else groups.set(finding.category, [finding]);
  }
  return [...groups.entries()]
    .map(([category, list]) => ({ category, findings: list }))
    .sort((a, b) => b.findings.length - a.findings.length || a.category.localeCompare(b.category));
}

/** True when any finding would fail a build (`check --security` exits non-zero). */
export function blocksBuild(findings: SecurityFinding[]): boolean {
  return findings.some((f) => f.severity === 'Error' || f.severity === 'Critical');
}

/* ----------------------------------------------------------- decorations */

function decorationSeverity(severity: SecuritySeverity): EditorDecoration['severity'] {
  switch (severity) {
    case 'Critical':
    case 'Error':
      return 'error';
    case 'Warning':
      return 'warning';
    default:
      return 'info';
  }
}

/**
 * Inline (error-lens) decorations for one file's findings. The CLI reports
 * 1-based line/column; Monaco decorations here are 0-based.
 */
export function findingsToDecorations(findings: SecurityFinding[]): EditorDecoration[] {
  return findings.map((finding) => ({
    startLine: Math.max(0, finding.startLine - 1),
    startCharacter: Math.max(0, finding.startColumn - 1),
    endLine: Math.max(0, finding.endLine - 1),
    endCharacter: Math.max(0, finding.endColumn - 1),
    severity: decorationSeverity(finding.severity),
    inlineMessage: `${finding.code} ${finding.message}`,
    wholeLine: finding.severity === 'Critical' || finding.severity === 'Error',
  }));
}
