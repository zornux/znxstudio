/**
 * i18n barrel (Phase 20B). Importing this registers the built-in locales as a
 * side effect, so any module that does `import { t } from '../i18n'` gets a
 * populated catalog. `en` is the fallback; `pseudo` is the localization-testing
 * locale derived from it.
 */
import { i18n } from './i18n';
import { EN, pseudoLocalize } from './en';
import { direction } from './format';

i18n.register('en', EN);
i18n.register('pseudo', pseudoLocalize(EN));

/**
 * RTL readiness (Phase 20J WI5): keep the document's writing direction in sync
 * with the active locale. English is LTR, but the seam means adding an RTL locale
 * flips the whole layout with no further wiring. Guarded so the DOM-free test
 * harness (no `document`) can import the catalog safely. This is also the first
 * real `onDidChangeLocale` consumer — live locale switching now drives the DOM.
 */
function applyDirection(): void {
  if (typeof document !== 'undefined') document.documentElement.dir = direction();
}
applyDirection();
i18n.onDidChangeLocale(applyDirection);

export { i18n, t, tp, interpolate } from './i18n';
export type { MessageCatalog, TranslateParams } from './i18n';
export {
  direction,
  localeTag,
  formatNumber,
  formatBytes,
  formatDate,
  formatTime,
  formatRelativeTime,
  pluralCategory,
} from './format';
