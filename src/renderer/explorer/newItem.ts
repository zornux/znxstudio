/**
 * Pure model for the Explorer "New …" actions: the catalog of item types, safe
 * filename/symbol derivation, name validation, and minimal starter templates.
 *
 * Every template uses only REAL, verified Zornux/Zoijs syntax (no invented
 * constructs): Zornux blocks open with a keyword and close with `end`, fields
 * are `has`, methods are `function … end`, contracts use `requires function`,
 * web routes are `on <METHOD> "/path"` inside a `service`, tests are
 * `test "…" … expect … to …`, and `#` is the only comment. Zoijs components are
 * plain functions returning an html`` template with `createState` reactivity.
 *
 * This module is DOM-free and filesystem-free so it can be unit-tested directly.
 */

/** Which file extension the project uses for Zoijs/JS sources. */
export type ScriptExt = '.js' | '.ts';

export type NewItemCategory = 'zornux' | 'zoijs' | 'standard' | 'folder';

export interface TemplateContext {
  /** The resolved filename (with extension). */
  fileName: string;
  /** Filename without its extension. */
  base: string;
  /** A safe PascalCase identifier derived from the name. */
  symbol: string;
  /** A safe camelCase identifier derived from the name. */
  camel: string;
  /** A human title derived from the name (for headings). */
  title: string;
}

export interface NewItemDef {
  /** Stable id (also the command suffix), e.g. `zornuxClass`. */
  id: string;
  /** Menu/palette label, e.g. `Zornux Class`. */
  label: string;
  category: NewItemCategory;
  /**
   * Fixed extension (e.g. `.zx`, `.json`), the sentinel `script` for the
   * project's JS/TS convention, or `''` for a folder.
   */
  ext: string;
  /** Starter content generator; omitted for folders (and blank files). */
  template?: (ctx: TemplateContext) => string;
}

/* ----- filename + identifier helpers ----- */

function stripExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function words(value: string): string[] {
  return value.split(/[^A-Za-z0-9]+/).filter(Boolean);
}

/** A safe PascalCase identifier from a filename (`my-user.zx` -> `MyUser`). */
export function derivePascal(name: string): string {
  const pascal = words(stripExtension(name))
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  if (!pascal) return 'Item';
  // Identifiers must start with a letter.
  return /^[A-Za-z]/.test(pascal) ? pascal : `Item${pascal}`;
}

/** A safe camelCase identifier from a filename (`user-store.js` -> `userStore`). */
export function deriveCamel(name: string): string {
  const pascal = derivePascal(name);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}

/** A human title from a filename (`getting-started.md` -> `Getting Started`). */
export function deriveTitle(name: string): string {
  const parts = words(stripExtension(name));
  if (parts.length === 0) return stripExtension(name) || name;
  return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Resolve the actual extension for a def given the project's script convention. */
export function resolveExtension(def: NewItemDef, scriptExt: ScriptExt): string {
  if (def.ext === 'script') return scriptExt;
  return def.ext;
}

/**
 * Apply the type's extension to a user-entered name, without duplicating one the
 * user already typed. `''` (folder) returns the name unchanged.
 */
export function resolveFileName(rawName: string, ext: string): string {
  const name = rawName.trim();
  if (!ext) return name;
  return name.toLowerCase().endsWith(ext.toLowerCase()) ? name : `${name}${ext}`;
}

/** Build the full TemplateContext for a resolved filename. */
export function templateContext(fileName: string): TemplateContext {
  return {
    fileName,
    base: stripExtension(fileName),
    symbol: derivePascal(fileName),
    camel: deriveCamel(fileName),
    title: deriveTitle(fileName),
  };
}

/* ----- validation ----- */

// Windows-reserved device names (also invalid on other platforms as filenames).
const RESERVED_NAMES = new Set<string>([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

// Characters illegal in filenames on Windows (superset-safe for POSIX too), plus
// ASCII control characters. Hyphens and spaces are allowed in names.
// eslint-disable-next-line no-control-regex
const INVALID_CHARS = /[<>:"/\\|?*\x00-\x1f]/;

/**
 * Validate a raw item name. Returns an error message, or `null` if valid.
 * Rejects empty names, path separators/traversal, invalid characters, reserved
 * device names, and trailing dot/space (invalid on Windows).
 */
export function validateItemName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return 'Enter a name.';
  if (name === '.' || name === '..') return 'Name cannot be "." or "..".';
  if (/[\\/]/.test(name)) return 'Name cannot contain a path separator.';
  if (name.includes('..')) return 'Name cannot contain "..".';
  if (INVALID_CHARS.test(name)) return 'Name contains an invalid character ( < > : " | ? * / \\ ).';
  // Trailing spaces are trimmed above; a trailing period is invalid on Windows.
  if (/\.$/.test(name)) return 'Name cannot end with a period.';
  if (RESERVED_NAMES.has(stripExtension(name).toLowerCase())) return `"${name}" is a reserved name.`;
  return null;
}

/** Case-insensitive duplicate check against a directory's existing entries. */
export function isDuplicate(fileName: string, existing: readonly string[]): boolean {
  const lower = fileName.toLowerCase();
  return existing.some((entry) => entry.toLowerCase() === lower);
}

/* ----- templates (verified minimal syntax) ----- */

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

function zornuxFile(ctx: TemplateContext): string {
  return lines(`# ${ctx.base}`, '', `show "Hello from ${ctx.base}"`);
}

function zornuxClass(ctx: TemplateContext): string {
  return lines(
    `class ${ctx.symbol}`,
    '    has name',
    '',
    '    function describe',
    `        give back "${ctx.symbol}: " + name`,
    '    end',
    'end',
  );
}

function zornuxContract(ctx: TemplateContext): string {
  return lines(`contract ${ctx.symbol}`, '    requires function describe', 'end');
}

function zornuxRecord(ctx: TemplateContext): string {
  return lines(`record ${ctx.symbol}`, '    has name', '        required', '    has created_at', 'end');
}

function zornuxService(ctx: TemplateContext): string {
  return lines(
    `service ${ctx.symbol}`,
    '',
    '    function handle with request',
    '        give back request',
    '    end',
    '',
    'end',
  );
}

function zornuxRoute(ctx: TemplateContext): string {
  return lines(
    `service ${ctx.symbol}`,
    '',
    '    on GET "/"',
    '        give back status 200 with message "OK"',
    '    end',
    '',
    'end',
    '',
    `publish ${ctx.symbol} on port 5000`,
  );
}

function zornuxTest(ctx: TemplateContext): string {
  return lines(`test "${ctx.base} works"`, '    expect 1 + 1 to equal 2', 'end');
}

function zoijsComponent(ctx: TemplateContext): string {
  return lines(
    'import { html, createState } from "@zoijs/core";',
    '',
    `export function ${ctx.symbol}() {`,
    '  const count = createState(0);',
    '',
    '  return html`',
    '    <div>',
    '      <button onclick=${() => count.set(count.get() + 1)}>',
    '        Count: ${() => count.get()}',
    '      </button>',
    '    </div>',
    '  `;',
    '}',
  );
}

function zoijsService(ctx: TemplateContext): string {
  return lines(
    'import { createState } from "@zoijs/core";',
    '',
    'const state = createState(null);',
    '',
    `export function get${ctx.symbol}() {`,
    '  return state.get();',
    '}',
    '',
    `export function set${ctx.symbol}(value) {`,
    '  state.set(value);',
    '}',
  );
}

function zoijsStore(ctx: TemplateContext): string {
  return lines(
    'import { createState, computed } from "@zoijs/core";',
    '',
    `export const ${ctx.camel} = createState(0);`,
    '',
    `export const ${ctx.camel}Doubled = computed(() => ${ctx.camel}.get() * 2);`,
    '',
    `export function reset${ctx.symbol}() {`,
    `  ${ctx.camel}.set(0);`,
    '}',
  );
}

function zoijsRoute(ctx: TemplateContext): string {
  return lines(
    'import { createRouter } from "@zoijs/router";',
    'import { html } from "@zoijs/core";',
    '',
    'function Home() {',
    `  return html\`<h1>${ctx.title}</h1>\`;`,
    '}',
    '',
    'const routes = {',
    '  "/": Home,',
    '  "*": () => html`<p>Not found</p>`,',
    '};',
    '',
    'export const router = createRouter(routes);',
  );
}

function javascriptFile(ctx: TemplateContext): string {
  return lines(`// ${ctx.base}`, '');
}

function typescriptFile(ctx: TemplateContext): string {
  return lines(`// ${ctx.base}`, '', 'export {};');
}

function jsonFile(): string {
  return lines('{}');
}

function markdownFile(ctx: TemplateContext): string {
  return lines(`# ${ctx.title}`, '');
}

/**
 * The catalog of "New …" item types, in the order shown in the submenu. Zoijs
 * and standard JS/TS types use `ext: 'script'` so they follow the project's
 * `.js`/`.ts` convention.
 */
export const NEW_ITEMS: readonly NewItemDef[] = [
  { id: 'zornuxFile', label: 'Zornux File', category: 'zornux', ext: '.zx', template: zornuxFile },
  { id: 'zornuxClass', label: 'Zornux Class', category: 'zornux', ext: '.zx', template: zornuxClass },
  { id: 'zornuxContract', label: 'Zornux Contract', category: 'zornux', ext: '.zx', template: zornuxContract },
  { id: 'zornuxRecord', label: 'Zornux Record', category: 'zornux', ext: '.zx', template: zornuxRecord },
  { id: 'zornuxService', label: 'Zornux Service', category: 'zornux', ext: '.zx', template: zornuxService },
  { id: 'zornuxRoute', label: 'Zornux Route', category: 'zornux', ext: '.zx', template: zornuxRoute },
  { id: 'zornuxTest', label: 'Zornux Test', category: 'zornux', ext: '.zx', template: zornuxTest },
  { id: 'zoijsComponent', label: 'Zoijs Component', category: 'zoijs', ext: 'script', template: zoijsComponent },
  { id: 'zoijsService', label: 'Zoijs Service', category: 'zoijs', ext: 'script', template: zoijsService },
  { id: 'zoijsStore', label: 'Zoijs Store', category: 'zoijs', ext: 'script', template: zoijsStore },
  { id: 'zoijsRoute', label: 'Zoijs Route', category: 'zoijs', ext: 'script', template: zoijsRoute },
  { id: 'javascriptFile', label: 'JavaScript File', category: 'standard', ext: '.js', template: javascriptFile },
  { id: 'typescriptFile', label: 'TypeScript File', category: 'standard', ext: '.ts', template: typescriptFile },
  { id: 'jsonFile', label: 'JSON File', category: 'standard', ext: '.json', template: jsonFile },
  { id: 'markdownFile', label: 'Markdown File', category: 'standard', ext: '.md', template: markdownFile },
  { id: 'folder', label: 'Folder', category: 'folder', ext: '' },
];

export function findItemDef(id: string): NewItemDef | undefined {
  return NEW_ITEMS.find((item) => item.id === id);
}

/** The command id that creates a given item type (registered by ExplorerActionsModule). */
export function newItemCommandId(id: string): string {
  return `znxstudio.explorer.new.${id}`;
}
