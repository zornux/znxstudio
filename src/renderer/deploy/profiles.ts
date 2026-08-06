/**
 * Deployment profiles (Phase 13A). A named deployment target — where and how a
 * Zornux/Zoijs project ships (docker / kubernetes / cloud / static), its
 * environment, build command, output, registry and env vars. Distinct from the
 * Phase 5F environment profiles (which parameterize the compiler): these drive
 * the Phase 13 generators + deploy commands. Pure parse/validate, unit-tested.
 */

export type DeployTarget = 'docker' | 'kubernetes' | 'cloud' | 'static';

export const DEPLOY_TARGETS: readonly DeployTarget[] = ['docker', 'kubernetes', 'cloud', 'static'];

export interface DeploymentProfile {
  id: string;
  name: string;
  target: DeployTarget;
  environment: string;
  buildCommand: string;
  outputDir: string;
  registry: string;
  envVars: Record<string, string>;
}

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
}

/** A sensible default profile for a target. */
export function defaultProfile(name: string, target: DeployTarget = 'docker'): DeploymentProfile {
  return {
    id: slug(name),
    name,
    target,
    environment: 'production',
    buildCommand: 'zornux build',
    outputDir: 'dist',
    registry: '',
    envVars: {},
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Validate a profile; returns a reason it's invalid, or null. */
export function validateProfile(profile: DeploymentProfile): string | null {
  if (!profile.name.trim()) return 'Profile needs a name.';
  if (!DEPLOY_TARGETS.includes(profile.target)) return `Unknown target "${profile.target}".`;
  if (!profile.environment.trim()) return 'Profile needs an environment.';
  return null;
}

/** Parse a raw array of profiles from settings/JSON; drops invalid entries. */
export function parseDeploymentProfiles(raw: unknown): DeploymentProfile[] {
  if (!Array.isArray(raw)) return [];
  const profiles: DeploymentProfile[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const target = record.target as DeployTarget;
    if (!name || !DEPLOY_TARGETS.includes(target)) continue;
    const envVars: Record<string, string> = {};
    const rawEnv = asRecord(record.envVars);
    if (rawEnv) {
      for (const [key, value] of Object.entries(rawEnv)) envVars[key] = String(value);
    }
    let id = typeof record.id === 'string' && record.id.trim() ? slug(record.id) : slug(name);
    while (seen.has(id)) id = `${id}-2`;
    seen.add(id);
    profiles.push({
      id,
      name,
      target,
      environment: typeof record.environment === 'string' && record.environment.trim() ? record.environment.trim() : 'production',
      buildCommand: typeof record.buildCommand === 'string' ? record.buildCommand : 'zornux build',
      outputDir: typeof record.outputDir === 'string' ? record.outputDir : 'dist',
      registry: typeof record.registry === 'string' ? record.registry : '',
      envVars,
    });
  }
  return profiles;
}
