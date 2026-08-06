import { describe, expect, test } from './harness';
import {
  interpretExitCode,
  outcomeRan,
  parseCheckStdout,
} from '../src/shared/compilerProtocol';
import { toPlatformDiagnostic } from '../src/renderer/compiler/compilerDiagnostics';

// A verbatim capture of `zornux check missing_end.zx --json` (unicode-escaped,
// exactly as the CLI emits it): the envelope, with the diagnostic under its
// top-level `diagnostics` array and `ok:false` because the file did not compile.
const ZX0103_JSON = `{
  "zornuxJson": 1, "ok": false, "command": "check", "result": null,
  "diagnostics": [
    {
      "code": "ZX0103",
      "severity": "error",
      "message": "I expected \\u0027end\\u0027 to close this if block.",
      "file": "examples/invalid/missing_end.zx",
      "range": {
        "start": { "line": 3, "col": 1 },
        "end": { "line": 3, "col": 3 }
      },
      "help": "add \\u0027end\\u0027 on a new line after the last statement of the if."
    }
  ]
}`;

describe('compiler protocol: exit codes', () => {
  test('classifies known codes', () => {
    expect(interpretExitCode(0)).toBe('ok');
    expect(interpretExitCode(1)).toBe('diagnostics');
    expect(interpretExitCode(2)).toBe('usage');
    expect(interpretExitCode(3)).toBe('not-found');
    expect(interpretExitCode(5)).toBe('internal');
    expect(interpretExitCode(99)).toBe('unknown');
    expect(interpretExitCode(null)).toBe('unknown');
  });

  test('only ok/diagnostics count as "ran"', () => {
    expect(outcomeRan('ok')).toBeTruthy();
    expect(outcomeRan('diagnostics')).toBeTruthy();
    expect(outcomeRan('not-found')).toBeFalsy();
    expect(outcomeRan('usage')).toBeFalsy();
  });
});

describe('compiler protocol: stdout parsing', () => {
  test('parses a diagnostic from the envelope', () => {
    const diagnostics = parseCheckStdout(ZX0103_JSON);
    expect(diagnostics).toHaveLength(1);
    const [d] = diagnostics;
    expect(d.code).toBe('ZX0103');
    expect(d.severity).toBe('error');
    expect(d.message).toContain('close this if block');
    expect(d.range.start.line).toBe(3);
    expect(d.range.start.col).toBe(1);
    expect(d.help).toContain("add 'end'");
  });

  test('empty stdout (clean file) yields no diagnostics', () => {
    expect(parseCheckStdout('')).toHaveLength(0);
    expect(parseCheckStdout('   \n')).toHaveLength(0);
  });

  test('non-JSON stdout (usage/error text) yields no diagnostics', () => {
    expect(parseCheckStdout("I couldn't find the file 'x.zx'.")).toHaveLength(0);
  });

  test('non-envelope JSON is tolerated', () => {
    expect(parseCheckStdout('[{ broken')).toHaveLength(0);
    expect(parseCheckStdout('[{"code":"ZX0001","message":"m","range":{"start":{"line":1,"col":1},"end":{"line":1,"col":1}}}]')).toHaveLength(0);
    expect(parseCheckStdout('{"not":"an array"}')).toHaveLength(0);
  });

  test('rc.8 envelope: diagnostics come from the top-level diagnostics array', () => {
    const envelope = `{ "zornuxJson": 1, "ok": false, "command": "check", "result": null,
      "diagnostics": [ { "code": "ZX0111", "severity": "error",
        "message": "I expected a value here, but found the end of the file.", "file": "bad.zx",
        "range": { "start": { "line": 2, "col": 1 }, "end": { "line": 2, "col": 1 } },
        "help": "a value can be a number, text, true/false, nothing, a name, or a list." } ] }`;
    const diagnostics = parseCheckStdout(envelope);
    // Without the envelope branch this returns [] — the editor would go blind on rc.8.
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('ZX0111');
    expect(diagnostics[0].severity).toBe('error');
    expect(diagnostics[0].range.start.line).toBe(2);
    expect(diagnostics[0].file).toBe('bad.zx');
  });

  test('rc.8 envelope: a clean check (ok:true, empty diagnostics) yields none', () => {
    const clean = `{ "zornuxJson": 1, "ok": true, "command": "check", "result": { "findings": [] }, "diagnostics": [] }`;
    expect(parseCheckStdout(clean)).toHaveLength(0);
  });

  test('drops elements missing required fields', () => {
    const partial =
      '{"zornuxJson":1,"ok":false,"command":"check","result":null,"diagnostics":[{"code":"ZX0001"},{"code":"ZX0002","message":"ok","range":{"start":{"line":1,"col":1},"end":{"line":1,"col":2}}}]}';
    const diagnostics = parseCheckStdout(partial);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('ZX0002');
  });
});

describe('compiler diagnostics: platform mapping', () => {
  test('converts 1-based CLI ranges to 0-based platform ranges', () => {
    const [cli] = parseCheckStdout(ZX0103_JSON);
    const mapped = toPlatformDiagnostic(cli, 'zornux-compiler');
    expect(mapped.severity).toBe('error');
    expect(mapped.code).toBe('ZX0103');
    expect(mapped.source).toBe('zornux-compiler');
    expect(mapped.hint).toContain("add 'end'");
    // line 3 col 1 → line 2 char 0 ; end line 3 col 3 → line 2 char 2
    expect(mapped.range.start).toEqual({ line: 2, character: 0 });
    expect(mapped.range.end).toEqual({ line: 2, character: 2 });
  });

  test('never produces negative coordinates', () => {
    const mapped = toPlatformDiagnostic(
      { code: 'ZX0001', severity: 'warning', message: 'x', file: 'f', range: { start: { line: 1, col: 1 }, end: { line: 1, col: 1 } } },
      'zornux-compiler',
    );
    expect(mapped.severity).toBe('warning');
    expect(mapped.range.start).toEqual({ line: 0, character: 0 });
  });
});
