import { describe, expect, test } from './harness';
import {
  confidenceRank,
  filterFindings,
  groupByFile,
  presentCategories,
  scanBlocksBuild,
  scanSummary,
  summaryLine,
} from '../src/renderer/security/scanner';
import type { ScanResult, SecurityFinding } from '../src/renderer/security/findings';

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    code: 'ZX3702',
    category: 'unsafe-api',
    severity: 'Warning',
    confidence: 'High',
    message: "'db.unsafe_query' turns off a safety guarantee.",
    explanation: 'why',
    suggestedFix: 'fix',
    documentationUrl: 'https://zornux.dev/security/rules#zx3702',
    file: 'a.zx',
    startLine: 4,
    startColumn: 6,
    endLine: 4,
    endColumn: 40,
    related: [],
    ...overrides,
  };
}

function result(overrides: Partial<ScanResult> = {}): ScanResult {
  return { file: 'a.zx', analyzed: true, findings: [], diagnostics: [], output: '', ...overrides };
}

describe('confidenceRank', () => {
  test('high outranks medium outranks low', () => {
    expect(confidenceRank('High')).toBeGreaterThan(confidenceRank('Medium'));
    expect(confidenceRank('Medium')).toBeGreaterThan(confidenceRank('Low'));
  });
});

describe('filterFindings', () => {
  const findings = [
    finding({ code: 'ZX3701', category: 'secrets', severity: 'Critical', confidence: 'High', file: 'a.zx' }),
    finding({ code: 'ZX3704', category: 'injection', severity: 'Error', confidence: 'Medium', file: 'b.zx' }),
    finding({ code: 'ZX3705', category: 'authorization', severity: 'Warning', confidence: 'Low', file: 'b.zx' }),
  ];

  test('no filter keeps everything, most-severe first', () => {
    expect(filterFindings(findings).map((f) => f.code)).toEqual(['ZX3701', 'ZX3704', 'ZX3705']);
  });

  test('severity filter', () => {
    expect(filterFindings(findings, { severities: ['Critical', 'Error'] }).map((f) => f.code)).toEqual(['ZX3701', 'ZX3704']);
  });

  test('an empty severity list means all, not none', () => {
    expect(filterFindings(findings, { severities: [] })).toHaveLength(3);
  });

  test('category filter', () => {
    expect(filterFindings(findings, { categories: ['injection'] }).map((f) => f.code)).toEqual(['ZX3704']);
  });

  test('minimum confidence drops the analyzer least-sure findings', () => {
    expect(filterFindings(findings, { minConfidence: 'Medium' }).map((f) => f.code)).toEqual(['ZX3701', 'ZX3704']);
    expect(filterFindings(findings, { minConfidence: 'High' }).map((f) => f.code)).toEqual(['ZX3701']);
  });

  test('the text query matches rule id, message and file path, case-insensitively', () => {
    expect(filterFindings(findings, { query: 'zx3705' }).map((f) => f.code)).toEqual(['ZX3705']);
    expect(filterFindings(findings, { query: 'b.zx' })).toHaveLength(2);
    expect(filterFindings(findings, { query: 'unsafe_query' })).toHaveLength(3);
  });

  test('filters compose', () => {
    expect(filterFindings(findings, { severities: ['Error', 'Warning'], categories: ['authorization'] }).map((f) => f.code)).toEqual([
      'ZX3705',
    ]);
  });
});

describe('groupByFile', () => {
  test('the file with the worst finding comes first', () => {
    const groups = groupByFile([
      finding({ file: 'ok.zx', severity: 'Info' }),
      finding({ file: 'bad.zx', severity: 'Critical' }),
      finding({ file: 'bad.zx', severity: 'Warning', startLine: 9 }),
    ]);
    expect(groups.map((g) => g.file)).toEqual(['bad.zx', 'ok.zx']);
    expect(groups[0].findings).toHaveLength(2);
  });

  test('ties on severity break on finding count', () => {
    const groups = groupByFile([
      finding({ file: 'few.zx', severity: 'Warning' }),
      finding({ file: 'many.zx', severity: 'Warning' }),
      finding({ file: 'many.zx', severity: 'Warning', startLine: 7 }),
    ]);
    expect(groups[0].file).toBe('many.zx');
  });
});

describe('scanSummary', () => {
  test('a file that did not compile is unanalyzed, never clean', () => {
    const summary = scanSummary([
      result({ file: 'ok.zx', analyzed: true }),
      result({ file: 'bad.zx', analyzed: false, diagnostics: [{ code: 'ZX0111', severity: 'error', message: 'm', line: 2 }] }),
    ]);
    expect(summary.files).toBe(2);
    expect(summary.analyzed).toBe(1);
    expect(summary.unanalyzed).toBe(1);
    expect(summary.cleanFiles).toBe(1);
  });

  test('blocking counts only error and critical, matching the CLI exit code', () => {
    const summary = scanSummary([
      result({ findings: [finding({ severity: 'Critical' }), finding({ severity: 'Error' }), finding({ severity: 'Warning' })] }),
    ]);
    expect(summary.findings).toBe(3);
    expect(summary.blocking).toBe(2);
    expect(summary.bySeverity).toEqual({ Critical: 1, Error: 1, Warning: 1, Info: 0 });
  });

  test('an empty scan summarises to zeroes', () => {
    expect(scanSummary([]).files).toBe(0);
  });
});

describe('summaryLine', () => {
  test('says what compiled, what was found, and what fails the build', () => {
    const line = summaryLine(
      scanSummary([
        result({ file: 'a.zx', findings: [finding({ severity: 'Critical' })] }),
        result({ file: 'b.zx', analyzed: false, diagnostics: [{ code: 'ZX0111', severity: 'error', message: 'm', line: 1 }] }),
      ]),
    );
    expect(line).toContain('1/2 file(s) analyzed');
    expect(line).toContain('1 did not compile');
    expect(line).toContain('1 finding(s)');
    expect(line).toContain('1 would fail the build');
  });

  test('a clean scan says so without mentioning the build', () => {
    const line = summaryLine(scanSummary([result()]));
    expect(line).toContain('no findings');
    expect(line.includes('fail the build')).toBe(false);
  });

  test('nothing scanned yet', () => {
    expect(summaryLine(scanSummary([]))).toBe('Nothing scanned yet.');
  });
});

describe('presentCategories', () => {
  test('the distinct categories, alphabetically', () => {
    expect(presentCategories([finding({ category: 'xss' }), finding({ category: 'injection' }), finding({ category: 'xss' })])).toEqual([
      'injection',
      'xss',
    ]);
  });
});

describe('scanBlocksBuild', () => {
  test('warnings alone do not fail the build', () => {
    expect(scanBlocksBuild([result({ findings: [finding({ severity: 'Warning' })] })])).toBe(false);
  });
  test('one error fails it', () => {
    expect(scanBlocksBuild([result({ findings: [finding({ severity: 'Error' })] })])).toBe(true);
  });
});
