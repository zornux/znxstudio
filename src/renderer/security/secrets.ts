/**
 * Secrets management (Phase 15A). Built on the two REAL secret rules the Zornux
 * analyzer ships:
 *
 *   • ZX3701 hardcoded-secret — SEMANTIC: a literal reaches a parameter the
 *     builtin catalog marks as key material (`crypto.hmac`, `auth.create_token`,
 *     `db.open`), or a `secret` configuration field is given a literal default.
 *   • ZX3707 secret-pattern  — TEXTUAL: a literal has the exact shape of a known
 *     provider credential (AWS access key, GitHub token, PEM private key, …).
 *
 * ZnxStudio never re-implements the detection: it runs `zornux check --security`
 * and reads what the compiler found. What it adds is the remediation the
 * compiler can only describe in prose — the `secret` field and the `reveal`
 * call that move the value out of the source.
 */

import type { SecurityFinding } from './findings';

/** The rule ids whose findings are secrets. */
export const SECRET_RULE_IDS = ['ZX3701', 'ZX3707'] as const;

export function isSecretFinding(finding: SecurityFinding): boolean {
  return (SECRET_RULE_IDS as readonly string[]).includes(finding.code);
}

export function secretsOnly(findings: SecurityFinding[]): SecurityFinding[] {
  return findings.filter(isSecretFinding);
}

/**
 * A leaked credential cannot be un-leaked by deleting the line: ZX3707 means a
 * real, live credential shape sat in the source, so it must also be revoked.
 * ZX3701 is a literal in a key position — moving it out is enough unless it was
 * ever committed.
 */
export function needsRevocation(finding: SecurityFinding): boolean {
  return finding.code === 'ZX3707';
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * The configuration field name to move this secret into. The analyzer names the
 * offending identifier in the first quoted word of its explanation (`'api_key'
 * is declared a secret…`); a pattern finding has no identifier, so fall back to
 * the `create <name> =` the literal was bound to, then to a generic name.
 */
export function suggestedFieldName(finding: SecurityFinding, sourceLine?: string): string {
  const quoted = /'([^']+)'/.exec(finding.explanation)?.[1];
  if (quoted && IDENTIFIER.test(quoted)) return quoted;

  const bound = sourceLine ? /^\s*create\s+([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(sourceLine)?.[1] : undefined;
  if (bound) return bound;

  return 'secret_value';
}

/**
 * The Zornux code that resolves a secret finding, exactly as the compiler's own
 * suggested fix describes it: declare the value as a `secret` field with NO
 * default, and read it through `reveal` at the point of use.
 */
export function remediationSnippet(fieldName: string, configurationName = 'AppConfig'): string {
  return [
    `configuration ${configurationName}`,
    `    has ${fieldName} as secret`,
    'end',
    '',
    `create settings from ${configurationName}`,
    `# use reveal(settings.${fieldName}) wherever the literal was`,
  ].join('\n');
}

export interface SecretsSummary {
  total: number;
  hardcoded: number;
  patterns: number;
  /** Findings that name a live credential shape and therefore demand revocation. */
  needRevocation: number;
  files: number;
}

export function secretsSummary(findings: SecurityFinding[]): SecretsSummary {
  const secrets = secretsOnly(findings);
  return {
    total: secrets.length,
    hardcoded: secrets.filter((f) => f.code === 'ZX3701').length,
    patterns: secrets.filter((f) => f.code === 'ZX3707').length,
    needRevocation: secrets.filter(needsRevocation).length,
    files: new Set(secrets.map((f) => f.file)).size,
  };
}
