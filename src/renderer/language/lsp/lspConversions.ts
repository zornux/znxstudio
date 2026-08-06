import type {
  CompletionItem,
  CompletionList,
  DocumentSymbol,
  FoldingRange,
  Hover,
  Location,
  Range,
  SemanticTokens,
  SignatureHelp,
  TextEdit,
  WorkspaceEdit,
} from '../api';

/**
 * Pure conversions from `zornux lsp` result payloads to the Language Platform's
 * provider types. Monaco-free and unit-tested. Positions need no shift — the
 * platform is already 0-based like LSP — so only shape/enum mapping happens here.
 */

/** LSP CompletionItemKind (int) → the platform's kind string (see the Monaco bridge map). */
const COMPLETION_KIND: Record<number, string> = {
  2: 'function', // Method
  3: 'function', // Function
  5: 'field', // Field
  6: 'variable', // Variable
  7: 'class', // Class
  8: 'type', // Interface
  9: 'import', // Module
  10: 'field', // Property
  14: 'keyword', // Keyword
  21: 'constant', // Constant
  22: 'record', // Struct
};

export function completionKindToPlatform(kind: number | undefined): string | undefined {
  return kind !== undefined ? COMPLETION_KIND[kind] : undefined;
}

interface RawCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { value?: string };
  insertText?: string;
  sortText?: string;
}

function documentationText(documentation: RawCompletionItem['documentation']): string | undefined {
  if (documentation === undefined) return undefined;
  return typeof documentation === 'string' ? documentation : documentation.value;
}

export function lspCompletionItemToPlatform(item: RawCompletionItem): CompletionItem {
  return {
    label: item.label,
    kind: completionKindToPlatform(item.kind),
    detail: item.detail,
    documentation: documentationText(item.documentation),
    insertText: item.insertText,
  };
}

/** The server returns a bare CompletionItem[] (not a CompletionList). */
export function lspCompletionToPlatform(result: unknown): CompletionList {
  const items = Array.isArray(result)
    ? (result as RawCompletionItem[])
    : ((result as { items?: RawCompletionItem[] } | null)?.items ?? []);
  return { items: items.map(lspCompletionItemToPlatform) };
}

interface RawHover {
  contents?: string | { value?: string } | Array<string | { value?: string }>;
  range?: { start: { line: number; character: number }; end: { line: number; character: number } };
}

function hoverStrings(contents: RawHover['contents']): string[] {
  if (contents === undefined) return [];
  const one = (c: string | { value?: string }): string => (typeof c === 'string' ? c : c.value ?? '');
  const list = Array.isArray(contents) ? contents.map(one) : [one(contents)];
  return list.filter((value) => value.length > 0);
}

export function lspHoverToPlatform(result: unknown): Hover | null {
  if (!result) return null;
  const raw = result as RawHover;
  const contents = hoverStrings(raw.contents);
  if (contents.length === 0) return null;
  return { contents, range: raw.range ? rangeToPlatform(raw.range) : undefined };
}

/* ----- locations / signatures / edits ----- */

interface RawRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}
interface RawLocation {
  uri: string;
  range: RawRange;
}

// LSP ranges are already 0-based like the platform — copy (don't share) the values.
function rangeToPlatform(range: RawRange): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/** definition returns a single Location (or null); references returns an array. */
export function lspLocationsToPlatform(result: unknown): Location[] {
  if (!result) return [];
  const list = Array.isArray(result) ? (result as RawLocation[]) : [result as RawLocation];
  return list
    .filter((loc) => loc && loc.uri && loc.range)
    .map((loc) => ({ uri: loc.uri, range: rangeToPlatform(loc.range) }));
}

interface RawSignatureHelp {
  signatures?: Array<{
    label: string;
    documentation?: string | { value?: string };
    parameters?: Array<{ label: string; documentation?: string | { value?: string } }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
}

export function lspSignatureHelpToPlatform(result: unknown): SignatureHelp | null {
  const raw = result as RawSignatureHelp | null;
  if (!raw?.signatures || raw.signatures.length === 0) return null;
  return {
    signatures: raw.signatures.map((signature) => ({
      label: signature.label,
      documentation: documentationText(signature.documentation),
      parameters: (signature.parameters ?? []).map((parameter) => ({
        label: parameter.label,
        documentation: documentationText(parameter.documentation),
      })),
    })),
    activeSignature: raw.activeSignature ?? 0,
    activeParameter: raw.activeParameter ?? 0,
  };
}

interface RawWorkspaceEdit {
  changes?: Record<string, Array<{ range: RawRange; newText: string }>>;
}

/** A present-but-empty edit is authoritative ("nothing to rename"); only a
 *  missing `changes` map yields null. */
export function lspWorkspaceEditToPlatform(result: unknown): WorkspaceEdit | null {
  const raw = result as RawWorkspaceEdit | null;
  if (!raw?.changes) return null;
  const changes: Record<string, TextEdit[]> = {};
  for (const [uri, edits] of Object.entries(raw.changes)) {
    changes[uri] = edits.map((edit) => ({ range: rangeToPlatform(edit.range), newText: edit.newText }));
  }
  return { changes };
}

/* ----- formatting / symbols / folding ----- */

interface RawTextEdit {
  range: RawRange;
  newText: string;
}

/** formatting/rangeFormatting return a TextEdit[] (or null when already formatted). */
export function lspTextEditsToPlatform(result: unknown): TextEdit[] {
  if (!Array.isArray(result)) return [];
  return (result as RawTextEdit[])
    .filter((edit) => edit && edit.range)
    .map((edit) => ({ range: rangeToPlatform(edit.range), newText: edit.newText }));
}

/** LSP SymbolKind (int) → the platform's kind string (see the Monaco bridge map). */
const SYMBOL_KIND: Record<number, string> = {
  2: 'module', // Module
  3: 'module', // Namespace
  5: 'class', // Class
  6: 'function', // Method
  7: 'field', // Property
  8: 'field', // Field
  11: 'interface', // Interface
  12: 'function', // Function
  13: 'variable', // Variable
  14: 'constant', // Constant
  23: 'struct', // Struct
};

interface RawDocumentSymbol {
  name: string;
  detail?: string;
  kind?: number;
  range: RawRange;
  selectionRange: RawRange;
  children?: RawDocumentSymbol[];
}

function documentSymbolToPlatform(symbol: RawDocumentSymbol): DocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail,
    kind: (symbol.kind !== undefined ? SYMBOL_KIND[symbol.kind] : undefined) ?? 'variable',
    range: rangeToPlatform(symbol.range),
    selectionRange: rangeToPlatform(symbol.selectionRange),
    children: symbol.children?.map(documentSymbolToPlatform),
  };
}

/** Hierarchical DocumentSymbol[] (the server nests fields/methods under classes). */
export function lspDocumentSymbolsToPlatform(result: unknown): DocumentSymbol[] {
  if (!Array.isArray(result)) return [];
  return (result as RawDocumentSymbol[])
    .filter((symbol) => symbol && symbol.range && symbol.selectionRange)
    .map(documentSymbolToPlatform);
}

interface RawFoldingRange {
  startLine: number;
  endLine: number;
  kind?: string;
}

export function lspFoldingRangesToPlatform(result: unknown): FoldingRange[] {
  if (!Array.isArray(result)) return [];
  return (result as RawFoldingRange[])
    .filter((range) => range && typeof range.startLine === 'number')
    .map((range) => ({ start: range.startLine, end: range.endLine, kind: range.kind }));
}

/**
 * The server returns tokens data in the standard LSP 5-int delta encoding
 * ([deltaLine, deltaChar, length, tokenType, tokenModifiers]), which is exactly
 * what Monaco consumes — so this only extracts the array defensively.
 */
export function lspSemanticTokensToPlatform(result: unknown): SemanticTokens {
  const data = (result as { data?: number[] } | null)?.data;
  return { data: Array.isArray(data) ? data : [] };
}
