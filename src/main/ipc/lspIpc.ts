import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { LspStartConfig } from '../../shared/types';
import { LanguageServerService } from '../services/LanguageServerService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/** `zornux lsp` language-server session bridge (Phase LSP). */
export function registerLspIpc(): void {
  const lsp = new LanguageServerService();
  const trust = sharedWorkspaceTrust();

  ipcMain.handle(IpcChannels.LspStart, (event, config: LspStartConfig) => {
    trust.assertTrusted('Language Server');
    if (config.rootPath) {
      const safe = confineToRoots(config.rootPath, trust.getRoots());
      if (!safe) throw new Error('Path is outside workspace boundaries.');
      config = { ...config, rootPath: safe };
    }
    return lsp.start(config, event.sender);
  });
  ipcMain.handle(IpcChannels.LspRequest, (_event, payload: { method: string; params?: unknown }) => {
    trust.assertTrusted('Language Server');
    return lsp.request(payload.method, payload.params);
  });
  ipcMain.on(IpcChannels.LspNotify, (_event, payload: { method: string; params?: unknown }) => {
    try { lsp.notify(payload.method, payload.params); } catch { /* notification is best-effort */ }
  });
  ipcMain.handle(IpcChannels.LspStop, () => lsp.stop());
  app.on('will-quit', () => { void lsp.stop(); });
}
