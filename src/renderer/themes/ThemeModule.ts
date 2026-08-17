import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type ExternalThemeData,
  type SettingsService,
  type StatusService,
  type ThemeService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { Disposable, IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { showModal } from '../ui/modal';
import type { ServiceRegistry } from '../core/ServiceRegistry';
import { DEFAULT_KEYWORD_COLOR } from '../settings/SettingsSchema';
import { ZORNUX_MONARCH } from '../language/languages/zornux/grammar';

const THEMES = [
  'system',
  'znxstudio-dark',
  'znxstudio-light',
  'znxstudio-tide',
  'znxstudio-dune',
  'znxstudio-hc-dark',
  'znxstudio-hc-light',
] as const;
const THEME_LABELS: Record<string, string> = {
  system: 'System',
  'znxstudio-dark': 'Dark',
  'znxstudio-light': 'Light',
  'znxstudio-tide': 'Tide',
  'znxstudio-dune': 'Dune',
  'znxstudio-hc-dark': 'High Contrast Dark',
  'znxstudio-hc-light': 'High Contrast Light',
};

/**
 * Theme system. Registers Monaco themes, drives the CSS variable set via
 * `data-theme`, persists the active theme through the settings service, and
 * publishes a status segment. Exposes a ThemeService (with a change event).
 */
export class ThemeModule implements IModule, ThemeService {
  readonly id = 'znxstudio.themes';
  readonly displayName = 'Theme System';

  private theme: string = 'znxstudio-dark';
  private keywordColor = DEFAULT_KEYWORD_COLOR;
  private services: ServiceRegistry | undefined;
  /** Extension-contributed themes, by id. */
  private readonly external = new Map<string, ExternalThemeData>();
  /** Inline `--z-*` custom properties currently set on <html> for an external theme. */
  private appliedVars: string[] = [];
  private systemMediaQuery: MediaQueryList | undefined;
  private systemListener: (() => void) | undefined;

  private readonly changeEmitter = new Emitter<string>();
  readonly onDidChange = this.changeEmitter.event;

  activate(context: ModuleContext): void {
    this.services = context.services;

    const settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    this.keywordColor = sanitizeColor(settings?.get('editor.keywordColor', DEFAULT_KEYWORD_COLOR));
    this.defineThemes();

    // Re-color keywords live when the user changes editor.keywordColor.
    if (settings) context.subscriptions.push(settings.onDidChange((event) => {
      if (event.key !== 'editor.keywordColor') return;
      this.keywordColor = sanitizeColor(settings.get('editor.keywordColor', DEFAULT_KEYWORD_COLOR));
      this.defineThemes();
      monaco.editor.setTheme(this.theme); // re-apply so the new rule takes effect
    }));

    context.services.register(ServiceKeys.Theme, this);
    context.commands.register(CommandIds.ThemeToggle, () => this.toggle(), 'Preferences: Toggle Color Theme');
    context.commands.register(CommandIds.ThemeSelect, () => this.pickTheme(), 'Preferences: Select Color Theme…');
    this.apply(this.theme);

    void selfTestCoordinator.run('themes', () => this.maybeSelfTest());
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) -----
   * Regression guard for the comment-highlighting bug: keywords inside a hash
   * line comment or a block comment must tokenize as `comment`, never `keyword`.
   * Uses the real Monaco Monarch tokenizer for the registered `zornux` language. */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string): void => console.info(`[selftest] ${message}`);

    // Tokenize against the real Zornux Monarch grammar. Register it under a
    // throwaway language id so the check does not depend on a `.zx` editor having
    // opened (which is what registers the live `zornux` tokenizer).
    const langId = 'zornux-syntax-selftest';
    if (!monaco.languages.getLanguages().some((l) => l.id === langId)) {
      monaco.languages.register({ id: langId });
      monaco.languages.setMonarchTokensProvider(langId, ZORNUX_MONARCH as monaco.languages.IMonarchLanguage);
    }
    const tokenize = (text: string) => monaco.editor.tokenize(text, langId)[0] ?? [];

    // Hash line comment: from the `#` onward must all be `comment`, with no keyword
    // (define/show/give) inside it tokenized as a keyword.
    const lineSrc = 'create x = 5 # define show give';
    const afterHash = tokenize(lineSrc).filter((t) => t.offset >= lineSrc.indexOf('#'));
    const lineTypes = afterHash.map((t) => t.type);
    const lineAllComment = lineTypes.length > 0 && lineTypes.every((t) => t.includes('comment'));
    const lineNoKeyword = !lineTypes.some((t) => t.includes('keyword'));

    // Block comment on one line: no keyword token inside the span.
    const blockSrc = 'create /* define show */ x';
    const open = blockSrc.indexOf('/*');
    const close = blockSrc.indexOf('*/') + 2;
    const blockNoKeyword = !tokenize(blockSrc).some((t) => t.offset >= open && t.offset < close && t.type.includes('keyword'));

    log(
      `syntaxcomment REAL: lineAfterHash=[${lineTypes.join(',')}] allComment=${lineAllComment} ` +
        `lineNoKeyword=${lineNoKeyword} blockNoKeyword=${blockNoKeyword} ` +
        `(expect comment tokens only, no keyword coloring inside comments)`,
    );
  }

  /**
   * (Re)register the built-in Monaco themes. Keyword coloring is driven by the
   * user's `editor.keywordColor` setting (default a vivid pink), applied as a
   * token rule on top of each base theme so it survives a theme switch.
   */
  private defineThemes(): void {
    const kw = this.keywordColor.replace('#', '');
    const kwRule = { token: 'keyword', foreground: kw, fontStyle: 'bold' };

    monaco.editor.defineTheme('znxstudio-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.quote', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'operator', foreground: 'D4D4D4' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'type', foreground: '4EC9B0' },
      ],
      colors: {
        'editor.background': '#1a1b1e',
        'editor.foreground': '#d7d9de',
        'editorLineNumber.foreground': '#4a4e57',
        'editorLineNumber.activeForeground': '#a0a4ad',
        'editor.selectionBackground': '#3a3f4b',
        'editorCursor.foreground': '#7657e8',
        'editor.lineHighlightBackground': '#ffffff08',
        'editorBracketMatch.background': '#ffffff15',
        'editorBracketMatch.border': '#88888880',
      },
    });
    monaco.editor.defineTheme('znxstudio-light', {
      base: 'vs',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.quote', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'operator', foreground: '1f2328' },
        { token: 'identifier', foreground: '001080' },
        { token: 'type', foreground: '267F99' },
      ],
      colors: {
        'editor.background': '#ffffff',
        'editor.foreground': '#1f2328',
        'editorLineNumber.foreground': '#b0b3b8',
        'editorLineNumber.activeForeground': '#5a5d63',
        'editor.selectionBackground': '#add6ff80',
        'editorCursor.foreground': '#6547d5',
        'editor.lineHighlightBackground': '#00000006',
        'editorBracketMatch.background': '#00000012',
        'editorBracketMatch.border': '#b0b0b080',
      },
    });
    monaco.editor.defineTheme('znxstudio-tide', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '709A82', fontStyle: 'italic' },
        { token: 'string', foreground: 'A7CF8D' },
        { token: 'string.quote', foreground: 'A7CF8D' },
        { token: 'number', foreground: 'E0A76C' },
        { token: 'operator', foreground: 'd7e4e5' },
        { token: 'identifier', foreground: '8ECDD5' },
        { token: 'type', foreground: '72C3D4' },
      ],
      colors: {
        'editor.background': '#101b22',
        'editor.foreground': '#d7e4e5',
        'editorLineNumber.foreground': '#58717a',
        'editorLineNumber.activeForeground': '#b7cbcf',
        'editor.selectionBackground': '#255b6670',
        'editorCursor.foreground': '#49c5b6',
        'editor.lineHighlightBackground': '#ffffff06',
        'editorBracketMatch.background': '#ffffff12',
        'editorBracketMatch.border': '#70909880',
      },
    });
    monaco.editor.defineTheme('znxstudio-dune', {
      base: 'vs',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '687A56', fontStyle: 'italic' },
        { token: 'string', foreground: '7A5B2E' },
        { token: 'string.quote', foreground: '7A5B2E' },
        { token: 'number', foreground: 'A24F35' },
        { token: 'operator', foreground: '2f2a24' },
        { token: 'identifier', foreground: '3D5A28' },
        { token: 'type', foreground: '176F73' },
      ],
      colors: {
        'editor.background': '#f7f1e6',
        'editor.foreground': '#2f2a24',
        'editorLineNumber.foreground': '#9a8e7f',
        'editorLineNumber.activeForeground': '#51483e',
        'editor.selectionBackground': '#9d70ac38',
        'editorCursor.foreground': '#7d438f',
        'editor.lineHighlightBackground': '#00000005',
        'editorBracketMatch.background': '#00000010',
        'editorBracketMatch.border': '#9a8e7f80',
      },
    });
    monaco.editor.defineTheme('znxstudio-hc-dark', {
      base: 'hc-black',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '7CA668', fontStyle: 'italic' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'identifier', foreground: '9CDCFE' },
        { token: 'type', foreground: '4EC9B0' },
      ],
      colors: { 'editor.background': '#000000', 'editor.foreground': '#ffffff' },
    });
    monaco.editor.defineTheme('znxstudio-hc-light', {
      base: 'hc-light',
      inherit: true,
      rules: [
        kwRule,
        { token: 'comment', foreground: '008000', fontStyle: 'italic' },
        { token: 'string', foreground: 'A31515' },
        { token: 'number', foreground: '098658' },
        { token: 'identifier', foreground: '001080' },
        { token: 'type', foreground: '267F99' },
      ],
      colors: { 'editor.background': '#ffffff', 'editor.foreground': '#000000' },
    });
  }

  /** Show a theme picker listing every built-in and contributed theme. */
  private async pickTheme(): Promise<void> {
    const buttons = THEMES.map((name) => ({
      label: THEME_LABELS[name] ?? name,
      value: name,
      primary: name === this.theme,
    }));
    const choice = await showModal({ title: 'Select Color Theme', body: 'Choose a color theme:', buttons });
    if (choice && choice !== 'cancel') this.apply(choice);
  }

  apply(name: string): void {
    // An unknown name (e.g. a persisted external theme not yet re-registered at startup)
    // falls back to the default so the workbench never lands on a theme with no variables.
    if (!THEMES.includes(name as (typeof THEMES)[number]) && !this.external.has(name)) {
      name = 'znxstudio-dark';
    }
    // Tear down any previous system-theme listener.
    this.detachSystemListener();

    if (name === 'system') {
      this.theme = 'system';
      this.attachSystemListener();
      const resolved = resolveSystemTheme();
      this.clearExternalVars();
      document.documentElement.dataset.theme = resolved;
      monaco.editor.setTheme(resolved);
      this.services?.tryGet<SettingsService>(ServiceKeys.Settings)?.set('workbench.theme', 'system');
      persistThemeHint('system');
      this.setStatus('system');
      this.changeEmitter.fire('system');
      return;
    }

    if (this.external.has(name)) {
      this.applyExternal(this.external.get(name)!);
      return;
    }
    // Built-in theme: clear any external inline overrides so its CSS block governs fully.
    this.clearExternalVars();
    this.theme = name;
    document.documentElement.dataset.theme = name;
    monaco.editor.setTheme(name);

    // Persist if settings is available (guarded to avoid a feedback loop —
    // SettingsService.set is a no-op when the value is unchanged).
    this.services?.tryGet<SettingsService>(ServiceKeys.Settings)?.set('workbench.theme', name);
    persistThemeHint(name);
    this.setStatus(name);
    this.changeEmitter.fire(name);
  }

  /** Register an extension-contributed theme; dispose removes it (reverting if it's active). */
  register(theme: ExternalThemeData): Disposable {
    this.external.set(theme.id, theme);
    this.changeEmitter.fire(this.theme);
    return {
      dispose: () => {
        this.external.delete(theme.id);
        if (this.theme === theme.id) this.apply('znxstudio-dark');
        else this.changeEmitter.fire(this.theme);
      },
    };
  }

  /** Apply an external theme: base data-theme fills gaps; validated tokens override inline. */
  private applyExternal(theme: ExternalThemeData): void {
    this.theme = theme.id;
    const base = theme.type === 'dark' ? 'znxstudio-dark' : 'znxstudio-light';
    document.documentElement.dataset.theme = base;
    this.clearExternalVars();
    for (const [cssVar, color] of Object.entries(theme.cssVars)) {
      document.documentElement.style.setProperty(cssVar, color);
      this.appliedVars.push(cssVar);
    }
    const monacoId = `ext-${theme.id}`;
    monaco.editor.defineTheme(monacoId, {
      base: theme.type === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [{ token: 'keyword', foreground: this.keywordColor.replace('#', '') }],
      colors: {
        'editor.background': theme.cssVars['--z-bg'] ?? (theme.type === 'dark' ? '#1a1b1e' : '#ffffff'),
        'editor.foreground': theme.cssVars['--z-fg'] ?? (theme.type === 'dark' ? '#d7d9de' : '#1f2328'),
      },
    });
    monaco.editor.setTheme(monacoId);
    this.services?.tryGet<SettingsService>(ServiceKeys.Settings)?.set('workbench.theme', theme.id);
    persistThemeHint(theme.type === 'dark' ? 'znxstudio-dark' : 'znxstudio-light');
    this.setStatus(theme.id);
    this.changeEmitter.fire(theme.id);
  }

  private clearExternalVars(): void {
    for (const cssVar of this.appliedVars) document.documentElement.style.removeProperty(cssVar);
    this.appliedVars = [];
  }

  private setStatus(name: string): void {
    const label = THEME_LABELS[name] ?? this.external.get(name)?.label ?? name;
    this.services?.tryGet<StatusService>(ServiceKeys.Status)?.setItem('theme', {
      text: `Theme ${label}`,
      tooltip: 'Toggle color theme',
      command: CommandIds.ThemeToggle,
      side: 'right',
      priority: 20,
    });
  }

  private attachSystemListener(): void {
    this.systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemListener = () => {
      if (this.theme !== 'system') return;
      const resolved = resolveSystemTheme();
      this.clearExternalVars();
      document.documentElement.dataset.theme = resolved;
      monaco.editor.setTheme(resolved);
      this.changeEmitter.fire('system');
    };
    this.systemMediaQuery.addEventListener('change', this.systemListener);
  }

  private detachSystemListener(): void {
    if (this.systemMediaQuery && this.systemListener) {
      this.systemMediaQuery.removeEventListener('change', this.systemListener);
    }
    this.systemMediaQuery = undefined;
    this.systemListener = undefined;
  }

  toggle(): void {
    this.apply(this.theme === 'znxstudio-dark' ? 'znxstudio-light' : 'znxstudio-dark');
  }

  current(): string {
    return this.theme;
  }

  list(): string[] {
    return [...THEMES, ...this.external.keys()];
  }
}

function persistThemeHint(name: string): void {
  try {
    localStorage.setItem('znxstudio-theme', name);
  } catch { /* quota or sandboxing — non-critical */ }
}

function resolveSystemTheme(): string {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'znxstudio-dark'
    : 'znxstudio-light';
}

function sanitizeColor(value: unknown): string {
  if (typeof value === 'string' && /^#?[0-9a-fA-F]{6}$/.test(value.trim())) {
    const hex = value.trim().replace('#', '');
    return `#${hex}`;
  }
  return DEFAULT_KEYWORD_COLOR;
}
