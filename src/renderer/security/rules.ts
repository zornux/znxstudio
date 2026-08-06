/**
 * Static security analysis configuration (Phase 15D) — the rule catalog and the
 * `security.*` settings that govern it, mirrored from
 * `Zornux.Analysis/SecurityConfiguration.cs` + each rule's `RuleInfo`.
 *
 * Two facts the UI must not paper over:
 *
 *   1. ZX3709 (vulnerable-dependency) is declared but is NOT in
 *      `SecurityAnalyzer.BuiltInRules()` — it needs an advisory source the
 *      compiler does not ship, so `zornux check --security` never runs it.
 *      ZnxStudio supplies that source itself (Phase 15C), outside the compiler.
 *   2. A profile shifts severities but leaves the EXTREMES alone: strict raises
 *      a warning to an error, relaxed lowers an error to a warning; info and
 *      critical never move. An explicit per-rule override beats the profile.
 */

import type { SecuritySeverity } from './findings';

export type SecurityProfile = 'relaxed' | 'standard' | 'strict';
export const SECURITY_PROFILES: SecurityProfile[] = ['relaxed', 'standard', 'strict'];

export interface RuleInfo {
  id: string;
  category: string;
  title: string;
  defaultSeverity: SecuritySeverity;
  /** False when the compiler declares the rule but does not run it by default. */
  builtIn: boolean;
  /** Why a non-built-in rule never fires under `zornux check --security`. */
  note?: string;
}

/** `RuleInfo.DocumentationUrl` — the compiler derives it from the id. */
export function documentationUrl(ruleId: string): string {
  return `https://zornux.dev/security/rules#${ruleId.toLowerCase()}`;
}

/** The nine rules the analyzer declares, in id order, with their authored severities. */
export const SECURITY_RULES: RuleInfo[] = [
  { id: 'ZX3701', category: 'secrets', title: 'Hardcoded secret', defaultSeverity: 'Critical', builtIn: true },
  { id: 'ZX3702', category: 'unsafe-api', title: 'Unsafe API used', defaultSeverity: 'Warning', builtIn: true },
  { id: 'ZX3703', category: 'resource-leak', title: 'Resource opened but never closed', defaultSeverity: 'Warning', builtIn: true },
  { id: 'ZX3704', category: 'injection', title: 'Untrusted data reaches a trusted parameter', defaultSeverity: 'Error', builtIn: true },
  { id: 'ZX3705', category: 'authorization', title: 'State-changing route has no authorization guard', defaultSeverity: 'Warning', builtIn: true },
  { id: 'ZX3706', category: 'web', title: 'Cookie weakens a safe default', defaultSeverity: 'Warning', builtIn: true },
  { id: 'ZX3707', category: 'secrets', title: 'Recognizable secret in the source', defaultSeverity: 'Critical', builtIn: true },
  { id: 'ZX3708', category: 'xss', title: 'Untrusted data returned as HTML without encoding', defaultSeverity: 'Error', builtIn: true },
  {
    id: 'ZX3709',
    category: 'dependency',
    title: 'Dependency has a known vulnerability',
    defaultSeverity: 'Error',
    builtIn: false,
    note: 'Needs an advisory source, which the compiler does not ship — `zornux check --security` never runs it. ZnxStudio audits dependencies itself.',
  },
];

export function findRule(ruleId: string): RuleInfo | undefined {
  return SECURITY_RULES.find((rule) => rule.id.toUpperCase() === ruleId.toUpperCase());
}

/** The rules `zornux check --security` will actually run. */
export function builtInRules(): RuleInfo[] {
  return SECURITY_RULES.filter((rule) => rule.builtIn);
}

/* ------------------------------------------------------- configuration */

export interface SecuritySettings {
  profile: SecurityProfile;
  /** Rule ids turned off entirely (`security.disable`). */
  disabled: string[];
  /** Per-rule severity overrides (`security.severity.ZX3702 = info`). */
  severityOverrides: Record<string, SecuritySeverity>;
}

export const DEFAULT_SETTINGS: SecuritySettings = { profile: 'standard', disabled: [], severityOverrides: {} };

const SEVERITY_WORDS: Record<string, SecuritySeverity> = {
  info: 'Info',
  warning: 'Warning',
  error: 'Error',
  critical: 'Critical',
};

function parseSeverity(value: string): SecuritySeverity | null {
  return SEVERITY_WORDS[value.trim().toLowerCase()] ?? null;
}

/**
 * Read `security.*` out of a `zornux.project`. Mirrors
 * `SecurityConfiguration.ParseProjectSettings`: `#` comments and lines without
 * an `=` are skipped, keys are case-insensitive, an unrecognised profile or
 * severity is ignored rather than guessed at.
 */
export function parseSecuritySettings(projectText: string): SecuritySettings {
  const settings: SecuritySettings = { profile: 'standard', disabled: [], severityOverrides: {} };

  for (const raw of projectText.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const lower = key.toLowerCase();

    if (lower === 'security.disable') {
      settings.disabled.push(...value.split(/[,\s\t]+/).filter(Boolean));
    } else if (lower === 'security.profile') {
      const profile = value.trim().toLowerCase();
      if ((SECURITY_PROFILES as string[]).includes(profile)) settings.profile = profile as SecurityProfile;
    } else if (lower.startsWith('security.severity.')) {
      const severity = parseSeverity(value);
      if (severity) settings.severityOverrides[key.slice('security.severity.'.length)] = severity;
    }
  }

  return settings;
}

/** True when a rule runs at all under these settings. */
export function isEnabled(settings: SecuritySettings, ruleId: string): boolean {
  return !settings.disabled.some((id) => id.toUpperCase() === ruleId.toUpperCase());
}

/**
 * The profile shift: strict raises a warning to an error, relaxed lowers an
 * error to a warning. Info and critical are never moved.
 */
export function applyProfile(severity: SecuritySeverity, profile: SecurityProfile): SecuritySeverity {
  if (profile === 'strict' && severity === 'Warning') return 'Error';
  if (profile === 'relaxed' && severity === 'Error') return 'Warning';
  return severity;
}

/** The severity a rule's findings will carry. An explicit override beats the profile. */
export function effectiveSeverity(settings: SecuritySettings, rule: RuleInfo): SecuritySeverity {
  const override = Object.entries(settings.severityOverrides).find(([id]) => id.toUpperCase() === rule.id.toUpperCase());
  return override ? override[1] : applyProfile(rule.defaultSeverity, settings.profile);
}

/** True when a rule, as configured, would fail `zornux check --security`. */
export function ruleBlocksBuild(settings: SecuritySettings, rule: RuleInfo): boolean {
  if (!isEnabled(settings, rule.id)) return false;
  const severity = effectiveSeverity(settings, rule);
  return severity === 'Error' || severity === 'Critical';
}

/* ----------------------------------------------------------- rendering */

/** The `security.*` lines these settings serialize to, in a stable order. */
export function renderSecuritySettings(settings: SecuritySettings): string[] {
  const lines: string[] = [];
  if (settings.profile !== 'standard') lines.push(`security.profile = ${settings.profile}`);
  if (settings.disabled.length) lines.push(`security.disable = ${[...settings.disabled].sort((a, b) => a.localeCompare(b)).join(', ')}`);
  for (const [ruleId, severity] of Object.entries(settings.severityOverrides).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`security.severity.${ruleId} = ${severity.toLowerCase()}`);
  }
  return lines;
}

/**
 * Write settings back into a `zornux.project`, replacing whatever `security.*`
 * lines it had and leaving every other line — name, version, dependencies,
 * comments — exactly as it found them.
 */
export function updateProjectText(projectText: string, settings: SecuritySettings): string {
  const eol = projectText.includes('\r\n') ? '\r\n' : '\n';
  const kept = projectText
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^\s*security\.[a-z.]+\s*=/i.test(line));

  while (kept.length && kept[kept.length - 1].trim() === '') kept.pop();

  const rendered = renderSecuritySettings(settings);
  const body = rendered.length ? [...kept, '', ...rendered] : kept;
  return `${body.join(eol)}${eol}`;
}
