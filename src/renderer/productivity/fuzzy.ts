/**
 * Pure fuzzy matcher (Phase 7J). Subsequence matching with a score that rewards
 * consecutive hits, word/segment starts, and matches in the basename — enough to
 * make Quick Open feel right. No DOM. Returns matched character positions so the
 * UI can highlight them.
 */
export interface FuzzyMatch {
  score: number;
  /** 0-based indices in the target that matched, ascending. */
  positions: number[];
}

const SEPARATORS = new Set(['/', '\\', '.', '-', '_', ' ']);

/**
 * Match `query` against `target` as a case-insensitive subsequence. Returns null
 * if any query char can't be found in order. Higher score = better.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (query === '') return { score: 1, positions: [] };
  const q = query.toLowerCase();
  const t = target.toLowerCase();

  const positions: number[] = [];
  let score = 0;
  let ti = 0;
  let prevMatch = -2;

  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q[qi];
    let found = -1;
    for (let i = ti; i < t.length; i += 1) {
      if (t[i] === ch) {
        found = i;
        break;
      }
    }
    if (found === -1) return null;

    let bonus = 1;
    if (found === prevMatch + 1) bonus += 3; // consecutive run
    if (found === 0 || SEPARATORS.has(t[found - 1])) bonus += 4; // segment/word start
    score += bonus;
    positions.push(found);
    prevMatch = found;
    ti = found + 1;
  }

  // Prefer matches concentrated in the basename (after the last separator).
  const lastSep = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'));
  if (lastSep >= 0 && positions[0] > lastSep) score += 6;
  // Slight preference for shorter targets (tighter match).
  score += Math.max(0, 20 - target.length) * 0.1;

  return { score, positions };
}

/** Filter + rank items by fuzzy match against `key(item)`; best first. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  key: (item: T) => string,
): { item: T; match: FuzzyMatch }[] {
  const results: { item: T; match: FuzzyMatch }[] = [];
  for (const item of items) {
    const match = fuzzyMatch(query, key(item));
    if (match) results.push({ item, match });
  }
  results.sort((a, b) => b.match.score - a.match.score || key(a.item).length - key(b.item).length);
  return results;
}
