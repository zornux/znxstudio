/**
 * Panel management (Phase 17B) — the pure model.
 *
 * Every module contributes its views through `LayoutManager.addPanelView`, so
 * the panel's tab strip is whatever happened to activate first. This model gives
 * the user control of it: order the tabs, hide the ones they never use, and have
 * that survive a restart — without any module knowing.
 *
 * A hidden panel is HIDDEN, not unregistered: its module still owns it, still
 * updates it, and showing it again costs nothing. Nothing here can remove a view
 * a module registered, because the module would keep a dangling reference.
 */

export interface PanelDescriptor {
  id: string;
  title: string;
}

/**
 * The panels shown as tabs by default (UX-2). The bottom panel is a container:
 * only this small classic set shows up front; every other panel lives in the
 * searchable "+" overflow until the user opens it. Nothing is unregistered.
 */
export const DEFAULT_PANELS = ['terminal', 'diagnostics', 'output', 'debug', 'log'];

export interface PanelPreferences {
  /** Panel ids in the order the user wants their tabs. Unlisted ids keep registration order, after these. */
  order: string[];
  /** Default panels the user CLOSED (removed from the strip). */
  hidden: string[];
  /** Non-default panels the user OPENED (added to the strip). */
  opened?: string[];
  /** The last active tab, restored on load. */
  active?: string | null;
}

export const DEFAULT_PANEL_PREFERENCES: PanelPreferences = { order: [], hidden: [], opened: [], active: null };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/** Read preferences from untrusted JSON. Duplicates are collapsed; anything else is dropped. */
export function parsePanelPreferences(value: unknown): PanelPreferences {
  const root = asRecord(value);
  return {
    order: [...new Set(stringArray(root.order))],
    hidden: [...new Set(stringArray(root.hidden))],
    opened: [...new Set(stringArray(root.opened))],
    active: typeof root.active === 'string' ? root.active : null,
  };
}

/** True when a panel belongs in the tab strip: an un-closed default, or one the user opened. */
export function inStrip(preferences: PanelPreferences, id: string, defaults: string[] = DEFAULT_PANELS): boolean {
  return (preferences.opened ?? []).includes(id) || (defaults.includes(id) && !preferences.hidden.includes(id));
}

/** The tabs shown in the strip (curated default set + user-opened), in order. */
export function stripPanels(panels: PanelDescriptor[], preferences: PanelPreferences, defaults: string[] = DEFAULT_PANELS): PanelDescriptor[] {
  return orderPanels(panels, preferences).filter((panel) => inStrip(preferences, panel.id, defaults));
}

/** The panels NOT in the strip — reachable through the searchable "+" overflow. */
export function overflowPanels(panels: PanelDescriptor[], preferences: PanelPreferences, defaults: string[] = DEFAULT_PANELS): PanelDescriptor[] {
  return orderPanels(panels, preferences).filter((panel) => !inStrip(preferences, panel.id, defaults));
}

/** Open a panel into the strip (from the overflow). Idempotent. */
export function openPanel(preferences: PanelPreferences, id: string): PanelPreferences {
  return { ...preferences, opened: [...new Set([...(preferences.opened ?? []), id])], hidden: preferences.hidden.filter((h) => h !== id) };
}

/**
 * Close a panel's tab — back to the overflow. A default is recorded as closed; a
 * user-opened panel simply leaves the opened set. Clears `active` if it was this.
 */
export function closePanel(preferences: PanelPreferences, id: string, defaults: string[] = DEFAULT_PANELS): PanelPreferences {
  return {
    ...preferences,
    opened: (preferences.opened ?? []).filter((o) => o !== id),
    hidden: defaults.includes(id) ? [...new Set([...preferences.hidden, id])] : preferences.hidden,
    active: preferences.active === id ? null : preferences.active,
  };
}

/** Remember the last active tab. */
export function setActivePanel(preferences: PanelPreferences, id: string): PanelPreferences {
  return { ...preferences, active: id };
}

export function isHidden(preferences: PanelPreferences, id: string): boolean {
  return preferences.hidden.includes(id);
}

export function setHidden(preferences: PanelPreferences, id: string, hidden: boolean): PanelPreferences {
  const next = preferences.hidden.filter((entry) => entry !== id);
  if (hidden) next.push(id);
  return { ...preferences, hidden: next };
}

/**
 * The tab strip: preferred order first, then anything the user never ranked, in
 * the order its module registered it. A preference naming a panel that no longer
 * exists is ignored rather than leaving a hole.
 */
export function orderPanels(panels: PanelDescriptor[], preferences: PanelPreferences): PanelDescriptor[] {
  const byId = new Map(panels.map((panel) => [panel.id, panel]));
  const ordered: PanelDescriptor[] = [];

  for (const id of preferences.order) {
    const panel = byId.get(id);
    if (panel) {
      ordered.push(panel);
      byId.delete(id);
    }
  }
  return [...ordered, ...panels.filter((panel) => byId.has(panel.id))];
}

/** The panels actually shown as tabs. */
export function visiblePanels(panels: PanelDescriptor[], preferences: PanelPreferences): PanelDescriptor[] {
  return orderPanels(panels, preferences).filter((panel) => !isHidden(preferences, panel.id));
}

/**
 * Move a panel one place earlier or later in the tab strip. Ranks every panel on
 * first use, so a partial `order` list cannot make a move ambiguous.
 */
export function movePanel(panels: PanelDescriptor[], preferences: PanelPreferences, id: string, delta: number): PanelPreferences {
  const order = orderPanels(panels, preferences).map((panel) => panel.id);
  const index = order.indexOf(id);
  if (index < 0) return preferences;

  const target = index + delta;
  if (target < 0 || target >= order.length) return preferences;

  order.splice(index, 1);
  order.splice(target, 0, id);
  return { ...preferences, order };
}

/**
 * Which panel should be active. The caller's preference wins when it is still
 * visible; otherwise the first visible panel; otherwise none, because a panel
 * strip with every tab hidden has nothing to show.
 */
export function resolveActivePanel(panels: PanelDescriptor[], preferences: PanelPreferences, preferred: string | null): string | null {
  const visible = visiblePanels(panels, preferences);
  if (preferred && visible.some((panel) => panel.id === preferred)) return preferred;
  return visible[0]?.id ?? null;
}

/** Restore the default strip (classic set), registration order, no user opens/closes. */
export function resetPanelPreferences(): PanelPreferences {
  return { order: [], hidden: [], opened: [], active: null };
}
