import { describe, expect, test } from './harness';
import { asRecord, bool, enumOr, num, preserveEnum, str, strList } from '../src/shared/cli/tolerant';
import { parseEnvelope } from '../src/shared/cli/envelope';
import { parseCheckStdout } from '../src/shared/compilerProtocol';
import { parseDocResult } from '../src/renderer/docs/apiReference';
import { parseScanResult } from '../src/renderer/security/findings';
import { parseInfoEnvelope } from '../src/shared/toolchain/negotiation';

describe('tolerant toolkit', () => {
  test('asRecord returns objects only (not arrays/primitives/null)', () => {
    expect(asRecord({ a: 1 })).toEqual({ a: 1 });
    expect(asRecord([1, 2])).toEqual({});
    expect(asRecord(null)).toEqual({});
    expect(asRecord('x')).toEqual({});
  });

  test('num coerces and defaults', () => {
    expect(num('5')).toBe(5);
    expect(num(3.2)).toBe(3.2);
    expect(num('nope')).toBe(0);
    expect(num(undefined, 9)).toBe(9);
    expect(num(Infinity, 7)).toBe(7);
  });

  test('str / bool / strList', () => {
    expect(str('hi')).toBe('hi');
    expect(str(42, 'fallback')).toBe('fallback');
    expect(bool(true)).toBe(true);
    expect(bool('true')).toBe(false);
    expect(bool(undefined, true)).toBe(true);
    expect(strList(['a', 1, 'b', null])).toEqual(['a', 'b']);
    expect(strList('x')).toEqual([]);
  });

  test('enumOr matches case-insensitively and returns the canonical spelling', () => {
    const sev = ['Info', 'Warning', 'Error', 'Critical'] as const;
    expect(enumOr('CRITICAL', sev, 'Info')).toBe('Critical');
    expect(enumOr('warning', sev, 'Info')).toBe('Warning');
    expect(enumOr('unheard-of', sev, 'Info')).toBe('Info');
    expect(enumOr(42, sev, 'Info')).toBe('Info');
  });

  test('preserveEnum returns the member or the literal "unknown"', () => {
    const kinds = ['Alpha', 'Beta'] as const;
    expect(preserveEnum('beta', kinds)).toBe('Beta');
    expect(preserveEnum('gamma', kinds)).toBe('unknown');
    expect(preserveEnum(null, kinds)).toBe('unknown');
  });
});

/* ---- the guarantees, exercised through the real readers ---- */

describe('parse tolerance — property order does not matter', () => {
  test('the envelope parses identically regardless of key order', () => {
    const ordered = `{ "zornuxJson":1, "ok":true, "command":"doc", "result":{"modules":2}, "diagnostics":[] }`;
    const shuffled = `{ "diagnostics":[], "result":{"modules":2}, "command":"doc", "ok":true, "zornuxJson":1 }`;
    expect(parseEnvelope(ordered)).toEqual(parseEnvelope(shuffled));
  });

  test('capabilities negotiate identically regardless of key order', () => {
    const a = `{ "zornuxJson":1,"ok":true,"command":"capabilities","result":{"productVersion":"1.0.0","protocols":{"cli":"1.0"},"capabilities":{"testing":true}},"diagnostics":[] }`;
    const b = `{ "diagnostics":[],"command":"capabilities","result":{"capabilities":{"testing":true},"protocols":{"cli":"1.0"},"productVersion":"1.0.0"},"ok":true,"zornuxJson":1 }`;
    expect(parseInfoEnvelope(a)).toEqual(parseInfoEnvelope(b));
  });
});

describe('parse tolerance — unknown fields are ignored, missing optionals defaulted', () => {
  test('extra top-level and per-diagnostic fields do not break the reader', () => {
    const withExtras = `{ "zornuxJson":1, "ok":false, "command":"check", "result":null, "surprise":"ignored",
      "diagnostics":[ { "code":"ZX0103","severity":"error","message":"m","futureField":true,
        "range":{"start":{"line":3,"col":1},"end":{"line":3,"col":3}} } ] }`;
    const diagnostics = parseCheckStdout(withExtras);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe('ZX0103');
  });

  test('a diagnostic missing its optional help defaults to undefined, not a throw', () => {
    const noHelp = `{ "zornuxJson":1,"ok":false,"command":"check","result":null,
      "diagnostics":[ { "code":"ZX0103","severity":"error","message":"m","range":{"start":{"line":1,"col":1},"end":{"line":1,"col":1}} } ] }`;
    expect(parseCheckStdout(noHelp)[0].help).toBeFalsy();
  });
});

describe('parse tolerance — an unknown enum never crashes', () => {
  test('an unknown compiler severity coerces to error', () => {
    const env = `{ "zornuxJson":1,"ok":false,"command":"check","result":null,
      "diagnostics":[ { "code":"ZXfut","severity":"catastrophic","message":"m","range":{"start":{"line":1,"col":1},"end":{"line":1,"col":1}} } ] }`;
    expect(parseCheckStdout(env)[0].severity).toBe('error');
  });

  test('an unknown security severity coerces to Info (never dropped, never thrown)', () => {
    const env = `{ "zornuxJson":1,"ok":true,"command":"check-security",
      "result":{"findings":[ { "code":"ZX3799","severity":"apocalyptic","confidence":"telepathic","message":"m",
        "range":{"start":{"line":2,"col":1},"end":{"line":2,"col":2}} } ]},"diagnostics":[] }`;
    const [finding] = parseScanResult(env, 'x.zx').findings;
    expect(finding.severity).toBe('Info');
    expect(finding.confidence).toBe('Low');
  });

  test('an unknown doc severity coerces to Warning', () => {
    const env = `{ "zornuxJson":1,"ok":true,"command":"doc",
      "result":{"project":"p","version":"1","format":"markdown","output":"o","written":true,"modules":1,"files":["index.md"]},
      "diagnostics":[ { "code":"ZX1601","severity":"whisper","message":"'x' has no doc comment." } ] }`;
    const result = parseDocResult(env);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary.diagnostics[0].severity).toBe('Warning');
  });
});
