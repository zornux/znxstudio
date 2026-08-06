import type { AiMessage } from '../../shared/ai/providers';

/**
 * Pure helpers for inline AI completion (Phase 10B). The Monaco provider is a
 * thin shell around these: split the buffer at the cursor, ask the model to
 * continue, then clean the model's reply into raw insertable text. Kept pure so
 * the prompt framing and (fiddly) output cleanup are unit-tested without Monaco.
 */

const MAX_PREFIX = 2000;
const MAX_SUFFIX = 800;
const MAX_LINES = 40;

export interface CompletionWindow {
  prefix: string;
  suffix: string;
}

/** Bound the code on each side of the cursor so requests stay small. */
export function completionWindow(
  text: string,
  offset: number,
  maxPrefix = MAX_PREFIX,
  maxSuffix = MAX_SUFFIX,
): CompletionWindow {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const prefix = text.slice(Math.max(0, clamped - maxPrefix), clamped);
  const suffix = text.slice(clamped, clamped + maxSuffix);
  return { prefix, suffix };
}

/**
 * Whether a completion is worth requesting at this cursor. Skips empty prefixes
 * and positions in the middle of a word (the user is still typing an identifier
 * — a snippet/IntelliSense completion is a better fit there).
 */
export function shouldComplete(window: CompletionWindow): boolean {
  if (!window.prefix.trim()) return false;
  const lastChar = window.prefix.slice(-1);
  const nextChar = window.suffix.slice(0, 1);
  // Mid-identifier (letter on both sides) → let word-completion handle it.
  if (/[A-Za-z0-9_]/.test(lastChar) && /[A-Za-z0-9_]/.test(nextChar)) return false;
  return true;
}

/** Build the fill-in-the-middle prompt for a provider-agnostic completion. */
export function buildCompletionMessages(
  window: CompletionWindow,
  fileName: string | null,
): { system: string; messages: AiMessage[] } {
  const system = [
    'You are an inline code completion engine inside the ZnxStudio IDE for the Zornux language (.zx) and Zoijs.',
    'Continue the code at the <CURSOR> marker.',
    'Return ONLY the raw code that should be inserted at the cursor — no explanation, no Markdown code fences, no repetition of the code before the cursor.',
    'Keep it short: complete the current line or a small block. Match the surrounding indentation and style.',
  ].join('\n');
  const where = fileName ? `File: ${fileName}\n` : '';
  const user = `${where}Complete at <CURSOR>:\n\n${window.prefix}<CURSOR>${window.suffix}`;
  return { system, messages: [{ role: 'user', content: user }] };
}

/** Strip a Markdown code fence the model may have wrapped the code in. */
function stripFences(text: string): string {
  const fence = text.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
  return fence ? fence[1] : text;
}

/**
 * Remove any overlap where the model echoed the end of the prefix. Finds the
 * largest k such that the prefix ends with the completion's first k chars.
 */
export function stripPrefixOverlap(prefix: string, completion: string): string {
  const max = Math.min(prefix.length, completion.length);
  for (let k = max; k > 0; k--) {
    if (prefix.endsWith(completion.slice(0, k))) return completion.slice(k);
  }
  return completion;
}

/**
 * Turn a raw model reply into insertable ghost text: unwrap fences, drop echoed
 * prefix, cap the number of lines, and strip trailing whitespace. Returns '' if
 * nothing usable remains.
 */
export function cleanCompletion(raw: string, prefix: string, maxLines = MAX_LINES): string {
  let text = stripFences(raw.replace(/\r\n/g, '\n'));
  text = stripPrefixOverlap(prefix, text);
  // A leading newline is usually the model starting a fresh line the user isn't on.
  text = text.replace(/^\n+/, (m) => (prefix.endsWith('\n') ? '' : m));
  const lines = text.split('\n');
  if (lines.length > maxLines) text = lines.slice(0, maxLines).join('\n');
  return text.replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
}
