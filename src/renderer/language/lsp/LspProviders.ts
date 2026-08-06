import type {
  CompletionList,
  DocumentSymbol,
  FoldingRange,
  FormattingOptions,
  Hover,
  Location,
  Position,
  SemanticTokens,
  SignatureHelp,
  TextDocument,
  TextEdit,
  WorkspaceEdit,
} from '../api';
import type { LspLanguageClient } from './LspLanguageClient';
import {
  lspCompletionToPlatform,
  lspDocumentSymbolsToPlatform,
  lspFoldingRangesToPlatform,
  lspHoverToPlatform,
  lspLocationsToPlatform,
  lspSemanticTokensToPlatform,
  lspSignatureHelpToPlatform,
  lspTextEditsToPlatform,
  lspWorkspaceEditToPlatform,
} from './lspConversions';

/**
 * The subset of language features answered by the `zornux lsp` server. Injected
 * into the Zornux language service, which prefers it and falls back to its own
 * TS analysis if a method THROWS (server down, transport error, or a document the
 * server doesn't know). Returning a value (including `null`) is authoritative and
 * suppresses the fallback. Grows with each LSP provider phase (LSP-D/E…).
 */
export interface LspProviderBackend {
  completion(doc: TextDocument, position: Position): Promise<CompletionList>;
  hover(doc: TextDocument, position: Position): Promise<Hover | null>;
  signatureHelp(doc: TextDocument, position: Position): Promise<SignatureHelp | null>;
  definition(doc: TextDocument, position: Position): Promise<Location[]>;
  references(doc: TextDocument, position: Position): Promise<Location[]>;
  rename(doc: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit | null>;
  formatting(doc: TextDocument, options: FormattingOptions): Promise<TextEdit[]>;
  documentSymbols(doc: TextDocument): Promise<DocumentSymbol[]>;
  folding(doc: TextDocument): Promise<FoldingRange[]>;
  semanticTokens(doc: TextDocument): Promise<SemanticTokens>;
}

export class LspProviders implements LspProviderBackend {
  constructor(private readonly client: LspLanguageClient) {}

  async completion(doc: TextDocument, position: Position): Promise<CompletionList> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/completion', this.textDocumentPosition(doc, position));
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspCompletionToPlatform(response.result);
  }

  async hover(doc: TextDocument, position: Position): Promise<Hover | null> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/hover', this.textDocumentPosition(doc, position));
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspHoverToPlatform(response.result);
  }

  async signatureHelp(doc: TextDocument, position: Position): Promise<SignatureHelp | null> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/signatureHelp', this.textDocumentPosition(doc, position));
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspSignatureHelpToPlatform(response.result);
  }

  async definition(doc: TextDocument, position: Position): Promise<Location[]> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/definition', this.textDocumentPosition(doc, position));
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspLocationsToPlatform(response.result);
  }

  async references(doc: TextDocument, position: Position): Promise<Location[]> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/references', {
      ...(this.textDocumentPosition(doc, position) as object),
      context: { includeDeclaration: true },
    });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspLocationsToPlatform(response.result);
  }

  async rename(doc: TextDocument, position: Position, newName: string): Promise<WorkspaceEdit | null> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/rename', {
      ...(this.textDocumentPosition(doc, position) as object),
      newName,
    });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspWorkspaceEditToPlatform(response.result);
  }

  async formatting(doc: TextDocument, options: FormattingOptions): Promise<TextEdit[]> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/formatting', {
      textDocument: { uri: doc.uri },
      options: { tabSize: options.tabSize, insertSpaces: options.insertSpaces },
    });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspTextEditsToPlatform(response.result);
  }

  async documentSymbols(doc: TextDocument): Promise<DocumentSymbol[]> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/documentSymbol', { textDocument: { uri: doc.uri } });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspDocumentSymbolsToPlatform(response.result);
  }

  async folding(doc: TextDocument): Promise<FoldingRange[]> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/foldingRange', { textDocument: { uri: doc.uri } });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspFoldingRangesToPlatform(response.result);
  }

  async semanticTokens(doc: TextDocument): Promise<SemanticTokens> {
    this.ensureSynced(doc);
    const response = await this.client.request('textDocument/semanticTokens/full', { textDocument: { uri: doc.uri } });
    if (!response.ok) throw new Error(this.errorText(response.error));
    return lspSemanticTokensToPlatform(response.result);
  }

  /** Only answer for documents the server has been told about; otherwise defer to TS. */
  private ensureSynced(doc: TextDocument): void {
    if (!this.client.isRunning() || !this.client.isOpen(doc.uri)) {
      throw new Error('document not synced to the language server');
    }
  }

  // Platform positions are 0-based, matching LSP — no coordinate shift needed.
  private textDocumentPosition(doc: TextDocument, position: Position): unknown {
    return {
      textDocument: { uri: doc.uri },
      position: { line: position.line, character: position.character },
    };
  }

  private errorText(error: { code: number; message: string } | string | undefined): string {
    if (error === undefined) return 'language server error';
    return typeof error === 'string' ? error : error.message;
  }
}
