import type { Diagnostic, Position } from '../language/api';

/**
 * Pure, Monaco-free logic for live error reporting: ordering diagnostics,
 * cursor-relative next/previous navigation, per-line reduction for the inline
 * error-lens overlay, and severity counting. Unit-testable in isolation.
 */

const RANK: Record<string, number> = { error: 0, warning: 1, info: 2, hint: 3 };

function rank(diagnostic: Diagnostic): number {
  return RANK[diagnostic.severity] ?? 2;
}

function compareByStart(a: Diagnostic, b: Diagnostic): number {
  return a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character;
}

function isAfter(position: Position, reference: Position): boolean {
  return (
    position.line > reference.line ||
    (position.line === reference.line && position.character > reference.character)
  );
}

/** Diagnostics ordered by start position (does not mutate the input). */
export function sortDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(compareByStart);
}

/** First diagnostic strictly after the cursor, wrapping to the first. */
export function nextDiagnostic(diagnostics: Diagnostic[], position: Position): Diagnostic | null {
  const sorted = sortDiagnostics(diagnostics);
  if (!sorted.length) return null;
  return sorted.find((d) => isAfter(d.range.start, position)) ?? sorted[0];
}

/** Last diagnostic strictly before the cursor, wrapping to the last. */
export function previousDiagnostic(diagnostics: Diagnostic[], position: Position): Diagnostic | null {
  const sorted = sortDiagnostics(diagnostics);
  if (!sorted.length) return null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (isAfter(position, sorted[i].range.start)) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

/**
 * One diagnostic per line for the inline overlay — the most severe, breaking
 * ties by earliest column. Returned sorted by line.
 */
export function topDiagnosticPerLine(diagnostics: Diagnostic[]): Diagnostic[] {
  const byLine = new Map<number, Diagnostic>();
  for (const diagnostic of diagnostics) {
    const line = diagnostic.range.start.line;
    const current = byLine.get(line);
    if (
      !current ||
      rank(diagnostic) < rank(current) ||
      (rank(diagnostic) === rank(current) &&
        diagnostic.range.start.character < current.range.start.character)
    ) {
      byLine.set(line, diagnostic);
    }
  }
  return [...byLine.values()].sort(compareByStart);
}

export interface SeverityCounts {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
}

export function countBySeverity(diagnostics: Diagnostic[]): SeverityCounts {
  const counts: SeverityCounts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === 'error') counts.errors++;
    else if (diagnostic.severity === 'warning') counts.warnings++;
    else if (diagnostic.severity === 'hint') counts.hints++;
    else counts.infos++;
  }
  return counts;
}
