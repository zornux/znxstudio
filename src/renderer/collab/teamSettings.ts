/**
 * Team settings (Phase 16D). A `znxstudio.team.json` committed to the repository
 * gives everyone on a project the same defaults, without silently overriding
 * the preferences people set for themselves.
 *
 * The precedence rule is the whole design, and it is deliberately boring:
 *
 *   locked team setting  >  user setting  >  team default  >  built-in default
 *
 * A team DEFAULT is a suggestion: it applies until someone sets that key
 * themselves. A LOCKED setting is a requirement: it always wins, and the UI says
 * so rather than letting a user edit a value that will not take effect.
 *
 * Every resolved value carries its origin, so the settings UI can explain
 * where a value came from instead of leaving a user to guess.
 */

export type SettingOrigin = 'locked' | 'user' | 'team' | 'default';

export interface TeamSettings {
  /** Human name of the team or project, for the UI. */
  name: string;
  /** Applied unless the user has set the key themselves. */
  defaults: Record<string, unknown>;
  /** Always applied; a user cannot override these. */
  locked: Record<string, unknown>;
  /** Free-text note shown to anyone who opens the workspace. */
  notice?: string;
}

export const EMPTY_TEAM_SETTINGS: TeamSettings = { name: '', defaults: {}, locked: {} };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Parse `znxstudio.team.json`. Malformed input yields empty settings rather than a
 * throw — a broken team file must not stop the IDE from opening the project.
 * A key that appears in both `locked` and `defaults` is locked: the stricter
 * reading is the safe one.
 */
export function parseTeamSettings(text: string): TeamSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_TEAM_SETTINGS;
  }
  const root = asRecord(raw);
  const locked = asRecord(root.locked);
  const defaults = { ...asRecord(root.defaults) };
  for (const key of Object.keys(locked)) delete defaults[key];

  return {
    name: typeof root.name === 'string' ? root.name : '',
    defaults,
    locked,
    notice: typeof root.notice === 'string' ? root.notice : undefined,
  };
}

export function renderTeamSettings(settings: TeamSettings): string {
  const body: Record<string, unknown> = { name: settings.name };
  if (settings.notice) body.notice = settings.notice;
  if (Object.keys(settings.defaults).length) body.defaults = settings.defaults;
  if (Object.keys(settings.locked).length) body.locked = settings.locked;
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** True when the team has locked this key, so a user edit would not take effect. */
export function isLocked(settings: TeamSettings, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(settings.locked, key);
}

export interface ResolvedSetting {
  key: string;
  value: unknown;
  origin: SettingOrigin;
  /** The value the user chose, when it is being overridden by a lock. */
  overriddenUserValue?: unknown;
}

/** Resolve one key against the precedence rule, reporting where the value came from. */
export function resolveSetting(
  key: string,
  user: Record<string, unknown>,
  team: TeamSettings,
  builtInDefault?: unknown,
): ResolvedSetting {
  const userHasIt = Object.prototype.hasOwnProperty.call(user, key);

  if (isLocked(team, key)) {
    return {
      key,
      value: team.locked[key],
      origin: 'locked',
      ...(userHasIt && user[key] !== team.locked[key] ? { overriddenUserValue: user[key] } : {}),
    };
  }
  if (userHasIt) return { key, value: user[key], origin: 'user' };
  if (Object.prototype.hasOwnProperty.call(team.defaults, key)) return { key, value: team.defaults[key], origin: 'team' };
  return { key, value: builtInDefault, origin: 'default' };
}

/**
 * The effective settings: every key either side mentions, resolved. This is what
 * the IDE should actually apply.
 */
export function mergeSettings(user: Record<string, unknown>, team: TeamSettings): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...team.defaults, ...user, ...team.locked };
  return merged;
}

/** Every key the team or the user touches, resolved and explained, sorted by key. */
export function explainSettings(user: Record<string, unknown>, team: TeamSettings): ResolvedSetting[] {
  const keys = new Set([...Object.keys(team.defaults), ...Object.keys(team.locked), ...Object.keys(user)]);
  return [...keys].sort((a, b) => a.localeCompare(b)).map((key) => resolveSetting(key, user, team));
}

/** The user settings a lock is currently overriding — worth telling someone about. */
export function overriddenByTeam(user: Record<string, unknown>, team: TeamSettings): ResolvedSetting[] {
  return explainSettings(user, team).filter((setting) => setting.origin === 'locked' && 'overriddenUserValue' in setting);
}
