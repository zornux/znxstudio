import type { CompilerDiagnostic } from '../../shared/compilerProtocol';
import type { Diagnostic } from '../language/api';

/**
 * Maps compiler-CLI diagnostics onto the Language Platform's diagnostic type.
 * Pure and Monaco-free, so it is unit-testable. The key translation is
 * coordinate systems: the CLI reports 1-based, end-exclusive line/columns; the
 * platform (and Monaco, via the bridge) uses 0-based, end-exclusive positions.
 */

const SEVERITY: Record<CompilerDiagnostic['severity'], Diagnostic['severity']> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
};

export function toPlatformDiagnostic(diagnostic: CompilerDiagnostic, source: string): Diagnostic {
  const { start, end } = diagnostic.range;
  return {
    severity: SEVERITY[diagnostic.severity] ?? 'error',
    message: diagnostic.message,
    code: diagnostic.code,
    hint: diagnostic.help,
    source,
    range: {
      start: { line: Math.max(0, start.line - 1), character: Math.max(0, start.col - 1) },
      end: { line: Math.max(0, end.line - 1), character: Math.max(0, end.col - 1) },
    },
  };
}

export function toPlatformDiagnostics(diagnostics: CompilerDiagnostic[], source: string): Diagnostic[] {
  return diagnostics.map((diagnostic) => toPlatformDiagnostic(diagnostic, source));
}
