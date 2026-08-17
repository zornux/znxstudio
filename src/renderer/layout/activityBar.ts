/**
 * Activity Bar curation (UI/UX modernization, UX-1). The workbench registers
 * every workspace as an activity item, but only a small default set shows in the
 * bar; the rest live in a grouped "More" overflow and can be pinned back. This
 * keeps the bar focused (the editor stays dominant) while every feature remains
 * one click away — nothing is removed, only organized.
 *
 * Pure — no DOM — so the curation is unit-testable; `LayoutManager` renders it.
 */

/** The core developer workspaces shown in the Activity Bar by default. */
export const DEFAULT_ACTIVITY = ['explorer', 'search', 'scm', 'run-debug', 'testing', 'extensions', 'ai-chat'] as const;

/**
 * Which logical WORKSPACE each non-default activity item belongs to, so the
 * overflow reads as organized groups rather than a flat list. Unmapped ids fall
 * to 'Other'.
 */
export const ACTIVITY_GROUP: Record<string, string> = {
  'ai-chat': 'AI',
  security: 'Security',
  performance: 'Performance',
  testing: 'Testing',
  database: 'Database',
  deploy: 'Cloud',
  learning: 'Documentation',
  exercises: 'Documentation',
  collab: 'Collaboration',
  packages: 'Project',
  solution: 'Project',
  profiles: 'Project',
  android: 'Mobile',
  'znxstudio.designer': 'Mobile',
};

/** Group display order in the overflow menu. */
export const GROUP_ORDER = [
  'AI',
  'Security',
  'Performance',
  'Testing',
  'Database',
  'Cloud',
  'Documentation',
  'Collaboration',
  'Project',
  'Other',
] as const;

export function activityGroup(id: string): string {
  return ACTIVITY_GROUP[id] ?? 'Other';
}

/** Persisted curation: the user's pinned order and hidden set. */
export interface ActivityCuration {
  /** Ordered ids shown in the bar. Empty means "use the defaults". */
  pinned: string[];
  /** Ids the user hid entirely (still reachable via the Manage list / View menu). */
  hidden: string[];
}

export const EMPTY_CURATION: ActivityCuration = { pinned: [], hidden: [] };

export interface ActivityLayout {
  /** Ids to render in the bar, in order. */
  pinned: string[];
  /** Overflow items grouped by workspace, in `GROUP_ORDER`. */
  overflow: { group: string; ids: string[] }[];
  /** Hidden ids that are registered (for a Manage/unhide affordance). */
  hidden: string[];
}

/**
 * Compute what the Activity Bar shows from the registered items + the user's
 * curation. Pinned items come first (user order, or the defaults when the user
 * hasn't customized); everything else that isn't hidden is grouped into the
 * overflow. Only registered ids appear — a stale preference for a removed item
 * is ignored.
 */
export function curateActivityBar(
  registered: string[],
  curation: ActivityCuration,
  defaults: readonly string[] = DEFAULT_ACTIVITY,
): ActivityLayout {
  const isRegistered = (id: string): boolean => registered.includes(id);
  const hidden = curation.hidden.filter(isRegistered);
  const isHidden = (id: string): boolean => hidden.includes(id);

  const source = curation.pinned.length > 0 ? curation.pinned : defaults;
  const pinned: string[] = [];
  for (const id of source) {
    if (isRegistered(id) && !isHidden(id) && !pinned.includes(id)) pinned.push(id);
  }

  const overflowIds = registered.filter((id) => !pinned.includes(id) && !isHidden(id));
  const byGroup = new Map<string, string[]>();
  for (const id of overflowIds) {
    const group = activityGroup(id);
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(id);
    else byGroup.set(group, [id]);
  }

  const groupsSeen = [...byGroup.keys()];
  const ordered = [
    ...GROUP_ORDER.filter((g) => byGroup.has(g)),
    ...groupsSeen.filter((g) => !GROUP_ORDER.includes(g as (typeof GROUP_ORDER)[number])).sort(),
  ];
  const overflow = ordered.map((group) => ({ group, ids: byGroup.get(group) ?? [] }));

  return { pinned, overflow, hidden };
}

/* ----- pure curation transitions (persisted by the caller) ----- */

export function pinItem(curation: ActivityCuration, id: string): ActivityCuration {
  const pinned = currentPinned(curation);
  const next = pinned.includes(id) ? pinned : [...pinned, id];
  return { pinned: next, hidden: curation.hidden.filter((h) => h !== id) };
}

export function unpinItem(curation: ActivityCuration, id: string): ActivityCuration {
  return { pinned: currentPinned(curation).filter((p) => p !== id), hidden: curation.hidden };
}

export function hideItem(curation: ActivityCuration, id: string): ActivityCuration {
  return {
    pinned: currentPinned(curation).filter((p) => p !== id),
    hidden: curation.hidden.includes(id) ? curation.hidden : [...curation.hidden, id],
  };
}

export function unhideItem(curation: ActivityCuration, id: string): ActivityCuration {
  return { pinned: curation.pinned, hidden: curation.hidden.filter((h) => h !== id) };
}

/** Move a pinned item one slot toward the top (-1) or bottom (+1). */
export function movePinned(curation: ActivityCuration, id: string, delta: -1 | 1): ActivityCuration {
  const pinned = currentPinned(curation);
  const index = pinned.indexOf(id);
  if (index < 0) return curation;
  const target = index + delta;
  if (target < 0 || target >= pinned.length) return curation;
  const next = [...pinned];
  [next[index], next[target]] = [next[target], next[index]];
  return { pinned: next, hidden: curation.hidden };
}

/** Materialize the effective pinned order (defaults when the user hasn't customized). */
function currentPinned(curation: ActivityCuration): string[] {
  return curation.pinned.length > 0 ? [...curation.pinned] : [...DEFAULT_ACTIVITY];
}
