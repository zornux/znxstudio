/**
 * Internationalization engine (Phase 20B).
 *
 * A tiny, dependency-free message catalog + `t(key, params)` lookup with a
 * fallback chain (current locale → default `en` → the key itself, so a missing
 * translation degrades to something readable rather than blank). DOM-free and
 * synchronous; modules import the `t` binding and localize their user-facing
 * strings. Interpolation uses `{name}` placeholders.
 */
import { Emitter } from '../core/Emitter';

export type MessageCatalog = Record<string, string>;
export type TranslateParams = Record<string, string | number>;

/** Replace `{name}` tokens; an unknown token is left intact (never blanked). */
export function interpolate(message: string, params?: TranslateParams): string {
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : whole,
  );
}

class I18n {
  private readonly catalogs = new Map<string, MessageCatalog>();
  private locale = 'en';
  private readonly fallbackLocale = 'en';
  private readonly changeEmitter = new Emitter<string>();
  readonly onDidChangeLocale = this.changeEmitter.event;

  /** Merge a catalog into a locale (later registrations win per key). */
  register(locale: string, catalog: MessageCatalog): void {
    this.catalogs.set(locale, { ...this.catalogs.get(locale), ...catalog });
  }

  /** Switch locale. Unknown locales fall back to `en` rather than breaking. */
  setLocale(locale: string): void {
    const next = this.catalogs.has(locale) ? locale : this.fallbackLocale;
    if (next === this.locale) return;
    this.locale = next;
    this.changeEmitter.fire(next);
  }

  getLocale(): string {
    return this.locale;
  }

  locales(): string[] {
    return [...this.catalogs.keys()];
  }

  /** True when a key exists in the current locale or the fallback. */
  has(key: string): boolean {
    return Boolean(this.catalogs.get(this.locale)?.[key] ?? this.catalogs.get(this.fallbackLocale)?.[key]);
  }

  t(key: string, params?: TranslateParams): string {
    const message = this.catalogs.get(this.locale)?.[key] ?? this.catalogs.get(this.fallbackLocale)?.[key] ?? key;
    return interpolate(message, params);
  }

  /**
   * Plural-aware lookup (Phase 20J WI5). Selects the catalog entry
   * `${key}.${category}` for the count's CLDR plural category in the active
   * locale (`one` / `other` / `few` / `many` / …), falling back to `.other` then
   * the bare key. `{count}` is provided to interpolation automatically.
   */
  plural(key: string, count: number, params?: TranslateParams): string {
    const category = new Intl.PluralRules(this.localeTag()).select(count);
    const merged = { count, ...params };
    const catalog = this.catalogs.get(this.locale) ?? {};
    const fallback = this.catalogs.get(this.fallbackLocale) ?? {};
    const message =
      catalog[`${key}.${category}`] ??
      fallback[`${key}.${category}`] ??
      catalog[`${key}.other`] ??
      fallback[`${key}.other`] ??
      catalog[key] ??
      fallback[key] ??
      key;
    return interpolate(message, merged);
  }

  /** The active locale as a real BCP-47 tag Intl accepts (pseudo → en). */
  localeTag(): string {
    return this.locale === 'pseudo' ? 'en' : this.locale;
  }
}

export const i18n = new I18n();
export const t = (key: string, params?: TranslateParams): string => i18n.t(key, params);
/** Plural-aware translation: `tp('files.count', n)` → "1 file" / "3 files". */
export const tp = (key: string, count: number, params?: TranslateParams): string => i18n.plural(key, count, params);
