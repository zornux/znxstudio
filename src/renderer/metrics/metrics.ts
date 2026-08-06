/**
 * Pure code metrics (Phase 7I). Line counts, cyclomatic complexity, max nesting
 * and a maintainability heuristic, computed from source text with language-aware
 * comment/string/decision rules. Comments and string literals are stripped before
 * counting decisions so keywords in prose/strings don't inflate complexity. No
 * DOM / no Monaco.
 */
export type Rating = 'A' | 'B' | 'C' | 'D';

export interface FileMetrics {
  total: number;
  code: number;
  comment: number;
  blank: number;
  /** Cyclomatic complexity: 1 + decision points across the file. */
  cyclomatic: number;
  /** Deepest indentation level among code lines. */
  maxNesting: number;
  /** 0–100 heuristic (higher = more maintainable). */
  maintainability: number;
  rating: Rating;
}

interface MetricProfile {
  line: string[];
  block?: [string, string];
  strings: string[];
  decisions: RegExp[];
}

const ZORNUX_PROFILE: MetricProfile = {
  line: ['#'],
  strings: ['"'],
  decisions: [/\bif\b/g, /\bwhile\b/g, /\bfor\b/g, /\brepeat\b/g, /\band\b/g, /\bor\b/g],
};

const JS_PROFILE: MetricProfile = {
  line: ['//'],
  block: ['/*', '*/'],
  strings: ['"', "'", '`'],
  decisions: [/\bif\b/g, /\bfor\b/g, /\bwhile\b/g, /\bcase\b/g, /\bcatch\b/g, /&&/g, /\|\|/g, /\?\?/g],
};

const JS_LANGS = new Set(['javascript', 'typescript', 'javascriptreact', 'typescriptreact']);

function profileFor(languageId: string): MetricProfile {
  return languageId === 'zornux' ? ZORNUX_PROFILE : JS_PROFILE;
}

/** Split into lines, dropping a single trailing empty from a final newline. */
function toLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Classify each line as blank / comment / code (block-comment aware). */
export function classifyLines(text: string, profile: MetricProfile): {
  total: number;
  code: number;
  comment: number;
  blank: number;
} {
  let code = 0;
  let comment = 0;
  let blank = 0;
  let inBlock = false;
  const lines = toLines(text);

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (inBlock) {
      comment += 1;
      if (profile.block && trimmed.includes(profile.block[1])) inBlock = false;
      continue;
    }
    if (trimmed === '') {
      blank += 1;
      continue;
    }
    if (profile.line.some((token) => trimmed.startsWith(token))) {
      comment += 1;
      continue;
    }
    if (profile.block && trimmed.startsWith(profile.block[0])) {
      comment += 1;
      if (!trimmed.includes(profile.block[1], profile.block[0].length)) inBlock = true;
      continue;
    }
    code += 1;
  }
  return { total: lines.length, code, comment, blank };
}

/** Replace comments and string bodies with spaces (newlines kept) for counting. */
export function stripNonCode(text: string, profile: MetricProfile): string {
  let out = '';
  let i = 0;
  const n = text.length;
  let stringDelim = '';

  while (i < n) {
    const ch = text[i];
    if (stringDelim) {
      if (ch === '\\') {
        out += '  ';
        i += 2;
        continue;
      }
      if (ch === stringDelim) stringDelim = '';
      out += ch === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    const lineToken = profile.line.find((token) => text.startsWith(token, i));
    if (lineToken) {
      while (i < n && text[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (profile.block && text.startsWith(profile.block[0], i)) {
      const end = text.indexOf(profile.block[1], i + profile.block[0].length);
      const stop = end === -1 ? n : end + profile.block[1].length;
      for (let j = i; j < stop; j += 1) out += text[j] === '\n' ? '\n' : ' ';
      i = stop;
      continue;
    }
    if (profile.strings.includes(ch)) {
      stringDelim = ch;
      out += ' ';
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Cyclomatic complexity = 1 + decision points (counted on code-only text). */
export function cyclomaticComplexity(text: string, profile: MetricProfile): number {
  const code = stripNonCode(text, profile);
  let decisions = 0;
  for (const pattern of profile.decisions) {
    pattern.lastIndex = 0;
    decisions += (code.match(pattern) ?? []).length;
  }
  return 1 + decisions;
}

/** Deepest indentation level among code lines (tabs count as 4 columns). */
export function maxNesting(text: string, profile: MetricProfile): number {
  const columns: number[] = [];
  let inBlock = false;
  for (const raw of toLines(text)) {
    const trimmed = raw.trim();
    if (inBlock) {
      if (profile.block && trimmed.includes(profile.block[1])) inBlock = false;
      continue;
    }
    if (trimmed === '') continue;
    if (profile.line.some((token) => trimmed.startsWith(token))) continue;
    if (profile.block && trimmed.startsWith(profile.block[0])) {
      if (!trimmed.includes(profile.block[1], profile.block[0].length)) inBlock = true;
      continue;
    }
    let column = 0;
    for (const ch of raw) {
      if (ch === ' ') column += 1;
      else if (ch === '\t') column += 4;
      else break;
    }
    columns.push(column);
  }
  const positive = columns.filter((c) => c > 0);
  if (positive.length === 0) return 0;
  const unit = Math.min(...positive);
  return Math.max(...columns.map((c) => Math.round(c / unit)));
}

function ratingFor(maintainability: number): Rating {
  if (maintainability >= 80) return 'A';
  if (maintainability >= 60) return 'B';
  if (maintainability >= 40) return 'C';
  return 'D';
}

/** Whole-file metrics for the given language. */
export function computeMetrics(text: string, languageId: string): FileMetrics {
  const profile = profileFor(languageId);
  const { total, code, comment, blank } = classifyLines(text, profile);
  const cyclomatic = cyclomaticComplexity(text, profile);
  const nesting = maxNesting(text, profile);

  // Penalise complexity ABOVE the baseline of 1, deep nesting, and large size.
  const penalty = (cyclomatic - 1) * 1.5 + nesting * 4 + Math.max(0, code - 40) * 0.3;
  const maintainability = Math.max(0, Math.min(100, Math.round(100 - penalty)));

  return {
    total,
    code,
    comment,
    blank,
    cyclomatic,
    maxNesting: nesting,
    maintainability,
    rating: ratingFor(maintainability),
  };
}
