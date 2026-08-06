import type {
  LspClosedMessage,
  LspDiagnosticsMessage,
  LspRawDiagnostic,
  LspRequestResult,
  LspStartConfig,
  LspStartResult,
  Unsubscribe,
} from '../../../shared/types';

type DiagnosticsHandler = (uri: string, diagnostics: LspRawDiagnostic[]) => void;
type ClosedHandler = () => void;

/**
 * Renderer-side facade over `window.znxstudio.lsp`. Owns the single language-server
 * session's lifecycle, tracks which documents are open on the server (so
 * didChange/didClose are only sent for docs the server knows), and fans out
 * pushed diagnostics + the closed signal. Provider phases (LSP-C+) reuse
 * `request` for completion/hover/etc.
 */
export class LspLanguageClient {
  private running = false;
  private readonly openUris = new Set<string>();
  private diagnosticsHandler: DiagnosticsHandler = () => undefined;
  private closedHandler: ClosedHandler = () => undefined;
  private unsubDiagnostics: Unsubscribe | null = null;
  private unsubClosed: Unsubscribe | null = null;

  isRunning(): boolean {
    return this.running;
  }
  isOpen(uri: string): boolean {
    return this.openUris.has(uri);
  }

  onDiagnostics(handler: DiagnosticsHandler): void {
    this.diagnosticsHandler = handler;
  }
  onClosed(handler: ClosedHandler): void {
    this.closedHandler = handler;
  }

  async start(config: LspStartConfig): Promise<LspStartResult> {
    // Rewire subscriptions to this session.
    this.unsubDiagnostics?.();
    this.unsubClosed?.();
    this.unsubDiagnostics = window.znxstudio.lsp.onDiagnostics((message: LspDiagnosticsMessage) =>
      this.diagnosticsHandler(message.uri, message.diagnostics),
    );
    this.unsubClosed = window.znxstudio.lsp.onClosed((_message: LspClosedMessage) => {
      this.running = false;
      this.openUris.clear();
      this.closedHandler();
    });

    this.openUris.clear();
    const result = await window.znxstudio.lsp.start(config);
    this.running = result.success;
    return result;
  }

  didOpen(uri: string, languageId: string, version: number, text: string): void {
    if (!this.running || this.openUris.has(uri)) return;
    this.openUris.add(uri);
    window.znxstudio.lsp.notify('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text },
    });
  }

  /** Full-document sync — the server accepts a whole-text change (range omitted). */
  didChange(uri: string, version: number, text: string): void {
    if (!this.running || !this.openUris.has(uri)) return;
    window.znxstudio.lsp.notify('textDocument/didChange', {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }

  didClose(uri: string): void {
    if (!this.running || !this.openUris.has(uri)) return;
    this.openUris.delete(uri);
    window.znxstudio.lsp.notify('textDocument/didClose', { textDocument: { uri } });
  }

  request(method: string, params?: unknown): Promise<LspRequestResult> {
    return window.znxstudio.lsp.request(method, params);
  }

  /** Send an arbitrary LSP notification (e.g. `workspace/didChangeConfiguration`). */
  notify(method: string, params?: unknown): void {
    window.znxstudio.lsp.notify(method, params);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.openUris.clear();
    await window.znxstudio.lsp.stop();
  }
}
