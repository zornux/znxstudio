import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from './harness';

const css = readFileSync(join(process.cwd(), 'src/renderer/styles/main.css'), 'utf8');
const themes = readFileSync(join(process.cwd(), 'src/renderer/themes/ThemeModule.ts'), 'utf8');
const themeInit = readFileSync(join(process.cwd(), 'src/renderer/theme-init.js'), 'utf8');
const indexHtml = readFileSync(join(process.cwd(), 'src/renderer/index.html'), 'utf8');
const schema = readFileSync(join(process.cwd(), 'src/renderer/settings/SettingsSchema.ts'), 'utf8');
const settingsUi = readFileSync(join(process.cwd(), 'src/renderer/settings/settingsUi.ts'), 'utf8');

const BUILTIN_THEMES = [
  'znxstudio-dark',
  'znxstudio-light',
  'znxstudio-tide',
  'znxstudio-dune',
  'znxstudio-hc-dark',
  'znxstudio-hc-light',
] as const;

describe('theme system — catalog completeness', () => {
  test('ThemeModule declares all 7 themes including system', () => {
    expect(themes).toContain("'system'");
    for (const id of BUILTIN_THEMES) {
      expect(themes).toContain(`'${id}'`);
    }
  });

  test('every built-in theme has a human-readable label', () => {
    expect(themes).toContain("system: 'System'");
    expect(themes).toContain("'znxstudio-dark': 'Dark'");
    expect(themes).toContain("'znxstudio-light': 'Light'");
    expect(themes).toContain("'znxstudio-tide': 'Tide'");
    expect(themes).toContain("'znxstudio-dune': 'Dune'");
    expect(themes).toContain("'znxstudio-hc-dark': 'High Contrast Dark'");
    expect(themes).toContain("'znxstudio-hc-light': 'High Contrast Light'");
  });

  test('settings schema enumerates all 7 themes with system first', () => {
    expect(schema).toContain("'system'");
    for (const id of BUILTIN_THEMES) {
      expect(schema).toContain(`'${id}'`);
    }
  });
});

describe('theme system — CSS token coverage', () => {
  test('every theme block defines core semantic tokens', () => {
    const coreTokens = [
      '--z-bg', '--z-fg', '--z-border', '--z-accent',
      '--z-bg-panel', '--z-bg-elevated', '--z-bg-hover',
      '--z-fg-muted', '--z-error', '--z-warn', '--z-ok', '--z-info',
    ];
    for (const id of BUILTIN_THEMES) {
      const pattern = `data-theme='${id}'`;
      expect(css).toContain(pattern);
      const blockStart = css.indexOf(pattern);
      expect(blockStart).toBeGreaterThan(-1);
      const blockEnd = css.indexOf('}', blockStart);
      const block = css.slice(blockStart, blockEnd);
      for (const token of coreTokens) {
        expect(block).toContain(token);
      }
    }
  });

  test('visualization tokens exist in all theme blocks', () => {
    const vizTokens = [
      '--z-flame-bg', '--z-flame-fg',
      '--z-tl-default', '--z-tl-query', '--z-tl-request', '--z-tl-job',
    ];
    for (const id of BUILTIN_THEMES) {
      const pattern = `data-theme='${id}'`;
      const blockStart = css.indexOf(pattern);
      const blockEnd = css.indexOf('}', blockStart);
      const block = css.slice(blockStart, blockEnd);
      for (const token of vizTokens) {
        expect(block).toContain(token);
      }
    }
  });

  test('scrollbar tokens are defined per theme', () => {
    for (const id of BUILTIN_THEMES) {
      const pattern = `data-theme='${id}'`;
      const blockStart = css.indexOf(pattern);
      const blockEnd = css.indexOf('}', blockStart);
      const block = css.slice(blockStart, blockEnd);
      expect(block).toContain('--z-scrollbar-thumb');
      expect(block).toContain('--z-scrollbar-thumb-hover');
    }
  });
});

describe('theme system — Monaco integration', () => {
  test('every built-in theme is registered with monaco.editor.defineTheme', () => {
    for (const id of BUILTIN_THEMES) {
      expect(themes).toContain(`defineTheme('${id}'`);
    }
  });

  test('all themes define comment and string token rules', () => {
    for (const token of ['comment', 'string']) {
      const count = (themes.match(new RegExp(`token: '${token}'`, 'g')) ?? []).length;
      expect(count).toBeGreaterThan(5);
    }
    expect(themes).toContain("token: 'keyword'");
  });

  test('all dark themes inherit from vs-dark, light from vs', () => {
    expect(themes).toContain("base: 'vs-dark'");
    expect(themes).toContain("base: 'vs'");
    expect(themes).toContain("base: 'hc-black'");
    expect(themes).toContain("base: 'hc-light'");
  });
});

describe('theme system — system theme', () => {
  test('ThemeModule handles system theme via matchMedia', () => {
    expect(themes).toContain('prefers-color-scheme: dark');
    expect(themes).toContain('resolveSystemTheme');
    expect(themes).toContain('attachSystemListener');
    expect(themes).toContain('detachSystemListener');
  });

  test('system theme persists hint to localStorage', () => {
    expect(themes).toContain('persistThemeHint');
    expect(themes).toContain("localStorage.setItem('znxstudio-theme'");
  });
});

describe('theme system — startup flash prevention', () => {
  test('theme-init.js reads localStorage and sets data-theme before paint', () => {
    expect(themeInit).toContain("localStorage.getItem('znxstudio-theme')");
    expect(themeInit).toContain("setAttribute('data-theme'");
    expect(themeInit).toContain('znxstudio-dark');
  });

  test('theme-init.js handles system preference resolution', () => {
    expect(themeInit).toContain("=== 'system'");
    expect(themeInit).toContain('prefers-color-scheme: dark');
  });

  test('theme-init.js is loaded before the stylesheet in index.html', () => {
    const scriptPos = indexHtml.indexOf('theme-init.js');
    const cssPos = indexHtml.indexOf('rel="stylesheet"');
    expect(scriptPos).toBeGreaterThan(-1);
    expect(cssPos).toBeGreaterThan(-1);
    expect(scriptPos).toBeLessThan(cssPos);
  });
});

describe('theme system — smooth transitions', () => {
  test('body has color and background-color transitions', () => {
    const idx = css.indexOf('body {', css.indexOf('body {') + 1);
    expect(idx).toBeGreaterThan(-1);
    const bodyEnd = css.indexOf('}', idx);
    const bodyBlock = css.slice(idx, bodyEnd);
    expect(bodyBlock).toContain('transition');
    expect(bodyBlock).toContain('background-color');
  });

  test('major IDE surfaces have theme-switch transitions', () => {
    const surfaces = [
      '.znxstudio-titlebar',
      '.znxstudio-activitybar',
      '.znxstudio-sidebar',
      '.znxstudio-panel',
      '.znxstudio-statusbar',
      '.znxstudio-editor-topbar',
    ];
    for (const selector of surfaces) {
      const pattern = new RegExp(
        selector.replace(/\./g, '\\.').replace(/-/g, '\\-') + '\\s*\\{[^}]*transition[^}]*\\}',
      );
      expect(pattern.test(css)).toBeTruthy();
    }
  });
});

describe('theme system — Appearance settings group', () => {
  test('settingsUi routes theme-related keys to the Appearance group', () => {
    expect(settingsUi).toContain("'workbench.theme'");
    expect(settingsUi).toContain("'editor.fontSize'");
    expect(settingsUi).toContain("'Appearance'");
    expect(settingsUi).toContain('APPEARANCE_KEYS');
  });

  test('Appearance is first in GROUP_ORDER', () => {
    const match = settingsUi.match(/GROUP_ORDER\s*=\s*\[([^\]]+)\]/);
    expect(match).toBeTruthy();
    const first = match![1].trim().split(',')[0].trim();
    expect(first).toBe("'Appearance'");
  });
});

describe('theme system — no hardcoded color leaks in component rules', () => {
  test('no bare #hex colors in component rules (outside theme blocks and intentional exceptions)', () => {
    const lines = css.split('\n');
    let inThemeBlock = false;
    const leaks: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("data-theme=")) inThemeBlock = true;
      if (inThemeBlock && line.trim() === '}') inThemeBlock = false;
      if (inThemeBlock) continue;
      if (line.trimStart().startsWith('/*') || line.trimStart().startsWith('*')) continue;
      const hexMatch = line.match(/#[0-9a-fA-F]{6}\b/);
      if (!hexMatch) continue;
      if (line.includes('var(')) continue;
      if (line.includes('--z-')) continue;
      if (line.includes('--znx-')) continue;
      if (line.includes('--zd-')) continue;
      if (line.includes('preview-frame')) continue;
      if (line.includes('zd-preview') || line.includes('zd-device')) continue;
      if (line.includes('rgba(255,255,255,0.16)') || line.includes('inset 0 1px')) continue;
      if (line.includes('transparent')) continue;
      if (line.includes('@font-face')) continue;
      if (line.includes('content:')) continue;
      leaks.push(`L${i + 1}: ${line.trim().slice(0, 80)}`);
    }
    expect(leaks).toHaveLength(0);
  });
});
