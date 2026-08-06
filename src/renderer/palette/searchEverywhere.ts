/**
 * Search Everywhere — the pure model (UX-4).
 *
 * IntelliJ-style universal search: one box that reaches commands, files,
 * symbols, settings and views (workspaces). This file is DOM-free — it parses a
 * query into a scope, ranks candidates with the shared fuzzy matcher, and groups
 * the hits into ordered sections. The module supplies real candidates and turns
 * the ranked hits into an overlay; everything decision-making lives here so it is
 * testable without a keyboard.
 */
import { fuzzyFilter } from '../productivity/fuzzy';

export type ResultCategory = 'commands' | 'files' | 'symbols' | 'settings' | 'views';

/** A searchable thing, category-tagged. Pure data — the action lives in the module. */
export interface SearchCandidate {
  category: ResultCategory;
  /** Unique within its category; the module maps it back to an action. */
  id: string;
  label: string;
  detail?: string;
  /** Extra text folded into the match key (command id, setting key, file path). */
  keywords?: string;
}

export interface RankedHit extends SearchCandidate {
  score: number;
}

export type SearchScope = ResultCategory | 'all';

/**
 * Leading sigils scope a raw query to one category — the VS Code muscle memory
 * (`>` command, `@` symbol) plus `#` for settings. Files have no sigil (they are
 * the default target), and views ride along in the unscoped 'all' search.
 */
export const SCOPE_SIGILS: Record<string, ResultCategory> = {
  '>': 'commands',
  '@': 'symbols',
  '#': 'settings',
};

/** The sigil that scopes to a category, for the tab UI to prefill. */
export const CATEGORY_SIGIL: Partial<Record<ResultCategory, string>> = {
  commands: '>',
  symbols: '@',
  settings: '#',
};

/** Fixed section order so results never reshuffle between keystrokes. */
export const CATEGORY_ORDER: ResultCategory[] = ['commands', 'files', 'symbols', 'settings', 'views'];

export const CATEGORY_LABEL: Record<ResultCategory, string> = {
  commands: 'Commands',
  files: 'Files',
  symbols: 'Symbols',
  settings: 'Settings',
  views: 'Views',
};

export interface ParsedQuery {
  scope: SearchScope;
  term: string;
}

/**
 * Split a raw query into a scope + term. A leading sigil wins and scopes to its
 * category; otherwise the `explicit` scope (from a category tab) applies, or
 * 'all' when the user hasn't picked one. The term is trimmed so trailing spaces
 * from a sigil (`> build`) don't defeat the match.
 */
export function parseQuery(raw: string, explicit: SearchScope = 'all'): ParsedQuery {
  const text = raw ?? '';
  const sigil = text[0];
  if (sigil && Object.prototype.hasOwnProperty.call(SCOPE_SIGILS, sigil)) {
    return { scope: SCOPE_SIGILS[sigil], term: text.slice(1).trim() };
  }
  return { scope: explicit, term: text.trim() };
}

function matchKey(candidate: SearchCandidate): string {
  return candidate.keywords ? `${candidate.label} ${candidate.keywords}` : candidate.label;
}

/**
 * Rank candidates against the term, best first. An empty term keeps the input
 * order (score 0) so a freshly-opened category shows its natural list rather than
 * nothing — the model never hides a feature just because the user hasn't typed.
 */
export function rankCandidates(term: string, candidates: SearchCandidate[]): RankedHit[] {
  if (!term) return candidates.map((candidate) => ({ ...candidate, score: 0 }));
  return fuzzyFilter(term, candidates, matchKey).map((result) => ({
    ...result.item,
    score: result.match.score,
  }));
}

export interface CategoryGroup {
  category: ResultCategory;
  label: string;
  hits: RankedHit[];
}

/**
 * Bucket ranked hits into ordered sections, capping each so no single category
 * (files, typically) floods the others out of view. Empty sections are dropped.
 * Within a section the incoming score order is preserved.
 */
export function groupHits(hits: RankedHit[], perCategory = 8): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const inCategory = hits.filter((hit) => hit.category === category);
    if (!inCategory.length) continue;
    groups.push({ category, label: CATEGORY_LABEL[category], hits: inCategory.slice(0, perCategory) });
  }
  return groups;
}

/** Flatten grouped hits into the top-to-bottom keyboard-navigation order. */
export function flattenGroups(groups: CategoryGroup[]): RankedHit[] {
  return groups.flatMap((group) => group.hits);
}

/**
 * The full pipeline: from a raw query + the candidate pool to ordered sections.
 * When a scope is active (sigil or tab) only that category is searched; 'all'
 * searches everything and lets `groupHits` fan it back out into sections.
 */
export function searchEverywhere(
  raw: string,
  candidates: SearchCandidate[],
  explicit: SearchScope = 'all',
  perCategory = 8,
): { parsed: ParsedQuery; groups: CategoryGroup[] } {
  const parsed = parseQuery(raw, explicit);
  const pool =
    parsed.scope === 'all' ? candidates : candidates.filter((candidate) => candidate.category === parsed.scope);
  const ranked = rankCandidates(parsed.term, pool);
  const perGroup = parsed.scope === 'all' ? perCategory : Math.max(perCategory, 50);
  return { parsed, groups: groupHits(ranked, perGroup) };
}
