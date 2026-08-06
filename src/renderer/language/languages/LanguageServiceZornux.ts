import type {
  CodeAction,
  CodeActionProvider,
  CompletionItem,
  CompletionList,
  CompletionProvider,
  DefinitionProvider,
  Diagnostic,
  DiagnosticProvider,
  DocumentFormatter,
  DocumentSymbol,
  DocumentSymbolProvider,
  FoldingRange,
  FoldingRangeProvider,
  Hover,
  HoverProvider,
  LanguageActivationContext,
  LanguageCapabilities,
  LanguageMetadata,
  LanguageService,
  Location,
  ParseResult,
  Parser,
  Position,
  Range,
  ReferenceProvider,
  RenameProvider,
  SemanticTokens,
  SemanticTokensProvider,
  SignatureHelp,
  SignatureHelpProvider,
  TextDocument,
  TextEdit,
  Tokenizer,
  WorkspaceEdit,
} from '../api';
import type { LspProviderBackend } from '../lsp/LspProviders';
import { ZORNUX_SEMANTIC_LEGEND } from '../lsp/semanticLegend';
import { ZORNUX_MONARCH } from './zornux/grammar';
import { ZORNUX_KEYWORDS } from './zornux/keywords';
import { formatZornux } from './zornux/formatter';
import { IncrementalTokenizer } from './zornux/incremental';
import { parseZornux, type ZornuxParseResult } from './zornux/parser';
import { EMPTY_FILE, type StatementNode } from './zornux/ast';
import {
  analyze,
  findCallContext,
  findDefinition,
  findOccurrences,
  symbolAt,
  symbolsInScope,
  type SemanticModel,
  type SymbolInfo,
} from './zornux/semantics';
import type { SrcRange, ZornuxDiagnostic } from './zornux/lexer';

const IDENTIFIER = /^[A-Za-z_]\w*$/;

const EMPTY_MODEL: SemanticModel = {
  fileScope: { kind: 'file', range: EMPTY_FILE.range, parent: null, symbols: new Map(), children: [] },
  diagnostics: [],
  references: [],
  imports: [],
};

interface Analysis {
  text: string;
  parse: ZornuxParseResult;
  model: SemanticModel;
}

/**
 * LanguageServiceZornux — the native Zornux language service and provider
 * boundary. It drives the Monaco-free Zornux front-end (`lexer`/`parser`/`ast`/
 * `semantics`) and maps its results into platform types. Diagnostics now merge
 * syntax + semantic passes, and go-to-definition resolves through the symbol
 * table. Still NO type checking and NO invented IntelliSense.
 */
export class LanguageServiceZornux implements LanguageService {
  readonly metadata: LanguageMetadata = {
    id: 'zornux',
    displayName: 'Zornux',
    extensions: ['.zx'],
    aliases: ['Zornux', 'zornux'],
    native: true,
    comments: { lineComment: '#', blockComment: ['/*', '*/'] },
  };

  readonly capabilities: LanguageCapabilities = {
    diagnostics: true,
    parser: true,
    formatter: true,
    tokenizer: true,
    documentSymbols: true,
    definition: true,
    completion: true,
    hover: true,
    signatureHelp: true,
    references: true,
    rename: true,
    codeActions: true,
    folding: true,
    semanticTokens: true,
  };

  private context: LanguageActivationContext | null = null;
  private readonly lexer = new IncrementalTokenizer();
  private readonly analysisCache = new Map<string, Analysis>();
  /**
   * When set (LSP-C+), completion/hover prefer the real `zornux lsp` server and
   * fall back to the TS analysis below only if the server errors or doesn't know
   * the document. Injected by the LSP module when the server is running.
   */
  private lspBackend: LspProviderBackend | null = null;

  /** Route LSP-served providers through the given backend, or `null` to use TS only. */
  setLspBackend(backend: LspProviderBackend | null): void {
    this.lspBackend = backend;
  }

  /**
   * The authoritative `zornux format` CLI, injected by the Language Platform. When
   * present it formats documents; the TS re-indenter below is only a fallback for
   * when the toolchain is unavailable. Returns null on any failure so the fallback
   * still runs.
   */
  private cliFormatter: ((source: string) => Promise<string | null>) | null = null;

  /** Provide the real compiler-backed formatter, or `null` to use the TS fallback only. */
  setCliFormatter(formatter: ((source: string) => Promise<string | null>) | null): void {
    this.cliFormatter = formatter;
  }

  activate(context: LanguageActivationContext): void {
    this.context = context;
    context.log('Zornux language service activated (syntax + AST + symbols + semantics)');
  }

  deactivate(): void {
    this.context = null;
    this.analysisCache.clear();
    this.lexer.clear();
  }

  readonly tokenizer: Tokenizer = {
    getMonarchGrammar: () => ZORNUX_MONARCH,
  };

  readonly parser: Parser = {
    parse: (doc: TextDocument): ParseResult => {
      const { parse } = this.analyze(doc);
      return { ast: parse.ast, diagnostics: parse.diagnostics.map((d) => toPlatform(d, 'zornux')) };
    },
  };

  readonly formatter: DocumentFormatter = {
    provideFormattingEdits: async (doc: TextDocument, options): Promise<TextEdit[]> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.formatting(doc, options);
        } catch {
          /* server down / doc not synced — fall back below */
        }
      }
      const original = doc.getText();
      let formatted: string | null = null;
      // Prefer the authoritative `zornux format` when the toolchain is present.
      if (this.cliFormatter) {
        try {
          formatted = await this.cliFormatter(original);
        } catch {
          formatted = null;
        }
      }
      // Fall back to the in-IDE token re-indenter when the compiler is unavailable.
      if (formatted === null) {
        try {
          formatted = formatZornux(original, {
            tabSize: options.tabSize,
            insertSpaces: options.insertSpaces,
          });
        } catch {
          return [];
        }
      }
      if (formatted === original) return [];
      const lastLine = Math.max(0, doc.lineCount() - 1);
      return [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: lastLine, character: doc.lineAt(lastLine).length },
          },
          newText: formatted,
        },
      ];
    },
  };

  readonly diagnostics: DiagnosticProvider = {
    provideDiagnostics: (doc: TextDocument): Diagnostic[] => this.mergedDiagnostics(doc),
  };

  readonly codeActions: CodeActionProvider = {
    provideCodeActions: (doc: TextDocument, range: Range): CodeAction[] => {
      const { model } = this.analyze(doc);
      const actions: CodeAction[] = [];

      // Quick fixes (diagnostic-driven).
      for (const diagnostic of this.mergedDiagnostics(doc)) {
        if (!rangesIntersect(diagnostic.range, range)) continue;
        switch (diagnostic.code) {
          case 'zx-undefined-identifier':
            actions.push(...didYouMeanActions(doc, model, diagnostic));
            break;
          case 'zx-duplicate-declaration':
            actions.push(removeDeclarationAction(doc, diagnostic));
            break;
          case 'zx-unterminated-string':
            actions.push(addClosingQuoteAction(doc, diagnostic));
            break;
        }
      }

      // Refactorings (cursor-driven).
      const inline = inlineSymbolAction(doc, model, range.start);
      if (inline) actions.push(inline);
      const convert = convertDeclarationAction(doc, model, range.start);
      if (convert) actions.push(convert);

      return actions;
    },
  };

  readonly documentSymbols: DocumentSymbolProvider = {
    provideDocumentSymbols: async (doc: TextDocument): Promise<DocumentSymbol[]> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.documentSymbols(doc);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      return toDocumentSymbols(this.analyze(doc).parse.ast.body);
    },
  };

  readonly folding: FoldingRangeProvider = {
    // Folding is server-provided (the TS analysis has none); an empty result
    // just means Monaco keeps its own indentation folding.
    provideFoldingRanges: async (doc: TextDocument): Promise<FoldingRange[]> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.folding(doc);
        } catch {
          /* server down / doc not synced */
        }
      }
      return [];
    },
  };

  readonly semanticTokens: SemanticTokensProvider = {
    // Server-provided (the Monarch grammar handles coarse coloring on its own);
    // an empty result leaves the Monarch tokens in place.
    legend: ZORNUX_SEMANTIC_LEGEND,
    provideSemanticTokens: async (doc: TextDocument): Promise<SemanticTokens> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.semanticTokens(doc);
        } catch {
          /* server down / doc not synced */
        }
      }
      return { data: [] };
    },
  };

  readonly definition: DefinitionProvider = {
    provideDefinition: async (doc: TextDocument, position: Position): Promise<Location[]> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.definition(doc, position);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      const target = findDefinition(this.analyze(doc).model, position);
      return target ? [{ uri: doc.uri, range: toRange(target.nameRange) }] : [];
    },
  };

  readonly hover: HoverProvider = {
    provideHover: async (doc: TextDocument, position: Position): Promise<Hover | null> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.hover(doc, position);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      const found = symbolAt(this.analyze(doc).model, position);
      return found ? { contents: hoverContents(found) } : null;
    },
  };

  readonly references: ReferenceProvider = {
    provideReferences: async (doc: TextDocument, position: Position): Promise<Location[]> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.references(doc, position);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      const occurrences = findOccurrences(this.analyze(doc).model, position, true);
      return occurrences
        ? occurrences.ranges.map((range) => ({ uri: doc.uri, range: toRange(range) }))
        : [];
    },
  };

  readonly rename: RenameProvider = {
    provideRenameEdits: async (
      doc: TextDocument,
      position: Position,
      newName: string,
    ): Promise<WorkspaceEdit | null> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.rename(doc, position, newName);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      if (!IDENTIFIER.test(newName) || ZORNUX_KEYWORDS.includes(newName)) return null;
      const occurrences = findOccurrences(this.analyze(doc).model, position, true);
      if (!occurrences || occurrences.ranges.length === 0) return null;
      return {
        changes: {
          [doc.uri]: occurrences.ranges.map((range) => ({ range: toRange(range), newText: newName })),
        },
      };
    },
  };

  readonly signatureHelp: SignatureHelpProvider = {
    provideSignatureHelp: async (doc: TextDocument, position: Position): Promise<SignatureHelp | null> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.signatureHelp(doc, position);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      const { model } = this.analyze(doc);
      const call = findCallContext(doc.getText(), position);
      if (!call) return null;
      const fn = symbolsInScope(model, position).find(
        (candidate) => candidate.name === call.name && candidate.kind === 'function',
      );
      if (!fn) return null;

      const params = fn.params ?? [];
      const label = `${fn.name}(${params.join(', ')})`;
      return {
        signatures: [{ label, parameters: params.map((name) => ({ label: name })) }],
        activeSignature: 0,
        activeParameter: params.length ? Math.min(call.activeParameter, params.length - 1) : 0,
      };
    },
  };

  readonly completion: CompletionProvider = {
    // `.` opens member completion as you type — the server answers `textDocument/
    // completion` with the receiver's members (it advertises `.` as a trigger).
    triggerCharacters: ['.'],
    // Real, scope-aware completions: symbols visible at the cursor + keywords.
    // Monaco filters by the typed prefix — we return the candidate set. Prefer the
    // language server when it's driving this document; TS analysis is the fallback.
    provideCompletions: async (doc: TextDocument, position: Position): Promise<CompletionList> => {
      if (this.lspBackend) {
        try {
          return await this.lspBackend.completion(doc, position);
        } catch {
          /* server down / doc not synced — fall back to TS analysis */
        }
      }
      // Member position (`receiver.` … ) with no language server: we have no
      // member data offline, so stay quiet rather than suggest keywords/symbols
      // that can't follow a `.`.
      const linePrefix = doc.lineAt(position.line).slice(0, position.character);
      if (/\.\s*\w*$/.test(linePrefix)) return { items: [] };

      const { model } = this.analyze(doc);
      const items: CompletionItem[] = symbolsInScope(model, position).map((symbolInfo) => ({
        label: symbolInfo.name,
        kind: symbolInfo.kind,
        detail: `Zornux ${symbolInfo.kind}`,
      }));
      for (const keyword of ZORNUX_KEYWORDS) {
        items.push({ label: keyword, kind: 'keyword', detail: 'keyword', insertText: keyword });
      }
      return { items };
    },
  };

  /** Merged, position-sorted syntax + semantic diagnostics. */
  private mergedDiagnostics(doc: TextDocument): Diagnostic[] {
    const { parse, model } = this.analyze(doc);
    const all: Diagnostic[] = [
      ...parse.diagnostics.map((d) => toPlatform(d, 'zornux')),
      ...model.diagnostics.map((d) => toPlatform(d, 'zornux-semantic')),
    ];
    all.sort(
      (a, b) =>
        a.range.start.line - b.range.start.line || a.range.start.character - b.range.start.character,
    );
    return all;
  }

  /**
   * Single analysis entry point: parse + semantic. Cached per (uri, version) so
   * the many providers Monaco fires for one document version share one analysis;
   * tokenization is incremental (unchanged lines aren't re-scanned) and the token
   * stream is shared between the parser and the semantic pass.
   */
  private analyze(doc: TextDocument): Analysis {
    const key = `${doc.uri}@${doc.version}`;
    const cached = this.analysisCache.get(key);
    if (cached) {
      // LRU touch.
      this.analysisCache.delete(key);
      this.analysisCache.set(key, cached);
      return cached;
    }

    const text = doc.getText();
    let parse: ZornuxParseResult;
    let model: SemanticModel;
    try {
      const lex = this.lexer.tokenize(text);
      parse = parseZornux(text, lex);
      model = analyze(parse.ast, lex.tokens);
    } catch {
      parse = { ast: EMPTY_FILE, diagnostics: [] };
      model = EMPTY_MODEL;
    }

    const analysis: Analysis = { text, parse, model };
    this.analysisCache.set(key, analysis);
    if (this.analysisCache.size > 64) {
      const oldest = this.analysisCache.keys().next().value;
      if (oldest !== undefined) this.analysisCache.delete(oldest);
    }
    return analysis;
  }
}

/* ----- AST → platform DocumentSymbol mapping ----- */
function toDocumentSymbols(nodes: StatementNode[]): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  for (const node of nodes) {
    switch (node.kind) {
      case 'Import':
        symbols.push(symbol(node.name, 'module', node.range, node.nameRange));
        break;
      case 'Function':
        symbols.push(symbol(node.name, 'function', node.range, node.nameRange, childrenOf(node.body)));
        break;
      case 'Class':
        symbols.push(symbol(node.name, 'class', node.range, node.nameRange, childrenOf(node.body)));
        break;
      case 'Record':
        symbols.push(symbol(node.name, 'struct', node.range, node.nameRange, childrenOf(node.body)));
        break;
      case 'Type':
        symbols.push(symbol(node.name, 'interface', node.range, node.nameRange));
        break;
      case 'Variable':
        symbols.push(symbol(node.name, 'variable', node.range, node.nameRange));
        break;
      case 'Constant':
        symbols.push(symbol(node.name, 'constant', node.range, node.nameRange));
        break;
      case 'Block':
        symbols.push(...toDocumentSymbols(node.body));
        break;
    }
  }
  return symbols;
}

function childrenOf(body: { body: StatementNode[] } | null): DocumentSymbol[] {
  return body ? toDocumentSymbols(body.body) : [];
}

function symbol(
  name: string,
  kind: string,
  range: SrcRange,
  selection: SrcRange,
  children?: DocumentSymbol[],
): DocumentSymbol {
  return { name, detail: kind, kind, range: toRange(range), selectionRange: toRange(selection), children };
}

function toRange(range: SrcRange): Range {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/** Markdown hover: a signature line + where it was declared. */
function hoverContents(symbol: SymbolInfo): string[] {
  const signature =
    symbol.kind === 'function'
      ? `function ${symbol.name}(${(symbol.params ?? []).join(', ')})`
      : `${symbol.kind} ${symbol.name}`;
  return ['```zornux\n' + signature + '\n```', `Declared on line ${symbol.nameRange.start.line + 1}.`];
}

/* ----- quick fixes ----- */
function didYouMeanActions(doc: TextDocument, model: SemanticModel, diagnostic: Diagnostic): CodeAction[] {
  const line = doc.lineAt(diagnostic.range.start.line);
  const name = line.substring(diagnostic.range.start.character, diagnostic.range.end.character);
  if (!name) return [];

  const candidates = [...new Set(symbolsInScope(model, diagnostic.range.start).map((s) => s.name))];
  const ranked = candidates
    .filter((candidate) => candidate !== name)
    .map((candidate) => ({ candidate, distance: levenshtein(name.toLowerCase(), candidate.toLowerCase()) }))
    .filter((entry) => entry.distance > 0 && entry.distance <= 2 && entry.distance < name.length)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3);

  return ranked.map((entry, index) => ({
    title: `Change '${name}' to '${entry.candidate}'`,
    kind: 'quickfix',
    isPreferred: index === 0,
    edit: replaceEdit(doc.uri, diagnostic.range, entry.candidate),
  }));
}

function removeDeclarationAction(doc: TextDocument, diagnostic: Diagnostic): CodeAction {
  const line = diagnostic.range.start.line;
  const deleteRange: Range = {
    start: { line, character: 0 },
    end: { line: line + 1, character: 0 },
  };
  return {
    title: 'Remove duplicate declaration',
    kind: 'quickfix',
    isPreferred: true,
    edit: replaceEdit(doc.uri, deleteRange, ''),
  };
}

function addClosingQuoteAction(doc: TextDocument, diagnostic: Diagnostic): CodeAction {
  const at = diagnostic.range.end;
  return {
    title: 'Add closing quote',
    kind: 'quickfix',
    isPreferred: true,
    edit: replaceEdit(doc.uri, { start: at, end: at }, '"'),
  };
}

function replaceEdit(uri: string, range: Range, newText: string): WorkspaceEdit {
  return { changes: { [uri]: [{ range, newText }] } };
}

/* ----- refactorings ----- */
const DECLARATION = /^(\s*)(define|let)\s+([A-Za-z_]\w*)\s+(to|is)\s+(.+?)\s*$/;

/** Inline a variable/constant: replace every use with its initializer, delete the declaration. */
function inlineSymbolAction(doc: TextDocument, model: SemanticModel, position: Position): CodeAction | null {
  const symbol = symbolAt(model, position);
  if (!symbol || (symbol.kind !== 'variable' && symbol.kind !== 'constant')) return null;

  const declLine = symbol.nameRange.start.line;
  const match = DECLARATION.exec(doc.lineAt(declLine));
  if (!match) return null;
  const initializer = match[5];

  const occurrences = findOccurrences(model, symbol.nameRange.start, false);
  if (!occurrences) return null;

  const edits = occurrences.ranges.map((range) => ({ range: toRange(range), newText: initializer }));
  edits.push({
    range: { start: { line: declLine, character: 0 }, end: { line: declLine + 1, character: 0 } },
    newText: '',
  });

  return {
    title: `Inline ${symbol.kind} '${symbol.name}'`,
    kind: 'refactor.inline',
    edit: { changes: { [doc.uri]: edits } },
  };
}

/** Convert a constant (define…to) to a variable (let…is), or vice versa. */
function convertDeclarationAction(
  doc: TextDocument,
  model: SemanticModel,
  position: Position,
): CodeAction | null {
  const symbol = symbolAt(model, position);
  if (!symbol || (symbol.kind !== 'variable' && symbol.kind !== 'constant')) return null;

  const line = symbol.nameRange.start.line;
  const text = doc.lineAt(line);
  const match = DECLARATION.exec(text);
  if (!match) return null;

  const [, indent, keyword, name, , value] = match;
  const toConstant = keyword === 'let';
  const newLine = toConstant
    ? `${indent}define ${name} to ${value}`
    : `${indent}let ${name} is ${value}`;
  const title = toConstant
    ? `Convert variable '${name}' to constant (define)`
    : `Convert constant '${name}' to variable (let)`;

  return {
    title,
    kind: 'refactor.rewrite',
    edit: replaceEdit(doc.uri, { start: { line, character: 0 }, end: { line, character: text.length } }, newLine),
  };
}

function rangesIntersect(a: Range, b: Range): boolean {
  return positionLE(a.start, b.end) && positionLE(b.start, a.end);
}

function positionLE(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.character <= b.character);
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[] = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    let previous = dp[0];
    dp[0] = i;
    for (let j = 1; j < cols; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? previous : 1 + Math.min(previous, dp[j], dp[j - 1]);
      previous = temp;
    }
  }
  return dp[cols - 1];
}

/* ----- front-end diagnostic → platform diagnostic ----- */
function toPlatform(
  diagnostic: ZornuxDiagnostic | { severity: 'error' | 'warning' | 'info'; code: string; message: string; hint?: string; range: SrcRange },
  source: string,
): Diagnostic {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    code: diagnostic.code,
    hint: diagnostic.hint,
    source,
    range: toRange(diagnostic.range),
  };
}
