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

  test('the Todo API ships layered .zxcfg files', () => {
    const todo = findTemplate('zornux-todo-api')!;
    const rendered = renderTemplate(todo, 'Api');
    const paths = rendered.files.map((f) => f.path);
    expect(paths).toContain('zornux.config.zxcfg');
    expect(paths).toContain('zornux.config.production.zxcfg');
  });

  test('mobile application IDs remain valid when project names contain punctuation', () => {
    const rendered = renderTemplate(findTemplate('zornux-mobile-blank')!, 'My-Mobile.App');
    const project = rendered.files.find((file) => file.path === 'zornux.project')!;
    expect(project.content).toContain('android.application_id = com.example.my_mobile_app');
    expect(project.content).toContain('name = My-Mobile.App');
  });
});

describe('Zornux template syntax correctness', () => {
  const INVALID_ZORNUX_PATTERNS = [
    { pattern: /\blet\s+\w+\s*=/, label: 'let (use create)' },
    { pattern: /\bask\s+"/, label: 'ask (use read_line())' },
    { pattern: /\bconfiguration\s+\w+\s*\{/, label: 'configuration with { (use end)' },
    { pattern: /\bserve\s+on\b/, label: 'serve on (not a keyword)' },
    { pattern: /\bvar\s+\w+/, label: 'var (use create)' },
    { pattern: /\bconst\s+\w+/, label: 'const (use create)' },
    { pattern: /\breturn\s/, label: 'return (use give back)' },
    { pattern: /\bfunction\s+\w+\s*\(/, label: 'function with () (use with)' },
  ];

  for (const tmpl of PROJECT_TEMPLATES) {
    if (tmpl.type === 'zoijs-frontend') continue;
    const zxFiles = tmpl.files.filter((f) => f.path.endsWith('.zx'));
    for (const file of zxFiles) {
      test(`${tmpl.id}/${file.path} contains no invalid Zornux syntax`, () => {
        const rendered = renderTemplate(tmpl, 'TestApp');
        const renderedFile = rendered.files.find((f) => f.path === file.path)!;
        for (const { pattern, label } of INVALID_ZORNUX_PATTERNS) {
          expect(pattern.test(renderedFile.content)).toBeFalsy();
        }
      });
    }
  }
});

describe('Todo REST API template structure', () => {
  const rendered = renderTemplate(findTemplate('zornux-todo-api')!, 'MyTodos');

  test('generates the expected project file set', () => {
    const paths = rendered.files.map((f) => f.path).sort();
    expect(paths).toContain('src/main.zx');
    expect(paths).toContain('src/models/todo.zx');
    expect(paths).toContain('src/contracts/todo_store.zx');
    expect(paths).toContain('src/requests/todo_requests.zx');
    expect(paths).toContain('src/responses/api_responses.zx');
    expect(paths).toContain('src/services/todo_service.zx');
    expect(paths).toContain('src/controllers/todo_controller.zx');
    expect(paths).toContain('zornux.config.zxcfg');
    expect(paths).toContain('zornux.config.production.zxcfg');
    expect(paths).toContain('znxstudio.project.json');
    expect(paths).toContain('README.md');
  });

  test('main.zx is the composition root with imports, configuration, application, and publish', () => {
    const main = rendered.files.find((f) => f.path === 'src/main.zx')!;
    expect(main.content).toContain('import TodoController');
    expect(main.content).toContain('import TodoServiceModule');
    expect(main.content).toContain('configuration AppConfig');
    expect(main.content).toContain('has listen_port as whole is 8080');
    expect(main.content).toContain('create settings from AppConfig');
    expect(main.content).toContain('application');
    expect(main.content).toContain('publish TodoApi');
  });

  test('Todo model is a class with id, title, and completed fields', () => {
    const model = rendered.files.find((f) => f.path === 'src/models/todo.zx')!;
    expect(model.content).toContain('module TodoModels');
    expect(model.content).toContain('public class Todo');
    expect(model.content).toContain('has id');
    expect(model.content).toContain('has title');
    expect(model.content).toContain('has completed');
  });

  test('contract defines the TodoStore interface', () => {
    const contract = rendered.files.find((f) => f.path === 'src/contracts/todo_store.zx')!;
    expect(contract.content).toContain('public contract TodoStore');
    expect(contract.content).toContain('requires function add');
    expect(contract.content).toContain('requires function list_all');
    expect(contract.content).toContain('requires function find_by_id');
    expect(contract.content).toContain('requires function modify');
    expect(contract.content).toContain('requires function remove');
  });

  test('request records have declarative validation', () => {
    const requests = rendered.files.find((f) => f.path === 'src/requests/todo_requests.zx')!;
    expect(requests.content).toContain('public record CreateTodoRequest');
    expect(requests.content).toContain('public record UpdateTodoRequest');
    expect(requests.content).toContain('required');
    expect(requests.content).toContain('minimum length 1');
  });

  test('service implements the contract', () => {
    const service = rendered.files.find((f) => f.path === 'src/services/todo_service.zx')!;
    expect(service.content).toContain('public class TodoService follows TodoStore');
    expect(service.content).toContain('import TodoContracts showing TodoStore');
    expect(service.content).toContain('import TodoModels showing Todo');
  });

  test('controller has all five CRUD routes with correct status codes', () => {
    const ctrl = rendered.files.find((f) => f.path === 'src/controllers/todo_controller.zx')!;
    expect(ctrl.content).toContain('on GET "/todos"');
    expect(ctrl.content).toContain('on GET "/todos/:id"');
    expect(ctrl.content).toContain('on POST "/todos" with CreateTodoRequest body');
    expect(ctrl.content).toContain('on PUT "/todos/:id" with UpdateTodoRequest body');
    expect(ctrl.content).toContain('on DELETE "/todos/:id"');
    expect(ctrl.content).toContain('give back ok');
    expect(ctrl.content).toContain('give back created');
    expect(ctrl.content).toContain('give back no content');
    expect(ctrl.content).toContain('give back status 404');
  });

  test('controller handles not-found errors', () => {
    const ctrl = rendered.files.find((f) => f.path === 'src/controllers/todo_controller.zx')!;
    expect(ctrl.content).toContain('if todo is nothing');
    expect(ctrl.content).toContain('error_envelope("NOT_FOUND"');
  });

  test('controller uses dependency injection for the service', () => {
    const ctrl = rendered.files.find((f) => f.path === 'src/controllers/todo_controller.zx')!;
    expect(ctrl.content).toContain('use TodoService');
    expect(ctrl.content).toContain('TodoService.list_all()');
    expect(ctrl.content).toContain('TodoService.add(');
  });
});

describe('cross-language isolation', () => {
  test('Zornux templates never contain JavaScript imports or JSX', () => {
    const zornuxTemplates = PROJECT_TEMPLATES.filter(
      (t) => t.type === 'zornux-api' || t.type === 'zornux-mobile',
    );
    for (const tmpl of zornuxTemplates) {
      const rendered = renderTemplate(tmpl, 'Test');
      for (const file of rendered.files) {
        if (!file.path.endsWith('.zx')) continue;
        expect(file.content.includes('import {')).toBeFalsy();
        expect(file.content.includes('export ')).toBeFalsy();
        expect(file.content.includes('<div')).toBeFalsy();
      }
    }
  });

  test('ZoiJS templates never contain Zornux keywords', () => {
    const zoijsTemplates = PROJECT_TEMPLATES.filter(
      (t) => t.type === 'zoijs-frontend',
    );
    for (const tmpl of zoijsTemplates) {
      const rendered = renderTemplate(tmpl, 'Test');
      for (const file of rendered.files) {
        if (!file.path.endsWith('.js')) continue;
        expect(file.content.includes('give back')).toBeFalsy();
        expect(file.content.includes('create ')).toBeFalsy();
        expect(file.content.includes('configuration ')).toBeFalsy();
        expect(file.content.includes('service ')).toBeFalsy();
      }
    }
  });
});

describe('every template generates a valid IDE manifest', () => {
  for (const tmpl of PROJECT_TEMPLATES) {
    if (tmpl.files.length === 0) continue;
    test(`${tmpl.id} manifest has correct type and language targets`, () => {
      const rendered = renderTemplate(tmpl, 'Proj');
      const manifest = rendered.files.find((f) => f.path === 'znxstudio.project.json');
      expect(manifest).toBeTruthy();
      const parsed = JSON.parse(manifest!.content) as {
        name: string;
        type: string;
        version: string;
        scripts: Record<string, string>;
        languageTargets: string[];
      };
      expect(parsed.name).toBe('Proj');
      expect(parsed.type).toBe(tmpl.type);
      expect(parsed.version).toBe('0.1.0');
      expect(parsed.languageTargets.length).toBeGreaterThan(0);
    });
  }
});
