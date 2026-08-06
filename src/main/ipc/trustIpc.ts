import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import type { TrustState } from '../../shared/workspaceTrust';

/**
 * Workspace Trust IPC (Phase 20J WI1). The renderer drives the trust UI through
 * these; enforcement itself lives in the execution IPC handlers, which consult
 * the same `sharedWorkspaceTrust()` instance. Every state change is broadcast so
 * open windows update their banner/commands.
 */
export function registerTrustIpc(): void {
  const trust = sharedWorkspaceTrust();
  void trust.load();

  const broadcast = (state: TrustState): TrustState => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.TrustChanged, state);
    }
    return state;
  };

  ipcMain.handle(IpcChannels.TrustState, async () => {
    await trust.load();
    return trust.state();
  });
  ipcMain.handle(IpcChannels.TrustSetWorkspace, (_event, roots: string[]) =>
    trust.setWorkspace(Array.isArray(roots) ? roots : []),
  );
  ipcMain.handle(IpcChannels.TrustWorkspace, async () => broadcast(await trust.trustWorkspace()));
  ipcMain.handle(IpcChannels.TrustParent, async () => broadcast(await trust.trustParent()));
  ipcMain.handle(IpcChannels.TrustRevoke, async () => broadcast(await trust.revoke()));
  ipcMain.handle(IpcChannels.TrustRestricted, () => broadcast(trust.acknowledgeRestricted()));
}
