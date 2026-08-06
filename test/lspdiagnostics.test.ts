import { describe, expect, test } from './harness';
import { toPlatformDiagnostic, toPlatformDiagnostics } from '../src/renderer/language/lsp/lspDiagnostics';
import type { LspRawDiagnostic } from '../src/shared/types';

function raw(overrides: Partial<LspRawDiagnostic> = {}): LspRawDiagnostic {
  return {
    range: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
    severity: 1,
    code: 'ZX0002',
    source: 'zornux',
    message: 'unterminated string',
    ...overrides,
  };
}

describe('lsp → platform diagnostics', () => {
  test('copies the 0-based range unchanged (no coordinate shift)', () => {
    const d = toPlatformDiagnostic(raw(), 'zornux-compiler');
    expect(d.range.start.line).toBe(2);
    expect(d.range.start.character).toBe(4);
    expect(d.range.end.line).toBe(2);
    expect(d.range.end.character).toBe(9);
  });

  test('maps LSP severity ints to platform severities', () => {
    expect(toPlatformDiagnostic(raw({ severity: 1 }), 's').severity).toBe('error');
    expect(toPlatformDiagnostic(raw({ severity: 2 }), 's').severity).toBe('warning');
    expect(toPlatformDiagnostic(raw({ severity: 3 }), 's').severity).toBe('info');
    expect(toPlatformDiagnostic(raw({ severity: 4 }), 's').severity).toBe('hint');
  });

  test('defaults missing/unknown severity to error', () => {
    expect(toPlatformDiagnostic(raw({ severity: undefined }), 's').severity).toBe('error');
  });

  test('splits an appended help line into message + hint', () => {
    const d = toPlatformDiagnostic(raw({ message: 'undefined name\nDid you mean "count"?' }), 's');
    expect(d.message).toBe('undefined name');
    expect(d.hint).toBe('Did you mean "count"?');
  });

  test('leaves hint undefined when there is no help line', () => {
    const d = toPlatformDiagnostic(raw({ message: 'plain message' }), 's');
    expect(d.message).toBe('plain message');
    expect(d.hint).toBeFalsy();
  });

  test('stringifies a numeric code and carries the source', () => {
    const d = toPlatformDiagnostic(raw({ code: 42 }), 'zornux-compiler');
    expect(d.code).toBe('42');
    expect(d.source).toBe('zornux-compiler');
  });

  test('maps a list', () => {
    expect(toPlatformDiagnostics([raw(), raw({ severity: 2 })], 's')).toHaveLength(2);
  });
});
