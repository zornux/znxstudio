import type { AiMessage } from '../../shared/ai/providers';
import type { CompilerDiagnostic } from '../../shared/compilerProtocol';

/**
 * Pure core for the AI Debug Assistant (Phase 10G). Turns a real error — most
 * often a live `zornux check` diagnostic, but also a pasted stack trace or run
 * output — into a provider-agnostic request that asks for a plain-language cause
 * plus a concrete fix. The code snippet + prompt framing are unit-tested so the
 * assistant is grounded in the actual compiler's diagnostics.
 */

export type DebugKind = 'diagnostic' | 'exception' | 'testFailure' | 'output';

export interface DebugContext {
  kind: DebugKind;
  message: string;
  /** ZX#### (or other) error code, when known. */
  code?: string;
  /** The compiler's own hint, when present. */
  help?: string;
  file?: string | null;
  /** 1-based line of the error, when known. */
  line?: number;
  /** Numbered code around the error, with a `>` marker on the error line. */
  snippet?: string;
}

/** Extract numbered source lines around a 1-based line, marking the error line. */
export function extractSnippet(source: string, line1: number, radius = 3): string {
  const lines = source.split('\n');
  const idx = Math.max(0, Math.min(line1 - 1, lines.length - 1));
  const from = Math.max(0, idx - radius);
  const to = Math.min(lines.length - 1, idx + radius);
  const width = String(to + 1).length;
  const out: string[] = [];
  for (let i = from; i <= to; i++) {
    const marker = i === idx ? '>' : ' ';
    const num = String(i + 1).padStart(width, ' ');
    out.push(`${marker} ${num} | ${lines[i]}`);
  }
  return out.join('\n');
}

/** Pick the diagnostic nearest the (1-based) cursor line; ties keep the first. */
export function pickNearestDiagnostic(
  diagnostics: CompilerDiagnostic[],
  cursorLine1: number,
): CompilerDiagnostic | null {
  if (diagnostics.length === 0) return null;
  let best = diagnostics[0];
  let bestDist = Math.abs(diagnostics[0].range.start.line - cursorLine1);
  for (const diagnostic of diagnostics) {
    const dist = Math.abs(diagnostic.range.start.line - cursorLine1);
    if (dist < bestDist) {
      best = diagnostic;
      bestDist = dist;
    }
  }
  return best;
}

/** Build a debug context from a compiler diagnostic + the current source. */
export function diagnosticToContext(
  diagnostic: CompilerDiagnostic,
  source: string,
  fileName: string | null,
): DebugContext {
  return {
    kind: 'diagnostic',
    message: diagnostic.message,
    code: diagnostic.code,
    help: diagnostic.help,
    file: fileName,
    line: diagnostic.range.start.line,
    snippet: extractSnippet(source, diagnostic.range.start.line),
  };
}

/** A one-line human summary of a debug context (panel header). */
export function summarizeContext(context: DebugContext): string {
  const code = context.code ? `[${context.code}] ` : '';
  const where = context.line ? ` (line ${context.line})` : '';
  return `${code}${context.message}${where}`;
}

/** Build the provider-agnostic "explain this error and suggest a fix" request. */
export function buildDebugMessages(
  context: DebugContext,
  fileName: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You are a debugging assistant for the Zornux language (.zx).',
    'Given an error, explain the most likely cause in plain language, then give a concrete fix.',
    'Show the corrected Zornux code when it helps. Be concise and specific to the code shown — do not speculate beyond it.',
  ].join('\n');

  const parts: string[] = [];
  if (fileName) parts.push(`File: ${fileName}`);
  const kindLabel =
    context.kind === 'diagnostic'
      ? 'Compiler error'
      : context.kind === 'exception'
        ? 'Runtime exception'
        : context.kind === 'testFailure'
          ? 'Test failure'
          : 'Program output';
  parts.push(`${kindLabel}${context.code ? ` [${context.code}]` : ''}: ${context.message}`);
  if (context.help) parts.push(`Compiler hint: ${context.help}`);
  if (context.line) parts.push(`Location: line ${context.line}`);
  if (context.snippet) parts.push(`\nCode:\n${context.snippet}`);
  parts.push('\nExplain the cause and how to fix it.');

  return { system, messages: [{ role: 'user', content: parts.join('\n') }] };
}
