import type { AiMessage } from '../../shared/ai/providers';
import { extractSnippet } from './debugassist';
import { diffLines, type DiffLine } from './refactor';

/**
 * Pure core for Fix with AI. Takes a compiler diagnostic + source, asks the
 * model for a concrete fix, and parses the response into a reviewable diff.
 * Grounded in the real compiler's diagnostics — the AI explains and proposes,
 * the developer reviews the diff and applies.
 */

export interface FixContext {
  code: string;
  message: string;
  hint?: string;
  severity: string;
  file: string;
  /** 1-based line. */
  line: number;
  /** Source code of the file. */
  source: string;
  /** Numbered snippet around the error. */
  snippet: string;
}

export interface FixProposal {
  explanation: string;
  /** The rewritten source (full file or region). */
  rewritten: string;
  /** Line-level diff of the region around the fix. */
  diff: DiffLine[];
  /** Stats for the diff. */
  added: number;
  removed: number;
}

/** Build a FixContext from a diagnostic and the file source. */
export function buildFixContext(
  code: string,
  message: string,
  severity: string,
  file: string,
  line1: number,
  source: string,
  hint?: string,
): FixContext {
  return {
    code,
    message,
    hint,
    severity,
    file,
    line: line1,
    source,
    snippet: extractSnippet(source, line1, 5),
  };
}

/** Build the prompt that asks the model to explain and fix a diagnostic. */
export function buildFixMessages(ctx: FixContext): { system: string; messages: AiMessage[] } {
  const system = [
    'You are a code-fixing assistant for the Zornux language (.zx) inside the ZnxStudio IDE.',
    'Given a compiler diagnostic and the surrounding code, do TWO things:',
    '1. Explain the error in 1-2 sentences.',
    '2. Show the FIXED code that resolves the diagnostic.',
    '',
    'Format your response EXACTLY like this:',
    'EXPLANATION: <your 1-2 sentence explanation>',
    '',
    '```',
    '<the fixed code — include enough surrounding lines for context, not just the changed line>',
    '```',
    '',
    'Rules:',
    '- Fix ONLY the reported diagnostic. Do not refactor or improve unrelated code.',
    '- Preserve the surrounding code, indentation, and Zornux idioms.',
    '- If you are unsure how to fix it, say so in the explanation and show the original code unchanged.',
  ].join('\n');

  const regionStart = Math.max(0, ctx.line - 6);
  const regionEnd = Math.min(ctx.source.split('\n').length, ctx.line + 6);
  const region = ctx.source
    .split('\n')
    .slice(regionStart, regionEnd)
    .map((l, i) => `${regionStart + i + 1} | ${l}`)
    .join('\n');

  const parts: string[] = [
    `File: ${ctx.file}`,
    `Diagnostic [${ctx.code}] (${ctx.severity}): ${ctx.message}`,
  ];
  if (ctx.hint) parts.push(`Compiler hint: ${ctx.hint}`);
  parts.push(`Location: line ${ctx.line}`, '', 'Code:', region);

  return { system, messages: [{ role: 'user', content: parts.join('\n') }] };
}

/** Parse the model's response into explanation + fixed code. */
export function parseFixResponse(raw: string, originalRegion: string): FixProposal {
  const normalized = raw.replace(/\r\n/g, '\n');

  // Extract explanation
  let explanation = '';
  const explMatch = normalized.match(/EXPLANATION:\s*([\s\S]*?)(?=\n```|\n\n```|$)/i);
  if (explMatch) {
    explanation = explMatch[1].trim();
  } else {
    // Fallback: take everything before the first code fence
    const fenceIdx = normalized.indexOf('```');
    if (fenceIdx > 0) {
      explanation = normalized.slice(0, fenceIdx).trim();
    } else {
      explanation = normalized.trim();
    }
  }

  // Extract fixed code
  let rewritten = originalRegion;
  const fenceMatch = normalized.match(/```[^\n]*\n([\s\S]*?)\n?```/);
  if (fenceMatch) {
    rewritten = fenceMatch[1];
  }

  // Strip line numbers the model may have echoed (e.g. "12 | code")
  rewritten = stripLineNumbers(rewritten);

  const diff = diffLines(stripLineNumbers(originalRegion), rewritten);
  let added = 0;
  let removed = 0;
  for (const line of diff) {
    if (line.type === 'add') added++;
    else if (line.type === 'del') removed++;
  }

  return { explanation, rewritten, diff, added, removed };
}

/** Strip `N | ` line-number prefixes from code (model may echo our numbered format). */
export function stripLineNumbers(code: string): string {
  const lines = code.split('\n');
  const numbered = lines.every((l) => !l.trim() || /^\s*\d+\s*\|/.test(l));
  if (!numbered) return code;
  return lines.map((l) => l.replace(/^\s*\d+\s*\|\s?/, '')).join('\n');
}

/** Extract the region of source around the diagnostic line. */
export function extractRegion(source: string, line1: number, radius = 5): string {
  const lines = source.split('\n');
  const start = Math.max(0, line1 - 1 - radius);
  const end = Math.min(lines.length, line1 + radius);
  return lines.slice(start, end).join('\n');
}

/** Apply a fix: replace the region around the diagnostic in the full source. */
export function applyFix(
  fullSource: string,
  line1: number,
  originalRegion: string,
  fixedRegion: string,
): string {
  const lines = fullSource.split('\n');
  const regionLines = originalRegion.split('\n');
  const start = Math.max(0, line1 - 1 - 5);
  const end = Math.min(start + regionLines.length, lines.length);
  const fixedLines = fixedRegion.split('\n');
  lines.splice(start, end - start, ...fixedLines);
  return lines.join('\n');
}

/** Format a fix proposal for display. */
export function summarizeFix(proposal: FixProposal): string {
  if (proposal.added === 0 && proposal.removed === 0) return 'No changes proposed.';
  return `+${proposal.added} −${proposal.removed} line${proposal.added + proposal.removed === 1 ? '' : 's'}`;
}
