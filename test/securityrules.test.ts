import { describe, expect, test } from './harness';
import {
  DEFAULT_SETTINGS,
  SECURITY_RULES,
  applyProfile,
  builtInRules,
  documentationUrl,
  effectiveSeverity,
  findRule,
  isEnabled,
  parseSecuritySettings,
  renderSecuritySettings,
  ruleBlocksBuild,
  updateProjectText,
  type SecuritySettings,
} from '../src/renderer/security/rules';

describe('SECURITY_RULES catalog', () => {
  test('mirrors the nine rules the analyzer declares, in id order', () => {
    expect(SECURITY_RULES.map((r) => r.id)).toEqual([
      'ZX3701',
      'ZX3702',
      'ZX3703',
      'ZX3704',
      'ZX3705',
      'ZX3706',
      'ZX3707',
      'ZX3708',
      'ZX3709',
    ]);
  });

  test('carries the severity each rule authored', () => {
    expect(findRule('ZX3701')?.defaultSeverity).toBe('Critical');
    expect(findRule('ZX3707')?.defaultSeverity).toBe('Critical');
    expect(findRule('ZX3704')?.defaultSeverity).toBe('Error');
    expect(findRule('ZX3708')?.defaultSeverity).toBe('Error');
    expect(findRule('ZX3702')?.defaultSeverity).toBe('Warning');
    expect(findRule('ZX3703')?.defaultSeverity).toBe('Warning');
    expect(findRule('ZX3705')?.defaultSeverity).toBe('Warning');
    expect(findRule('ZX3706')?.defaultSeverity).toBe('Warning');
  });

  test('carries each rule category', () => {
    expect(SECURITY_RULES.map((r) => r.category)).toEqual([
      'secrets',
      'unsafe-api',
      'resource-leak',
      'injection',
      'authorization',
      'web',
      'secrets',
      'xss',
      'dependency',
    ]);
  });

  test('only eight rules are built in — ZX3709 needs an advisory source the compiler does not ship', () => {
    expect(builtInRules()).toHaveLength(8);
    expect(findRule('ZX3709')?.builtIn).toBe(false);
    expect(findRule('ZX3709')?.note).toContain('advisory source');
  });

  test('findRule is case-insensitive and misses cleanly', () => {
    expect(findRule('zx3701')?.id).toBe('ZX3701');
    expect(findRule('ZX9999')).toBe(undefined);
  });

  test('the documentation url is derived from the id, as RuleInfo does', () => {
    expect(documentationUrl('ZX3701')).toBe('https://zornux.dev/security/rules#zx3701');
  });
});

describe('applyProfile', () => {
  test('strict raises a warning to an error', () => {
    expect(applyProfile('Warning', 'strict')).toBe('Error');
  });
  test('relaxed lowers an error to a warning', () => {
    expect(applyProfile('Error', 'relaxed')).toBe('Warning');
  });
  test('standard changes nothing', () => {
    expect(applyProfile('Warning', 'standard')).toBe('Warning');
    expect(applyProfile('Error', 'standard')).toBe('Error');
  });
  test('the extremes never move', () => {
    expect(applyProfile('Critical', 'relaxed')).toBe('Critical');
    expect(applyProfile('Critical', 'strict')).toBe('Critical');
    expect(applyProfile('Info', 'strict')).toBe('Info');
    expect(applyProfile('Info', 'relaxed')).toBe('Info');
  });
});

describe('parseSecuritySettings', () => {
  test('reads profile, disables and severity overrides', () => {
    const settings = parseSecuritySettings(
      ['name = demo', 'security.profile = strict', 'security.disable = ZX3703, ZX3705', 'security.severity.ZX3702 = info'].join('\n'),
    );
    expect(settings.profile).toBe('strict');
    expect(settings.disabled).toEqual(['ZX3703', 'ZX3705']);
    expect(settings.severityOverrides).toEqual({ ZX3702: 'Info' });
  });

  test('keys are case-insensitive', () => {
    expect(parseSecuritySettings('Security.Profile = Relaxed\n').profile).toBe('relaxed');
  });

  test('comments and lines with no equals sign are ignored', () => {
    expect(parseSecuritySettings('# security.profile = strict\nsecurity profile strict\n').profile).toBe('standard');
  });

  test('an unrecognised profile is ignored, not guessed at', () => {
    expect(parseSecuritySettings('security.profile = paranoid\n').profile).toBe('standard');
  });

  test('an unrecognised severity is ignored', () => {
    expect(parseSecuritySettings('security.severity.ZX3702 = fatal\n').severityOverrides).toEqual({});
  });

  test('a manifest with no security settings yields the defaults', () => {
    expect(parseSecuritySettings('name = demo\nversion = 1.0.0\n')).toEqual(DEFAULT_SETTINGS);
  });

  test('disables split on commas, spaces and tabs', () => {
    expect(parseSecuritySettings('security.disable = ZX3701 ZX3702,ZX3703\n').disabled).toEqual(['ZX3701', 'ZX3702', 'ZX3703']);
  });
});

describe('isEnabled', () => {
  const settings: SecuritySettings = { profile: 'standard', disabled: ['zx3703'], severityOverrides: {} };
  test('a disabled rule is off, matched case-insensitively', () => {
    expect(isEnabled(settings, 'ZX3703')).toBe(false);
  });
  test('every other rule is on', () => {
    expect(isEnabled(settings, 'ZX3701')).toBe(true);
  });
});

describe('effectiveSeverity', () => {
  const unsafeApi = findRule('ZX3702')!;
  const injection = findRule('ZX3704')!;

  test('standard keeps the authored severity', () => {
    expect(effectiveSeverity(DEFAULT_SETTINGS, unsafeApi)).toBe('Warning');
  });

  test('strict raises the unsafe-api warning to an error', () => {
    expect(effectiveSeverity({ ...DEFAULT_SETTINGS, profile: 'strict' }, unsafeApi)).toBe('Error');
  });

  test('relaxed lowers the injection error to a warning', () => {
    expect(effectiveSeverity({ ...DEFAULT_SETTINGS, profile: 'relaxed' }, injection)).toBe('Warning');
  });

  test('an explicit override beats the profile', () => {
    const settings: SecuritySettings = { profile: 'strict', disabled: [], severityOverrides: { ZX3702: 'Info' } };
    expect(effectiveSeverity(settings, unsafeApi)).toBe('Info');
  });

  test('an override matches its rule case-insensitively', () => {
    const settings: SecuritySettings = { profile: 'standard', disabled: [], severityOverrides: { zx3702: 'Critical' } };
    expect(effectiveSeverity(settings, unsafeApi)).toBe('Critical');
  });
});

describe('ruleBlocksBuild', () => {
  const unsafeApi = findRule('ZX3702')!;
  const secret = findRule('ZX3701')!;

  test('a warning does not fail the build', () => {
    expect(ruleBlocksBuild(DEFAULT_SETTINGS, unsafeApi)).toBe(false);
  });
  test('under strict, the same warning does', () => {
    expect(ruleBlocksBuild({ ...DEFAULT_SETTINGS, profile: 'strict' }, unsafeApi)).toBe(true);
  });
  test('a critical rule always would', () => {
    expect(ruleBlocksBuild(DEFAULT_SETTINGS, secret)).toBe(true);
  });
  test('unless it is disabled', () => {
    expect(ruleBlocksBuild({ ...DEFAULT_SETTINGS, disabled: ['ZX3701'] }, secret)).toBe(false);
  });
});

describe('renderSecuritySettings', () => {
  test('the default configuration writes nothing', () => {
    expect(renderSecuritySettings(DEFAULT_SETTINGS)).toHaveLength(0);
  });

  test('lines are stable and sorted', () => {
    expect(
      renderSecuritySettings({ profile: 'strict', disabled: ['ZX3705', 'ZX3703'], severityOverrides: { ZX3702: 'Info' } }),
    ).toEqual(['security.profile = strict', 'security.disable = ZX3703, ZX3705', 'security.severity.ZX3702 = info']);
  });

  test('round-trips through the parser', () => {
    const settings: SecuritySettings = { profile: 'relaxed', disabled: ['ZX3706'], severityOverrides: { ZX3708: 'Critical' } };
    expect(parseSecuritySettings(renderSecuritySettings(settings).join('\n'))).toEqual(settings);
  });
});

describe('updateProjectText', () => {
  test('replaces old security lines and keeps everything else', () => {
    const before = 'name = demo\nversion = 1.0.0\nsecurity.profile = relaxed\ndependency Greetings = ^1.0.0\n';
    const after = updateProjectText(before, { profile: 'strict', disabled: [], severityOverrides: {} });
    expect(after).toContain('name = demo');
    expect(after).toContain('dependency Greetings = ^1.0.0');
    expect(after).toContain('security.profile = strict');
    expect(after.includes('relaxed')).toBe(false);
  });

  test('clearing every setting removes the security lines entirely', () => {
    const after = updateProjectText('name = demo\nsecurity.profile = strict\n', DEFAULT_SETTINGS);
    expect(after).toBe('name = demo\n');
  });

  test('comments survive', () => {
    const after = updateProjectText('# my project\nname = demo\n', { profile: 'strict', disabled: [], severityOverrides: {} });
    expect(after).toContain('# my project');
  });

  test('CRLF line endings are preserved', () => {
    const after = updateProjectText('name = demo\r\n', { profile: 'strict', disabled: [], severityOverrides: {} });
    expect(after).toContain('\r\n');
  });

  test('the result parses back to what was written', () => {
    const settings: SecuritySettings = { profile: 'strict', disabled: ['ZX3703'], severityOverrides: { ZX3702: 'Info' } };
    expect(parseSecuritySettings(updateProjectText('name = demo\n', settings))).toEqual(settings);
  });
});
