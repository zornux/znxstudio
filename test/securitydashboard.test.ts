import { describe, expect, test } from './harness';
import {
  buildPosture,
  postureVerdict,
  renderMarkdownReport,
  securityGrade,
  securityScore,
} from '../src/renderer/security/dashboard';
import type { ScanResult, SecurityFinding } from '../src/renderer/security/findings';

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    code: 'ZX3702',
    category: 'unsafe-api',
    severity: 'Warning',
    confidence: 'High',
    message: 'm',
    explanation: 'e',
    suggestedFix: 'f',
    documentationUrl: 'd',
    file: 'a.zx',
    startLine: 1,
    startColumn: 1,
    endLine: 1,
    endColumn: 2,
    related: [],
    ...overrides,
  };
}

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  return { file: 'a.zx', analyzed: true, findings: [], diagnostics: [], output: '', ...overrides };
}

/**
 * A real ZX3709 finding. Since rc.4 the compiler emits it inside the ordinary
 * findings array, so the dashboard receives it the same way as any other rule.
 */
function dependency(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return finding({
    code: 'ZX3709',
    category: 'dependency',
    severity: 'Error',
    message: "'Greetings' 1.0.0 has a known vulnerability (CVE-2026-0001).",
    ...overrides,
  });
}
describe('buildPosture', () => {
  test('counts coverage, and a file that did not compile is not analyzed', () => {
    const posture = buildPosture({
      results: [result(), result({ file: 'b.zx', analyzed: false, diagnostics: [{ code: 'ZX0111', severity: 'error', message: 'm', line: 1 }] })],
    });
    expect(posture.filesScanned).toBe(2);
    expect(posture.filesAnalyzed).toBe(1);
    expect(posture.filesUnanalyzed).toBe(1);
    expect(posture.complete).toBe(false);
  });

  test('a scan of nothing is never complete', () => {
    expect(buildPosture({ results: [] }).complete).toBe(false);
  });

  test('analyzer and dependency findings are counted separately, and together', () => {
    const posture = buildPosture({ results: [result({ findings: [finding(), dependency()] })] });
    expect(posture.analyzerFindings).toBe(1);
    expect(posture.dependencyFindings).toBe(1);
    expect(posture.totalFindings).toBe(2);
  });

  test('dependency severities fold into the severity counts', () => {
    const posture = buildPosture({ results: [result({ findings: [finding({ severity: 'Critical' }), dependency()] })] });
    expect(posture.bySeverity).toEqual({ Critical: 1, Error: 1, Warning: 0, Info: 0 });
    expect(posture.blocking).toBe(2);
  });

  test('categories are ranked by count', () => {
    const posture = buildPosture({
      results: [result({ findings: [finding({ category: 'secrets' }), finding({ category: 'secrets' }), finding({ category: 'xss' })] })],
    });
    expect(posture.byCategory).toEqual([
      { category: 'secrets', count: 2 },
      { category: 'xss', count: 1 },
    ]);
  });

  test('rules are ranked by count and carry their catalog title', () => {
    const posture = buildPosture({ results: [result({ findings: [finding({ code: 'ZX3701' }), dependency()] })] });
    expect(posture.byRule[0].ruleId).toBe('ZX3701');
    expect(posture.byRule[0].title).toBe('Hardcoded secret');
    expect(posture.byRule[1].ruleId).toBe('ZX3709');
    expect(posture.byRule[1].title).toBe('Dependency has a known vulnerability');
  });

  test('suppression counts pass through', () => {
    const posture = buildPosture({ results: [result()], suppressions: 3, unjustifiedSuppressions: 1 });
    expect(posture.suppressions).toBe(3);
    expect(posture.unjustifiedSuppressions).toBe(1);
  });
});

describe('securityScore', () => {
  test('a clean scan scores 100', () => {
    expect(securityScore(buildPosture({ results: [result()] }))).toBe(100);
  });
  test('severity is weighted: critical 25, error 10, warning 3', () => {
    expect(securityScore(buildPosture({ results: [result({ findings: [finding({ severity: 'Critical' })] })] }))).toBe(75);
    expect(securityScore(buildPosture({ results: [result({ findings: [finding({ severity: 'Error' })] })] }))).toBe(90);
    expect(securityScore(buildPosture({ results: [result({ findings: [finding({ severity: 'Warning' })] })] }))).toBe(97);
  });
  test('info costs nothing', () => {
    expect(securityScore(buildPosture({ results: [result({ findings: [finding({ severity: 'Info' })] })] }))).toBe(100);
  });
  test('the score never goes below zero', () => {
    const findings = Array.from({ length: 10 }, () => finding({ severity: 'Critical' }));
    expect(securityScore(buildPosture({ results: [result({ findings })] }))).toBe(0);
  });
});

describe('securityGrade', () => {
  test('a clean scan is an A', () => {
    expect(securityGrade(buildPosture({ results: [result()] }))).toBe('A');
  });
  test('one critical drops it to a B', () => {
    expect(securityGrade(buildPosture({ results: [result({ findings: [finding({ severity: 'Critical' })] })] }))).toBe('B');
  });
  test('one critical plus three errors (45) is a D', () => {
    const findings = [finding({ severity: 'Critical' }), finding({ severity: 'Error' }), finding({ severity: 'Error' }), finding({ severity: 'Error' })];
    expect(securityGrade(buildPosture({ results: [result({ findings })] }))).toBe('D');
  });

  test('three criticals (25) is an F', () => {
    const findings = [finding({ severity: 'Critical' }), finding({ severity: 'Critical' }), finding({ severity: 'Critical' })];
    expect(securityGrade(buildPosture({ results: [result({ findings })] }))).toBe('F');
  });
});

describe('postureVerdict', () => {
  test('nothing scanned', () => {
    expect(postureVerdict(buildPosture({ results: [] }))).toBe('Nothing scanned yet.');
  });

  test('an incomplete scan says so before anything else', () => {
    const posture = buildPosture({
      results: [result({ findings: [finding({ severity: 'Critical' })] }), result({ file: 'b.zx', analyzed: false })],
    });
    expect(postureVerdict(posture)).toContain('never analyzed');
  });

  test('blocking findings name the command that would fail', () => {
    expect(postureVerdict(buildPosture({ results: [result({ findings: [finding({ severity: 'Error' })] })] }))).toContain(
      '`zornux check --security`',
    );
  });

  test('warnings alone still pass the build', () => {
    expect(postureVerdict(buildPosture({ results: [result({ findings: [finding({ severity: 'Warning' })] })] }))).toContain(
      'the build would still pass',
    );
  });

  test('a clean, complete scan says the build passes', () => {
    expect(postureVerdict(buildPosture({ results: [result()] }))).toBe('No findings. The build passes.');
  });
});

describe('renderMarkdownReport', () => {
  const posture = buildPosture({
    results: [result({ findings: [finding({ code: 'ZX3701', category: 'secrets', severity: 'Critical' }), dependency()] })],
    suppressions: 2,
    unjustifiedSuppressions: 1,
  });

  test('carries the grade, the verdict and the coverage', () => {
    const report = renderMarkdownReport(posture, { projectName: 'demo' });
    expect(report).toContain('# Security report');
    expect(report).toContain('Project: **demo**');
    // One critical (25) plus one dependency error (10) leaves 65 — a C.
    expect(report).toContain('Grade: **C**');
    expect(report).toContain('Files scanned: 1');
  });

  test('reports code rules and dependency advisories separately, though both come from the compiler', () => {
    const report = renderMarkdownReport(posture);
    expect(report).toContain('Code rules (ZX3701–ZX3708): 1');
    expect(report).toContain('Dependency advisories (ZX3709): 1');
  });

  test('the rule table names each rule', () => {
    expect(renderMarkdownReport(posture)).toContain('| ZX3701 | Hardcoded secret | secrets | 1 |');
  });

  test('unjustified suppressions are called out as silencing nothing', () => {
    expect(renderMarkdownReport(posture)).toContain('Without a justification (these silence nothing): 1');
  });

  test('the notes state the real limits plainly', () => {
    const report = renderMarkdownReport(posture);
    expect(report).toContain('a file with errors is unanalyzed, not clean');
    expect(report).toContain('runs only when `zornux check --security` is given an advisory feed');
    expect(report).toContain('no `zornux.lock` entry');
  });

  test('the timestamp is supplied, never read from a clock, so a report is reproducible', () => {
    const a = renderMarkdownReport(posture, { generatedAt: '2026-07-09T00:00:00Z' });
    const b = renderMarkdownReport(posture, { generatedAt: '2026-07-09T00:00:00Z' });
    expect(a).toBe(b);
  });

  test('a clean posture reports no rule table and no suppression section', () => {
    const report = renderMarkdownReport(buildPosture({ results: [result()] }));
    expect(report.includes('## Findings by rule')).toBe(false);
    expect(report.includes('## Suppressions')).toBe(false);
  });
});
