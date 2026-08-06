/**
 * Zornux compiler wire protocol — pure, dependency-free helpers shared by the
 * main-process CompilerService (which spawns the CLI) and the renderer (which
 * maps results into platform diagnostics). No Node, no Electron, no Monaco, so
 * it is unit-testable in isolation.
 *
 * The CLI contract (rc.8 is the floor):
 *   - `check`/`build --json` print the JSON envelope, with compiler diagnostics
 *     under its top-level `diagnostics` array (1-based line/col, each
 *     `{ code, severity, message, file, range, help? }`). A clean file is
 *     `ok:true` with an empty `diagnostics`.
 *   - A missing file / usage error prints plain text (not JSON) on stdout.
 *   - Exit codes: 0 ok · 1 diagnostics · 2 usage · 3 not-found · 4 host-failed
 *     · 5 internal.
 */

import { parseEnvelope, type EnvelopeDiagnostic } from './cli/envelope';
import { enumOr } from './cli/tolerant';

export type CompilerSeverity = 'error' | 'warning' | 'info';

/** 1-based line/column, exactly as the CLI reports it. */
export interface CompilerPosition {
  line: number;
  col: number;
}

export interface CompilerRange {
  start: CompilerPosition;
  end: CompilerPosition;
}

/** One diagnostic as emitted by `zornux check --json`. */
export interface CompilerDiagnostic {
  code: string;
  severity: CompilerSeverity;
  message: string;
  file: string;
  range: CompilerRange;
  help?: string;
}

/** Classification of the CLI process exit code. */
export type CompilerCheckOutcome =
  | 'ok' // 0 — checked, no diagnostics
  | 'diagnostics' // 1 — checked, diagnostics found
  | 'usage' // 2 — bad command line
  | 'not-found' // 3 — file not found
  | 'host-failed' // 4 — host failed to start
  | 'internal' // 5 — internal compiler error
  | 'unknown'; // anything else

export function interpretExitCode(code: number | null): CompilerCheckOutcome {
  switch (code) {
    case 0:
      return 'ok';
    case 1:
      return 'diagnostics';
    case 2:
      return 'usage';
    case 3:
      return 'not-found';
    case 4:
      return 'host-failed';
    case 5:
      return 'internal';
    default:
      return 'unknown';
  }
}

/** True when the exit code means the compiler actually ran the check. */
export function outcomeRan(outcome: CompilerCheckOutcome): boolean {
  return outcome === 'ok' || outcome === 'diagnostics';
}

/**
 * Extract compiler diagnostics from `check`/`build --json` output — the JSON
 * envelope's top-level `diagnostics` array (the `check` `result` only carries
 * security findings, which this path does not want). Returns [] for empty
 * output (clean file), non-JSON output (plain-text usage/error messages), or a
 * malformed envelope — this layer never throws. A clean file is an `ok:true`
 * envelope with an empty `diagnostics`.
 *
 * This is main-process code, so the envelope parser it uses lives in `shared`.
 */
export function parseCheckStdout(stdout: string): CompilerDiagnostic[] {
  const envelope = parseEnvelope(stdout);
  if (!envelope) return [];
  const diagnostics: CompilerDiagnostic[] = [];
  for (const entry of envelope.diagnostics) {
    const diagnostic = fromEnvelopeDiagnostic(entry);
    if (diagnostic) diagnostics.push(diagnostic);
  }
  return diagnostics;
}

/** An envelope diagnostic (already flattened + 1-based) → a `CompilerDiagnostic`. */
function fromEnvelopeDiagnostic(entry: EnvelopeDiagnostic): CompilerDiagnostic | null {
  if (!entry.code || !entry.message) return null;
  const startLine = Math.max(1, entry.startLine || 1);
  const startCol = Math.max(1, entry.startColumn || 1);
  return {
    code: entry.code,
    severity: normalizeSeverity(entry.severity),
    message: entry.message,
    file: entry.file ?? '',
    range: {
      start: { line: startLine, col: startCol },
      end: { line: Math.max(startLine, entry.endLine || startLine), col: Math.max(1, entry.endColumn || startCol) },
    },
    help: entry.help ?? undefined,
  };
}

function normalizeSeverity(raw: unknown): CompilerSeverity {
  // Unknown severities coerce to 'error' — the safe default (never silently clean).
  return enumOr(raw, ['error', 'warning', 'info'] as const, 'error');
}
