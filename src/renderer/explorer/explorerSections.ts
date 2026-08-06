/**
 * Explorer sections — the pure model (UX-6).
 *
 * The Explorer sidebar stacks contributed sections (Open Editors, Outline,
 * Bookmarks) above the file tree, each collapsible with a remembered state.
 * Ordering and collapse persistence are pure and testable here; the DOM framing
 * lives in the module.
 */
export interface OrderedSection {
  id: string;
  order: number;
}

/** Sort by `order` (ascending), ties broken by id so the layout is stable. */
export function sortSections<T extends OrderedSection>(sections: T[]): T[] {
  return [...sections].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/** Persisted collapse map wins over the section's own default. */
export function isCollapsed(persisted: Record<string, boolean>, id: string, fallback = false): boolean {
  return Object.prototype.hasOwnProperty.call(persisted, id) ? persisted[id] : fallback;
}

/** Return a new map with `id` flipped to `collapsed`. */
export function setCollapsed(
  persisted: Record<string, boolean>,
  id: string,
  collapsed: boolean,
): Record<string, boolean> {
  return { ...persisted, [id]: collapsed };
}
