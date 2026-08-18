/**
 * Project template catalog (Phase 5G). Pure data + rendering so it is
 * unit-testable and shared between the renderer (gallery UI) and the scaffold
 * request it builds.
 *
 * Design: Zornux-based templates scaffold the authoritative `zornux.project`
 * via the REAL `zornux init` (so the manifest is exactly what the compiler
 * writes — no hand-rolled drift), then layer template-specific files on top
 * (overriding init's placeholder `src/main.zx` where a template supplies one).
 * `${name}` in any file body is replaced with the project name.
 */
import type { WorkspaceType } from './types';

export interface TemplateFile {
  /** Path relative to the project directory, using forward slashes. */
  path: string;
  content: string;
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  icon: string;
  type: WorkspaceType;
  /** Run the real `zornux init` first for an authoritative zornux.project. */
  runZornuxInit: boolean;
  /** Copy the ZoiJS runtime into this relative directory so the project works out-of-box. */
  vendorZoijsDir?: string;
  /** Files written after init (may override init's src/main.zx). */
  files: TemplateFile[];
}

/** A concrete, rendered scaffold (placeholders resolved). */
export interface RenderedTemplate {
  runZornuxInit: boolean;
  vendorZoijsDir?: string;
  files: TemplateFile[];
}

/**
 * Technology-specific run/serve scripts. A ZoiJS-only project is served statically (no
 * build, no compiler) and must NEVER carry a `zornux run` command — that would point a
 * pure-JS project at a compiler and a `.zx` entry it doesn't have. Zornux and full-stack
 * projects run the compiler on their `.zx` entry; full-stack also serves its web/ folder.
 */
function scriptsFor(type: WorkspaceType): Record<string, string> {
  switch (type) {
    case 'zornux-api':
      return { run: 'zornux run src/main.zx' };
    case 'zornux-mobile':
      return { run: 'zornux mobile run android', build: 'zornux mobile build android' };
    case 'zornux-zoijs-fullstack':
      return { run: 'zornux run src/main.zx', serve: 'python3 -m http.server 8000 --directory web' };
    case 'zoijs-frontend':
      return { serve: 'python3 -m http.server 8000' };
    default:
      return {};
  }
}

/** Source/generated dirs per technology (a no-build ZoiJS project has no generated dir). */
function workspaceDirsFor(type: WorkspaceType): { sourceDirs: string[]; generatedDirs: string[]; configFiles: string[] } {
  const configFiles = ['znxstudio.project.json'];
  switch (type) {
    case 'zornux-mobile':
      return { sourceDirs: ['.'], generatedDirs: ['.zornux'], configFiles: ['zornux.project', ...configFiles] };
    case 'zornux-zoijs-fullstack':
      return { sourceDirs: ['src', 'web'], generatedDirs: ['dist'], configFiles };
    case 'zoijs-frontend':
      return { sourceDirs: ['src'], generatedDirs: [], configFiles };
    case 'zornux-api':
    default:
      return { sourceDirs: ['src'], generatedDirs: ['dist'], configFiles };
  }
}

function znxstudioManifest(name: string, type: WorkspaceType, langs: string[], frameworks: string[]): string {
  const manifest = {
    name,
    type,
    version: '0.1.0',
    scripts: scriptsFor(type),
    languageTargets: langs,
    frameworkTargets: frameworks,
    extensionRequirements: [],
    workspace: workspaceDirsFor(type),
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const README = (name: string, blurb: string): TemplateFile => ({
  path: 'README.md',
  content: `# ${name}\n\n${blurb}\n\nScaffolded with ZnxStudio.\n`,
});

/* ----- real Zoijs (no-build JS framework) file bodies -----
 * These are single-quoted string concatenations (NOT template literals), so the
 * `${name}` project-name token and the literal Zoijs bindings `${() => ...}`
 * pass through verbatim — renderTemplate substitutes only `${name}`. */

/** A Zoijs App component: a plain-JS function returning an `html` template. */
const zoijsApp = (): string =>
  'import { html, createState } from "@zoijs/core";\n\n' +
  'export function App() {\n' +
  '  const count = createState(0);\n\n' +
  '  return html`\n' +
  '    <main>\n' +
  '      <h1>Hello ${name}</h1>\n' +
  '      <button onclick=${() => count.set(count.get() + 1)}>\n' +
  '        Count: ${() => count.get()}\n' +
  '      </button>\n' +
  '    </main>\n' +
  '  `;\n' +
  '}\n';

const zoijsMain = (appPath: string): string =>
  'import { mount } from "@zoijs/core";\n' +
  'import { App } from "' + appPath + '";\n\n' +
  'mount(() => App(), "#app");\n';

const zoijsIndexHtml = (mainSrc: string): string =>
  '<!doctype html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1" />\n' +
  '    <title>${name}</title>\n' +
  '    <!-- No build step: bare specifiers resolve via this import map. -->\n' +
  '    <script type="importmap">\n' +
  '      {\n' +
  '        "imports": {\n' +
  '          "@zoijs/core": "/vendor/zoijs/core/index.js",\n' +
  '          "@zoijs/router": "/vendor/zoijs/router/index.js",\n' +
  '          "@zoijs/head": "/vendor/zoijs/head/index.js"\n' +
  '        }\n' +
  '      }\n' +
  '    </script>\n' +
  '  </head>\n  <body>\n    <div id="app"></div>\n' +
  '    <script type="module" src="' + mainSrc + '"></script>\n' +
  '  </body>\n</html>\n';

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'zornux-mobile-blank',
    label: 'Zornux Mobile Application',
    description: 'A Zornux Mobile Android application with a single screen.',
    icon: '📱',
    type: 'zornux-mobile',
    runZornuxInit: false,
    files: [
      {
        path: 'zornux.project',
        content:
          'name = ${name}\nversion = 0.1.0\ntype = mobile\nentry = main.zx\n\n' +
          'android.application_id = com.example.${androidName}\nandroid.min_sdk = 24\nandroid.target_sdk = 34\n',
      },
      {
        path: 'main.zx',
        content:
          'mobile app "${name}"\n\nscreen Home\n    state greeting = "Hello from ${name}!"\n\n' +
          '    column\n        text greeting\n    end\nend\n\nstart with Home\n',
      },
      { path: 'znxstudio.project.json', content: '${znxstudio-mobile}' },
    ],
  },
  {
    id: 'zornux-mobile-nav',
    label: 'Zornux Mobile Navigation',
    description: 'A Zornux Mobile Android application with two screens and navigation.',
    icon: '📱',
    type: 'zornux-mobile',
    runZornuxInit: false,
    files: [
      {
        path: 'zornux.project',
        content:
          'name = ${name}\nversion = 0.1.0\ntype = mobile\nentry = main.zx\n\n' +
          'android.application_id = com.example.${androidName}\nandroid.min_sdk = 24\nandroid.target_sdk = 34\n',
      },
      {
        path: 'main.zx',
        content:
          'mobile app "${name}"\n\nscreen Home\n    state greeting = "Welcome to ${name}!"\n\n' +
          '    column\n        text greeting\n\n        button "Go to Details"\n' +
          '            when tapped\n                go to Details\n            end\n        end\n' +
          '    end\nend\n\nscreen Details\n    column\n        text "Details Screen"\n\n' +
          '        button "Go Back"\n            when tapped\n                go back\n            end\n' +
          '        end\n    end\nend\n\nstart with Home\n',
      },
      { path: 'znxstudio.project.json', content: '${znxstudio-mobile}' },
    ],
  },
  {
    id: 'zornux-empty',
    label: 'Empty Zornux Project',
    description: 'A minimal Zornux project — just what `zornux init` scaffolds (zornux.project + src/main.zx).',
    icon: '📦',
    type: 'zornux-api',
    runZornuxInit: true,
    files: [],
  },
  {
    id: 'zornux-cli',
    label: 'Zornux CLI App',
    description: 'A command-line Zornux program with a small starter and an IDE manifest.',
    icon: '🛠',
    type: 'zornux-api',
    runZornuxInit: true,
    files: [
      { path: 'src/main.zx', content: 'show "Hello from ${name}!"\n\nlet name = ask "What is your name? "\nshow "Nice to meet you, " + name + "."\n' },
      { path: 'znxstudio.project.json', content: '${znxstudio-api}' },
      README('${name}', 'A Zornux command-line application.'),
    ],
  },
  {
    id: 'zornux-service',
    label: 'Configured Zornux Service',
    description: 'A Zornux web service with layered configuration (base + production) — pairs with Workspace Profiles.',
    icon: '⚙',
    type: 'zornux-api',
    runZornuxInit: true,
    files: [
      {
        path: 'src/main.zx',
        content:
          'configuration AppConfig {\n  host: text = "localhost"\n  listen_port: whole = 8080\n}\n\nserve on AppConfig.listen_port\nshow "${name} listening on " + AppConfig.host + ":" + AppConfig.listen_port\n',
      },
      { path: 'zornux.config.zxcfg', content: 'host = "localhost"\nlisten_port = 8080\n' },
      { path: 'zornux.config.production.zxcfg', content: 'host = "0.0.0.0"\nlisten_port = 80\n' },
      { path: 'znxstudio.project.json', content: '${znxstudio-api}' },
      README('${name}', 'A configurable Zornux web service. Use the Profiles view to switch environments.'),
    ],
  },
  {
    id: 'zornux-zoijs-fullstack',
    label: 'Zornux + Zoijs Fullstack',
    description: 'A full-stack app: a Zornux backend and a real Zoijs (.js) frontend.',
    icon: '🧩',
    type: 'zornux-zoijs-fullstack',
    runZornuxInit: true,
    vendorZoijsDir: 'web/vendor/zoijs',
    files: [
      { path: 'src/main.zx', content: 'show "${name} backend online."\n' },
      { path: 'web/index.html', content: zoijsIndexHtml('/web/main.js') },
      { path: 'web/main.js', content: zoijsMain('./App.js') },
      { path: 'web/App.js', content: zoijsApp() },
      { path: 'znxstudio.project.json', content: '${znxstudio-fullstack}' },
      README('${name}', 'A Zornux + Zoijs full-stack application. Frontend is no-build Zoijs (serve web/).'),
    ],
  },
  {
    id: 'zoijs-frontend',
    label: 'Zoijs Frontend',
    description: 'A no-build Zoijs single-page frontend (real .js components + import map).',
    icon: '🎨',
    type: 'zoijs-frontend',
    runZornuxInit: false,
    vendorZoijsDir: 'vendor/zoijs',
    files: [
      { path: 'index.html', content: zoijsIndexHtml('/src/main.js') },
      { path: 'src/main.js', content: zoijsMain('./App.js') },
      { path: 'src/App.js', content: zoijsApp() },
      { path: 'znxstudio.project.json', content: '${znxstudio-zoijs}' },
      README('${name}', 'A Zoijs frontend application. Serve this folder (e.g. python -m http.server) — no build step.'),
    ],
  },
];

export function findTemplate(id: string): ProjectTemplate | undefined {
  return PROJECT_TEMPLATES.find((template) => template.id === id);
}

/** Resolve a template's files for a project name (substitutes `${name}` + manifest macros). */
export function renderTemplate(template: ProjectTemplate, name: string): RenderedTemplate {
  const macros: Record<string, string> = {
    'znxstudio-api': znxstudioManifest(name, 'zornux-api', ['zornux'], []),
    'znxstudio-mobile': znxstudioManifest(name, 'zornux-mobile', ['zornux'], []),
    'znxstudio-fullstack': znxstudioManifest(name, 'zornux-zoijs-fullstack', ['zornux', 'javascript'], ['zoijs']),
    'znxstudio-zoijs': znxstudioManifest(name, 'zoijs-frontend', ['javascript'], ['zoijs']),
  };
  const files = template.files.map((file) => ({
    path: file.path,
    content: substitute(file.content, name, macros),
  }));
  return { runZornuxInit: template.runZornuxInit, vendorZoijsDir: template.vendorZoijsDir, files };
}

function substitute(content: string, name: string, macros: Record<string, string>): string {
  // A whole-file manifest macro (e.g. "${znxstudio-api}") expands first.
  const macroMatch = /^\$\{(znxstudio-[a-z]+)\}$/.exec(content.trim());
  if (macroMatch && macros[macroMatch[1]]) return macros[macroMatch[1]];
  const androidName = name.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^[^a-z_]/, '_');
  return content.replace(/\$\{androidName\}/g, androidName).replace(/\$\{name\}/g, name);
}
