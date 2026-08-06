/**
 * Levelled logging (Phase 19D).
 *
 * ZnxStudio logs to a file on the user's disk and offers a one-click "copy
 * diagnostics" report. Both are things people paste into bug trackers, so the
 * only interesting question this module answers is: **what must never appear in
 * a log line?**
 *
 * Two answers, and `redact` enforces both:
 *
 *  1. **Secrets.** Registry tokens, `Authorization: Bearer …`, AI provider API
 *     keys, `password=…`. ZnxStudio handles all of these (`zornux login --token`,
 *     `AiService`, `configuration … as secret`). A log that echoes one turns a
 *     support paste into a credential leak.
 *  2. **The user's home directory.** `C:\Users\jane\…` names a person. It is
 *     rewritten to `~`, which loses nothing a maintainer needs.
 *
 * Redaction happens once, at record time, before anything reaches the ring
 * buffer or the disk. Redacting at render time would leave the secret sitting
 * in memory in a buffer the diagnostics report also reads.
 */

export const LOG_LEVELS = ['trace', 'debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogRecord {
  /** Milliseconds since the epoch. Injected — this module never reads a clock. */
  time: number;
  level: LogLevel;
  /** The subsystem: a module id, a service name. */
  source: string;
  message: string;
}

export const REDACTED = '«redacted»';

/** Levels at or above the threshold are kept. */
export function shouldLog(level: LogLevel, threshold: LogLevel): boolean {
  return LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

export function parseLogLevel(value: unknown, fallback: LogLevel = 'info'): LogLevel {
  const text = String(value ?? '').toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(text) ? (text as LogLevel) : fallback;
}

/**
 * Patterns that mark a secret. Each captures the NAME and replaces only the
 * value, so a redacted line still says which credential was involved — that is
 * usually the fact a maintainer needs.
 */
const SECRET_PATTERNS: { pattern: RegExp; replace: (match: string, ...groups: string[]) => string }[] = [
  // `Authorization: Bearer eyJ…` and a bare `Bearer eyJ…`.
  { pattern: /\bBearer\s+[\w.~+/=-]{8,}/gi, replace: () => `Bearer ${REDACTED}` },
  // `--token abc`, `--token=abc`.
  { pattern: /(--token[=\s]+)(\S+)/gi, replace: (_m, prefix) => `${prefix}${REDACTED}` },
  // `token: abc`, `apiKey="abc"`, `password=abc`, `secret = abc`.
  {
    pattern: /\b(api[_-]?key|apikey|access[_-]?token|token|password|passwd|secret|client[_-]?secret)\b(\s*[:=]\s*)"?([^"\s,;}]{4,})"?/gi,
    replace: (_m, name, separator) => `${name}${separator}${REDACTED}`,
  },
  // Environment variables that are credentials by definition.
  { pattern: /\b(ZORNUX_REGISTRY_TOKEN|ANTHROPIC_API_KEY|OPENAI_API_KEY|GOOGLE_API_KEY|AZURE_OPENAI_API_KEY)=(\S+)/g, replace: (_m, name) => `${name}=${REDACTED}` },
  // Recognisable key shapes, even unlabelled: `sk-…`, `ghp_…`, `github_pat_…`.
  { pattern: /\bsk-[A-Za-z0-9_-]{16,}/g, replace: () => REDACTED },
  { pattern: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, replace: () => REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g, replace: () => REDACTED },
];

/**
 * Strip secrets, then the user's home directory. `homeDir` is passed in rather
 * than discovered so this stays pure and testable.
 */
export function redact(text: string, homeDir = ''): string {
  let result = text;
  for (const { pattern, replace } of SECRET_PATTERNS) {
    // `replace` is typed loosely because each pattern captures different groups.
    result = result.replace(pattern, replace as (substring: string, ...args: unknown[]) => string);
  }
  return homeDir ? replaceHome(result, homeDir) : result;
}

/**
 * Rewrite the home directory to `~`, case-insensitively and for both separator
 * styles — Windows paths reach the log as `C:\Users\jane` and as `C:/Users/jane`.
 */
function replaceHome(text: string, homeDir: string): string {
  const trimmed = homeDir.replace(/[\\/]+$/, '');
  if (!trimmed) return text;
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\\|\//g, '[\\\\/]');
  return text.replace(new RegExp(escaped, 'gi'), '~');
}

/** `]` would break the bracketed log format `parseRecord` reads back. */
function safeSource(source: string): string {
  return source.replace(/[[\]]/g, '').trim() || 'unknown';
}

export function makeRecord(level: LogLevel, source: string, message: string, time: number, homeDir = ''): LogRecord {
  return { time, level, source: safeSource(source), message: redact(message, homeDir) };
}

/**
 * `2026-07-10T01:36:37.272Z [warn] [compiler] message` — sortable, greppable,
 * and unambiguous to read back: the delimiters are brackets, so a message
 * containing spaces (all of them do) cannot be mistaken for another field. A
 * newline inside a message would split the record, so it is escaped.
 */
export function formatRecord(record: LogRecord): string {
  const stamp = new Date(record.time).toISOString();
  const message = record.message.replace(/\r?\n/g, '\\n');
  return `${stamp} [${record.level}] [${safeSource(record.source)}] ${message}`;
}

/** Parse a line back. Returns null for a line this did not write. */
export function parseRecord(line: string): LogRecord | null {
  const match = /^(\S+) \[(\w+)\] \[([^\]]*)\] ([\s\S]*)$/.exec(line);
  if (!match) return null;
  const time = Date.parse(match[1]);
  if (Number.isNaN(time)) return null;
  const level = match[2].toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(level)) return null;
  return { time, level: level as LogLevel, source: match[3], message: match[4].replace(/\\n/g, '\n') };
}

/**
 * A bounded in-memory log. The IDE runs for days; an unbounded array is a slow
 * memory leak that only shows up in the sessions you most want a log from.
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('A ring buffer needs room for at least one item.');
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  /** Oldest first. */
  all(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items.length = 0;
  }
}

export interface LogFilter {
  level?: LogLevel;
  source?: string;
  /** Case-insensitive substring of the message. */
  text?: string;
}

export function filterRecords(records: LogRecord[], filter: LogFilter): LogRecord[] {
  const needle = filter.text?.trim().toLowerCase();
  return records.filter((record) => {
    if (filter.level && !shouldLog(record.level, filter.level)) return false;
    if (filter.source && record.source !== filter.source) return false;
    if (needle && !record.message.toLowerCase().includes(needle)) return false;
    return true;
  });
}

export function countByLevel(records: LogRecord[]): Record<LogLevel, number> {
  const counts = { trace: 0, debug: 0, info: 0, warn: 0, error: 0 };
  for (const record of records) counts[record.level] += 1;
  return counts;
}

/** Distinct sources, sorted, for a filter dropdown. */
export function logSources(records: LogRecord[]): string[] {
  return [...new Set(records.map((record) => record.source))].sort();
}
