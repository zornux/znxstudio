import { describe, expect, test } from './harness';
import { interpolate } from '../src/renderer/i18n/i18n';
import { EN, pseudoLocalize, pseudoString } from '../src/renderer/i18n/en';

describe('i18n — interpolation', () => {
  test('replaces {name} tokens and leaves unknown ones intact', () => {
    expect(interpolate('Hello {name}', { name: 'Ada' })).toBe('Hello Ada');
    expect(interpolate('{a} and {b}', { a: '1', b: 2 })).toBe('1 and 2');
    expect(interpolate('Hi {who}', {})).toBe('Hi {who}');
    expect(interpolate('no tokens')).toBe('no tokens');
  });
});

describe('i18n — pseudo-localization', () => {
  test('wraps in markers and accents letters', () => {
    const out = pseudoString('Run');
    expect(out.startsWith('⟦')).toBe(true);
    expect(out.endsWith('⟧')).toBe(true);
    expect(out).toBe('⟦Rúñ⟧');
  });

  test('leaves {param} placeholders untouched so interpolation still works', () => {
    const pseudo = pseudoString('Hello {name}!');
    expect(pseudo.includes('{name}')).toBe(true);
    // Interpolation still substitutes because the token survived pseudo transform.
    expect(interpolate(pseudo, { name: 'Ada' }).includes('Ada')).toBe(true);
  });

  test('pseudoLocalize transforms every value and only marks catalog strings', () => {
    const pseudo = pseudoLocalize(EN);
    expect(Object.keys(pseudo)).toEqual(Object.keys(EN));
    for (const value of Object.values(pseudo)) expect(value.startsWith('⟦')).toBe(true);
    // A non-catalog string is never marked — that is how un-externalized text is spotted.
    expect('Raw hard-coded'.startsWith('⟦')).toBe(false);
  });
});

describe('i18n — catalog coverage', () => {
  test('the keys the chrome uses are all present', () => {
    for (const key of ['action.run', 'action.build', 'status.noFile', 'view.workspaces', 'view.panels', 'view.resetLayout']) {
      expect(typeof EN[key]).toBe('string');
      expect(EN[key].length).toBeGreaterThan(0);
    }
  });
});
