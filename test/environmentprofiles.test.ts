import { describe, expect, test } from './harness';
import {
  ENVIRONMENT_PROFILES,
  isEnvironmentProfile,
  parseConfigShow,
  parseConfigValidate,
  profileConfigFiles,
  profileDisplay,
} from '../src/shared/environmentProfiles';

describe('environment profile helpers', () => {
  test('exposes the four profiles in declaration order', () => {
    expect(ENVIRONMENT_PROFILES).toHaveLength(4);
    expect(ENVIRONMENT_PROFILES[0]).toBe('development');
    expect(ENVIRONMENT_PROFILES[3]).toBe('production');
  });

  test('isEnvironmentProfile guards unknown values', () => {
    expect(isEnvironmentProfile('production')).toBeTruthy();
    expect(isEnvironmentProfile('prod')).toBeFalsy();
    expect(isEnvironmentProfile(42)).toBeFalsy();
  });

  test('profileDisplay title-cases the name', () => {
    expect(profileDisplay('development')).toBe('Development');
    expect(profileDisplay('staging')).toBe('Staging');
  });

  test('profileConfigFiles mirrors the ConfigurationLoader layering', () => {
    const files = profileConfigFiles('production');
    expect(files).toHaveLength(3);
    expect(files[0].name).toBe('zornux.config.zxcfg');
    expect(files[1].name).toBe('zornux.config.production.zxcfg');
    expect(files[1].committed).toBeTruthy();
    expect(files[2].name).toBe('zornux.config.local.zxcfg');
    expect(files[2].committed).toBeFalsy();
  });
});

describe('parseConfigShow', () => {
  test('parses the profile line and config blocks with fields', () => {
    const stdout = 'Profile: Development\nServer:\n  port = 8080\n  host = "localhost"\nDatabase:\n  url = «redacted»\n';
    const result = parseConfigShow(0, stdout, '');
    expect(result.error).toBeNull();
    expect(result.profile).toBe('Development');
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0].name).toBe('Server');
    expect(result.blocks[0].fields).toHaveLength(2);
    expect(result.blocks[0].fields[0].name).toBe('port');
    expect(result.blocks[0].fields[0].value).toBe('8080');
    expect(result.blocks[1].fields[0].value).toBe('«redacted»');
  });

  test('recognizes "no configuration declared"', () => {
    const result = parseConfigShow(0, 'src/main.zx: no configuration declared.\n', '');
    expect(result.noConfig).toBeTruthy();
    expect(result.blocks).toHaveLength(0);
  });

  test('non-zero exit surfaces the error text', () => {
    const result = parseConfigShow(1, '', 'ZX2801: missing required setting');
    expect(result.error).toBe('ZX2801: missing required setting');
    expect(result.blocks).toHaveLength(0);
  });
});

describe('parseConfigValidate', () => {
  test('valid config yields valid=true and the summary', () => {
    const result = parseConfigValidate(0, 'Configuration is valid.\n', '');
    expect(result.valid).toBeTruthy();
    expect(result.summary).toBe('Configuration is valid.');
    expect(result.warnings).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  test('collects warnings and keeps valid=true on exit 0', () => {
    const stdout =
      "zornux.config.zxcfg: ZX2810 warning — 'api_key' is a secret set in a committed file; use an environment variable.\nConfiguration is valid, with 1 warning(s).\n";
    const result = parseConfigValidate(0, stdout, '');
    expect(result.valid).toBeTruthy();
    expect(result.warnings).toHaveLength(1);
    expect(result.summary).toContain('1 warning');
  });

  test('non-zero exit is invalid and captures the error summary from stderr', () => {
    const stdout = 'zornux.config.zxcfg: ZX2802 — bad value\n';
    const stderr = 'Configuration has 1 error(s) and 0 warning(s).\n';
    const result = parseConfigValidate(2, stdout, stderr);
    expect(result.valid).toBeFalsy();
    expect(result.errors).toHaveLength(1);
    expect(result.summary).toContain('1 error');
  });
});
