import { describe, expect, test } from './harness';
import {
  EMPTY_TEAM_SETTINGS,
  explainSettings,
  isLocked,
  mergeSettings,
  overriddenByTeam,
  parseTeamSettings,
  renderTeamSettings,
  resolveSetting,
} from '../src/renderer/collab/teamSettings';
import {
  EMPTY_POLICY,
  blocksBuild,
  complianceSummary,
  evaluatePolicy,
  isCompliant,
  parsePolicy,
  profileRank,
  satisfiesProfile,
  type Policy,
} from '../src/renderer/collab/policy';

const TEAM_FILE = JSON.stringify({
  name: 'Platform',
  notice: 'Formatting is locked; everything else is a suggestion.',
  defaults: { 'editor.tabSize': 4, 'ai.provider': 'ollama' },
  locked: { 'editor.formatOnSave': true },
});

describe('parseTeamSettings', () => {
  test('reads the name, notice, defaults and locks', () => {
    const team = parseTeamSettings(TEAM_FILE);
    expect(team.name).toBe('Platform');
    expect(team.notice).toContain('Formatting is locked');
    expect(team.defaults).toEqual({ 'editor.tabSize': 4, 'ai.provider': 'ollama' });
    expect(team.locked).toEqual({ 'editor.formatOnSave': true });
  });

  test('a key in both defaults and locked is locked — the stricter reading wins', () => {
    const team = parseTeamSettings(JSON.stringify({ defaults: { a: 1 }, locked: { a: 2 } }));
    expect(team.locked).toEqual({ a: 2 });
    expect('a' in team.defaults).toBe(false);
  });

  test('malformed json yields empty settings rather than throwing', () => {
    expect(parseTeamSettings('{{{')).toEqual(EMPTY_TEAM_SETTINGS);
  });

  test('a non-object defaults section is ignored', () => {
    expect(parseTeamSettings(JSON.stringify({ defaults: [1, 2] })).defaults).toEqual({});
  });

  test('render round-trips through the parser', () => {
    const team = parseTeamSettings(TEAM_FILE);
    expect(parseTeamSettings(renderTeamSettings(team))).toEqual(team);
  });
});

describe('setting precedence', () => {
  const team = parseTeamSettings(TEAM_FILE);
  const user = { 'editor.tabSize': 2, 'editor.formatOnSave': false, 'editor.fontSize': 13 };

  test('a locked team setting beats the user', () => {
    const resolved = resolveSetting('editor.formatOnSave', user, team);
    expect(resolved.value).toBe(true);
    expect(resolved.origin).toBe('locked');
    expect(resolved.overriddenUserValue).toBe(false);
  });

  test('a user setting beats a team default', () => {
    expect(resolveSetting('editor.tabSize', user, team)).toEqual({ key: 'editor.tabSize', value: 2, origin: 'user' });
  });

  test('a team default applies when the user never set the key', () => {
    expect(resolveSetting('ai.provider', user, team)).toEqual({ key: 'ai.provider', value: 'ollama', origin: 'team' });
  });

  test('the built-in default applies when nobody set the key', () => {
    expect(resolveSetting('editor.wordWrap', user, team, 'off')).toEqual({ key: 'editor.wordWrap', value: 'off', origin: 'default' });
  });

  test('a lock that matches the user value reports no override', () => {
    const resolved = resolveSetting('editor.formatOnSave', { 'editor.formatOnSave': true }, team);
    expect(resolved.origin).toBe('locked');
    expect(resolved.overriddenUserValue).toBe(undefined);
  });

  test('mergeSettings produces exactly what the IDE should apply', () => {
    expect(mergeSettings(user, team)).toEqual({
      'editor.tabSize': 2,
      'ai.provider': 'ollama',
      'editor.formatOnSave': true,
      'editor.fontSize': 13,
    });
  });

  test('isLocked answers for any key', () => {
    expect(isLocked(team, 'editor.formatOnSave')).toBe(true);
    expect(isLocked(team, 'editor.tabSize')).toBe(false);
  });

  test('explainSettings covers every key either side mentions, sorted', () => {
    expect(explainSettings(user, team).map((s) => s.key)).toEqual([
      'ai.provider',
      'editor.fontSize',
      'editor.formatOnSave',
      'editor.tabSize',
    ]);
  });

  test('overriddenByTeam lists only the user values a lock silently ignores', () => {
    expect(overriddenByTeam(user, team).map((s) => s.key)).toEqual(['editor.formatOnSave']);
  });

  test('with no team file, every user setting stands', () => {
    expect(mergeSettings(user, EMPTY_TEAM_SETTINGS)).toEqual(user);
  });
});

/* ------------------------------------------------------------- policies */

const POLICY: Policy = {
  name: 'Baseline',
  requiredSecurityProfile: 'strict',
  requiredSecurityRules: ['ZX3701'],
  requireLockfile: true,
  allowedAiProviders: ['ollama'],
  severity: 'error',
};

describe('parsePolicy', () => {
  test('reads every rule', () => {
    const policy = parsePolicy(JSON.stringify(POLICY));
    expect(policy.name).toBe('Baseline');
    expect(policy.requiredSecurityProfile).toBe('strict');
    expect(policy.requiredSecurityRules).toEqual(['ZX3701']);
    expect(policy.requireLockfile).toBe(true);
    expect(policy.allowedAiProviders).toEqual(['ollama']);
    expect(policy.severity).toBe('error');
  });

  test('an unknown profile is dropped rather than guessed at', () => {
    expect(parsePolicy(JSON.stringify({ requiredSecurityProfile: 'paranoid' })).requiredSecurityProfile).toBe(undefined);
  });

  test('severity defaults to warning', () => {
    expect(parsePolicy(JSON.stringify({ name: 'x' })).severity).toBe('warning');
  });

  test('malformed json yields an empty policy, never a pass', () => {
    expect(parsePolicy('nonsense')).toEqual(EMPTY_POLICY);
  });

  test('an empty allowedAiProviders list is kept — it means AI is forbidden', () => {
    expect(parsePolicy(JSON.stringify({ allowedAiProviders: [] })).allowedAiProviders).toEqual([]);
  });
});

describe('satisfiesProfile', () => {
  test('strict is the most demanding, relaxed the least', () => {
    expect(profileRank('strict')).toBeGreaterThan(profileRank('standard'));
    expect(profileRank('standard')).toBeGreaterThan(profileRank('relaxed'));
  });
  test('a stricter profile satisfies a looser requirement', () => {
    expect(satisfiesProfile('strict', 'standard')).toBe(true);
    expect(satisfiesProfile('standard', 'standard')).toBe(true);
  });
  test('a looser profile does not satisfy a stricter requirement', () => {
    expect(satisfiesProfile('relaxed', 'strict')).toBe(false);
  });
});

describe('evaluatePolicy', () => {
  test('a compliant workspace has no violations', () => {
    const violations = evaluatePolicy(POLICY, {
      projectText: 'name = demo\nsecurity.profile = strict\n',
      hasLockfile: true,
      aiProvider: 'ollama',
    });
    expect(violations).toHaveLength(0);
    expect(isCompliant(violations)).toBe(true);
  });

  test('a loose security profile is a violation', () => {
    const violations = evaluatePolicy(POLICY, { projectText: 'security.profile = relaxed\n', hasLockfile: true, aiProvider: 'ollama' });
    expect(violations.map((v) => v.rule)).toEqual(['requiredSecurityProfile']);
    expect(violations[0].message).toContain("requires at least 'strict'");
    expect(violations[0].remedy).toContain('zornux.project');
  });

  test('a missing zornux.project cannot satisfy a profile requirement, and says so', () => {
    const violations = evaluatePolicy(POLICY, { projectText: null, hasLockfile: true, aiProvider: 'ollama' });
    expect(violations[0].rule).toBe('requiredSecurityProfile');
    expect(violations[0].message).toContain('no zornux.project');
  });

  test('a disabled required rule is a violation, matched case-insensitively', () => {
    const violations = evaluatePolicy(POLICY, {
      projectText: 'security.profile = strict\nsecurity.disable = zx3701\n',
      hasLockfile: true,
      aiProvider: 'ollama',
    });
    expect(violations.map((v) => v.rule)).toEqual(['requiredSecurityRules']);
  });

  test('a missing lockfile is a violation with a runnable remedy', () => {
    const violations = evaluatePolicy(POLICY, { projectText: 'security.profile = strict\n', hasLockfile: false, aiProvider: 'ollama' });
    expect(violations[0].rule).toBe('requireLockfile');
    expect(violations[0].remedy).toContain('zornux restore');
  });

  test('a disallowed AI provider is a violation naming the allowed ones', () => {
    const violations = evaluatePolicy(POLICY, { projectText: 'security.profile = strict\n', hasLockfile: true, aiProvider: 'openai' });
    expect(violations[0].rule).toBe('allowedAiProviders');
    expect(violations[0].message).toContain('ollama');
  });

  test("the 'none' provider never violates an AI policy — AI being off is always allowed", () => {
    const violations = evaluatePolicy({ ...POLICY, allowedAiProviders: [] }, {
      projectText: 'security.profile = strict\n',
      hasLockfile: true,
      aiProvider: 'none',
    });
    expect(violations).toHaveLength(0);
  });

  test('an empty allowed list forbids AI entirely, and says that', () => {
    const violations = evaluatePolicy({ ...POLICY, allowedAiProviders: [] }, {
      projectText: 'security.profile = strict\n',
      hasLockfile: true,
      aiProvider: 'openai',
    });
    expect(violations[0].message).toContain('forbids AI features');
    expect(violations[0].remedy).toContain('"none"');
  });

  test('a policy with no rules passes anything', () => {
    expect(evaluatePolicy({ name: 'empty', severity: 'warning' }, { projectText: null, hasLockfile: false, aiProvider: 'openai' })).toHaveLength(0);
  });

  test('errors are listed before warnings', () => {
    const mixed = evaluatePolicy({ ...POLICY, severity: 'error' }, { projectText: null, hasLockfile: false, aiProvider: 'openai' });
    expect(mixed.every((v) => v.severity === 'error')).toBe(true);
    expect(mixed.length).toBe(3);
  });
});

describe('blocksBuild and complianceSummary', () => {
  test('an error-severity violation would fail a CI gate', () => {
    const violations = evaluatePolicy(POLICY, { projectText: null, hasLockfile: true, aiProvider: 'ollama' });
    expect(blocksBuild(violations)).toBe(true);
  });

  test('a warning-severity violation would not', () => {
    const violations = evaluatePolicy({ ...POLICY, severity: 'warning' }, { projectText: null, hasLockfile: true, aiProvider: 'ollama' });
    expect(blocksBuild(violations)).toBe(false);
  });

  test('the summary names the policy and counts the violations', () => {
    const violations = evaluatePolicy(POLICY, { projectText: null, hasLockfile: false, aiProvider: 'ollama' });
    expect(complianceSummary(POLICY, violations)).toBe("Not compliant with 'Baseline' — 2 violation(s).");
  });

  test('a compliant workspace says so', () => {
    expect(complianceSummary(POLICY, [])).toBe("Compliant with 'Baseline'.");
  });

  test('no policy file is stated plainly, not reported as compliant', () => {
    expect(complianceSummary(EMPTY_POLICY, [])).toBe('No policy file in this workspace.');
  });
});
