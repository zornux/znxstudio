/**
 * Locale-aware formatting (Phase 20J WI5).
 *
 * The engine ships English only, but every user-visible number, date, time and
 * relative time must go through `Intl` keyed off the ACTIVE locale — so the day a
 * real locale is added, formatting follows automatically instead of being frozen
 * to `toISOString()` / bare `toLocaleString()`. Pluralization uses
 * `Intl.PluralRules`, so counts read correctly in any language's plural system.
 *
 * DOM-free and dependency-free; consumers import these helpers instead of
 * hand-formatting. The locale is resolved to a real BCP-47 tag (the `pseudo`
 * testing locale formats as `en`).
 */
import { i18n } from './i18n';

/** Map an engine locale to a real BCP-47 tag Intl understands (pseudo → en). */
export function localeTag(locale = i18n.getLocale()): string {
  return locale === 'pseudo' ? 'en' : locale;
}

/** Writing direction for a locale. English/pseudo are LTR; the seam supports RTL. */
export function direction(locale = i18n.getLocale()): 'ltr' | 'rtl' {
  const RTL = new Set(['ar', 'he', 'fa', 'ur']);
  const base = localeTag(locale).split('-')[0];
  return RTL.has(base) ? 'rtl' : 'ltr';
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(), options).format(value);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(value, { maximumFractionDigits: unit === 0 ? 0 : 1 })} ${units[unit]}`;
}

export function formatDate(date: Date, options: Intl.DateTimeFormatOptions = { dateStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(localeTag(), options).format(date);
}

export function formatTime(date: Date, options: Intl.DateTimeFormatOptions = { timeStyle: 'medium' }): string {
  return new Intl.DateTimeFormat(localeTag(), options).format(date);
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
  ['second', 1],
];

/** Human "3 minutes ago" / "in 2 days" from a delta in SECONDS (negative = past). */
export function formatRelativeTime(deltaSeconds: number): string {
  const rtf = new Intl.RelativeTimeFormat(localeTag(), { numeric: 'auto' });
  const abs = Math.abs(deltaSeconds);
  for (const [unit, secs] of RELATIVE_UNITS) {
    if (abs >= secs || unit === 'second') {
      return rtf.format(Math.round(deltaSeconds / secs), unit);
    }
  }
  return rtf.format(0, 'second');
}

/** The CLDR plural category for a count in the active locale (`one`, `other`, …). */
export function pluralCategory(count: number): Intl.LDMLPluralRule {
  return new Intl.PluralRules(localeTag()).select(count);
}
