/**
 * ZnxStudio Language Platform — public API.
 *
 * These are the stable, editor-agnostic contracts every language service builds
 * against. Nothing here imports Monaco or Node: geometry is expressed with
 * LSP-style 0-based positions and the Monaco bridge translates at the edges.
 * Future compiler services attach by implementing these interfaces — the shape
 * of the platform does not change.
 */
import type { Event } from '../core/Emitter';
import type { WorkspaceInfo } from '../../shared/types';

/* ----- Geometry (0-based, LSP-style) ----- */
export interface Position {
  line: number;
  character: number;
}
export interface Range {
  start: Position;
  end: Position;
}
export interface Location {
  uri: string;
  range: Range;
}
export interface TextEdit {
  range: Range;
  newText: string;
}
export interface WorkspaceEdit {
  changes: Record<string, TextEdit[]>;
}

/* ----- Diagnostics ----- */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';
export interface Diagnostic {
  range: Range;
  severity: DiagnosticSeverity;
  message: string;
  source?: string;
  code?: string;
  /** Optional actionable guidance shown in the Problems panel + squiggle hover. */
  hint?: string;
}

/* ----- Documents ----- */
export interface TextDocument {
  readonly uri: string;
  readonly path: string;
  readonly languageId: string;
  readonly version: number;
  getText(): string;
  lineCount(): number;
  /** 0-based line access. */
  lineAt(line: number): string;
}

/** Read-only document view handed to language services on activation. */
export interface DocumentStore {
  get(uri: string): TextDocument | undefined;
  all(): TextDocument[];
}

/* ----- Provider payloads ----- */
export interface CompletionItem {
  label: string;
  kind?: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
}
export interface CompletionList {
  items: CompletionItem[];
}
export interface Hover {
  contents: string[];
  range?: Range;
}
export interface ParameterInformation {
  label: string;
  documentation?: string;
}
export interface SignatureInformation {
  label: string;
  documentation?: string;
  parameters: ParameterInformation[];
}
export interface SignatureHelp {
  signatures: SignatureInformation[];
  activeSignature: number;
  activeParameter: number;
}
export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: string;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}
export interface SemanticTokensLegend {
  tokenTypes: string[];
  tokenModifiers: string[];
}
export interface SemanticTokens {
  data: number[];
}
export interface FoldingRange {
  /** 0-based start line (inclusive). */
  start: number;
  /** 0-based end line (inclusive). */
  end: number;
  /** e.g. 'comment' | 'imports' | 'region'. */
  kind?: string;
}
export interface FormattingOptions {
  tabSize: number;
  insertSpaces: boolean;
}
export interface ParseResult {
  ast: unknown | null;
  diagnostics: Diagnostic[];
}

export interface CancellationToken {
  readonly isCancellationRequested: boolean;
}

/* ----- Providers (each is an independent extension point) ----- */
export interface DiagnosticProvider {
  provideDiagnostics(doc: TextDocument, token?: CancellationToken): Diagnostic[] | Promise<Diagnostic[]>;
}
export interface Parser {
  parse(doc: TextDocument): ParseResult | Promise<ParseResult>;
}
export interface DocumentFormatter {
  provideFormattingEdits(doc: TextDocument, options: FormattingOptions): TextEdit[] | Promise<TextEdit[]>;
}
export interface Tokenizer {
  /** Returns a Monarch grammar object; consumed (and typed) by the Monaco bridge. */
  getMonarchGrammar(): object;
}
export interface CompletionProvider {
  provideCompletions(doc: TextDocument, position: Position): CompletionList | Promise<CompletionList>;
  /**
   * Characters that should auto-open completion (beyond the editor's default
   * word-triggering), e.g. `.` for member access. Without these, member/dot
   * completion never fires as the user types even when the backend supports it.
   */
  readonly triggerCharacters?: readonly string[];
}
export interface HoverProvider {
  provideHover(doc: TextDocument, position: Position): Hover | null | Promise<Hover | null>;
}
export interface SignatureHelpProvider {
  provideSignatureHelp(
    doc: TextDocument,
    position: Position,
  ): SignatureHelp | null | Promise<SignatureHelp | null>;
}
export interface DocumentSymbolProvider {
  provideDocumentSymbols(doc: TextDocument): DocumentSymbol[] | Promise<DocumentSymbol[]>;
}
export interface SemanticTokensProvider {
  readonly legend: SemanticTokensLegend;
  provideSemanticTokens(doc: TextDocument): SemanticTokens | Promise<SemanticTokens>;
}
export interface FoldingRangeProvider {
  provideFoldingRanges(doc: TextDocument): FoldingRange[] | Promise<FoldingRange[]>;
}
export interface DefinitionProvider {
  provideDefinition(doc: TextDocument, position: Position): Location[] | Promise<Location[]>;
}
export interface ReferenceProvider {
  provideReferences(doc: TextDocument, position: Position): Location[] | Promise<Location[]>;
}
export interface RenameProvider {
  provideRenameEdits(
    doc: TextDocument,
    position: Position,
    newName: string,
  ): WorkspaceEdit | null | Promise<WorkspaceEdit | null>;
}

export interface CodeAction {
  title: string;
  /** e.g. 'quickfix'. */
  kind?: string;
  edit?: WorkspaceEdit;
  isPreferred?: boolean;
}
export interface CodeActionContext {
  /** Diagnostics overlapping the requested range (as reported by the editor). */
  diagnostics: Diagnostic[];
}
export interface CodeActionProvider {
  provideCodeActions(
    doc: TextDocument,
    range: Range,
    context: CodeActionContext,
  ): CodeAction[] | Promise<CodeAction[]>;
}

/* ----- Language service ----- */
/** Comment delimiters for a language (monaco-free; the bridge translates them). */
export interface LanguageComments {
  /** Line-comment prefix, e.g. the hash character. Drives the comment-toggle command. */
  lineComment?: string;
  /** Block-comment open/close delimiters (e.g. slash-star … star-slash). */
  blockComment?: [string, string];
}

export interface LanguageMetadata {
  id: string;
  displayName: string;
  extensions: string[];
  aliases?: string[];
  native: boolean;
  /** Comment syntax (optional). When present the bridge wires comment toggling. */
  comments?: LanguageComments;
}

/** Declares which provider slots a language currently fulfils. */
export interface LanguageCapabilities {
  diagnostics: boolean;
  parser: boolean;
  formatter: boolean;
  tokenizer: boolean;
  completion: boolean;
  hover: boolean;
  signatureHelp: boolean;
  documentSymbols: boolean;
  semanticTokens: boolean;
  definition: boolean;
  references: boolean;
  rename: boolean;
  codeActions: boolean;
  folding: boolean;
}

/** Sink a language service writes diagnostics into. */
export interface DiagnosticSink {
  set(uri: string, source: string, diagnostics: Diagnostic[]): void;
  clear(uri: string, source?: string): void;
}

export interface LanguageActivationContext {
  documents: DocumentStore;
  diagnostics: DiagnosticSink;
  workspace: WorkspaceInfo | null;
  log(message: string): void;
}

/**
 * A language service. Providers are optional and resolved lazily — the platform
 * checks `capabilities` (and the presence of a provider) before dispatching, so
 * a language can start as placeholders and grow real providers with no redesign.
 */
export interface LanguageService {
  readonly metadata: LanguageMetadata;
  readonly capabilities: LanguageCapabilities;
  activate(context: LanguageActivationContext): void | Promise<void>;
  deactivate(): void | Promise<void>;

  readonly diagnostics?: DiagnosticProvider;
  readonly parser?: Parser;
  readonly formatter?: DocumentFormatter;
  readonly tokenizer?: Tokenizer;
  readonly completion?: CompletionProvider;
  readonly hover?: HoverProvider;
  readonly signatureHelp?: SignatureHelpProvider;
  readonly documentSymbols?: DocumentSymbolProvider;
  readonly semanticTokens?: SemanticTokensProvider;
  readonly definition?: DefinitionProvider;
  readonly references?: ReferenceProvider;
  readonly rename?: RenameProvider;
  readonly codeActions?: CodeActionProvider;
  readonly folding?: FoldingRangeProvider;
}

/** Read side of the diagnostics engine (consumed by the Problems panel + bridge). */
export interface DiagnosticsReader {
  get(uri: string): Diagnostic[];
  uris(): string[];
  readonly onDidChange: Event<{ uri: string }>;
}

/** Service-registry keys for the language platform. */
export const LanguageServiceKeys = {
  Registry: 'znxstudio.lang.registry',
  Documents: 'znxstudio.lang.documents',
  Diagnostics: 'znxstudio.lang.diagnostics',
} as const;
