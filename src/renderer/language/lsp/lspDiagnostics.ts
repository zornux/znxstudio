import type { LspRawDiagnostic } from '../../../shared/types';
import type { Diagnostic } from '../api';

/**
 * Maps `zornux lsp` diagnostics onto the Language Platform's diagnostic type.
 * Pure and Monaco-free, so it is unit-testable. Unlike the CLI (1-based), LSP
 * positions are already 0-based end-exclusive — matching the platform exactly —
 * so ranges copy across without a coordinate shift. The server appends any help
 * text after a newline; we split it back into message + hint.
 */

const SEVERITY: Record<number, Diagnostic['severity']> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

export function toPlatformDiagnostic(diagnostic: LspRawDiagnostic, source: string): Diagnostic {
  const newline = diagnostic.message.indexOf('\n');
  const message = newline >= 0 ? diagnostic.message.slice(0, newline) : diagnostic.message;
  const hintText = newline >= 0 ? diagnostic.message.slice(newline + 1).trim() : '';
  return {
    severity: (diagnostic.severity !== undefined ? SEVERITY[diagnostic.severity] : undefined) ?? 'error',
    message,
    code: diagnostic.code !== undefined ? String(diagnostic.code) : undefined,
    hint: hintText.length > 0 ? hintText : undefined,
    source,
    range: {
      start: { line: diagnostic.range.start.line, character: diagnostic.range.start.character },
      end: { line: diagnostic.range.end.line, character: diagnostic.range.end.character },
    },
  };
}

export function toPlatformDiagnostics(diagnostics: LspRawDiagnostic[], source: string): Diagnostic[] {
  return diagnostics.map((diagnostic) => toPlatformDiagnostic(diagnostic, source));
}
