/**
 * Team policies (Phase 16E). A `znxstudio.policy.json` committed to a repository
 * states what an organisation requires of anyone working in it, and ZnxStudio
 * checks the workspace against it.
 *
 * A policy is a CHECK, not an enforcement mechanism, and the UI must never
 * pretend otherwise. ZnxStudio runs on the developer's machine: someone who wants
 * to ignore a policy can delete the file. What this buys is that a violation is
 * visible — to the developer now, and to CI later, which is where enforcement
 * actually belongs.
 *
 * Every rule here is grounded in something ZnxStudio can genuinely observe:
 *   • the security profile and disabled rules in `zornux.project` (Phase 15D)
 *   • whether a lockfile exists (Phase 15C)
 *   • which AI provider is configured (Phase 10)
 *   • whether AI features may be used at all
 */

import { parseSecuritySettings, type SecurityProfile } from '../security/rules';

export type PolicySeverity = 'warning' | 'error';

export interface Policy {
  name: string;
  /** The minimum security profile the project must use. */
  requiredSecurityProfile?: SecurityProfile;
  /** Rule ids that may never be disabled. */
  requiredSecurityRules?: string[];
  /** True when `zornux.lock` must be committed. */
  requireLockfile?: boolean;
  /** AI provider ids that may be configured. An empty list forbids AI entirely. */
  allowedAiProviders?: string[];
  /** How loudly a violation is reported. */
  severity: PolicySeverity;
  notice?: string;
}

export const EMPTY_POLICY: Policy = { name: '', severity: 'warning' };

export interface PolicyViolation {
  rule: string;
  severity: PolicySeverity;
  message: string;
  /** What the developer should do about it. */
  remedy: string;
}

/** Everything the evaluator is allowed to look at. Nothing is inferred. */
export interface PolicyContext {
  /** The text of `zornux.project`, or null when the workspace has none. */
  projectText: string | null;
  /** True when `zornux.lock` exists in the workspace root. */
  hasLockfile: boolean;
  /** The configured AI provider id (`none` when AI is off). */
  aiProvider: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : undefined;
}

const PROFILES: SecurityProfile[] = ['relaxed', 'standard', 'strict'];

/** Malformed input yields an empty policy rather than a throw, and never a pass. */
export function parsePolicy(text: string): Policy {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return EMPTY_POLICY;
  }
  const root = asRecord(raw);
  const profile = String(root.requiredSecurityProfile);
  const severity = root.severity === 'error' ? 'error' : 'warning';

  return {
    name: typeof root.name === 'string' ? root.name : '',
    requiredSecurityProfile: (PROFILES as string[]).includes(profile) ? (profile as SecurityProfile) : undefined,
    requiredSecurityRules: stringArray(root.requiredSecurityRules),
    requireLockfile: root.requireLockfile === true,
    allowedAiProviders: stringArray(root.allowedAiProviders),
    severity,
    notice: typeof root.notice === 'string' ? root.notice : undefined,
  };
}

/** How strict a profile is. `strict` is the most demanding. */
export function profileRank(profile: SecurityProfile): number {
  return { relaxed: 0, standard: 1, strict: 2 }[profile];
}

/** True when `actual` is at least as strict as `required`. */
export function satisfiesProfile(actual: SecurityProfile, required: SecurityProfile): boolean {
  return profileRank(actual) >= profileRank(required);
}

/**
 * Check a workspace against a policy. Returns every violation, most serious
 * first. A workspace with no `zornux.project` cannot satisfy a security-profile
 * requirement, and says so rather than passing by default.
 */
export function evaluatePolicy(policy: Policy, context: PolicyContext): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const settings = context.projectText ? parseSecuritySettings(context.projectText) : null;

  if (policy.requiredSecurityProfile) {
    if (!settings) {
      violations.push({
        rule: 'requiredSecurityProfile',
        severity: policy.severity,
        message: `The policy requires the '${policy.requiredSecurityProfile}' security profile, but this workspace has no zornux.project.`,
        remedy: `Add a zornux.project with 'security.profile = ${policy.requiredSecurityProfile}'.`,
      });
    } else if (!satisfiesProfile(settings.profile, policy.requiredSecurityProfile)) {
      violations.push({
        rule: 'requiredSecurityProfile',
        severity: policy.severity,
        message: `The security profile is '${settings.profile}', but the policy requires at least '${policy.requiredSecurityProfile}'.`,
        remedy: `Set 'security.profile = ${policy.requiredSecurityProfile}' in zornux.project.`,
      });
    }
  }

  if (policy.requiredSecurityRules?.length) {
    const disabled = new Set((settings?.disabled ?? []).map((id) => id.toUpperCase()));
    for (const ruleId of policy.requiredSecurityRules) {
      if (disabled.has(ruleId.toUpperCase())) {
        violations.push({
          rule: 'requiredSecurityRules',
          severity: policy.severity,
          message: `${ruleId} is disabled in zornux.project, but the policy requires it.`,
          remedy: `Remove ${ruleId} from 'security.disable'.`,
        });
      }
    }
  }

  if (policy.requireLockfile && !context.hasLockfile) {
    violations.push({
      rule: 'requireLockfile',
      severity: policy.severity,
      message: 'The policy requires a committed zornux.lock, and this workspace has none.',
      remedy: 'Run `zornux restore` and commit the resulting zornux.lock.',
    });
  }

  if (policy.allowedAiProviders && context.aiProvider !== 'none') {
    if (!policy.allowedAiProviders.includes(context.aiProvider)) {
      violations.push({
        rule: 'allowedAiProviders',
        severity: policy.severity,
        message: policy.allowedAiProviders.length
          ? `The AI provider '${context.aiProvider}' is not on the policy's allowed list (${policy.allowedAiProviders.join(', ')}).`
          : `This policy forbids AI features, but the '${context.aiProvider}' provider is configured.`,
        remedy: policy.allowedAiProviders.length
          ? `Choose one of: ${policy.allowedAiProviders.join(', ')}.`
          : 'Set the AI provider to "none" in settings.',
      });
    }
  }

  return violations.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1));
}

/** True when nothing the policy asks for is missing. */
export function isCompliant(violations: PolicyViolation[]): boolean {
  return violations.length === 0;
}

/** True when a violation is serious enough that a build gate should fail. */
export function blocksBuild(violations: PolicyViolation[]): boolean {
  return violations.some((violation) => violation.severity === 'error');
}

/** One honest line about compliance — including the limit of what a local check means. */
export function complianceSummary(policy: Policy, violations: PolicyViolation[]): string {
  if (!policy.name) return 'No policy file in this workspace.';
  if (isCompliant(violations)) return `Compliant with '${policy.name}'.`;
  const errors = violations.filter((v) => v.severity === 'error').length;
  const warnings = violations.length - errors;
  const parts: string[] = [];
  if (errors) parts.push(`${errors} violation(s)`);
  if (warnings) parts.push(`${warnings} warning(s)`);
  return `Not compliant with '${policy.name}' — ${parts.join(', ')}.`;
}
