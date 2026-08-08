import * as monaco from 'monaco-editor';
import type { Disposable } from '../core/Module';
import type { DiagnosticsEngine } from './DiagnosticsEngine';
import type { DocumentManager } from './DocumentManager';
import type { LanguageRegistry } from './LanguageRegistry';
import type {
  Diagnostic,
  DocumentSymbol,
  Location,
  Position,
  Range,
  TextDocument,
  WorkspaceEdit,
} from './api';
import { formatProvenance } from './diagnosticCatalog';

const MARKER_OWNER = 'znxstudio-language';

const SEVERITY: Record<Diagnostic['severity'], monaco.MarkerSeverity> = {
  error: monaco.MarkerSeverity.Error,
  warning: monaco.MarkerSeverity.Warning,
  info: monaco.MarkerSeverity.Info,
  hint: monaco.MarkerSeverity.Hint,
};

const REVERSE_SEVERITY = new Map<monaco.MarkerSeverity, Diagnostic['severity']>([
  [monaco.MarkerSeverity.Error, 'error'],
  [monaco.MarkerSeverity.Warning, 'warning'],
  [monaco.MarkerSeverity.Info, 'info'],
  [monaco.MarkerSeverity.Hint, 'hint'],
]);

const SYMBOL_KIND: Record<string, monaco.languages.SymbolKind> = {
  function: monaco.languages.SymbolKind.Function,
  class: monaco.languages.SymbolKind.Class,
  struct: monaco.languages.SymbolKind.Struct,
  interface: monaco.languages.SymbolKind.Interface,
  variable: monaco.languages.SymbolKind.Variable,
  constant: monaco.languages.SymbolKind.Constant,
  module: monaco.languages.SymbolKind.Module,
  field: monaco.languages.SymbolKind.Field,
};

const COMPLETION_KIND: Record<string, monaco.languages.CompletionItemKind> = {
  function: monaco.languages.CompletionItemKind.Function,
  variable: monaco.languages.CompletionItemKind.Variable,
  constant: monaco.languages.CompletionItemKind.Constant,
  parameter: monaco.languages.CompletionItemKind.Variable,
  class: monaco.languages.CompletionItemKind.Class,
  record: monaco.languages.CompletionItemKind.Struct,
  type: monaco.languages.CompletionItemKind.Interface,
  import: monaco.languages.CompletionItemKind.Module,
  keyword: monaco.languages.CompletionItemKind.Keyword,
};

/**
 * The ONLY Monaco-aware piece of the platform. It registers each language with
 * Monaco (syntax mode + theme tokens), routes Monaco provider callbacks to the
 * active language service, and paints diagnostics as editor squiggles. Language
 * logic never lives here — Monaco simply consumes the platform.
 */
export class MonacoLanguageBridge {
  private diagnosticsSubscription: Disposable | undefined;
  constructor(
    private readonly registry: LanguageRegistry,
    private readonly documents: DocumentManager,
    private readonly diagnostics: DiagnosticsEngine,
  ) {}

  registerLanguages(): void {
    for (const service of this.registry.all()) this.registerLanguage(service.metadata.id);
    this.diagnosticsSubscription?.dispose();
    this.diagnosticsSubscription = this.diagnostics.onDidChange(({ uri }) => this.applyMarkers(uri));
  }

  dispose(): void {
    this.diagnosticsSubscription?.dispose();
    this.diagnosticsSubscription = undefined;
  }

  private registerLanguage(id: string): void {
    const service = this.registry.get(id);
    if (!service) return;
    const { metadata } = service;

    // Don't re-register Monaco built-ins (e.g. plaintext).
    if (!monaco.languages.getLanguages().some((lang) => lang.id === id)) {
      monaco.languages.register({
        id,
        extensions: metadata.extensions,
        aliases: metadata.aliases ?? [metadata.displayName],
      });
    }

    if (service.tokenizer) {
      monaco.languages.setMonarchTokensProvider(
        id,
        service.tokenizer.getMonarchGrammar() as monaco.languages.IMonarchLanguage,
      );
    }

    // Comment syntax → language configuration, so the comment-toggle command uses
    // the language's real delimiters (Zornux: `#` line, `/* … */` block).
    if (metadata.comments) {
      monaco.languages.setLanguageConfiguration(id, {
        comments: {
          lineComment: metadata.comments.lineComment,
          blockComment: metadata.comments.blockComment,
        },
      });
    }

    if (service.semanticTokens) {
      const legend = service.semanticTokens.legend;
      monaco.languages.registerDocumentSemanticTokensProvider(id, {
        getLegend: () => legend,
        provideDocumentSemanticTokens: async (model) => {
          const svc = this.activeService(id);
          const doc = this.docFor(model);
          if (!svc?.semanticTokens || !doc) return null;
          const tokens = await svc.semanticTokens.provideSemanticTokens(doc);
          return { data: new Uint32Array(tokens.data) };
        },
        releaseDocumentSemanticTokens: () => undefined,
      });
    }

    if (service.folding) {
      monaco.languages.registerFoldingRangeProvider(id, {
        provideFoldingRanges: async (model) => {
          const svc = this.activeService(id);
          const doc = this.docFor(model);
          if (!svc?.folding || !doc) return [];
          const ranges = await svc.folding.provideFoldingRanges(doc);
          // Platform folding lines are 0-based; Monaco's are 1-based.
          return ranges.map((range) => ({ start: range.start + 1, end: range.end + 1 }));
        },
      });
    }

    this.registerProviders(id);
  }

  /** Register every provider adapter once; each resolves the active service lazily. */
  private registerProviders(id: string): void {
    // Trigger characters are a static property of the registration, so read them
    // from the registered service (e.g. Zornux's `.` for member completion).
    const completionTriggers = this.registry.get(id)?.completion?.triggerCharacters;
    monaco.languages.registerCompletionItemProvider(id, {
      triggerCharacters: completionTriggers ? [...completionTriggers] : undefined,
      provideCompletionItems: async (model, position) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.completion || !doc) return { suggestions: [] };
        const list = await svc.completion.provideCompletions(doc, this.toPosition(position));
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        return {
          suggestions: list.items.map((item) => ({
            label: item.label,
            kind: COMPLETION_KIND[item.kind ?? ''] ?? monaco.languages.CompletionItemKind.Text,
            insertText: item.insertText ?? item.label,
            detail: item.detail,
            documentation: item.documentation,
            range,
          })),
        };
      },
    });

    monaco.languages.registerHoverProvider(id, {
      provideHover: async (model, position) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.hover || !doc) return null;
        const hover = await svc.hover.provideHover(doc, this.toPosition(position));
        if (!hover) return null;
        return {
          contents: hover.contents.map((value) => ({ value })),
          range: hover.range ? this.toRange(hover.range) : undefined,
        };
      },
    });

    monaco.languages.registerSignatureHelpProvider(id, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model, position) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.signatureHelp || !doc) return null;
        const help = await svc.signatureHelp.provideSignatureHelp(doc, this.toPosition(position));
        if (!help) return null;
        return {
          value: {
            signatures: help.signatures.map((signature) => ({
              label: signature.label,
              documentation: signature.documentation,
              parameters: signature.parameters.map((parameter) => ({
                label: parameter.label,
                documentation: parameter.documentation,
              })),
            })),
            activeSignature: help.activeSignature,
            activeParameter: help.activeParameter,
          },
          dispose: () => undefined,
        };
      },
    });

    monaco.languages.registerDocumentSymbolProvider(id, {
      provideDocumentSymbols: async (model) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.documentSymbols || !doc) return [];
        const symbols = await svc.documentSymbols.provideDocumentSymbols(doc);
        return symbols.map((symbol) => this.toMonacoSymbol(symbol));
      },
    });

    monaco.languages.registerDefinitionProvider(id, {
      provideDefinition: async (model, position) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.definition || !doc) return [];
        const locations = await svc.definition.provideDefinition(doc, this.toPosition(position));
        return locations.map((location) => this.toMonacoLocation(location));
      },
    });

    monaco.languages.registerReferenceProvider(id, {
      provideReferences: async (model, position) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.references || !doc) return [];
        const locations = await svc.references.provideReferences(doc, this.toPosition(position));
        return locations.map((location) => this.toMonacoLocation(location));
      },
    });

    monaco.languages.registerRenameProvider(id, {
      provideRenameEdits: async (model, position, newName) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.rename || !doc) return { edits: [] };
        const edit = await svc.rename.provideRenameEdits(doc, this.toPosition(position), newName);
        return edit ? this.toWorkspaceEdit(edit) : { edits: [] };
      },
    });

    monaco.languages.registerCodeActionProvider(
      id,
      {
        provideCodeActions: async (model, range, context) => {
          const svc = this.activeService(id);
          const doc = this.docFor(model);
          if (!svc?.codeActions || !doc) return { actions: [], dispose: () => undefined };
          const diagnostics = context.markers.map((marker) => this.markerToDiagnostic(marker));
          const actions = await svc.codeActions.provideCodeActions(
            doc,
            this.fromMonacoRange(range),
            { diagnostics },
          );
          return {
            actions: actions.map((action) => ({
              title: action.title,
              kind: action.kind ?? 'quickfix',
              isPreferred: action.isPreferred,
              edit: action.edit ? this.toWorkspaceEdit(action.edit) : undefined,
            })),
            dispose: () => undefined,
          };
        },
      },
      { providedCodeActionKinds: ['quickfix', 'refactor.inline', 'refactor.rewrite'] },
    );

    monaco.languages.registerDocumentFormattingEditProvider(id, {
      provideDocumentFormattingEdits: async (model, options) => {
        const svc = this.activeService(id);
        const doc = this.docFor(model);
        if (!svc?.formatter || !doc) return [];
        const edits = await svc.formatter.provideFormattingEdits(doc, {
          tabSize: options.tabSize,
          insertSpaces: options.insertSpaces,
        });
        return edits.map((edit) => ({ range: this.toRange(edit.range), text: edit.newText }));
      },
    });
  }

  private applyMarkers(uri: string): void {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri));
    if (!model) return;
    const markers: monaco.editor.IMarkerData[] = this.diagnostics.get(uri).map((diagnostic) => ({
      severity: SEVERITY[diagnostic.severity],
      message: diagnostic.hint ? `${diagnostic.message}\n${diagnostic.hint}` : diagnostic.message,
      // Provenance in the hover: which layer + subsystem, e.g. "Compiler · Parser".
      source: formatProvenance(diagnostic.source, diagnostic.code) || diagnostic.source,
      code: diagnostic.code,
      startLineNumber: diagnostic.range.start.line + 1,
      startColumn: diagnostic.range.start.character + 1,
      endLineNumber: diagnostic.range.end.line + 1,
      endColumn: diagnostic.range.end.character + 1,
    }));
    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);
  }

  /* ----- helpers ----- */
  private activeService(id: string) {
    const service = this.registry.get(id);
    return service && this.registry.isActive(id) ? service : undefined;
  }

  private docFor(model: monaco.editor.ITextModel): TextDocument | undefined {
    return this.documents.get(model.uri.toString());
  }

  private toPosition(position: monaco.IPosition): Position {
    return { line: position.lineNumber - 1, character: position.column - 1 };
  }

  private fromMonacoRange(range: monaco.IRange): Range {
    return {
      start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
      end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
    };
  }

  private toWorkspaceEdit(edit: WorkspaceEdit): monaco.languages.WorkspaceEdit {
    const edits: monaco.languages.IWorkspaceTextEdit[] = [];
    for (const [uri, textEdits] of Object.entries(edit.changes)) {
      for (const textEdit of textEdits) {
        edits.push({
          resource: monaco.Uri.parse(uri),
          versionId: undefined,
          textEdit: { range: this.toRange(textEdit.range), text: textEdit.newText },
        });
      }
    }
    return { edits };
  }

  private markerToDiagnostic(marker: monaco.editor.IMarkerData): Diagnostic {
    const code = typeof marker.code === 'string' ? marker.code : marker.code?.value;
    return {
      severity: REVERSE_SEVERITY.get(marker.severity) ?? 'info',
      message: marker.message,
      code,
      range: {
        start: { line: marker.startLineNumber - 1, character: marker.startColumn - 1 },
        end: { line: marker.endLineNumber - 1, character: marker.endColumn - 1 },
      },
    };
  }

  private toRange(range: Range): monaco.IRange {
    return {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    };
  }

  private toMonacoLocation(location: Location): monaco.languages.Location {
    return { uri: monaco.Uri.parse(location.uri), range: this.toRange(location.range) };
  }

  private toMonacoSymbol(symbol: DocumentSymbol): monaco.languages.DocumentSymbol {
    return {
      name: symbol.name,
      detail: symbol.detail ?? '',
      kind: SYMBOL_KIND[symbol.kind] ?? monaco.languages.SymbolKind.Variable,
      tags: [],
      range: this.toRange(symbol.range),
      selectionRange: this.toRange(symbol.selectionRange),
      children: symbol.children?.map((child) => this.toMonacoSymbol(child)),
    };
  }
}
