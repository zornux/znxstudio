import { describe, expect, test } from './harness';
import {
  buildDebugMessages,
  diagnosticToContext,
  extractSnippet,
  pickNearestDiagnostic,
  summarizeContext,
} from '../src/renderer/ai/debugassist';
import type { CompilerDiagnostic } from '../src/shared/compilerProtocol';

const SOURCE = 'function combine with a, b\n    give back a + b\nend\n';

function diag(code: string, line: number, message = 'msg'): CompilerDiagnostic {
  return { code, severity: 'error', message, file: 'm.zx', range: { start: { line, col: 1 }, end: { line, col: 2 } } };
}

describe('extractSnippet', () => {
  test('marks the error line and numbers lines', () => {
    const snippet = extractSnippet(SOURCE, 2);
    const lines = snippet.split('\n');
    expect(lines[0].startsWith(' ')).toBe(true); // context line
    const marked = lines.find((l) => l.startsWith('>'));
    expect(marked).toContain('give back a + b');
    expect(marked).toContain('2 |');
  });
  test('clamps a line beyond the source', () => {
    const snippet = extractSnippet('a\nb', 99);
    expect(snippet).toContain('> 2 | b');
  });
});

describe('pickNearestDiagnostic', () => {
  test('returns the diagnostic closest to the cursor line', () => {
    const diags = [diag('ZX0110', 1), diag('ZX0100', 8)];
    expect(pickNearestDiagnostic(diags, 7)!.code).toBe('ZX0100');
    expect(pickNearestDiagnostic(diags, 2)!.code).toBe('ZX0110');
  });
  test('ties keep the earlier diagnostic', () => {
    const diags = [diag('A', 5), diag('B', 5)];
    expect(pickNearestDiagnostic(diags, 5)!.code).toBe('A');
  });
  test('empty list returns null', () => {
    expect(pickNearestDiagnostic([], 1)).toBeNull();
  });
});

describe('diagnosticToContext & summarize', () => {
  test('carries code, message, help, line, and a snippet', () => {
    const d = { ...diag('ZX0110', 1, 'reserved word'), help: 'pick another name' };
    const ctx = diagnosticToContext(d, SOURCE, 'm.zx');
    expect(ctx.kind).toBe('diagnostic');
    expect(ctx.code).toBe('ZX0110');
    expect(ctx.help).toBe('pick another name');
    expect(ctx.line).toBe(1);
    expect(ctx.snippet).toContain('combine');
  });
  test('summarizeContext renders code, message, and line', () => {
    const ctx = diagnosticToContext(diag('ZX0110', 3, 'boom'), SOURCE, 'm.zx');
    expect(summarizeContext(ctx)).toBe('[ZX0110] boom (line 3)');
  });
});

describe('buildDebugMessages', () => {
  test('includes the error, hint, snippet, and asks for a fix', () => {
    const d = { ...diag('ZX0110', 1, 'reserved word'), help: 'rename it' };
    const { system, messages } = buildDebugMessages(diagnosticToContext(d, SOURCE, 'm.zx'), 'm.zx');
    expect(system).toContain('debugging assistant');
    const body = messages[0].content;
    expect(body).toContain('Compiler error [ZX0110]');
    expect(body).toContain('Compiler hint: rename it');
    expect(body).toContain('give back a + b');
    expect(body).toContain('fix');
  });
  test('labels a pasted output context', () => {
    const { messages } = buildDebugMessages({ kind: 'output', message: 'segfault at 0x0' }, null);
    expect(messages[0].content).toContain('Program output: segfault at 0x0');
  });
});
