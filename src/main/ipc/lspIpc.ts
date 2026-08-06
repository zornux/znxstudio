import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { LspStartConfig } from '../../shared/types';
import { LanguageServerService } from '../services/LanguageServerService';

/** `zornux lsp` language-server session bridge (Phase LSP). */
export function registerLspIpc(): void {
  const lsp = new LanguageServerService();

  ipcMain.handle(IpcChannels.LspStart, (event, config: LspStartConfig) => lsp.start(config, event.sender));
  ipcMain.handle(IpcChannels.LspRequest, (_event, payload: { method: string; params?: unknown }) =>
    lsp.request(payload.method, payload.params),
  );
  ipcMain.on(IpcChannels.LspNotify, (_event, payload: { method: string; params?: unknown }) =>
    lsp.notify(payload.method, payload.params),
  );
  ipcMain.handle(IpcChannels.LspStop, () => lsp.stop());
  // Terminate the language server on quit so `zornux lsp` isn't left running.
  app.on('will-quit', () => { void lsp.stop(); });
}
