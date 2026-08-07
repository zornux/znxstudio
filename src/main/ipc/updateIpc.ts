import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { UpdateService, type UpdateStatus } from '../services/UpdateService';
import type { UpdateChannel } from '../../shared/update';

/**
 * Auto-update IPC (Phase 20J WI3; GitHub-native since 2026-08). The renderer
 * supplies the channel (from settings) on check; the service delegates the check
 * and, when packaged, the download/install to electron-updater (which reads
 * latest.yml from the GitHub Releases feed). A legacy `feedUrl` field may still
 * be sent by the renderer — it is accepted and ignored. Status changes are
 * broadcast to every window so the update UI stays live. All update lifecycle
 * events are logged with an `[update]` prefix (low-volume, operationally useful).
 */
export function registerUpdateIpc(): void {
  let service: UpdateService | null = null;
  let config = { channel: 'stable' as UpdateChannel };

  const broadcast = (status: UpdateStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.UpdateStatusEvent, status);
    }
  };

  const ensure = (channel: UpdateChannel): UpdateService => {
    if (service && config.channel === channel) return service;
    config = { channel };
    service = new UpdateService({
      currentVersion: app.getVersion(),
      channel,
      log: (level, message) => console[level === 'error' ? 'error' : 'info'](`[update] ${message}`),
    });
    service.onDidChangeStatus(broadcast);
    return service;
  };

  ipcMain.handle(IpcChannels.UpdateCheck, (_event, options: { channel: UpdateChannel; feedUrl?: string }) =>
    ensure(options.channel).check(),
  );
  ipcMain.handle(IpcChannels.UpdateDownload, () => service?.download() ?? null);
  ipcMain.handle(IpcChannels.UpdateInstall, () => {
    service?.install();
  });
  ipcMain.handle(IpcChannels.UpdateStatusGet, () => service?.current() ?? null);
}
