/**
 * Live Preview support (Phase 6G) — shared between the main-process static
 * server (which injects into served HTML) and the renderer. Pure + no Node/DOM
 * so it is unit-testable.
 *
 * `ZOIJS_DEVTOOLS_BRIDGE` is the injectable snippet that attaches to the real
 * `@zoijs/core/devtools` hook (Phase 6F) and forwards serialized inspector
 * events to the IDE. `injectPreviewHtml` wires it into a served page: it adds a
 * `@zoijs/core/devtools` entry to the page's import map (derived from its
 * existing `@zoijs/core` entry) and appends the bridge as a module script, so
 * DevTools goes live with no changes to the user's project.
 */
export const ZOIJS_DEVTOOLS_BRIDGE = `import { attachInspector } from "@zoijs/core/devtools";
const ids = new WeakMap();
let seq = 0;
const idOf = (node) => {
  let id = ids.get(node);
  if (id === undefined) { id = ++seq; ids.set(node, id); }
  return id;
};
const post = (event) => {
  if (typeof window.__ZNXSTUDIO_DEVTOOLS__ === "function") window.__ZNXSTUDIO_DEVTOOLS__(event);
  else if (window.parent && window.parent !== window) window.parent.postMessage({ __zoijsDevtools: event }, "*");
};
attachInspector({
  onAttach: () => post({ type: "attach" }),
  onCreate: (node, kind, label) => post({ type: "create", id: idOf(node), nodeKind: String(kind), label: label && label.kind }),
  onRun: (node) => post({ type: "run", id: idOf(node) }),
  onWrite: (node) => post({ type: "write", id: idOf(node) }),
  onDispose: (node) => post({ type: "dispose", id: idOf(node) }),
});
`;

const IMPORT_MAP = /<script\b[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i;

/** Derive the `@zoijs/core/devtools` URL from the `@zoijs/core` (index.js) URL. */
function devtoolsUrlFrom(coreUrl: string): string {
  if (/index\.js(\?.*)?$/.test(coreUrl)) return coreUrl.replace(/index\.js(\?.*)?$/, 'reactivity/devtools.js$1');
  return coreUrl.replace(/\/[^/]*$/, '/reactivity/devtools.js');
}

/**
 * Inject the DevTools bridge into a served HTML page. Only injects when the page
 * has an import map that maps `@zoijs/core` (so the bridge's subpath import
 * resolves); otherwise returns the HTML unchanged. Pure.
 */
export function injectPreviewHtml(html: string): string {
  const match = IMPORT_MAP.exec(html);
  if (!match) return html;

  let map: { imports?: Record<string, string> };
  try {
    map = JSON.parse(match[1]) as { imports?: Record<string, string> };
  } catch {
    return html;
  }
  const core = map.imports?.['@zoijs/core'];
  if (!map.imports || typeof core !== 'string') return html;

  if (!map.imports['@zoijs/core/devtools']) {
    map.imports['@zoijs/core/devtools'] = devtoolsUrlFrom(core);
  }
  const rewrittenMap = `<script type="importmap">\n${JSON.stringify(map, null, 2)}\n</script>`;
  // Insert the bridge immediately AFTER the import map so it evaluates before the
  // app's own module scripts — attaching the inspector before the first mount, so
  // the initial onCreate events are captured.
  const bridge = `\n<script type="module">\n${ZOIJS_DEVTOOLS_BRIDGE}</script>`;
  return html.slice(0, match.index) + rewrittenMap + bridge + html.slice(match.index + match[0].length);
}
