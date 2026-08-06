import { describe, expect, test } from './harness';
import { i18n, tp } from '../src/renderer/i18n/i18n';
import { EN } from '../src/renderer/i18n/en';
import {
  direction,
  formatBytes,
  formatNumber,
  formatRelativeTime,
  localeTag,
  pluralCategory,
} from '../src/renderer/i18n/format';

// The engine defaults to `en`; register it so lookups resolve in the test env.
i18n.register('en', EN);

describe('i18n format — locale-aware numbers/bytes', () => {
  test('formatNumber groups by the active locale (en)', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
  });
  test('formatBytes scales to human units', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB');
  });
});

describe('i18n format — relative time', () => {
  test('past and future read naturally', () => {
    expect(formatRelativeTime(-90)).toBe('1 minute ago');
    expect(formatRelativeTime(-3600)).toBe('1 hour ago');
    expect(formatRelativeTime(7200)).toBe('in 2 hours');
    expect(formatRelativeTime(0)).toBe('now');
  });
});

describe('i18n format — direction (RTL seam)', () => {
  test('english is ltr; arabic/hebrew are rtl', () => {
    expect(direction('en')).toBe('ltr');
    expect(direction('pseudo')).toBe('ltr');
    expect(direction('ar')).toBe('rtl');
    expect(direction('he')).toBe('rtl');
  });
  test('the pseudo locale formats as a real BCP-47 tag', () => {
    expect(localeTag('pseudo')).toBe('en');
    expect(localeTag('en')).toBe('en');
  });
});

describe('i18n pluralization (Intl.PluralRules)', () => {
  test('CLDR category for a count (en)', () => {
    expect(pluralCategory(1)).toBe('one');
    expect(pluralCategory(0)).toBe('other');
    expect(pluralCategory(2)).toBe('other');
  });
  test('tp() selects the right form and interpolates {count}', () => {
    expect(tp('files.count', 1)).toBe('1 file');
    expect(tp('files.count', 3)).toBe('3 files');
    expect(tp('files.count', 0)).toBe('0 files');
    expect(tp('extensions.count', 1)).toBe('1 extension');
    expect(tp('modules.count', 5)).toBe('5 modules');
  });
  test('an unknown plural key degrades to the key, never throws', () => {
    expect(tp('nope.count', 2)).toBe('nope.count');
  });
});

describe('i18n catalog coverage + pseudo detector', () => {
  test('every plural key ships both one and other forms', () => {
    for (const base of ['files.count', 'problems.count', 'extensions.count', 'modules.count']) {
      expect(typeof EN[`${base}.one`]).toBe('string');
      expect(typeof EN[`${base}.other`]).toBe('string');
    }
  });
  test('common dialog actions are externalized', () => {
    for (const key of ['common.save', 'common.dontSave', 'common.cancel']) {
      expect(typeof EN[key]).toBe('string');
    }
  });
});
