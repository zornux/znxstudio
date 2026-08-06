import { describe, expect, test } from './harness';
import { isZoijsSource, scanZoijsImports } from '../src/renderer/zoijs/zoijsDetect';
import { scanHtmlBindings } from '../src/renderer/zoijs/zoijsBindings';
import { analyzeZoijs } from '../src/renderer/zoijs/zoijsDiagnostics';
import { isInHtmlTemplate } from '../src/renderer/zoijs/zoijsBindings';
import { zoijsCompletions, zoijsComponentCompletions, zoijsHover } from '../src/renderer/zoijs/zoijsCompletions';
import { zoijsPackageExports } from '../src/renderer/zoijs/zoijsApi';
import { scanZoijsComponents, matchBrace } from '../src/renderer/zoijs/zoijsComponents';
import { analyzeZoijsComponents } from '../src/renderer/zoijs/zoijsComponentDiagnostics';
import { templateContextAt, htmlTagCompletions, htmlAttributeCompletions } from '../src/renderer/zoijs/zoijsHtml';
import { analyzeReactiveGraph, matchParen } from '../src/renderer/zoijs/zoijsReactivity';
import { scanRoutes, analyzeRoutes } from '../src/renderer/zoijs/zoijsRouter';
import { DevtoolsModel, BRIDGE_CALLBACKS, ZOIJS_DEVTOOLS_BRIDGE } from '../src/renderer/zoijs/zoijsDevtools';

describe('Zoijs detection', () => {
  test('isZoijsSource recognizes an @zoijs import', () => {
    expect(isZoijsSource('import { html } from "@zoijs/core";')).toBeTruthy();
    expect(isZoijsSource("import { createRouter } from '@zoijs/router'")).toBeTruthy();
    expect(isZoijsSource('import { useState } from "react";')).toBeFalsy();
  });

  test('scanZoijsImports captures package + symbol positions', () => {
    const imports = scanZoijsImports('import { html, createState } from "@zoijs/core";');
    expect(imports).toHaveLength(1);
    expect(imports[0].package).toBe('@zoijs/core');
    expect(imports[0].symbols.map((s) => s.name)).toEqual(['html', 'createState']);
    // Column of `html` (0-based) — right after `import { `.
    expect(imports[0].symbols[0].startCol).toBe(9);
  });

  test('scanZoijsImports handles a renamed import (validates the source name)', () => {
    const imports = scanZoijsImports('import { html as h } from "@zoijs/core";');
    expect(imports[0].symbols[0].name).toBe('html');
  });
});

describe('scanHtmlBindings', () => {
  test('finds interpolations inside html`` and ignores plain template literals', () => {
    const bindings = scanHtmlBindings('const x = `${a}`;\nconst y = html`<b>${count.get()}</b>`;');
    expect(bindings).toHaveLength(1);
    expect(bindings[0].expr).toBe('count.get()');
  });

  test('handles nested html`` inside each()', () => {
    const src = 'html`<ul>${each(() => xs.get(), (i) => i.id, (i) => html`<li>${() => i.name}</li>`)}</ul>`';
    const exprs = scanHtmlBindings(src).map((b) => b.expr.trim());
    // Outer each(...) binding + the inner `() => i.name` binding.
    expect(exprs.some((e) => e.startsWith('each('))).toBeTruthy();
    expect(exprs).toContain('() => i.name');
  });
});

describe('analyzeZoijs diagnostics', () => {
  test('flags a bare state read in markup as non-reactive', () => {
    const diags = analyzeZoijs('import { html } from "@zoijs/core";\nexport const V = html`<span>${count.get()}</span>`;');
    const reactive = diags.filter((d) => d.code === 'ZOIJS-REACTIVE');
    expect(reactive).toHaveLength(1);
    expect(reactive[0].severity).toBe('warning');
  });

  test('does NOT flag a wrapped reactive binding', () => {
    const diags = analyzeZoijs('import { html } from "@zoijs/core";\nexport const V = html`<span>${() => count.get()}</span>`;');
    expect(diags.filter((d) => d.code === 'ZOIJS-REACTIVE')).toHaveLength(0);
  });

  test('does NOT flag each(() => xs.get(), ...) (a valid list, not a bare read)', () => {
    const diags = analyzeZoijs('import { html, each } from "@zoijs/core";\nexport const V = html`<ul>${each(() => xs.get(), (i) => i.id, (i) => html`<li>${() => i.n}</li>`)}</ul>`;');
    expect(diags.filter((d) => d.code === 'ZOIJS-REACTIVE')).toHaveLength(0);
  });

  test('flags an unknown named import from a cataloged @zoijs package', () => {
    const diags = analyzeZoijs('import { html, nope } from "@zoijs/core";');
    const unknown = diags.filter((d) => d.code === 'ZOIJS-UNKNOWN-EXPORT');
    expect(unknown).toHaveLength(1);
    expect(unknown[0].message).toContain('nope');
  });

  test('accepts every real export of a cataloged package', () => {
    const names = zoijsPackageExports('@zoijs/core').join(', ');
    const diags = analyzeZoijs(`import { ${names} } from "@zoijs/core";`);
    expect(diags.filter((d) => d.code === 'ZOIJS-UNKNOWN-EXPORT')).toHaveLength(0);
  });
});

describe('Zoijs completions + hover', () => {
  test('offers the API functions and idiom snippets', () => {
    const items = zoijsCompletions();
    const labels = items.map((i) => i.label);
    expect(labels).toContain('createState');
    expect(labels).toContain('html');
    expect(labels).toContain('zcomponent');
    expect(items.find((i) => i.label === 'zcomponent')?.snippet).toBeTruthy();
  });

  test('hover returns signature + docs for a known API symbol, null otherwise', () => {
    const hover = zoijsHover('createState');
    expect(hover?.value).toContain('createState');
    expect(hover?.value).toContain('@zoijs/core');
    expect(zoijsHover('notAZoijsThing')).toBeNull();
  });
});

/* ----- Phase 6B: Component Intelligence ----- */

describe('matchBrace', () => {
  test('matches braces past strings, templates, and ${} interpolations', () => {
    const src = 'function F() { const s = "a}b"; return html`<i>${x ? "}" : `${y}`}</i>`; }';
    const open = src.indexOf('{');
    const close = matchBrace(src, open);
    expect(src[close]).toBe('}');
    expect(close).toBe(src.length - 1);
  });
});

describe('scanZoijsComponents', () => {
  const SRC = [
    'import { html, createState, effect } from "@zoijs/core";',
    'export function Card(title, open) {',
    '  const expanded = createState(false);',
    '  effect(() => console.log(expanded.get()));',
    '  return html`<div>${() => title} ${Icon()} ${Badge()}</div>`;',
    '}',
    'const Icon = () => html`<i></i>`;',
    'function helper() { return 1; }',
  ].join('\n');

  test('detects only functions that return html``', () => {
    const comps = scanZoijsComponents(SRC);
    const names = comps.map((c) => c.name);
    expect(names).toContain('Card');
    expect(names).toContain('Icon'); // arrow-expression component
    expect(names.includes('helper')).toBeFalsy(); // returns 1, not html
  });

  test('extracts params, state, effects, and child component uses', () => {
    const card = scanZoijsComponents(SRC).find((c) => c.name === 'Card')!;
    expect(card.exported).toBeTruthy();
    expect(card.params).toEqual(['title', 'open']);
    expect(card.state).toContain('expanded');
    expect(card.effects).toBe(1);
    expect(card.uses).toContain('Icon');
    expect(card.uses).toContain('Badge');
  });

  test('reports the component name position for navigation', () => {
    const card = scanZoijsComponents(SRC).find((c) => c.name === 'Card')!;
    expect(card.nameLine).toBe(1); // 0-based: second line
    expect(card.nameChar).toBe('export function '.length);
  });
});

describe('analyzeZoijsComponents (PascalCase convention)', () => {
  test('flags a lowercase-named html-returning function', () => {
    const diags = analyzeZoijsComponents('import { html } from "@zoijs/core";\nfunction card() { return html`<i></i>`; }');
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('ZOIJS-COMPONENT-CASE');
    expect(diags[0].severity).toBe('info');
  });

  test('does not flag a PascalCase component', () => {
    const diags = analyzeZoijsComponents('import { html } from "@zoijs/core";\nfunction Card() { return html`<i></i>`; }');
    expect(diags).toHaveLength(0);
  });
});

describe('isInHtmlTemplate + component completions', () => {
  test('recognizes offsets inside vs outside an html`` template', () => {
    const src = 'const x = 1; const v = html`<div>HERE</div>`;';
    const inside = src.indexOf('HERE');
    const outside = src.indexOf('x = 1');
    expect(isInHtmlTemplate(src, inside)).toBeTruthy();
    expect(isInHtmlTemplate(src, outside)).toBeFalsy();
  });

  test('component completions insert a call', () => {
    const items = zoijsComponentCompletions(['Card', 'Header']);
    expect(items).toHaveLength(2);
    expect(items[0].insertText).toBe('Card()');
    expect(items[0].detail).toBe('Zoijs component');
  });
});

/* ----- Phase 6C: Template IntelliSense ----- */

describe('templateContextAt', () => {
  const at = (src: string) => templateContextAt(src, src.length).region;

  test('reports the JS body as none', () => {
    expect(at('const x = 1;')).toBe('none');
  });

  test('typing a tag name after < is markup-tag', () => {
    const src = 'const v = html`<di';
    const ctx = templateContextAt(src, src.length);
    expect(ctx.region).toBe('markup-tag');
    if (ctx.region === 'markup-tag') expect(ctx.partial).toBe('di');
  });

  test('after the tag name + space is markup-attr with the tag', () => {
    const src = 'const v = html`<button ';
    const ctx = templateContextAt(src, src.length);
    expect(ctx.region).toBe('markup-attr');
    if (ctx.region === 'markup-attr') expect(ctx.tag).toBe('button');
  });

  test('inside an attribute value is markup-value (no tag/attr noise)', () => {
    expect(at('const v = html`<div class="')).toBe('markup-value');
  });

  test('between tags is markup-text', () => {
    expect(at('const v = html`<div>')).toBe('markup-text');
  });

  test('inside a ${} interpolation is expr', () => {
    expect(at('const v = html`<div>${Ca')).toBe('expr');
  });

  test('an attribute is still tracked across a ${} binding value', () => {
    // <button onclick=${fn}  ← after the binding + a space we are back in attr position.
    const src = 'const v = html`<button onclick=${fn} ';
    const ctx = templateContextAt(src, src.length);
    expect(ctx.region).toBe('markup-attr');
    if (ctx.region === 'markup-attr') expect(ctx.tag).toBe('button');
  });

  test('a plain (non-html) template literal is not markup', () => {
    expect(at('const s = `<div>')).toBe('none');
  });
});

describe('HTML completions', () => {
  test('tag completions include common elements', () => {
    const tags = htmlTagCompletions().map((t) => t.label);
    expect(tags).toContain('div');
    expect(tags).toContain('button');
    expect(htmlTagCompletions()[0].kind).toBe('html-tag');
  });

  test('attribute completions include globals, events, and tag-specific', () => {
    const attrs = htmlAttributeCompletions('input').map((a) => a.label);
    expect(attrs).toContain('class'); // global
    expect(attrs).toContain('onclick'); // event
    expect(attrs).toContain('ref'); // Zoijs ref
    expect(attrs).toContain('placeholder'); // input-specific
  });

  test('event + ref attributes insert a ${} binding snippet', () => {
    const onclick = htmlAttributeCompletions('button').find((a) => a.label === 'onclick')!;
    expect(onclick.snippet).toBeTruthy();
    expect(onclick.insertText).toContain('${');
    const cls = htmlAttributeCompletions().find((a) => a.label === 'class')!;
    expect(cls.insertText).toBe('class="$0"');
  });
});

/* ----- Phase 6D: Reactive State Inspector ----- */

const COUNTER = [
  'import { html, createState, computed, effect } from "@zoijs/core";',
  'export function Counter() {',
  '  const count = createState(0);',
  '  const doubled = computed(() => count.get() * 2);',
  '  effect(() => document.title = String(doubled.get()));',
  '  return html`<button onclick=${() => count.set(count.get() + 1)}>${() => count.get()}</button>`;',
  '}',
].join('\n');

describe('matchParen', () => {
  test('matches parens past strings, templates, and nested calls', () => {
    const src = 'computed(() => f(g(")"), `${h()}`))';
    const open = src.indexOf('(');
    expect(src[matchParen(src, open)]).toBe(')');
    expect(matchParen(src, open)).toBe(src.length - 1);
  });
});

describe('analyzeReactiveGraph', () => {
  test('collects states and computeds', () => {
    const g = analyzeReactiveGraph(COUNTER);
    const states = g.values.filter((v) => v.kind === 'state').map((v) => v.name);
    const computeds = g.values.filter((v) => v.kind === 'computed').map((v) => v.name);
    expect(states).toEqual(['count']);
    expect(computeds).toEqual(['doubled']);
    expect(g.values.find((v) => v.name === 'count')?.detail).toBe('0');
  });

  test('resolves computed dependencies (reads) to known reactive names', () => {
    const doubled = analyzeReactiveGraph(COUNTER).values.find((v) => v.name === 'doubled')!;
    expect(doubled.reads).toEqual(['count']);
  });

  test('captures effect reads', () => {
    const g = analyzeReactiveGraph(COUNTER);
    expect(g.effects).toHaveLength(1);
    expect(g.effects[0].reads).toContain('doubled');
    expect(g.effects[0].index).toBe(1);
  });

  test('counts markup binding reads and writes per state', () => {
    const g = analyzeReactiveGraph(COUNTER);
    // `${() => count.get()}` and the onclick handler's `count.get() + 1` both read.
    expect(g.bindingReads.count).toBe(2);
    // The onclick handler `count.set(...)` writes once.
    expect(g.bindingWrites.count).toBe(1);
  });

  test('ignores .get() on non-reactive objects', () => {
    const g = analyzeReactiveGraph(
      'import { html, createState } from "@zoijs/core";\nconst c = createState(0);\nconst m = new Map(); m.get("k"); const v = html`<i>${() => c.get()}</i>`;',
    );
    expect(g.bindingReads.c).toBe(1);
    expect(g.bindingReads.m).toBeFalsy(); // m is not a reactive value
  });
});

/* ----- Phase 6E: Router Designer ----- */

const ROUTES_SRC = [
  'import { createRouter } from "@zoijs/router";',
  'import { Home } from "./pages/home.js";',
  'const routes = {',
  '  "/": Home,',
  '  "/users/:id": (params) => html`<h1>User ${params.id}</h1>`,',
  '  "/docs/:section/:page": DocPage,',
  '  "*": NotFound,',
  '};',
  'createRouter(routes, { interceptLinks: true });',
].join('\n');

describe('scanRoutes', () => {
  test('extracts the route table from a const passed to createRouter', () => {
    const routes = scanRoutes(ROUTES_SRC);
    expect(routes.map((r) => r.pattern)).toEqual(['/', '/users/:id', '/docs/:section/:page', '*']);
  });

  test('resolves the target component (identifier) or marks inline', () => {
    const routes = scanRoutes(ROUTES_SRC);
    expect(routes.find((r) => r.pattern === '/')?.component).toBe('Home');
    expect(routes.find((r) => r.pattern === '/users/:id')?.component).toBe('(inline)');
    expect(routes.find((r) => r.pattern === '/docs/:section/:page')?.component).toBe('DocPage');
  });

  test('captures :params and the not-found route', () => {
    const routes = scanRoutes(ROUTES_SRC);
    expect(routes.find((r) => r.pattern === '/users/:id')?.params).toEqual(['id']);
    expect(routes.find((r) => r.pattern === '/docs/:section/:page')?.params).toEqual(['section', 'page']);
    expect(routes.find((r) => r.pattern === '/')?.dynamic).toBeFalsy();
    expect(routes.find((r) => r.pattern === '*')?.notFound).toBeTruthy();
  });

  test('handles an inline object literal in createRouter(...)', () => {
    const routes = scanRoutes('import { createRouter } from "@zoijs/router";\ncreateRouter({ "/": Home, "/about": About });');
    expect(routes.map((r) => r.pattern)).toEqual(['/', '/about']);
  });

  test('ignores a plain object that is not a route table', () => {
    expect(scanRoutes('const opts = { base: "/app", interceptLinks: true };')).toHaveLength(0);
  });
});

describe('analyzeRoutes', () => {
  test('flags a duplicate route pattern', () => {
    const src = 'const routes = { "/": A, "/x": B, "/x": C };';
    const diags = analyzeRoutes(src);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('ZOIJS-DUPLICATE-ROUTE');
    expect(diags[0].message).toContain('/x');
  });

  test('no duplicates → no diagnostics', () => {
    expect(analyzeRoutes('const routes = { "/": A, "/x": B };')).toHaveLength(0);
  });
});

/* ----- Phase 6F: DevTools ----- */

describe('DevtoolsModel', () => {
  test('folds a lifecycle event stream into a reactive-node view', () => {
    const m = new DevtoolsModel();
    m.apply({ type: 'attach' });
    m.apply({ type: 'create', id: 1, nodeKind: 'state' });
    m.apply({ type: 'create', id: 2, nodeKind: 'computed' });
    m.apply({ type: 'create', id: 3, nodeKind: 'effect', label: 'text' });
    m.apply({ type: 'run', id: 3 });
    m.apply({ type: 'write', id: 1 });
    m.apply({ type: 'run', id: 2 });
    m.apply({ type: 'run', id: 3 });

    const snap = m.snapshot();
    expect(snap.attached).toBeTruthy();
    expect(snap.nodes).toHaveLength(3);
    expect(snap.countsByKind).toEqual({ state: 1, computed: 1, effect: 1 });
    expect(snap.totalRuns).toBe(3);
    expect(snap.totalWrites).toBe(1);
    expect(snap.liveCount).toBe(3);
    const effect = snap.nodes.find((n) => n.id === 3)!;
    expect(effect.label).toBe('text');
    expect(effect.runs).toBe(2);
  });

  test('dispose marks a node not-alive but keeps it', () => {
    const m = new DevtoolsModel();
    m.apply({ type: 'create', id: 1, nodeKind: 'effect' });
    m.apply({ type: 'dispose', id: 1 });
    const snap = m.snapshot();
    expect(snap.nodes).toHaveLength(1);
    expect(snap.nodes[0].alive).toBeFalsy();
    expect(snap.liveCount).toBe(0);
  });

  test('ignores events for unknown ids and resets cleanly', () => {
    const m = new DevtoolsModel();
    m.apply({ type: 'run', id: 99 }); // no such node — no throw
    m.apply({ type: 'attach' });
    m.apply({ type: 'create', id: 1, nodeKind: 'state' });
    m.reset();
    const snap = m.snapshot();
    expect(snap.attached).toBeFalsy();
    expect(snap.nodes).toHaveLength(0);
  });
});

describe('DevTools bridge', () => {
  test('the bridge implements exactly the inspector callbacks and attaches to the real subpath', () => {
    // Each callback the model needs must be wired in the injectable bridge.
    for (const cb of BRIDGE_CALLBACKS) expect(ZOIJS_DEVTOOLS_BRIDGE).toContain(`${cb}:`);
    expect(ZOIJS_DEVTOOLS_BRIDGE).toContain('@zoijs/core/devtools');
    expect(ZOIJS_DEVTOOLS_BRIDGE).toContain('attachInspector');
  });
});
