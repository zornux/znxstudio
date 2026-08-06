import { describe, expect, test } from './harness';
import { envelopeResultArray, envelopeResultObject, parseEnvelope } from '../src/shared/cli/envelope';
import { blocksBuild, countBySeverity, parseScanResult } from '../src/renderer/security/findings';
import { parseDocResult } from '../src/renderer/docs/apiReference';
import { parseProfileReport, parseTimelineEvents } from '../src/renderer/profiler/profile';
import { parseTestResult } from '../src/renderer/testing/testModel';

/* ---- real rc.8 envelope captures (verbatim from the Release binary) ---- */

const SECURITY_CLEAN = `{
  "zornuxJson": 1, "ok": true, "command": "check-security",
  "result": { "findings": [], "auditProblems": [], "unaudited": [] },
  "diagnostics": []
}`;

const SECURITY_FINDING = `{
  "zornuxJson": 1, "ok": true, "command": "check-security",
  "result": { "findings": [ {
    "code": "ZX3701", "category": "secrets", "severity": "critical", "confidence": "high",
    "message": "A secret is written directly into the call to 'crypto.hmac'.",
    "explanation": "…", "suggestedFix": "…", "documentationUrl": "https://zornux.dev/security/rules#zx3701",
    "file": "sec.zx", "range": { "start": { "line": 2, "col": 18 }, "end": { "line": 2, "col": 38 } },
    "related": []
  } ], "auditProblems": [], "unaudited": [] },
  "diagnostics": []
}`;

const SECURITY_BROKEN = `{
  "zornuxJson": 1, "ok": false, "command": "check-security", "result": null,
  "diagnostics": [ {
    "code": "ZX0111", "severity": "error", "message": "I expected a value here, but found the end of the file.",
    "file": "bad.zx", "range": { "start": { "line": 2, "col": 1 }, "end": { "line": 2, "col": 1 } },
    "help": "a value can be a number, text, true/false, nothing, a name, or a list."
  } ]
}`;

const DOC_OK = `{
  "zornuxJson": 1, "ok": true, "command": "doc",
  "result": { "project": "Zornux Project", "version": "1.0.0-rc.8", "format": "markdown",
    "output": "C:/tmp/out", "written": true, "modules": 1, "files": [ "index.md", "modules/Shop.md" ] },
  "diagnostics": []
}`;

const DOC_BADFORMAT = `{
  "zornuxJson": 1, "ok": false, "command": "doc", "result": null,
  "diagnostics": [ { "code": "ZX1605", "severity": "error", "message": "Unknown documentation format 'pdf'.",
    "file": "<doc>", "range": { "start": { "line": 1, "col": 1 }, "end": { "line": 1, "col": 1 } },
    "help": "use --format markdown or --format html." } ]
}`;

const PROFILE_RUN = `{
  "zornuxJson": 1, "ok": true, "command": "profile",
  "result": { "engine": "interpreter", "totalCalls": 0, "totalSamples": 1, "totalAllocations": 0,
    "hotSpots": [ { "name": "<program>", "calls": 0, "samples": 1, "allocations": 0, "percent": 100, "source": null } ],
    "hotLines": [], "allocations": [], "allocationSites": [], "gc": null, "subsystems": [], "heap": null,
    "truncated": false, "notes": [] },
  "diagnostics": []
}`;

// The trap: events live in `result`, and the envelope ALSO carries an empty
// `diagnostics: []`. A "grab the last array" reader would return the wrong one.
const PROFILE_TIMELINE = `program output line\n{
  "zornuxJson": 1, "ok": true, "command": "profile",
  "result": [
    { "sequence": 0, "kind": "ProgramStart", "name": "", "category": null, "depth": 0, "source": null, "timestampMicroseconds": null },
    { "sequence": 1, "kind": "ProgramEnd", "name": "", "category": null, "depth": 0, "source": null, "timestampMicroseconds": null }
  ],
  "diagnostics": []
}`;

/* ---- non-envelope shapes: parseEnvelope must reject these (return null) ---- */

const BARE_OBJECT = `{ "project": "P", "version": "1", "format": "markdown", "output": "o",
  "written": true, "modules": 1, "files": [ "index.md" ], "diagnostics": [] }`;

const BARE_ARRAY = `[ { "code": "ZX1605", "severity": "error", "message": "bad format", "help": "use markdown" } ]`;

/* ------------------------------------------------------------ envelope */

describe('cli envelope — recognition', () => {
  test('an envelope is recognised and normalised', () => {
    const envelope = parseEnvelope(DOC_OK);
    expect(envelope).toBeTruthy();
    expect(envelope!.ok).toBe(true);
    expect(envelope!.command).toBe('doc');
    expect(envelopeResultObject(envelope!)!.modules).toBe(1);
  });

  test('a bare object is NOT an envelope (returns null)', () => {
    expect(parseEnvelope(BARE_OBJECT)).toBeNull();
  });

  test('a bare array is NOT an envelope', () => {
    expect(parseEnvelope(BARE_ARRAY)).toBeNull();
  });

  test('program output before the envelope is skipped', () => {
    const envelope = parseEnvelope(PROFILE_TIMELINE);
    expect(envelope).toBeTruthy();
    expect(envelopeResultArray(envelope!)).toHaveLength(2);
  });

  test('diagnostics are normalised from camelCase range to flat 1-based fields', () => {
    const envelope = parseEnvelope(SECURITY_BROKEN);
    const diagnostic = envelope!.diagnostics[0];
    expect(diagnostic.code).toBe('ZX0111');
    expect(diagnostic.severity).toBe('error');
    expect(diagnostic.startLine).toBe(2);
    expect(diagnostic.startColumn).toBe(1);
    expect(diagnostic.file).toBe('bad.zx');
  });

  test('resultArray is null for an object payload, resultObject null for an array payload', () => {
    expect(envelopeResultArray(parseEnvelope(DOC_OK)!)).toBeNull();
    expect(envelopeResultObject(parseEnvelope(PROFILE_TIMELINE)!)).toBeNull();
  });
});

/* ------------------------------------------------------------ security */

describe('security reader — envelope', () => {
  test('envelope: a finding parses with LOWERCASE severity mapped to Critical', () => {
    const result = parseScanResult(SECURITY_FINDING, 'sec.zx');
    expect(result.analyzed).toBe(true);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].severity).toBe('Critical');
    expect(result.findings[0].startLine).toBe(2);
    expect(result.findings[0].startColumn).toBe(18);
    expect(blocksBuild(result.findings)).toBe(true);
  });

  test('envelope: ok:false means UNANALYZED, carrying the compile diagnostics', () => {
    const result = parseScanResult(SECURITY_BROKEN, 'bad.zx');
    expect(result.analyzed).toBe(false);
    expect(result.findings).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe('ZX0111');
    expect(result.diagnostics[0].line).toBe(2);
  });

  test('envelope: clean is analyzed with zero findings', () => {
    const result = parseScanResult(SECURITY_CLEAN, 'ok.zx');
    expect(result.analyzed).toBe(true);
    expect(result.findings).toEqual([]);
    expect(countBySeverity(result.findings).Critical).toBe(0);
  });
});

/* ------------------------------------------------------------ doc */

describe('doc reader — envelope', () => {
  test('envelope success carries the summary from result', () => {
    const result = parseDocResult(DOC_OK);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.modules).toBe(1);
    expect(result.summary.files).toHaveLength(2);
  });

  test('envelope failure carries the diagnostic, not an empty success', () => {
    const result = parseDocResult(DOC_BADFORMAT);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failures[0].code).toBe('ZX1605');
    expect(result.failures[0].help).toBe('use --format markdown or --format html.');
  });
});

/* ------------------------------------------------------------ test runner */

const TEST_ENVELOPE = `{
  "zornuxJson": 1, "ok": false, "command": "test",
  "result": { "total": 2, "passed": 1, "failed": 1, "tests": [
    { "name": "adds", "status": "passed", "durationMs": 5 },
    { "name": "subtracts", "status": "failed", "durationMs": 1, "code": "ZX1503", "message": "Expected 3, but got 2." }
  ] },
  "diagnostics": []
}`;

const TEST_ENVELOPE_UNCOMPILED = `{ "zornuxJson": 1, "ok": false, "command": "test", "result": null,
  "diagnostics": [ { "code": "ZX0111", "severity": "error", "message": "boom", "range": { "start": { "line": 1, "col": 1 } } } ] }`;

describe('test reader — envelope', () => {
  test('envelope: the summary is unwrapped from result (was undefined pre-fix)', () => {
    const result = parseTestResult(TEST_ENVELOPE);
    expect(result).toBeTruthy();
    expect(result!.total).toBe(2);
    expect(result!.passed).toBe(1);
    expect(result!.failed).toBe(1);
    expect(result!.tests[1].code).toBe('ZX1503');
  });

  test('envelope with no result (program did not compile) yields null', () => {
    expect(parseTestResult(TEST_ENVELOPE_UNCOMPILED)).toBeNull();
  });

  test('non-envelope output yields null', () => {
    expect(parseTestResult('compiling…\ndone')).toBeNull();
  });
});

/* ------------------------------------------------------------ profile */

describe('profile readers — envelope', () => {
  test('envelope: the report is unwrapped from result', () => {
    const report = parseProfileReport(PROFILE_RUN);
    expect(report).toBeTruthy();
    expect(report!.engine).toBe('interpreter');
    expect(report!.hotSpots[0].percent).toBe(100);
  });

  test('non-envelope output yields null', () => {
    expect(parseProfileReport('just program output')).toBeNull();
  });

  test('envelope timeline: events come from result, NOT the empty diagnostics array', () => {
    const events = parseTimelineEvents(PROFILE_TIMELINE);
    expect(events).toHaveLength(2);
    expect(events[0].kind).toBe('ProgramStart');
    expect(events[1].kind).toBe('ProgramEnd');
  });

  test('non-envelope output yields no events', () => {
    expect(parseTimelineEvents('no json here')).toHaveLength(0);
  });
});
