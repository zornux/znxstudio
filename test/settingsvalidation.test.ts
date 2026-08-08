import { describe, expect, test } from './harness';
import { coerceSetting } from '../src/renderer/settings/SettingsSchema';

describe('settings validation — coerceSetting', () => {
  test('clamps out-of-range numbers to the schema bounds', () => {
    // files.autosaveDelay: minimum 100, maximum 10000
    expect(coerceSetting('files.autosaveDelay', 50)).toEqual({ ok: true, value: 100 });
    expect(coerceSetting('files.autosaveDelay', 999999)).toEqual({ ok: true, value: 10000 });
    expect(coerceSetting('files.autosaveDelay', 250)).toEqual({ ok: true, value: 250 });
  });

  test('rejects non-numeric values for a number setting', () => {
    expect(coerceSetting('files.autosaveDelay', 'abc')).toEqual({ ok: false });
    expect(coerceSetting('files.autosaveDelay', NaN)).toEqual({ ok: false });
  });

  test('enforces a string pattern (hex color)', () => {
    expect(coerceSetting('editor.keywordColor', '#ff5c9d')).toEqual({ ok: true, value: '#ff5c9d' });
    expect(coerceSetting('editor.keywordColor', 'red')).toEqual({ ok: false });
    expect(coerceSetting('editor.keywordColor', '#zzzzzz')).toEqual({ ok: false });
  });

  test('enforces an enum (theme / locale)', () => {
    expect(coerceSetting('workbench.theme', 'znxstudio-hc-dark')).toEqual({ ok: true, value: 'znxstudio-hc-dark' });
    expect(coerceSetting('workbench.theme', 'znxstudio-tide')).toEqual({ ok: true, value: 'znxstudio-tide' });
    expect(coerceSetting('workbench.theme', 'znxstudio-dune')).toEqual({ ok: true, value: 'znxstudio-dune' });
    expect(coerceSetting('workbench.theme', 'solarized')).toEqual({ ok: false });
    expect(coerceSetting('workbench.locale', 'pseudo')).toEqual({ ok: true, value: 'pseudo' });
    expect(coerceSetting('workbench.locale', 'fr')).toEqual({ ok: false });
  });

  test('enforces boolean type', () => {
    expect(coerceSetting('files.autosave', true)).toEqual({ ok: true, value: true });
    expect(coerceSetting('files.autosave', 'yes')).toEqual({ ok: false });
    expect(coerceSetting('files.autosave', 1)).toEqual({ ok: false });
  });

  test('passes through keys the schema does not describe (backward compatible)', () => {
    const value = { arbitrary: [1, 2, 3] };
    expect(coerceSetting('some.future.key', value)).toEqual({ ok: true, value });
  });

  test('validates the store keys newly given schema entries (UX-013a)', () => {
    // deploy.port: 1..65535
    expect(coerceSetting('deploy.port', 0)).toEqual({ ok: true, value: 1 });
    expect(coerceSetting('deploy.port', 70000)).toEqual({ ok: true, value: 65535 });
    // provider enums
    expect(coerceSetting('deploy.cloud.provider', 'fly')).toEqual({ ok: true, value: 'fly' });
    expect(coerceSetting('deploy.cloud.provider', 'heroku')).toEqual({ ok: false });
    expect(coerceSetting('deploy.ci.provider', 'gitlab')).toEqual({ ok: true, value: 'gitlab' });
    expect(coerceSetting('deploy.ci.provider', 'jenkins')).toEqual({ ok: false });
    // workbench.zoomLevel: -5..8
    expect(coerceSetting('workbench.zoomLevel', 20)).toEqual({ ok: true, value: 8 });
    expect(coerceSetting('workbench.zoomLevel', -20)).toEqual({ ok: true, value: -5 });
  });
});
