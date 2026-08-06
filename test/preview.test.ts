import { describe, expect, test } from './harness';
import { injectPreviewHtml, ZOIJS_DEVTOOLS_BRIDGE } from '../src/shared/zoijsPreview';

const PAGE = (importMap: string) =>
  `<!doctype html>\n<html>\n<head>\n<script type="importmap">\n${importMap}\n</script>\n</head>\n<body>\n<div id="app"></div>\n<script type="module" src="/src/main.js"></script>\n</body>\n</html>\n`;

describe('injectPreviewHtml', () => {
  test('adds a @zoijs/core/devtools mapping derived from @zoijs/core and injects the bridge', () => {
    const html = PAGE('{ "imports": { "@zoijs/core": "/vendor/zoijs/core/index.js" } }');
    const out = injectPreviewHtml(html);
    // Devtools subpath resolves to the core package sibling.
    expect(out).toContain('"@zoijs/core/devtools": "/vendor/zoijs/core/reactivity/devtools.js"');
    // The bridge module is appended before </body>.
    expect(out).toContain('<script type="module">');
    expect(out).toContain('attachInspector');
    expect(out.indexOf('attachInspector')).toBeLessThan(out.indexOf('</body>'));
  });

  test('keeps an existing @zoijs/core/devtools mapping', () => {
    const html = PAGE('{ "imports": { "@zoijs/core": "/v/core/index.js", "@zoijs/core/devtools": "/custom/devtools.js" } }');
    const out = injectPreviewHtml(html);
    expect(out).toContain('/custom/devtools.js');
  });

  test('leaves a page with no import map unchanged (no bridge)', () => {
    const html = '<!doctype html><html><body><h1>hi</h1></body></html>';
    expect(injectPreviewHtml(html)).toBe(html);
  });

  test('does not inject when the import map lacks @zoijs/core', () => {
    const html = PAGE('{ "imports": { "lodash": "/vendor/lodash.js" } }');
    const out = injectPreviewHtml(html);
    expect(out.includes('attachInspector')).toBeFalsy();
  });

  test('the bridge posts the inspector event shape the model consumes', () => {
    expect(ZOIJS_DEVTOOLS_BRIDGE).toContain('type: "create"');
    expect(ZOIJS_DEVTOOLS_BRIDGE).toContain('nodeKind');
    expect(ZOIJS_DEVTOOLS_BRIDGE).toContain('__zoijsDevtools');
  });
});
