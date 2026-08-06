import type { AiMessage } from '../../shared/ai/providers';
import type { EditorDecoration } from '../core/Contracts';

/**
 * Pure core for AI code review (Phase 10D). Numbers the code so the model can
 * cite lines, frames a strict-JSON review request, and parses the reply into
 * structured findings — tolerant of the model wrapping JSON in prose or fences.
 * Kept pure so the (fiddly) parsing and severity mapping are unit-tested.
 */

export type ReviewSeverity = 'error' | 'warning' | 'info' | 'suggestion';

export interface ReviewFinding {
  /** 1-based line in the ORIGINAL document. */
  line: number;
  severity: ReviewSeverity;
  title: string;
  detail: string;
}

const SEVERITY_RANK: Record<ReviewSeverity, number> = { error: 0, warning: 1, info: 2, suggestion: 3 };

/** Prefix each line with its (1-based, document-relative) number for the model. */
export function numberLines(code: string, startLine = 1): string {
  return code
    .split('\n')
    .map((line, index) => `${startLine + index}: ${line}`)
    .join('\n');
}

/** Build the provider-agnostic, strict-JSON review request. */
export function buildReviewMessages(
  code: string,
  fileName: string | null,
  startLine = 1,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You are a meticulous code reviewer inside the ZnxStudio IDE for the Zornux language (.zx).',
    'Review the code for bugs, correctness, missing edge cases, readability, and idiomatic style.',
    'Respond with ONLY a JSON array — no prose, no Markdown code fences.',
    'Each element: {"line": <number matching the shown line numbers>, "severity": "error"|"warning"|"info"|"suggestion", "title": <short>, "detail": <one or two sentences>}.',
    'Cite the most relevant line for each finding. If the code has no issues, return [].',
  ].join('\n');
  const where = fileName ? `File: ${fileName}\n\n` : '';
  const user = `${where}Review this code (line numbers shown):\n${numberLines(code, startLine)}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

function normalizeSeverity(value: unknown): ReviewSeverity {
  const v = String(value ?? '').toLowerCase();
  if (/(error|critical|high|bug|blocker)/.test(v)) return 'error';
  if (/(warn|medium|major)/.test(v)) return 'warning';
  if (/(suggest|hint|nit|style|minor|refactor)/.test(v)) return 'suggestion';
  return 'info';
}

/** Extract the outermost JSON array from a possibly-noisy model reply. */
function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export interface ParseBounds {
  /** Lowest valid 1-based line (document-relative). */
  minLine: number;
  /** Highest valid 1-based line. */
  maxLine: number;
}

/**
 * Parse a model review reply into findings. Never throws: drops malformed
 * entries, clamps out-of-range lines, normalizes severities, and sorts by line
 * then severity.
 */
export function parseReviewFindings(text: string, bounds: ParseBounds): ReviewFinding[] {
  const json = extractJsonArray(text);
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const findings: ReviewFinding[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const title = String(item.title ?? item.message ?? '').trim();
    if (!title) continue;
    const lineValue = Number(item.line ?? item.lineNumber);
    const line = Number.isFinite(lineValue)
      ? clamp(Math.round(lineValue), bounds.minLine, bounds.maxLine)
      : bounds.minLine;
    findings.push({
      line,
      severity: normalizeSeverity(item.severity),
      title,
      detail: String(item.detail ?? item.description ?? '').trim(),
    });
  }
  return sortFindings(findings);
}

export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort((a, b) => a.line - b.line || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export function countBySeverity(findings: ReviewFinding[]): Record<ReviewSeverity, number> {
  const counts: Record<ReviewSeverity, number> = { error: 0, warning: 0, info: 0, suggestion: 0 };
  for (const finding of findings) counts[finding.severity]++;
  return counts;
}

/** Map a review severity to the editor decoration severity (suggestion → hint). */
export function reviewSeverityToDecoration(severity: ReviewSeverity): EditorDecoration['severity'] {
  return severity === 'suggestion' ? 'hint' : severity;
}

/** Build error-lens style decorations (0-based) for the findings. */
export function findingsToDecorations(findings: ReviewFinding[]): EditorDecoration[] {
  return findings.map((finding) => {
    const zeroLine = Math.max(0, finding.line - 1);
    return {
      startLine: zeroLine,
      startCharacter: 0,
      endLine: zeroLine,
      endCharacter: 0,
      severity: reviewSeverityToDecoration(finding.severity),
      inlineMessage: finding.title,
      wholeLine: finding.severity === 'error' || finding.severity === 'warning',
    };
  });
}
