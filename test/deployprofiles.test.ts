import { describe, expect, test } from './harness';
import {
  DEPLOY_TARGETS,
  defaultProfile,
  parseDeploymentProfiles,
  validateProfile,
} from '../src/renderer/deploy/profiles';

describe('defaultProfile', () => {
  test('slugs the name into an id and fills defaults', () => {
    const p = defaultProfile('Production Web', 'kubernetes');
    expect(p.id).toBe('production-web');
    expect(p.target).toBe('kubernetes');
    expect(p.buildCommand).toBe('zornux build');
    expect(validateProfile(p)).toBeNull();
  });
});

describe('validateProfile', () => {
  test('flags missing name and bad target', () => {
    expect(validateProfile({ ...defaultProfile('x'), name: '' })).toContain('name');
    expect(validateProfile({ ...defaultProfile('x'), target: 'bogus' as never })).toContain('target');
  });
  test('every declared target validates', () => {
    for (const target of DEPLOY_TARGETS) {
      expect(validateProfile(defaultProfile('p', target))).toBeNull();
    }
  });
});

describe('parseDeploymentProfiles', () => {
  test('parses valid entries, drops invalid, dedupes ids, keeps env vars', () => {
    const out = parseDeploymentProfiles([
      { name: 'Prod', target: 'docker', environment: 'production', registry: 'ghcr.io/acme', envVars: { KEY: 'v' } },
      { name: 'bad', target: 'nonsense' },
      { name: 'Prod', target: 'kubernetes' }, // duplicate slug -> deduped
      'garbage',
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].registry).toBe('ghcr.io/acme');
    expect(out[0].envVars).toEqual({ KEY: 'v' });
    expect(out[1].id).toBe('prod-2');
  });
  test('non-array input yields empty', () => {
    expect(parseDeploymentProfiles(null)).toHaveLength(0);
    expect(parseDeploymentProfiles({})).toHaveLength(0);
  });
});
