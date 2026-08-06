import { describe, expect, test } from './harness';
import {
  buildSummary,
  groupByFile,
  isAbsolutePath,
  normalizePath,
  resolveDiagnosticPath,
} from '../src/renderer/run/buildDiagnostics';
import type { CompilerDiagnostic } from '../src/shared/compilerProtocol';

const diag = (file: string, code = 'ZX0001'): CompilerDiagnostic => ({
  code,
  severity: 'error',
  message: 'x',
  file,
  range: { start: { line: 1, col: 1 }, end: { line: 1, col: 2 } },
});

describe('build: path resolution', () => {
  test('recognizes absolute paths (windows + posix)', () => {
    expect(isAbsolutePath('C:\\a\\b.zx')).toBeTruthy();
    expect(isAbsolutePath('C:/a/b.zx')).toBeTruthy();
    expect(isAbsolutePath('/home/a/b.zx')).toBeTruthy();
    expect(isAbsolutePath('src/main.zx')).toBeFalsy();
    expect(isAbsolutePath('main.zx')).toBeFalsy();
  });

  test('leaves absolute paths untouched', () => {
    expect(resolveDiagnosticPath('C:\\proj\\src\\main.zx', 'C:\\proj')).toBe('C:\\proj\\src\\main.zx');
  });

  test('joins relative paths onto the workspace root', () => {
    expect(resolveDiagnosticPath('src/main.zx', 'C:\\proj')).toBe('C:\\proj/src/main.zx');
    expect(resolveDiagnosticPath('src/main.zx', 'C:\\proj\\')).toBe('C:\\proj/src/main.zx');
  });

  test('returns the file as-is when there is no root', () => {
    expect(resolveDiagnosticPath('src/main.zx', null)).toBe('src/main.zx');
  });

  test('collapses redundant "." segments the dir-scan emits', () => {
    expect(normalizePath('C:\\proj\\.\\app.zx')).toBe('C:\\proj\\app.zx');
    expect(normalizePath('C:\\proj/./app.zx')).toBe('C:\\proj/app.zx');
    expect(resolveDiagnosticPath('C:\\proj\\.\\app.zx', 'C:\\proj')).toBe('C:\\proj\\app.zx');
  });
});

describe('build: grouping', () => {
  test('groups diagnostics by resolved file, preserving order', () => {
    const groups = groupByFile(
      [diag('src/a.zx'), diag('src/b.zx'), diag('src/a.zx', 'ZX0002')],
      'C:\\proj',
    );
    expect(groups.size).toBe(2);
    expect(groups.get('C:\\proj/src/a.zx')).toHaveLength(2);
    expect(groups.get('C:\\proj/src/b.zx')).toHaveLength(1);
  });
});

describe('build: summary', () => {
  test('summarizes counts', () => {
    expect(buildSummary(0, 0)).toBe('no problems');
    expect(buildSummary(1, 0)).toBe('1 error');
    expect(buildSummary(2, 0)).toBe('2 errors');
    expect(buildSummary(2, 3)).toBe('2 errors, 3 warnings');
    expect(buildSummary(0, 1)).toBe('1 warning');
  });
});
