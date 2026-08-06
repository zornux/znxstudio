/**
 * Environment profiles — the real Zornux concept (Zornux.Core/EnvironmentProfile
 * + Zornux.Configuration). The active profile selects which configuration file
 * layer applies, so the same program runs with development / testing / staging /
 * production settings. Threaded into the CLI via `--profile <name>` (config /
 * run / serve). Development is the default when nothing selects one.
 *
 * These helpers are pure so they are unit-testable without the CLI. The parsers
 * read the text `zornux config show` / `config validate` print (they emit text,
 * not JSON).
 */
export type EnvironmentProfile = 'development' | 'testing' | 'staging' | 'production';

/** Canonical order, matching the Zornux enum declaration order. */
export const ENVIRONMENT_PROFILES: readonly EnvironmentProfile[] = [
  'development',
  'testing',
  'staging',
  'production',
];

export function isEnvironmentProfile(value: unknown): value is EnvironmentProfile {
  return typeof value === 'string' && (ENVIRONMENT_PROFILES as readonly string[]).includes(value);
}

/** Title-case display name (`development` → `Development`), matching `EnvironmentProfiles.Display`. */
export function profileDisplay(profile: EnvironmentProfile): string {
  return profile.charAt(0).toUpperCase() + profile.slice(1);
}

const BASE_CONFIG_FILE = 'zornux.config.zxcfg';
const LOCAL_CONFIG_FILE = 'zornux.config.local.zxcfg';

/**
 * The configuration files that layer for a profile, in application order —
 * mirrors `ConfigurationLoader`: base (committed), profile-specific (committed),
 * local (git-ignored overrides).
 */
export function profileConfigFiles(profile: EnvironmentProfile): { name: string; committed: boolean; role: string }[] {
  return [
    { name: BASE_CONFIG_FILE, committed: true, role: 'base' },
    { name: `zornux.config.${profile}.zxcfg`, committed: true, role: 'profile' },
    { name: LOCAL_CONFIG_FILE, committed: false, role: 'local' },
  ];
}

/* -------------------------------------------------------- config show parse */

export interface ConfigField {
  name: string;
  value: string;
}

export interface ConfigBlock {
  name: string;
  fields: ConfigField[];
}

export interface ConfigShowResult {
  /** The profile the CLI echoed (`Profile: Development`), if present. */
  profile: string | null;
  /** True when the target declared no configuration (exit 0, informational). */
  noConfig: boolean;
  blocks: ConfigBlock[];
  /** Set when the command failed (bind/parse error), else null. */
  error: string | null;
}

export function parseConfigShow(exitCode: number, stdout: string, stderr: string): ConfigShowResult {
  if (exitCode !== 0) {
    return { profile: null, noConfig: false, blocks: [], error: (stderr.trim() || stdout.trim()) || `config show failed (exit ${exitCode}).` };
  }
  let profile: string | null = null;
  const blocks: ConfigBlock[] = [];
  let current: ConfigBlock | null = null;
  let noConfig = false;

  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const profileMatch = /^Profile:\s*(.+)$/.exec(raw);
    if (profileMatch) {
      profile = profileMatch[1].trim();
      continue;
    }
    if (/:\s*no configuration declared\.$/.test(raw)) {
      noConfig = true;
      continue;
    }
    const indented = raw.startsWith(' ') || raw.startsWith('\t');
    if (!indented) {
      // A `Name:` header (the CLI writes a trailing colon).
      const name = raw.replace(/:\s*$/, '').trim();
      current = { name, fields: [] };
      blocks.push(current);
      continue;
    }
    // `  field = value` under the current block.
    const eq = raw.indexOf('=');
    if (eq < 0 || !current) continue;
    current.fields.push({ name: raw.slice(0, eq).trim(), value: raw.slice(eq + 1).trim() });
  }
  return { profile, noConfig, blocks, error: null };
}

/* ---------------------------------------------------- config validate parse */

export interface ConfigValidateResult {
  valid: boolean;
  warnings: string[];
  errors: string[];
  /** The final summary line (`Configuration is valid.` / `… has N error(s)…`). */
  summary: string;
}

export function parseConfigValidate(exitCode: number, stdout: string, stderr: string): ConfigValidateResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let summary = '';

  const lines = `${stdout}\n${stderr}`.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^Configuration (is valid|has )/.test(line)) {
      summary = line;
      continue;
    }
    if (line.includes(' warning ')) {
      warnings.push(line);
    } else if (line.includes(' — ') || / error/i.test(line)) {
      errors.push(line);
    }
  }
  return { valid: exitCode === 0, warnings, errors, summary };
}
