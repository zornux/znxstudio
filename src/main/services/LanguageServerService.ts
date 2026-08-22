import type { WebContents } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { LspStartConfig, LspStartResult, LspRequestResult } from '../../shared/types';
import { LspClient } from '../lsp/LspClient';
import { resolveZornux } from '../util/zornuxRuntime';

/**
 * Manages a single `zornux lsp` language-server session. Bridges the renderer to
 * the server: spawns it, runs the LSP `initialize` → `initialized` handshake,
 * forwards `textDocument/publishDiagnostics` to the renderer, and pass-throughs
 * arbitrary LSP requests/notifications (so later phases add completion/hover/…
 * without new IPC). One server at a time. Never throws to the renderer.
 */
export class LanguageServerService {
  private client: LspClient | null = null;
  private sender: WebContents | null = null;

  async start(config: LspStartConfig, sender: WebContents): Promise<LspStartResult> {
    this.stop(); // dispose any prior server
    this.sender = sender;

    // An explicit negotiated path wins; otherwise resolve through the shared
    // locator so the LSP prefers the bundled runtime over bare PATH.
    const command = config.compilerPath?.trim() || resolveZornux().path;
    const cwd = config.rootPath ?? process.cwd();
    let client: LspClient;
    try {
      client = new LspClient(command, ['lsp'], cwd);
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
    this.client = client;

    client.onNotification((method, params) => this.onNotification(client, method, params));
    client.onExit((code) => {
      if (this.client === client) this.client = null;
      this.send(IpcChannels.LspClosed, { code });
    });

    try {
      const init = await client.sendRequest('initialize', {
        processId: null,
        clientInfo: { name: 'ZnxStudio' },
        locale: 'en',
        rootUri: config.rootUri ?? null,
        initializationOptions: { zornux: config.settings ?? {} },
        capabilities: {
          textDocument: {
            synchronization: { didSave: true },
            publishDiagnostics: { relatedInformation: false },
          },
        },
      });
      if (init.error) {
        return this.fail(typeof init.error === 'object' ? init.error.message : String(init.error));
      }
      const result = (init.result ?? {}) as {
        capabilities?: Record<string, unknown>;
        serverInfo?: { name: string; version?: string };
      };
      client.sendNotification('initialized', {});
      return { success: true, capabilities: result.capabilities ?? {}, serverInfo: result.serverInfo };
    } catch (error) {
      const detail = client.stderrText();
      return this.fail(`${(error as Error).message}${detail ? ` — ${detail}` : ''}`);
    }
  }

  async request(method: string, params?: unknown): Promise<LspRequestResult> {
    if (!this.client) return { ok: false, error: 'No language server running.' };
    try {
      const response = await this.client.sendRequest(method, params);
      if (response.error) return { ok: false, error: response.error };
      return { ok: true, result: response.result ?? null };
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }
  }

  notify(method: string, params?: unknown): void {
    this.client?.sendNotification(method, params);
  }

  /** Gracefully shut the server down (LSP shutdown → exit) and dispose it. */
  stop(): void {
    const client = this.client;
    if (!client) return;
    this.client = null;
    client.onNotification(() => undefined);
    client.onExit(() => undefined);
    client.sendRequest('shutdown').catch(() => undefined);
    client.sendNotification('exit');
    setTimeout(() => client.dispose(), 200);
  }

  private onNotification(client: LspClient, method: string, params: unknown): void {
    if (this.client !== client) return; // stale server
    if (method === 'textDocument/publishDiagnostics') {
      this.send(IpcChannels.LspDiagnostics, params);
    }
    // window/logMessage, window/showMessage, telemetry/event are ignored for now.
  }

  private fail(error: string): LspStartResult {
    this.stop();
    return { success: false, error };
  }

  private send(channel: string, payload: unknown): void {
    if (this.sender && !this.sender.isDestroyed()) this.sender.send(channel, payload);
  }
}
