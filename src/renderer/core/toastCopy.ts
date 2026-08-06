/**
 * Toast copy convention (WS30).
 *
 * Notifications should read as complete sentences with one consistent terminal
 * mark. Before this, success/state toasts ended in a period ("Analysis copied.")
 * while error toasts did not ("Review failed: <reason>") and one carried a stray
 * emoji — three conventions at once. Normalizing at the sink (LayoutManager) gives
 * every toast the same shape without editing dozens of call sites:
 *
 *  - surrounding whitespace is trimmed;
 *  - a message already ending in sentence punctuation (`.` `!` `?` `…`) or a label
 *    colon (`:`) is left as-is;
 *  - otherwise a single period is appended.
 *
 * Tone is carried by the severity icon, not by punctuation or emoji, so this
 * function deliberately does not add or strip symbols beyond the terminal period.
 */

/** Characters that already terminate a toast; a trailing `:` is a label, left alone. */
const TERMINAL = new Set(['.', '!', '?', '…', ':']);

export function normalizeToastMessage(message: string): string {
  const text = message.trim();
  if (text.length === 0) return text;
  const last = text[text.length - 1] ?? '';
  return TERMINAL.has(last) ? text : `${text}.`;
}
