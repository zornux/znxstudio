import { describe, expect, test } from './harness';
import {
  blocksBuild,
  buildSecurityArgs,
  countBySeverity,
  findingsToDecorations,
  groupByCategory,
  parseScanResult,
  severityRank,
  sortFindings,
  type SecurityFinding,
} from '../src/renderer/security/findings';

/** A verbatim capture of `zornux check app.zx --security --json`: the envelope,
 *  findings under `result` in camelCase with lowercase severity. */
const REAL_SECRET_OUTPUT = `{
  "zornuxJson": 1, "ok": true, "command": "check-security",
  "result": {
    "findings": [
      {
        "code": "ZX3701",
        "category": "secrets",
        "severity": "critical",
        "confidence": "high",
        "message": "A secret is written directly into the call to 'crypto.hmac'.",
        "explanation": "'key' carries key material, and it is set to a literal here.",
        "suggestedFix": "Read it from configuration instead.",
        "documentationUrl": "https://zornux.dev/security/rules#zx3701",
        "file": "C:\\\\tmp\\\\app.zx",
        "range": { "start": { "line": 2, "col": 18 }, "end": { "line": 2, "col": 38 } },
        "related": []
      }
    ],
    "auditProblems": [], "unaudited": []
  },
  "diagnostics": []
}`;

/** A verbatim capture when the program does not compile: `ok:false`, compile errors in `diagnostics`. */
const REAL_BROKEN_OUTPUT = `{
  "zornuxJson": 1, "ok": false, "command": "check-security", "result": null,
  "diagnostics": [
    {
      "code": "ZX0111",
      "severity": "error",
      "message": "I expected a value here, but found the end of the file.",
      "file": "C:\\\\tmp\\\\bad.zx",
      "range": { "start": { "line": 2, "col": 1 }, "end": { "line": 2, "col": 1 } },
      "help": "a value can be a number, text, true/false, nothing, a name, or a list."
    }
  ]
}`;

function finding(overrides: Partial<SecurityFinding> = {}): SecurityFinding {
  return {
    code: 'ZX3702',
    category: 'unsafe-api',
    severity: 'Warning',
    confidence: 'High',
    message: 'unsafe',
    explanation: 'why',
    suggestedFix: 'fix',
    documentationUrl: 'https://zornux.dev/security/rules#zx3702',
    file: 'a.zx',
    startLine: 3,
    startColumn: 1,
    endLine: 3,
    endColumn: 9,
    related: [],
    ...overrides,
  };
}

describe('buildSecurityArgs', () => {
  test('is the real check invocation', () => {
    expect(buildSecurityArgs('app.zx')).toEqual(['check', 'app.zx', '--security', '--json']);
  });
  test('json can be turned off for human output', () => {
    expect(buildSecurityArgs('app.zx', false)).toEqual(['check', 'app.zx', '--security']);
  });
});

describe('parseScanResult', () => {
  test('reads the finding shape from the envelope result', () => {
    const result = parseScanResult(REAL_SECRET_OUTPUT, 'C:\\tmp\\app.zx');
    expect(result.analyzed).toBe(true);
    expect(result.findings).toHaveLength(1);
    const [first] = result.findings;
    expect(first.code).toBe('ZX3701');
    expect(first.category).toBe('secrets');
    expect(first.severity).toBe('Critical');
    expect(first.confidence).toBe('High');
    expect(first.startLine).toBe(2);
    expect(first.startColumn).toBe(18);
    expect(first.endColumn).toBe(38);
  });

  test('a clean program is analyzed with no findings', () => {
    const result = parseScanResult('{ "zornuxJson": 1, "ok": true, "command": "check-security", "result": { "findings": [] }, "diagnostics": [] }', 'ok.zx');
    expect(result.analyzed).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  test('a program that does not compile is UNANALYZED, not clean', () => {
    const result = parseScanResult(REAL_BROKEN_OUTPUT, 'bad.zx');
    expect(result.analyzed).toBe(false);
    expect(result.findings).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('ZX0111');
    expect(result.diagnostics[0].line).toBe(2);
  });

  test('program output printed before the JSON does not confuse the parser', () => {
    const result = parseScanResult(`hello\n{ "not": "it" }\n${REAL_SECRET_OUTPUT}`, 'app.zx');
    expect(result.analyzed).toBe(true);
    expect(result.findings[0].code).toBe('ZX3701');
  });

  test('related locations are carried through', () => {
    const output = `{"zornuxJson":1,"ok":true,"command":"check-security","result":{"findings":[{"code":"ZX3701","category":"secrets","severity":"critical","confidence":"high","message":"m","explanation":"e","suggestedFix":"f","documentationUrl":"d","file":"a.zx","range":{"start":{"line":2,"col":30},"end":{"line":2,"col":40}},"related":[{"message":"'api_key' is declared secret here","line":2,"column":9}]}]},"diagnostics":[]}`;
    const [parsed] = parseScanResult(output, 'a.zx').findings;
    expect(parsed.related).toHaveLength(1);
    expect(parsed.related[0].line).toBe(2);
    expect(parsed.related[0].message).toContain('declared secret');
  });

  test('garbage never throws', () => {
    expect(parseScanResult('not json at all', 'a.zx').analyzed).toBe(false);
  });
});

describe('severity ordering', () => {
  test('critical outranks error outranks warning outranks info', () => {
    expect(severityRank('Critical')).toBeLessThan(severityRank('Error'));
    expect(severityRank('Error')).toBeLessThan(severityRank('Warning'));
    expect(severityRank('Warning')).toBeLessThan(severityRank('Info'));
  });

  test('sortFindings puts the worst first, then by file and position', () => {
    const sorted = sortFindings([
      finding({ severity: 'Info', file: 'a.zx', startLine: 1 }),
      finding({ severity: 'Critical', file: 'b.zx', startLine: 9 }),
      finding({ severity: 'Warning', file: 'a.zx', startLine: 7 }),
      finding({ severity: 'Warning', file: 'a.zx', startLine: 2 }),
    ]);
    expect(sorted.map((f) => `${f.severity}:${f.file}:${f.startLine}`)).toEqual([
      'Critical:b.zx:9',
      'Warning:a.zx:2',
      'Warning:a.zx:7',
      'Info:a.zx:1',
    ]);
  });

  test('countBySeverity always lists every severity', () => {
    expect(countBySeverity([finding({ severity: 'Critical' })])).toEqual({ Critical: 1, Error: 0, Warning: 0, Info: 0 });
  });

  test('blocksBuild matches the CLI exit code: only error and critical fail', () => {
    expect(blocksBuild([finding({ severity: 'Warning' }), finding({ severity: 'Info' })])).toBe(false);
    expect(blocksBuild([finding({ severity: 'Error' })])).toBe(true);
    expect(blocksBuild([finding({ severity: 'Critical' })])).toBe(true);
  });
});

describe('groupByCategory', () => {
  test('largest group first, ties broken alphabetically', () => {
    const groups = groupByCategory([
      finding({ category: 'injection' }),
      finding({ category: 'secrets' }),
      finding({ category: 'secrets', startLine: 4 }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['secrets', 'injection']);
    expect(groups[0].findings).toHaveLength(2);
  });
});

describe('findingsToDecorations', () => {
  test('converts the CLI 1-based range to Monaco 0-based', () => {
    const [decoration] = findingsToDecorations([finding({ severity: 'Critical', startLine: 2, startColumn: 18, endLine: 2, endColumn: 38 })]);
    expect(decoration.startLine).toBe(1);
    expect(decoration.startCharacter).toBe(17);
    expect(decoration.endCharacter).toBe(37);
    expect(decoration.severity).toBe('error');
    expect(decoration.wholeLine).toBe(true);
  });

  test('a warning is a warning decoration and does not tint the line', () => {
    const [decoration] = findingsToDecorations([finding({ severity: 'Warning' })]);
    expect(decoration.severity).toBe('warning');
    expect(decoration.wholeLine).toBe(false);
  });

  test('the inline message names the rule', () => {
    const [decoration] = findingsToDecorations([finding({ code: 'ZX3705', message: 'POST /items has no guard.' })]);
    expect(decoration.inlineMessage).toBe('ZX3705 POST /items has no guard.');
  });
});
