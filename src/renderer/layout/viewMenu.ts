/**
 * View-menu model (UI/UX modernization, UX-3). The View menu is the central
 * launcher: every workspace and panel is reachable from it. This groups the
 * registered activity items into their workspaces so the menu reads as organized
 * sections rather than a flat wall of entries.
 *
 * Pure — no DOM — so the grouping is unit-testable; `LayoutModule` renders it.
 */

import { activityGroup, DEFAULT_ACTIVITY } from './activityBar';

const CORE = 'Core';

/** Group order in the View menu (Core first — the five defaults). */
const ORDER = [CORE, 'AI', 'Security', 'Performance', 'Testing', 'Database', 'Cloud', 'Documentation', 'Collaboration', 'Project', 'Other'];

export interface WorkspaceGroup {
  group: string;
  items: { id: string; label: string }[];
}

/** The five default workspaces group under "Core"; everything else by its workspace. */
export function workspaceGroupOf(id: string): string {
  return (DEFAULT_ACTIVITY as readonly string[]).includes(id) ? CORE : activityGroup(id);
}

/** Group activity items into ordered workspace sections for the View menu. */
export function groupWorkspaces(items: { id: string; label: string }[]): WorkspaceGroup[] {
  const byGroup = new Map<string, { id: string; label: string }[]>();
  for (const item of items) {
    const group = workspaceGroupOf(item.id);
    const bucket = byGroup.get(group);
    if (bucket) bucket.push(item);
    else byGroup.set(group, [item]);
  }
  const seen = [...byGroup.keys()];
  const ordered = [...ORDER.filter((g) => byGroup.has(g)), ...seen.filter((g) => !ORDER.includes(g)).sort()];
  return ordered.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}
