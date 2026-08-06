/**
 * Pure completion + hover data for Zoijs (Phase 6A). API entries come from the
 * catalog; snippets encode the idiomatic patterns (component, state, effect,
 * router, mount, list). The ZoijsModule maps these onto Monaco. No DOM.
 */
import { ZOIJS_SYMBOLS, zoijsSymbol } from './zoijsApi';

/** A secondary edit applied when a completion is accepted (0-based, LSP-style). */
export interface ComponentImportEdit {
  start: { line: number; character: number };
  end: { line: number; character: number };
  newText: string;
}

export interface ZoijsCompletion {
  label: string;
  kind: 'function' | 'snippet' | 'html-tag' | 'html-attribute';
  detail?: string;
  documentation?: string;
  insertText: string;
  /** True = insertText is a Monaco snippet ($1, $0 tab stops). */
  snippet?: boolean;
  /** Extra edit applied on accept — e.g. the auto-import for a cross-file component. */
  additionalEdit?: ComponentImportEdit;
}

const SNIPPETS: ZoijsCompletion[] = [
  {
    label: 'zcomponent',
    kind: 'snippet',
    detail: 'Zoijs component',
    documentation: 'A component: a function returning an `html` template.',
    snippet: true,
    insertText: ['export function ${1:Name}() {', '  return html`', '    <div>$0</div>', '  `;', '}'].join('\n'),
  },
  {
    label: 'zstate',
    kind: 'snippet',
    detail: 'createState',
    documentation: 'A reactive value: read with .get(), write with .set().',
    snippet: true,
    insertText: 'const ${1:value} = createState(${2:initial});',
  },
  {
    label: 'zcomputed',
    kind: 'snippet',
    detail: 'computed derived value',
    snippet: true,
    insertText: 'const ${1:value} = computed(() => $0);',
  },
  {
    label: 'zeffect',
    kind: 'snippet',
    detail: 'effect (auto-tracked side effect)',
    snippet: true,
    insertText: ['effect(() => {', '  $0', '});'].join('\n'),
  },
  {
    label: 'zeach',
    kind: 'snippet',
    detail: 'each (keyed list)',
    snippet: true,
    insertText: 'each(() => ${1:items}.get(), (${2:item}) => ${2:item}.${3:id}, (${2:item}) => html`<li>${() => ${2:item}.${4:label}}</li>`)',
  },
  {
    label: 'zmount',
    kind: 'snippet',
    detail: 'mount app',
    snippet: true,
    insertText: 'mount(() => ${1:App}(), "${2:#app}");',
  },
  {
    label: 'zrouter',
    kind: 'snippet',
    detail: 'createRouter + mount',
    snippet: true,
    insertText: [
      'const router = createRouter({',
      '  "/": ${1:Home},',
      '  "*": ${2:NotFound},',
      '});',
      '',
      'mount(() => router.view(), "#app");',
    ].join('\n'),
  },
];

export function zoijsCompletions(): ZoijsCompletion[] {
  const api: ZoijsCompletion[] = ZOIJS_SYMBOLS.filter((s) => s.kind === 'value').map((s) => ({
    label: s.name,
    kind: 'function',
    detail: s.signature,
    documentation: `${s.doc}\n\n_from ${s.package}_`,
    insertText: s.name,
  }));
  return [...api, ...SNIPPETS];
}

/**
 * Component completions offered INSIDE an `html`…`` template — the file's own
 * components (Phase 6B), inserting a call `Name()`. Context-aware: the caller
 * only requests these when the cursor sits in markup.
 */
export function zoijsComponentCompletions(names: readonly string[]): ZoijsCompletion[] {
  return names.map((name) => ({
    label: name,
    kind: 'function',
    detail: 'Zoijs component',
    documentation: `Render the \`${name}\` component.`,
    insertText: `${name}()`,
  }));
}

/** Markdown hover for a Zoijs API symbol, or null if the word is not one. */
export function zoijsHover(word: string): { value: string } | null {
  const symbol = zoijsSymbol(word);
  if (!symbol) return null;
  return {
    value: `\`\`\`ts\n${symbol.signature}\n\`\`\`\n\n${symbol.doc}\n\n_from ${symbol.package}_`,
  };
}
