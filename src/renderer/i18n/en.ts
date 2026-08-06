/**
 * English message catalog (Phase 20B) + the pseudo-locale transform.
 *
 * `en` is the source of truth and the fallback. `pseudo` is derived from it by
 * accenting letters and wrapping each string in ⟦ … ⟧ — the standard i18n
 * technique: it makes any string that came from the catalog visibly different, so
 * a hard-coded (un-externalized) string stands out immediately, and the added
 * width surfaces layouts that can't take longer translations.
 */
import type { MessageCatalog } from './i18n';

export const EN: MessageCatalog = {
  'app.subtitle': 'Enterprise IDE for Zornux & Zoijs',
  'sidebar.explorer': 'Explorer',

  // Editor toolbar actions (SB-5).
  'action.run': 'Run',
  'action.debug': 'Debug',
  'action.stop': 'Stop',
  'action.build': 'Build',
  'action.rebuild': 'Rebuild',

  // Status bar.
  'status.noFile': 'No file',
  'status.noFolder': 'No folder',

  // View menu (UX-3 / SB-3 / SB-4).
  'view.menu': 'View',
  'view.appearance': 'Appearance',
  'view.toggleSideBar': 'Toggle Side Bar',
  'view.togglePanel': 'Toggle Panel',
  'view.toggleActivityBar': 'Toggle Activity Bar',
  'view.toggleStatusBar': 'Toggle Status Bar',
  'view.toggleZen': 'Toggle Zen Mode',
  'view.workspaces': 'Workspaces',
  'view.panels': 'Panels',
  'view.openPanel': 'Open Panel…',
  'view.managePanels': 'Manage Panels…',
  'view.resetLayout': 'Reset Layout',

  // Common dialog actions (Phase 20J).
  'common.save': 'Save',
  'common.dontSave': "Don't Save",
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.close': 'Close',

  // Pluralized counts (Phase 20J WI5) — selected via Intl.PluralRules by `tp()`.
  'files.count.one': '{count} file',
  'files.count.other': '{count} files',
  'problems.count.one': '{count} problem',
  'problems.count.other': '{count} problems',
  'extensions.count.one': '{count} extension',
  'extensions.count.other': '{count} extensions',
  'modules.count.one': '{count} module',
  'modules.count.other': '{count} modules',
};

const ACCENTS: Record<string, string> = {
  a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', y: 'ý', n: 'ñ', c: 'ç', s: 'š',
  A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú', N: 'Ñ', C: 'Ç', S: 'Š',
};

/** Accent letters, but leave `{param}` placeholders untouched so interpolation still matches. */
export function pseudoString(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] === '{') {
      const end = text.indexOf('}', i);
      if (end >= 0) {
        out += text.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    }
    out += ACCENTS[text[i]] ?? text[i];
    i += 1;
  }
  return `⟦${out}⟧`;
}

export function pseudoLocalize(catalog: MessageCatalog): MessageCatalog {
  const out: MessageCatalog = {};
  for (const [key, value] of Object.entries(catalog)) out[key] = pseudoString(value);
  return out;
}
