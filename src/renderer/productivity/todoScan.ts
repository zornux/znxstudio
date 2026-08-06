/**
 * Pure task-comment (TODO) parsing (Phase 7J). The workspace scan reuses the 7A
 * text search with the tag regex below; this parses each matching line into a
 * tag + message. No DOM.
 */
export const TASK_TAGS = ['TODO', 'FIXME', 'HACK', 'XXX', 'BUG', 'NOTE'] as const;
export type TaskTag = (typeof TASK_TAGS)[number];

/** Regex source (for `search.text` with isRegex) matching a tag inside a comment. */
export const TASK_TAG_REGEX = `\\b(${TASK_TAGS.join('|')})\\b`;

export interface TaskComment {
  tag: TaskTag;
  message: string;
}

const LINE_RE = new RegExp(`\\b(${TASK_TAGS.join('|')})\\b[:\\s-]*(.*)$`);
/** A comment marker must appear before the tag (#, //, /*, <!--, or a JSDoc *). */
const COMMENT_MARKER = /#|\/\/|\/\*|<!--|\*/;

/**
 * Parse a line into its task tag + trailing message, or null when the line
 * carries no tag inside a comment. Requiring a comment marker before the tag
 * keeps `"TODO"` in a string/identifier from being reported — best-effort.
 */
export function parseTaskTag(line: string): TaskComment | null {
  const match = LINE_RE.exec(line);
  if (!match) return null;
  const tag = match[1] as TaskTag;
  const before = line.slice(0, line.indexOf(tag, match.index));
  if (!COMMENT_MARKER.test(before)) return null;
  const message = match[2].replace(/\*\/\s*$/, '').trim();
  return { tag, message };
}
