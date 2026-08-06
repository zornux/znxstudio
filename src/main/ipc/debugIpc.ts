import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { DebugLaunchConfig } from '../../shared/types';
import { DebugService } from '../services/DebugService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/** Debug Adapter Protocol session bridge (Phase 4). */
export function registerDebugIpc(): void {
  const debug = new DebugService();

  ipcMain.handle(IpcChannels.DebugStart, (event, config: DebugLaunchConfig) => {
    // Trust gate: debugging runs the program, so it needs a trusted workspace.
    sharedWorkspaceTrust().assertTrusted('debugging');
    return debug.start(config, event.sender);
  });
  ipcMain.handle(IpcChannels.DebugRequest, (_event, payload: { command: string; args?: unknown }) =>
    debug.request(payload.command, payload.args),
  );
  ipcMain.handle(IpcChannels.DebugStop, () => debug.stop());
  // Terminate any DAP adapter on quit so no debug session is orphaned.
  app.on('will-quit', () => { void debug.stop(); });
}
