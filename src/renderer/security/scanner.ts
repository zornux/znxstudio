/**
 * Vulnerability scanner (Phase 15B) — the pure half. Filtering, grouping and
 * summarising the findings the REAL analyzer returned. No detection lives here:
 * the compiler owns that, and re-implementing any of it in TypeScript would
 * only produce a second, drifting truth.
 */

import { blocksBuild, countBySeverity, severityRank, sortFindings } from './findings';
import type { Confidence, ScanResult, SecurityFinding, SecuritySeverity } from './findings';

export interface ScanFilter {
  /** Only these severities. Empty/undefined means all. */
  severities?: SecuritySeverity[];
  /** Only these categories. Empty/undefined means all. */
  categories?: string[];
  /** Drop findings the analyzer is less sure of than this. */
  minConfidence?: Confidence;
  /** Free-text match over the rule id, message and file path. */
  query?: string;
}

const CONFIDENCE_RANK: Record<Confidence, number> = { Low: 0, Medium: 1, High: 2 };

export function confidenceRank(confidence: Confidence): number {
  return CONFIDENCE_RANK[confidence];
}

/** Apply a filter, keeping the canonical most-severe-first order. */
export function filterFindings(findings: SecurityFinding[], filter: ScanFilter = {}): SecurityFinding[] {
  const query = filter.query?.trim().toLowerCase();
  const floor = filter.minConfidence ? confidenceRank(filter.minConfidence) : -1;

  return sortFindings(
    findings.filter((finding) => {
      if (filter.severities?.length && !filter.severities.includes(finding.severity)) return false;
      if (filter.categories?.length && !filter.categories.includes(finding.category)) return false;
      if (confidenceRank(finding.confidence) < floor) return false;
      if (query) {
        const haystack = `${finding.code} ${finding.message} ${finding.file}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    }),
  );
}

/** Findings grouped by file, worst file first. */
export function groupByFile(findings: SecurityFinding[]): { file: string; findings: SecurityFinding[] }[] {
  const groups = new Map<string, SecurityFinding[]>();
  for (const finding of sortFindings(findings)) {
    const bucket = groups.get(finding.file);
    if (bucket) bucket.push(finding);
    else groups.set(finding.file, [finding]);
  }
  return [...groups.entries()]
    .map(([file, list]) => ({ file, findings: list }))
    .sort(
      (a, b) =>
        severityRank(a.findings[0].severity) - severityRank(b.findings[0].severity) ||
        b.findings.length - a.findings.length ||
        a.file.localeCompare(b.file),
    );
}

export interface ScanSummary {
  files: number;
  /** Files the analyzer actually examined (the rest failed to compile). */
  analyzed: number;
  unanalyzed: number;
  findings: number;
  /** Findings that make `zornux check --security` exit non-zero. */
  blocking: number;
  /** Files with no findings, out of those actually analyzed. */
  cleanFiles: number;
  bySeverity: Record<SecuritySeverity, number>;
}

/**
 * Summarise a whole scan. `unanalyzed` is reported separately and never counted
 * as clean: a program with compile errors was never examined.
 */
export function scanSummary(results: ScanResult[]): ScanSummary {
  const analyzed = results.filter((r) => r.analyzed);
  const findings = results.flatMap((r) => r.findings);
  const counts = countBySeverity(findings);
  return {
    files: results.length,
    analyzed: analyzed.length,
    unanalyzed: results.length - analyzed.length,
    findings: findings.length,
    blocking: counts.Critical + counts.Error,
    cleanFiles: analyzed.filter((r) => r.findings.length === 0).length,
    bySeverity: counts,
  };
}

/** One line a human can read: what the scan found, and whether it fails a build. */
export function summaryLine(summary: ScanSummary): string {
  if (summary.files === 0) return 'Nothing scanned yet.';
  const parts = [`${summary.analyzed}/${summary.files} file(s) analyzed`];
  if (summary.unanalyzed) parts.push(`${summary.unanalyzed} did not compile`);
  parts.push(summary.findings ? `${summary.findings} finding(s)` : 'no findings');
  if (summary.blocking) parts.push(`${summary.blocking} would fail the build`);
  return parts.join(' · ');
}

/** Every category present in a finding set, alphabetically — the filter's options. */
export function presentCategories(findings: SecurityFinding[]): string[] {
  return [...new Set(findings.map((f) => f.category))].sort((a, b) => a.localeCompare(b));
}

/** True when the scan as a whole would fail `zornux check --security`. */
export function scanBlocksBuild(results: ScanResult[]): boolean {
  return blocksBuild(results.flatMap((r) => r.findings));
}
