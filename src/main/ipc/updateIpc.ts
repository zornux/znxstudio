import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { UpdateService, type UpdateStatus } from '../services/UpdateService';
import type { UpdateChannel } from '../../shared/update';

/**
 * Auto-update IPC (Phase 20J WI3). The renderer supplies the channel + feed URL
 * (from settings) on check; the service performs the real HTTP feed check and,
 * when packaged with electron-updater, the download/install. Status changes are
 * broadcast to every window so the update UI stays live. All update lifecycle
 * events are logged with an `[update]` prefix (low-volume, operationally useful).
 */
export function registerUpdateIpc(): void {
  let service: UpdateService | null = null;
  let config = { channel: 'stable' as UpdateChannel, feedUrl: '' };

  const broadcast = (status: UpdateStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.UpdateStatusEvent, status);
    }
  };

  const ensure = (channel: UpdateChannel, feedUrl: string): UpdateService => {
    if (service && config.channel === channel && config.feedUrl === feedUrl) return service;
    config = { channel, feedUrl };
    service = new UpdateService({
      currentVersion: app.getVersion(),
      channel,
      feedUrl,
      log: (level, message) => console[level === 'error' ? 'error' : 'info'](`[update] ${message}`),
    });
    service.onDidChangeStatus(broadcast);
    return service;
  };

  ipcMain.handle(IpcChannels.UpdateCheck, (_event, options: { channel: UpdateChannel; feedUrl: string }) =>
    ensure(options.channel, options.feedUrl).check(),
  );
  ipcMain.handle(IpcChannels.UpdateDownload, () => service?.download() ?? null);
  ipcMain.handle(IpcChannels.UpdateInstall, () => {
    service?.install();
  });
  ipcMain.handle(IpcChannels.UpdateStatusGet, () => service?.current() ?? null);
}
