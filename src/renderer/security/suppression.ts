/**
 * Source-level suppression directives (Phase 15A), mirrored EXACTLY from
 * `Zornux.Analysis/SourceSuppressions.cs`. ZnxStudio must agree with the compiler
 * about which findings a file already silences, or its panels would show
 * findings the build no longer reports.
 *
 * A directive is a comment: `# zornux:suppress ZX3701 <justification>`
 *   • on its own line  → silences that rule on the NEXT line holding code
 *   • after code       → silences that rule on ITS OWN line
 *
 * The justification is REQUIRED. A directive without one silences nothing:
 * turning a finding off stays a deliberate, explained act.
 */

export const SUPPRESS_MARKER = 'zornux:suppress';

export interface Suppression {
  ruleId: string;
  /** The 1-based line this directive covers. */
  line: number;
  justification: string;
  /** The 1-based line the directive itself is written on. */
  directiveLine: number;
  /** True when written after code on the same line. */
  inline: boolean;
}

/** A rule id is exactly `ZX` followed by four digits. */
export function isRuleId(candidate: string): boolean {
  return /^ZX\d{4}$/.test(candidate);
}

/** The 1-based number of the next line holding code, or 0 when none follows. */
function nextCodeLine(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (line.length > 0 && !line.startsWith('#')) return i + 1;
  }
  return 0;
}

function readDirective(rest: string): { ruleId: string | null; justification: string } {
  const trimmed = rest.trim();
  const space = trimmed.indexOf(' ');
  const ruleId = space < 0 ? trimmed : trimmed.slice(0, space);
  if (!isRuleId(ruleId)) return { ruleId: null, justification: '' };
  return { ruleId, justification: space < 0 ? '' : trimmed.slice(space + 1).trim() };
}

/** Every suppression directive in the source, resolved to the line it covers. */
export function parseSuppressions(text: string): Suppression[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const suppressions: Suppression[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const hash = lines[i].indexOf('#');
    if (hash < 0) continue;

    const comment = lines[i].slice(hash + 1).trim();
    if (!comment.startsWith(SUPPRESS_MARKER)) continue;

    const { ruleId, justification } = readDirective(comment.slice(SUPPRESS_MARKER.length));
    if (!ruleId) continue;

    const inline = lines[i].slice(0, hash).trim().length > 0;
    const covered = inline ? i + 1 : nextCodeLine(lines, i + 1);
    if (covered > 0) suppressions.push({ ruleId, line: covered, justification, directiveLine: i + 1, inline });
  }

  return suppressions;
}

/**
 * True when a finding is suppressed: a directive names its rule, covers its
 * line, and carries a justification. A blank justification silences nothing.
 */
export function isSuppressed(suppressions: Suppression[], ruleId: string, line: number): boolean {
  return suppressions.some(
    (s) => s.ruleId.toUpperCase() === ruleId.toUpperCase() && s.justification.trim().length > 0 && s.line === line,
  );
}

/** Directives that name a rule but give no reason — they silence nothing, so surface them. */
export function unjustifiedSuppressions(suppressions: Suppression[]): Suppression[] {
  return suppressions.filter((s) => s.justification.trim().length === 0);
}

/**
 * The comment line to insert above a finding to suppress it. Written on its own
 * line, indented to match the code it covers, so it reads as a note about that line.
 */
export function buildSuppressionComment(ruleId: string, justification: string, indent = ''): string {
  const reason = justification.trim();
  return `${indent}# ${SUPPRESS_MARKER} ${ruleId} ${reason}`;
}

/** The leading whitespace of a 1-based line, so an inserted directive lines up. */
export function indentOf(text: string, line: number): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const target = lines[line - 1] ?? '';
  return /^[ \t]*/.exec(target)?.[0] ?? '';
}
