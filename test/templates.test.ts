import { describe, expect, test } from './harness';
import { PROJECT_TEMPLATES, findTemplate, renderTemplate } from '../src/shared/templates';

describe('project template catalog', () => {
  test('exposes templates with unique ids', () => {
    expect(PROJECT_TEMPLATES.length).toBeGreaterThan(3);
    const ids = new Set(PROJECT_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(PROJECT_TEMPLATES.length);
  });

  test('findTemplate resolves by id', () => {
    expect(findTemplate('zornux-cli')?.label).toBe('Zornux CLI App');
    expect(findTemplate('nope')).toBeFalsy();
  });

  test('the empty Zornux template is init-only (no extra files)', () => {
    const empty = findTemplate('zornux-empty')!;
    expect(empty.runZornuxInit).toBeTruthy();
    const rendered = renderTemplate(empty, 'demo');
    expect(rendered.files).toHaveLength(0);
    expect(rendered.runZornuxInit).toBeTruthy();
  });

  test('the Zoijs frontend is files-only (no compiler needed)', () => {
    const zoijs = findTemplate('zoijs-frontend')!;
    expect(zoijs.runZornuxInit).toBeFalsy();
  });
});

describe('renderTemplate substitution', () => {
  test('replaces ${name} in file bodies', () => {
    const cli = findTemplate('zornux-cli')!;
    const rendered = renderTemplate(cli, 'Widgets');
    const main = rendered.files.find((f) => f.path === 'src/main.zx');
    expect(main).toBeTruthy();
    expect(main?.content).toContain('Widgets');
    const readme = rendered.files.find((f) => f.path === 'README.md');
    expect(readme?.content).toContain('# Widgets');
  });

  test('expands the whole-file manifest macro into JSON with the name and type', () => {
    const cli = findTemplate('zornux-cli')!;
    const rendered = renderTemplate(cli, 'Widgets');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
    expect(manifest).toBeTruthy();
    const parsed = JSON.parse(manifest!.content) as { name: string; type: string; languageTargets: string[] };
    expect(parsed.name).toBe('Widgets');
    expect(parsed.type).toBe('zornux-api');
    expect(parsed.languageTargets).toContain('zornux');
  });

  test('fullstack manifest declares both zornux and zoijs targets', () => {
    const full = findTemplate('zornux-zoijs-fullstack')!;
    const rendered = renderTemplate(full, 'Shop');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
    const parsed = JSON.parse(manifest!.content) as { type: string; frameworkTargets: string[] };
    expect(parsed.type).toBe('zornux-zoijs-fullstack');
    expect(parsed.frameworkTargets).toContain('zoijs');
    // The Zoijs frontend is real, runnable .js (a function returning html`...`).
    const component = rendered.files.find((f) => f.path === 'web/App.js');
    expect(component?.content).toContain('Shop');
    expect(component?.content).toContain('@zoijs/core');
    expect(component?.content).toContain('html`');
  });

  test('Zoijs templates emit real runnable .js — never a fictional .zoijs file', () => {
    for (const id of ['zornux-zoijs-fullstack', 'zoijs-frontend']) {
      const rendered = renderTemplate(findTemplate(id)!, 'demo');
      const paths = rendered.files.map((f) => f.path);
      expect(paths.some((p) => p.endsWith('.zoijs'))).toBeFalsy();
      expect(paths.some((p) => p.endsWith('App.js'))).toBeTruthy();
      expect(paths.some((p) => p.endsWith('index.html'))).toBeTruthy();
      // The App keeps the literal Zoijs reactive binding (not substituted away).
      const app = rendered.files.find((f) => f.path.endsWith('App.js'))!;
      expect(app.content).toContain('${() => count.get()}');
    }
  });

  test('the ZoiJS manifest is technology-specific — no Zornux run/language leaks', () => {
    const rendered = renderTemplate(findTemplate('zoijs-frontend')!, 'Web');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json')!;
    const parsed = JSON.parse(manifest.content) as {
      scripts: Record<string, string>;
      languageTargets: string[];
      frameworkTargets: string[];
    };
    // A pure-JS project must never carry a `zornux run` command or the zornux language.
    const scripts = Object.values(parsed.scripts).join(' ');
    expect(scripts.includes('zornux')).toBeFalsy();
    expect(scripts.includes('.zx')).toBeFalsy();
    expect(parsed.scripts.serve).toBeTruthy(); // served statically, no build
    expect(parsed.languageTargets).toContain('javascript');
    expect(parsed.languageTargets.includes('zornux')).toBeFalsy();
    expect(parsed.frameworkTargets).toContain('zoijs');
  });

  test('the Zornux CLI manifest runs the compiler on its .zx entry', () => {
    const rendered = renderTemplate(findTemplate('zornux-cli')!, 'Cli');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json')!;
    const parsed = JSON.parse(manifest.content) as { scripts: Record<string, string> };
    expect(parsed.scripts.run).toBe('zornux run src/main.zx');
  });

  test('the fullstack manifest runs Zornux for the backend and serves the web/ frontend', () => {
    const rendered = renderTemplate(findTemplate('zornux-zoijs-fullstack')!, 'Shop');
    const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json')!;
    const parsed = JSON.parse(manifest.content) as { scripts: Record<string, string> };
    expect(parsed.scripts.run).toContain('zornux run');
    expect(parsed.scripts.serve).toContain('web');
  });

  test('the configured service ships layered .zxcfg files', () => {
    const service = findTemplate('zornux-service')!;
    const rendered = renderTemplate(service, 'Api');
    const paths = rendered.files.map((f) => f.path);
    expect(paths).toContain('zornux.config.zxcfg');
    expect(paths).toContain('zornux.config.production.zxcfg');
  });
});
