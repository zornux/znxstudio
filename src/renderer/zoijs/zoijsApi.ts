/**
 * Curated catalog of the real Zoijs API (Phase 6A), transcribed from the
 * framework's own type declarations at
 * "Xornux frontend documentation/vendor/zoijs/{core,router,head}/index.d.ts".
 * Zoijs ships no
 * compiler or language server, so this hand-maintained catalog is the source of
 * truth for completions, hover docs, and import validation. Pure data — no DOM.
 */
export type ZoijsPackage = '@zoijs/core' | '@zoijs/router' | '@zoijs/head';

export const ZOIJS_PACKAGES: readonly ZoijsPackage[] = ['@zoijs/core', '@zoijs/router', '@zoijs/head'];

export interface ZoijsSymbol {
  name: string;
  package: ZoijsPackage;
  /** `value` = a callable/value export (offered as a completion); `type` = a TS type (valid import, not completed). */
  kind: 'value' | 'type';
  signature: string;
  doc: string;
}

export const ZOIJS_SYMBOLS: readonly ZoijsSymbol[] = [
  // ----- @zoijs/core
  {
    name: 'html',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'html(strings, ...values): TemplateResult',
    doc: 'Tagged-template function — write markup as HTML. Wrap a value in `() => …` to make it reactive; a bare `${value}` renders once.',
  },
  {
    name: 'mount',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'mount(component, target, options?): () => void',
    doc: 'Render a component (or template) into a DOM element or CSS selector. Returns an `unmount()` that detaches the DOM and disposes reactivity.',
  },
  {
    name: 'createState',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'createState<T>(initial, equals?): State<T>',
    doc: 'Create a reactive value. Read with `.get()` (subscribes inside a binding/effect), write with `.set(next)`, read untracked with `.peek()`.',
  },
  {
    name: 'computed',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'computed<T>(fn, equals?): Computed<T>',
    doc: 'A lazy, cached derived value. Recomputes only when a dependency it read changes.',
  },
  {
    name: 'effect',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'effect(fn): EffectHandle',
    doc: 'Run a side effect that re-runs when a reactive value it reads changes (auto-tracked, no dep array). For reactive content *on screen*, use a binding `${() => …}` instead.',
  },
  {
    name: 'each',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'each(items, keyFn, renderFn): EachResult',
    doc: 'Keyed list rendering. `items` may be a reactive function or a plain array; `keyFn` returns a stable key; `renderFn` returns the template for one item.',
  },
  {
    name: 'boundary',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'boundary(child, fallback): C | F',
    doc: 'Render `child`; if it throws synchronously while building its markup, tear down and render `fallback` instead. Place in a template slot.',
  },
  {
    name: 'configure',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'configure(options: { dev?: boolean }): void',
    doc: 'Toggle development warnings (default: `dev` is true).',
  },
  {
    name: 'onCleanup',
    package: '@zoijs/core',
    kind: 'value',
    signature: 'onCleanup(fn: () => void): void',
    doc: 'Register a teardown for the current component or list item — runs on unmount/removal. Use for timers, subscriptions, third-party widgets.',
  },
  { name: 'State', package: '@zoijs/core', kind: 'type', signature: 'interface State<T>', doc: 'A reactive value from `createState` — `.get()/.set()/.peek()`.' },
  { name: 'Computed', package: '@zoijs/core', kind: 'type', signature: 'interface Computed<T>', doc: 'A derived value from `computed` — `.get()/.peek()`.' },
  { name: 'TemplateResult', package: '@zoijs/core', kind: 'type', signature: 'interface TemplateResult', doc: 'The opaque result of an `html` template.' },
  { name: 'EachResult', package: '@zoijs/core', kind: 'type', signature: 'interface EachResult', doc: 'The result of `each` — place in a template child position.' },
  { name: 'Component', package: '@zoijs/core', kind: 'type', signature: 'type Component = () => TemplateResult', doc: 'A function that returns an `html` template.' },
  { name: 'Ref', package: '@zoijs/core', kind: 'type', signature: 'type Ref<E> = (element: E) => void | (() => void)', doc: 'A callback ref: `ref=${fn}` receives the real DOM element after insertion; may return a cleanup fn.' },
  { name: 'MountOptions', package: '@zoijs/core', kind: 'type', signature: 'interface MountOptions', doc: 'Options for `mount` (e.g. `{ hydrate: true }`).' },
  { name: 'EffectHandle', package: '@zoijs/core', kind: 'type', signature: 'interface EffectHandle', doc: 'Disposable handle from `effect` — `.dispose()`.' },

  // ----- @zoijs/router
  {
    name: 'createRouter',
    package: '@zoijs/router',
    kind: 'value',
    signature: 'createRouter(routes, options?): Router',
    doc: 'Create a router from a `{ pattern: component }` map. Use `":name"` for dynamic segments and `"*"` for the not-found route.',
  },
  { name: 'Router', package: '@zoijs/router', kind: 'type', signature: 'interface Router', doc: 'view() / link(path,text) / go(path) / path() / query() / match(path?) / destroy().' },
  { name: 'Routes', package: '@zoijs/router', kind: 'type', signature: 'type Routes = Record<string, RouteComponent>', doc: 'A `{ pattern: component }` map; `"*"` is not-found.' },
  { name: 'RouteComponent', package: '@zoijs/router', kind: 'type', signature: 'type RouteComponent = (params) => TemplateResult | null', doc: 'A route component receiving matched params.' },
  { name: 'RouteParams', package: '@zoijs/router', kind: 'type', signature: 'type RouteParams = Record<string, string>', doc: 'Params captured from a dynamic route.' },
  { name: 'RouteMatch', package: '@zoijs/router', kind: 'type', signature: 'interface RouteMatch', doc: '`{ component, params }` from `Router.match`.' },
  { name: 'RouterOptions', package: '@zoijs/router', kind: 'type', signature: 'interface RouterOptions', doc: '`{ base?, interceptLinks?, location? }`.' },

  // ----- @zoijs/head
  { name: 'title', package: '@zoijs/head', kind: 'value', signature: 'title(value: string): void', doc: 'Set `document.title`; restored when the calling component unmounts.' },
  { name: 'description', package: '@zoijs/head', kind: 'value', signature: 'description(value: string): void', doc: 'Set `<meta name="description">` (creating it if needed); restored on unmount.' },
  { name: 'meta', package: '@zoijs/head', kind: 'value', signature: 'meta(name: string, content: string): void', doc: 'Set `<meta name="…">` to `content`; restored/removed on unmount.' },
];

const BY_NAME = new Map(ZOIJS_SYMBOLS.map((s) => [s.name, s]));

export function zoijsSymbol(name: string): ZoijsSymbol | undefined {
  return BY_NAME.get(name);
}

export function isZoijsPackage(spec: string): spec is ZoijsPackage {
  return (ZOIJS_PACKAGES as readonly string[]).includes(spec);
}

/** Every export name of a cataloged package (values + types). */
export function zoijsPackageExports(pkg: string): string[] {
  return ZOIJS_SYMBOLS.filter((s) => s.package === pkg).map((s) => s.name);
}
