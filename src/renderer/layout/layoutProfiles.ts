/**
 * Layout profiles (Phase 17F) — the pure model.
 *
 * A profile bundles everything Phase 17 made configurable: the workbench layout
 * (17A), the panel tab strip (17B) and the user's keybinding overrides (17D).
 * Switching profile applies all three at once, so "Debugging", "Writing" and
 * "Review" are one click apart rather than nine settings apart.
 *
 * Profiles are pure VALUES. Applying one is the caller's job; this module only
 * decides what a profile is, validates one read from disk, and answers whether
 * the live configuration still matches the profile it was loaded from — which is
 * what lets the UI say "modified" instead of quietly discarding a user's tweaks.
 */

import { DEFAULT_LAYOUT, layoutsEqual, parseLayout, type LayoutState } from './layoutModel';
import { DEFAULT_PANEL_PREFERENCES, parsePanelPreferences, type PanelPreferences } from './panels';
import { parseUserKeybindings, renderUserKeybindings, type Keybinding, type UserKeybindings } from '../keybindings/keybindings';

export interface LayoutProfile {
  name: string;
  layout: LayoutState;
  panels: PanelPreferences;
  keybindings: UserKeybindings;
  /** True for the profiles ZnxStudio ships; they can be applied but not deleted. */
  builtIn: boolean;
}

/** The configuration a profile captures, as it currently is. */
export interface WorkbenchConfiguration {
  layout: LayoutState;
  panels: PanelPreferences;
  keybindings: Keybinding[];
}

/**
 * Three shipped profiles. Each states its intent in the arrangement rather than
 * in a comment: Focus hides everything but the code; Debugging gives the panel
 * room and puts the sidebar out of the way of a stack trace; Default is default.
 */
export const BUILT_IN_PROFILES: LayoutProfile[] = [
  {
    name: 'Default',
    layout: DEFAULT_LAYOUT,
    panels: DEFAULT_PANEL_PREFERENCES,
    keybindings: {},
    builtIn: true,
  },
  {
    name: 'Focus',
    layout: {
      sidebar: { side: 'left', visible: false, width: 260 },
      panel: { position: 'bottom', visible: false, height: 240, width: 380, maximized: false },
      statusBarVisible: false,
      activityBarVisible: false,
    },
    panels: DEFAULT_PANEL_PREFERENCES,
    keybindings: {},
    builtIn: true,
  },
  {
    name: 'Debugging',
    layout: {
      sidebar: { side: 'left', visible: true, width: 220 },
      panel: { position: 'bottom', visible: true, height: 420, width: 380, maximized: false },
      statusBarVisible: true,
      activityBarVisible: true,
    },
    panels: { order: ['debug', 'problems', 'output', 'terminal'], hidden: [] },
    keybindings: {},
    builtIn: true,
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Read a profile from untrusted JSON. An unnamed profile is not a profile. */
export function parseProfile(value: unknown): LayoutProfile | null {
  const root = asRecord(value);
  if (typeof root.name !== 'string' || !root.name.trim()) return null;

  const keybindings: UserKeybindings = {};
  // Round-trip through the parser so a malformed key never reaches the model.
  for (const binding of parseUserKeybindings(root.keybindings)) {
    Object.assign(keybindings, renderUserKeybindings([binding]));
  }

  return {
    name: root.name.trim(),
    layout: parseLayout(root.layout),
    panels: parsePanelPreferences(root.panels),
    keybindings,
    // A stored profile is never built-in: the built-ins are code, not data.
    builtIn: false,
  };
}

export function parseProfiles(value: unknown): LayoutProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: LayoutProfile[] = [];
  for (const entry of value) {
    const profile = parseProfile(entry);
    if (profile && !BUILT_IN_PROFILES.some((builtIn) => builtIn.name === profile.name)) profiles.push(profile);
  }
  return profiles;
}

/** Every profile a user can pick: the shipped ones first, then their own. */
export function allProfiles(stored: LayoutProfile[]): LayoutProfile[] {
  return [...BUILT_IN_PROFILES, ...stored];
}

export function findProfile(profiles: LayoutProfile[], name: string): LayoutProfile | undefined {
  return profiles.find((profile) => profile.name === name);
}

/** Capture the live configuration as a named profile. */
export function captureProfile(name: string, configuration: WorkbenchConfiguration): LayoutProfile {
  return {
    name: name.trim() || 'Untitled',
    layout: configuration.layout,
    panels: configuration.panels,
    keybindings: renderUserKeybindings(configuration.keybindings),
    builtIn: false,
  };
}

/** Add or replace a stored profile. A built-in name can never be shadowed. */
export function upsertProfile(stored: LayoutProfile[], profile: LayoutProfile): LayoutProfile[] {
  if (BUILT_IN_PROFILES.some((builtIn) => builtIn.name === profile.name)) return stored;
  const others = stored.filter((existing) => existing.name !== profile.name);
  return [...others, { ...profile, builtIn: false }].sort((a, b) => a.name.localeCompare(b.name));
}

/** A built-in profile cannot be deleted; asking to is a no-op, not an error. */
export function removeProfile(stored: LayoutProfile[], name: string): LayoutProfile[] {
  return stored.filter((profile) => profile.name !== name);
}

/**
 * True when the live configuration still matches the profile. Keybindings are
 * compared canonically, so a differently-spelled but identical override does not
 * read as a change.
 */
export function matchesProfile(profile: LayoutProfile, configuration: WorkbenchConfiguration): boolean {
  if (!layoutsEqual(profile.layout, configuration.layout)) return false;
  if (JSON.stringify(profile.panels) !== JSON.stringify(configuration.panels)) return false;
  return JSON.stringify(sortKeys(profile.keybindings)) === JSON.stringify(sortKeys(renderUserKeybindings(configuration.keybindings)));
}

function sortKeys(record: UserKeybindings): UserKeybindings {
  const sorted: UserKeybindings = {};
  for (const key of Object.keys(record).sort()) sorted[key] = record[key];
  return sorted;
}
