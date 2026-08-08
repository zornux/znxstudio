import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from './harness';

describe('ZnxStudio design identity', () => {
  const css = readFileSync(join(process.cwd(), 'src/renderer/styles/main.css'), 'utf8');
  const output = readFileSync(join(process.cwd(), 'src/renderer/output/OutputModule.ts'), 'utf8');
  const themes = readFileSync(join(process.cwd(), 'src/renderer/themes/ThemeModule.ts'), 'utf8');

  test('defines the studio signal palette and geometry', () => {
    expect(css).toContain('--z-accent-secondary');
    expect(css).toContain('--z-radius-lg');
    expect(css).toContain('ZnxStudio identity layer');
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  test('distinguishes IDE logs from the interactive terminal', () => {
    expect(output).toContain("title: 'Logs'");
    expect(output).toContain('Workbench / Tasks');
    expect(css).toContain('.znxstudio-log-channelbar');
  });

  test('carries the studio signal through high-frequency workspace controls', () => {
    expect(css).toContain('.znxstudio-tree-row::after');
    expect(css).toContain('.znxstudio-term-tab.is-active::before');
    expect(css).toContain('.znxstudio-statusbar::before');
    expect(css).toContain('.znxstudio-template-card,');
  });

  test('frames the center workspace and adapts it for narrow windows', () => {
    expect(css).toContain('Identity pass III');
    expect(css).toContain('.znxstudio-welcome::before');
    expect(css).toContain('.znxstudio-settings-ui-group h2::before');
    expect(css).toContain("data-theme='znxstudio-hc-dark'");
    expect(css).toContain('@media (max-width: 640px)');
  });

  test('unifies transient UI, dense tools, and keyboard feedback', () => {
    expect(css).toContain('Identity pass IV');
    expect(css).toContain('button:focus-visible');
    expect(css).toContain("[class$='-toolbar']");
    expect(css).toContain('.znxstudio-diagnostics-list,');
    expect(css).toContain('.znxstudio-palette-item.is-selected,');
  });

  test('offers complete Tide and Dune theme palettes', () => {
    for (const id of ['znxstudio-tide', 'znxstudio-dune']) {
      expect(css).toContain(`data-theme='${id}'`);
      expect(themes).toContain(`'${id}'`);
      expect(themes).toContain(`defineTheme('${id}'`);
    }
    expect(themes).toContain("'znxstudio-tide': 'Tide'");
    expect(themes).toContain("'znxstudio-dune': 'Dune'");
  });
});
