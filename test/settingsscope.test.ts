import { describe, expect, test } from './harness';
import {
  LEGACY_OVERRIDES_KEY,
  effectiveSettings,
  getEffective,
  getUserValue,
  hasOverride,
  isOverridable,
  legacyOverridesFor,
  overriddenKeys,
  sanitizeWorkspaceSettings,
  withOverride,
  withoutLegacyRoot,
  withoutOverride,
} from '../src/renderer/settings/settingsScope';

describe('settingsScope — precedence', () => {
  test('workspace override wins over user value wins over fallback', () => {
    const user = { 'editor.fontSize': 13 };
    const ws = { 'editor.fontSize': 18 };
    expect(getEffective(user, ws, 'editor.fontSize', 12)).toBe(18); // override
    expect(getEffective(user, {}, 'editor.fontSize', 12)).toBe(13); // no override → user
    expect(getEffective(user, {}, 'editor.tabSize', 4)).toBe(4); // neither → fallback
  });

  test('a non-overridable key ignores any workspace value', () => {
    const user = { 'workbench.recentWorkspaces': ['real'] };
    const ws = { 'workbench.recentWorkspaces': ['bad'] };
    expect(getEffective(user, ws, 'workbench.recentWorkspaces', [])).toEqual(['real']);
    expect(hasOverride(ws, 'workbench.recentWorkspaces')).toBe(false);
  });
});

describe('settingsScope — overridability & sanitize', () => {
  test('isOverridable rejects the meta/global keys', () => {
    expect(isOverridable('editor.fontSize')).toBe(true);
    expect(isOverridable(LEGACY_OVERRIDES_KEY)).toBe(false);
    expect(isOverridable('workbench.recentWorkspaces')).toBe(false);
  });

  test('sanitizeWorkspaceSettings drops junk, arrays, and non-overridable keys', () => {
    expect(sanitizeWorkspaceSettings('nope')).toEqual({});
    expect(sanitizeWorkspaceSettings(['a'])).toEqual({});
    expect(
      sanitizeWorkspaceSettings({ 'editor.fontSize': 20, 'workbench.recentWorkspaces': ['x'], [LEGACY_OVERRIDES_KEY]: {} }),
    ).toEqual({ 'editor.fontSize': 20 });
  });
});

describe('settingsScope — mutation is immutable', () => {
  test('withOverride adds without mutating the source', () => {
    const ws = { 'editor.tabSize': 2 };
    const next = withOverride(ws, 'editor.fontSize', 20);
    expect(next).toEqual({ 'editor.tabSize': 2, 'editor.fontSize': 20 });
    expect(ws).toEqual({ 'editor.tabSize': 2 }); // unchanged
  });

  test('withoutOverride removes the key immutably', () => {
    const ws = { 'editor.fontSize': 20, 'editor.tabSize': 2 };
    expect(withoutOverride(ws, 'editor.fontSize')).toEqual({ 'editor.tabSize': 2 });
    expect(withoutOverride(ws, 'missing')).toBe(ws); // no-op returns same ref
  });

  test('withOverride refuses a non-overridable key', () => {
    let threw = false;
    try {
      withOverride({}, LEGACY_OVERRIDES_KEY, {});
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});

describe('settingsScope — introspection & display', () => {
  test('overriddenKeys / hasOverride / getUserValue', () => {
    const user = { 'editor.fontSize': 13, 'editor.tabSize': 4 };
    const ws = { 'editor.fontSize': 20 };
    expect(overriddenKeys(ws)).toEqual(new Set(['editor.fontSize']));
    expect(hasOverride(ws, 'editor.fontSize')).toBe(true);
    expect(hasOverride(ws, 'editor.tabSize')).toBe(false);
    expect(getUserValue(user, 'editor.fontSize')).toBe(13); // ignores the override
    expect(getUserValue(user, 'missing')).toBe(undefined);
  });

  test('effectiveSettings overlays overrides and hides the legacy key', () => {
    const user = { 'editor.fontSize': 13, 'files.autosave': true, [LEGACY_OVERRIDES_KEY]: { r: {} } };
    const ws = { 'editor.fontSize': 20 };
    const eff = effectiveSettings(user, ws);
    expect(eff['editor.fontSize']).toBe(20);
    expect(eff['files.autosave']).toBe(true);
    expect(LEGACY_OVERRIDES_KEY in eff).toBe(false);
  });
});

describe('settingsScope — legacy migration (UX-021 → folder file)', () => {
  test('legacyOverridesFor reads a root bucket (normalized) and sanitizes it', () => {
    const user = { [LEGACY_OVERRIDES_KEY]: { 'c:/studio apps/demo': { 'editor.fontSize': 18, [LEGACY_OVERRIDES_KEY]: {} } } };
    expect(legacyOverridesFor(user, 'C:\\Studio Apps\\Demo')).toEqual({ 'editor.fontSize': 18 });
    expect(legacyOverridesFor({}, 'C:\\x')).toEqual({});
  });

  test('withoutLegacyRoot prunes one root, and returns undefined when empty', () => {
    const user = {
      [LEGACY_OVERRIDES_KEY]: { 'c:/a': { 'editor.fontSize': 1 }, 'c:/b': { 'editor.fontSize': 2 } },
    };
    expect(withoutLegacyRoot(user, 'C:\\a')).toEqual({ 'c:/b': { 'editor.fontSize': 2 } });
    const single = { [LEGACY_OVERRIDES_KEY]: { 'c:/a': { 'editor.fontSize': 1 } } };
    expect(withoutLegacyRoot(single, 'C:\\a')).toBe(undefined); // nothing legacy remains
  });
});
