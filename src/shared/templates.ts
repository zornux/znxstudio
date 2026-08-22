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
import { TEMPLATE_ICONS } from './templateIcons';

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
      return { run: 'zornux serve .' };
    case 'zornux-mobile':
      return { run: 'zornux mobile run android', build: 'zornux mobile build android' };
    case 'zornux-zoijs-fullstack':
      return { run: 'zornux serve .', serve: 'python3 -m http.server 8000 --directory web' };
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

function znxstudioManifest(name: string, type: WorkspaceType, langs: string[], frameworks: string[], scriptsOverride?: Record<string, string>): string {
  const manifest = {
    name,
    type,
    version: '0.1.0',
    scripts: scriptsOverride ?? scriptsFor(type),
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

/* ----- Zornux Web API template files (layered architecture) ----- */

function todoApiFiles(): TemplateFile[] {
  return [
    {
      path: 'src/main.zx',
      content:
        '# Composition root — wires the layers and starts the server.\n' +
        '#   zornux run .     start the API\n' +
        '#   zornux check .   validate the project\n\n' +
        'import TodoController showing TodoApi\n' +
        'import TodoServiceModule showing TodoService\n\n' +
        'configuration AppConfig\n' +
        '    has listen_port as whole is 8080\nend\n\n' +
        'create settings from AppConfig\n\n' +
        'application\n' +
        '    use TodoService\n' +
        '    use TodoApi\nend\n\n' +
        'publish TodoApi on port settings.listen_port\n',
    },
    {
      path: 'src/models/todo.zx',
      content:
        'module TodoModels\n\n' +
        'public class Todo\n' +
        '    has id\n' +
        '    has title\n' +
        '    has completed\n' +
        'end\n',
    },
    {
      path: 'src/contracts/todo_store.zx',
      content:
        'module TodoContracts\n\n' +
        'public contract TodoStore\n' +
        '    requires function add with title\n' +
        '    requires function list_all\n' +
        '    requires function find_by_id with id\n' +
        '    requires function modify with id, title, completed\n' +
        '    requires function remove with id\n' +
        'end\n',
    },
    {
      path: 'src/requests/todo_requests.zx',
      content:
        'module TodoRequests\n\n' +
        'public record CreateTodoRequest\n' +
        '    has title\n' +
        '        required\n' +
        '        minimum length 1\n' +
        'end\n\n' +
        'public record UpdateTodoRequest\n' +
        '    has title\n' +
        '        required\n' +
        '        minimum length 1\n' +
        '    has completed\n' +
        'end\n',
    },
    {
      path: 'src/responses/api_responses.zx',
      content:
        'module TodoResponses\n\n' +
        'public function ok_envelope with data\n' +
        '    give back { "success": true, "data": data }\n' +
        'end\n\n' +
        'public function error_envelope with code, detail\n' +
        '    give back { "success": false, "error": { "code": code, "message": detail } }\n' +
        'end\n',
    },
    {
      path: 'src/services/todo_service.zx',
      content:
        'module TodoServiceModule\n\n' +
        'import TodoModels showing Todo\n\n' +
        'public service TodoService\n' +
        '    create store = []\n' +
        '    create next_id = 1\n\n' +
        '    function add with title\n' +
        '        create todo from Todo\n' +
        '        todo.id = next_id\n' +
        '        todo.title = title\n' +
        '        todo.completed = false\n' +
        '        next_id = next_id + 1\n' +
        '        store = add_item(store, todo)\n' +
        '        give back todo\n' +
        '    end\n\n' +
        '    function list_all\n' +
        '        give back store\n' +
        '    end\n\n' +
        '    function find_by_id with id\n' +
        '        for each todo in store\n' +
        '            if todo.id is id\n' +
        '                give back todo\n' +
        '            end\n' +
        '        end\n' +
        '        give back nothing\n' +
        '    end\n\n' +
        '    function modify with id, title, completed\n' +
        '        create updated = nothing\n' +
        '        create new_store = []\n' +
        '        for each todo in store\n' +
        '            if todo.id is id\n' +
        '                todo.title = title\n' +
        '                todo.completed = completed\n' +
        '                updated = todo\n' +
        '            end\n' +
        '            new_store = add_item(new_store, todo)\n' +
        '        end\n' +
        '        store = new_store\n' +
        '        give back updated\n' +
        '    end\n\n' +
        '    function remove with id\n' +
        '        create found = false\n' +
        '        create new_store = []\n' +
        '        for each todo in store\n' +
        '            if todo.id is id\n' +
        '                found = true\n' +
        '            else\n' +
        '                new_store = add_item(new_store, todo)\n' +
        '            end\n' +
        '        end\n' +
        '        store = new_store\n' +
        '        give back found\n' +
        '    end\n' +
        'end\n',
    },
    {
      path: 'src/controllers/todo_controller.zx',
      content:
        'module TodoController\n\n' +
        'import TodoRequests showing CreateTodoRequest, UpdateTodoRequest\n' +
        'import TodoResponses showing ok_envelope, error_envelope\n' +
        'import TodoServiceModule showing TodoService\n\n' +
        'public service TodoApi\n' +
        '    use TodoService\n\n' +
        '    on GET "/todos"\n' +
        '        create todos = TodoService.list_all()\n' +
        '        give back ok ok_envelope(todos)\n' +
        '    end\n\n' +
        '    on GET "/todos/:id"\n' +
        '        create todo = TodoService.find_by_id(id)\n' +
        '        if todo is nothing\n' +
        '            give back status 404 with body error_envelope("NOT_FOUND", "Todo not found")\n' +
        '        end\n' +
        '        give back ok ok_envelope(todo)\n' +
        '    end\n\n' +
        '    on POST "/todos" with CreateTodoRequest body\n' +
        '        create todo = TodoService.add(body.title)\n' +
        '        give back created ok_envelope(todo)\n' +
        '    end\n\n' +
        '    on PUT "/todos/:id" with UpdateTodoRequest body\n' +
        '        create todo = TodoService.modify(id, body.title, body.completed)\n' +
        '        if todo is nothing\n' +
        '            give back status 404 with body error_envelope("NOT_FOUND", "Todo not found")\n' +
        '        end\n' +
        '        give back ok ok_envelope(todo)\n' +
        '    end\n\n' +
        '    on DELETE "/todos/:id"\n' +
        '        create removed = TodoService.remove(id)\n' +
        '        if removed is false\n' +
        '            give back status 404 with body error_envelope("NOT_FOUND", "Todo not found")\n' +
        '        end\n' +
        '        give back no content\n' +
        '    end\n' +
        'end\n',
    },
  ];
}

export const PROJECT_TEMPLATES: readonly ProjectTemplate[] = [
  {
    id: 'zornux-mobile-blank',
    label: 'Zornux Mobile Application',
    description: 'A Zornux Mobile Android application with a single screen.',
    icon: TEMPLATE_ICONS['zornux-mobile-blank'],
    type: 'zornux-mobile',
    runZornuxInit: false,
    files: [
      {
        path: 'zornux.project',
        content:
          'name = ${name}\nversion = 0.1.0\ntype = mobile\nentry = main.zx\n\n' +
          'android.application_id = com.example.${androidName}\nandroid.version_code = 1\nandroid.min_sdk = 24\nandroid.target_sdk = 35\nandroid.compile_sdk = 35\n',
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
    icon: TEMPLATE_ICONS['zornux-mobile-nav'],
    type: 'zornux-mobile',
    runZornuxInit: false,
    files: [
      {
        path: 'zornux.project',
        content:
          'name = ${name}\nversion = 0.1.0\ntype = mobile\nentry = main.zx\n\n' +
          'android.application_id = com.example.${androidName}\nandroid.version_code = 1\nandroid.min_sdk = 24\nandroid.target_sdk = 35\nandroid.compile_sdk = 35\n',
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
    id: 'zornux-mobile-styled',
    label: 'Zornux Mobile Styled',
    description: 'A styled Zornux Mobile application with themes, animations, responsive layout, and gestures.',
    icon: TEMPLATE_ICONS['zornux-mobile-styled'],
    type: 'zornux-mobile',
    runZornuxInit: false,
    files: [
      {
        path: 'zornux.project',
        content:
          'name = ${name}\nversion = 0.1.0\ntype = mobile\nentry = main.zx\n\n' +
          'android.application_id = com.example.${androidName}\nandroid.version_code = 1\nandroid.min_sdk = 24\nandroid.target_sdk = 35\nandroid.compile_sdk = 35\n',
      },
      {
        path: 'main.zx',
        content:
          'mobile app "${name}"\n\n' +
          'theme AppTheme\n    primary "#6750A4"\n    secondary "#625B71"\n    background "#FFFBFE"\nend\n\n' +
          'tokens\n    spacing small 8\n    spacing medium 16\n    spacing large 24\nend\n\n' +
          'screen Home\n    state greeting = "Welcome to ${name}!"\n\n' +
          '    transition\n        enter slide_left\n        exit fade\n    end\n\n' +
          '    column\n        animate fade_in\n            duration 500\n        end\n\n' +
          '        text greeting\n            style\n                font_size 24\n' +
          '                color primary\n            end\n\n' +
          '        card\n            style\n                corner_radius 16\n' +
          '                elevation 4\n                padding 16\n' +
          '            end\n\n' +
          '            text "Swipe me!"\n\n' +
          '            when swiped left\n                show "Swiped left!"\n            end\n        end\n\n' +
          '        responsive\n            compact\n                text "Phone layout"\n' +
          '            end\n            expanded\n                text "Tablet layout"\n' +
          '            end\n        end\n\n' +
          '        button "Go to Details"\n' +
          '            when tapped\n                go to Details\n            end\n        end\n' +
          '    end\nend\n\n' +
          'screen Details\n    column\n        text "Details Screen"\n\n' +
          '        button "Go Back"\n            when tapped\n                go back\n' +
          '            end\n        end\n    end\nend\n\n' +
          'start with Home\n',
      },
      { path: 'znxstudio.project.json', content: '${znxstudio-mobile}' },
    ],
  },
  {
    id: 'zornux-empty',
    label: 'Empty Zornux Project',
    description: 'A minimal Zornux project — just what `zornux init` scaffolds (zornux.project + src/main.zx).',
    icon: TEMPLATE_ICONS['zornux-empty'],
    type: 'zornux-api',
    runZornuxInit: true,
    files: [],
  },
  {
    id: 'zornux-cli',
    label: 'Zornux CLI App',
    description: 'A command-line Zornux program with a small starter and an IDE manifest.',
    icon: TEMPLATE_ICONS['zornux-cli'],
    type: 'zornux-api',
    runZornuxInit: true,
    files: [
      { path: 'src/main.zx', content: 'show "Hello from ${name}!"\n\ncreate name = read_line("What is your name? ")\nshow "Nice to meet you, " + name + "."\n' },
      { path: 'znxstudio.project.json', content: '${znxstudio-cli}' },
      README('${name}', 'A Zornux command-line application.'),
    ],
  },
  {
    id: 'zornux-todo-api',
    label: 'Zornux Web API',
    description: 'A complete Zornux backend with layered architecture: model, contract, service, controller, validation, and configuration.',
    icon: TEMPLATE_ICONS['zornux-todo-api'],
    type: 'zornux-api',
    runZornuxInit: true,
    files: [
      ...todoApiFiles(),
      { path: 'zornux.config.zxcfg', content: 'listen_port is 8080\n' },
      { path: 'zornux.config.production.zxcfg', content: 'listen_port is 80\n' },
      { path: 'znxstudio.project.json', content: '${znxstudio-api}' },
      README('${name}', 'A Zornux Web API example. Demonstrates layered architecture, validation, dependency injection, and configuration. Use the Profiles view to switch environments.'),
    ],
  },
  {
    id: 'zornux-zoijs-fullstack',
    label: 'Zornux + Zoijs Fullstack',
    description: 'A full-stack app: a Zornux backend and a real Zoijs (.js) frontend.',
    icon: TEMPLATE_ICONS['zornux-zoijs-fullstack'],
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
    icon: TEMPLATE_ICONS['zoijs-frontend'],
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
    'znxstudio-cli': znxstudioManifest(name, 'zornux-api', ['zornux'], [], { run: 'zornux run .' }),
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
