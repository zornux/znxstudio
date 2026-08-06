/**
 * Security dashboard (Phase 15E) — the pure half. Folds one workspace scan into
 * a single posture, and renders a report a human or a pipeline can read.
 *
 * Every finding here came from ONE place: `zornux check --security`. Since rc.4
 * that includes ZX3709 (vulnerable dependency), which the compiler emits when it
 * is handed an advisory feed. The posture still reports code findings and
 * dependency findings separately, because a reader wants to know which is which —
 * but they are no longer two different sources of truth, and the build fails on
 * both alike.
 *
 * It also refuses to call a scan complete when a file failed to compile: the
 * analyzer never looked at it, so its silence means nothing.
 */

import { countBySeverity, type ScanResult, type SecurityFinding, type SecuritySeverity } from './findings';
import { VULNERABLE_DEPENDENCY_RULE } from './advisories';
import { findRule } from './rules';

export interface RuleCount {
  ruleId: string;
  title: string;
  category: string;
  count: number;
}

export interface SecurityPosture {
  filesScanned: number;
  filesAnalyzed: number;
  filesUnanalyzed: number;
  /** True only when every scanned file compiled and was actually examined. */
  complete: boolean;
  analyzerFindings: number;
  dependencyFindings: number;
  totalFindings: number;
  /** Findings that would fail `zornux check --security` (error or critical). */
  blocking: number;
  bySeverity: Record<SecuritySeverity, number>;
  byCategory: { category: string; count: number }[];
  byRule: RuleCount[];
  /** Suppression directives found in the scanned sources, with their reasons. */
  suppressions: number;
  /** Directives that name a rule but give no reason, so they silence nothing. */
  unjustifiedSuppressions: number;
}

export interface PostureInput {
  results: ScanResult[];
  suppressions?: number;
  unjustifiedSuppressions?: number;
}

export function buildPosture(input: PostureInput): SecurityPosture {
  const { results } = input;
  const allFindings = results.flatMap((r) => r.findings);
  // ZX3709 arrives inside the analyzer's findings now; split it out for the
  // report rather than counting it twice.
  const dependencies = allFindings.filter((f) => f.code === VULNERABLE_DEPENDENCY_RULE);
  const code = allFindings.filter((f) => f.code !== VULNERABLE_DEPENDENCY_RULE);

  const severities = countBySeverity(allFindings);

  const categories = new Map<string, number>();
  const rules = new Map<string, number>();
  for (const finding of allFindings) {
    categories.set(finding.category, (categories.get(finding.category) ?? 0) + 1);
    rules.set(finding.code, (rules.get(finding.code) ?? 0) + 1);
  }

  const analyzed = results.filter((r) => r.analyzed).length;
  return {
    filesScanned: results.length,
    filesAnalyzed: analyzed,
    filesUnanalyzed: results.length - analyzed,
    complete: results.length > 0 && analyzed === results.length,
    analyzerFindings: code.length,
    dependencyFindings: dependencies.length,
    totalFindings: allFindings.length,
    blocking: severities.Critical + severities.Error,
    bySeverity: severities,
    byCategory: [...categories.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category)),
    byRule: [...rules.entries()]
      .map(([ruleId, count]) => ({
        ruleId,
        title: findRule(ruleId)?.title ?? ruleId,
        category: findRule(ruleId)?.category ?? '',
        count,
      }))
      .sort((a, b) => b.count - a.count || a.ruleId.localeCompare(b.ruleId)),
    suppressions: input.suppressions ?? 0,
    unjustifiedSuppressions: input.unjustifiedSuppressions ?? 0,
  };
}

/**
 * A 0–100 score. Weighted by severity, because one hardcoded credential is not
 * ten style nits: critical −25, error −10, warning −3, info −0. Clamped, and
 * never rounded up past a blocking finding.
 */
export function securityScore(posture: SecurityPosture): number {
  const { Critical, Error: errors, Warning } = posture.bySeverity;
  const penalty = Critical * 25 + errors * 10 + Warning * 3;
  return Math.max(0, Math.min(100, 100 - penalty));
}

export type SecurityGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export function securityGrade(posture: SecurityPosture): SecurityGrade {
  const score = securityScore(posture);
  if (score >= 90) return 'A';
  if (score >= 75) return 'B';
  if (score >= 60) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

/** One honest sentence about the scan's standing. */
export function postureVerdict(posture: SecurityPosture): string {
  if (!posture.filesScanned) return 'Nothing scanned yet.';
  if (!posture.complete) {
    return `${posture.filesUnanalyzed} of ${posture.filesScanned} file(s) did not compile — those were never analyzed, so this posture is incomplete.`;
  }
  if (posture.blocking) return `${posture.blocking} finding(s) would fail \`zornux check --security\`.`;
  if (posture.totalFindings) return `${posture.totalFindings} advisory finding(s); the build would still pass.`;
  return 'No findings. The build passes.';
}

/* -------------------------------------------------------------- report */

function severityTable(posture: SecurityPosture): string[] {
  const order: SecuritySeverity[] = ['Critical', 'Error', 'Warning', 'Info'];
  return [
    '| Severity | Count |',
    '| --- | --- |',
    ...order.map((severity) => `| ${severity} | ${posture.bySeverity[severity]} |`),
  ];
}

export interface ReportOptions {
  projectName?: string;
  /** Passed in rather than read from a clock, so a report is reproducible. */
  generatedAt?: string;
}

/**
 * A Markdown security report. Every number is traceable to a rule the Zornux
 * analyzer ran, or to the advisory feed ZnxStudio matched — and the report says
 * which, rather than blurring them into one total.
 */
export function renderMarkdownReport(posture: SecurityPosture, options: ReportOptions = {}): string {
  const lines: string[] = ['# Security report'];
  if (options.projectName) lines.push('', `Project: **${options.projectName}**`);
  if (options.generatedAt) lines.push('', `Generated: ${options.generatedAt}`);

  lines.push(
    '',
    `Grade: **${securityGrade(posture)}** (${securityScore(posture)}/100)`,
    '',
    postureVerdict(posture),
    '',
    '## Coverage',
    '',
    `- Files scanned: ${posture.filesScanned}`,
    `- Analyzed: ${posture.filesAnalyzed}`,
    `- Not analyzed (did not compile): ${posture.filesUnanalyzed}`,
    '',
    '## Findings by severity',
    '',
    ...severityTable(posture),
    '',
    '## Findings by source',
    '',
    `- Code rules (ZX3701–ZX3708): ${posture.analyzerFindings}`,
    `- Dependency advisories (ZX3709): ${posture.dependencyFindings}`,
  );

  if (posture.byRule.length) {
    lines.push('', '## Findings by rule', '', '| Rule | Title | Category | Count |', '| --- | --- | --- | --- |');
    for (const rule of posture.byRule) {
      lines.push(`| ${rule.ruleId} | ${rule.title} | ${rule.category} | ${rule.count} |`);
    }
  }

  if (posture.suppressions || posture.unjustifiedSuppressions) {
    lines.push(
      '',
      '## Suppressions',
      '',
      `- Justified: ${posture.suppressions - posture.unjustifiedSuppressions}`,
      `- Without a justification (these silence nothing): ${posture.unjustifiedSuppressions}`,
    );
  }

  lines.push(
    '',
    '## Notes',
    '',
    '- The analyzer runs only on programs that compile; a file with errors is unanalyzed, not clean.',
    '- `ZX3709` (vulnerable dependency) runs only when `zornux check --security` is given an advisory feed (`--advisories`). Without one, no dependency was checked — which is not the same as no dependency being vulnerable.',
    '- A dependency with no `zornux.lock` entry has no resolved version, so it was not audited. The compiler reports those by name on standard error.',
  );

  return `${lines.join('\n')}\n`;
}
