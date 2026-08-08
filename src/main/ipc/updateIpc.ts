import { app, BrowserWindow, ipcMain } from 'electron';
import * as fs from 'node:fs';
import { IpcChannels } from '../../shared/ipc';
import { UpdateService, type UpdateStatus } from '../services/UpdateService';
import { isUpdateChannel, type UpdateChannel } from '../../shared/update';
import { FsRollbackController, noopRollbackController, type RollbackController } from '../services/rollback';

/**
 * Build the rollback controller for this install. Only an AppImage exposes a
 * single-file artifact we can snapshot and swap in place (its path is in
 * $APPIMAGE); every other install form gets the no-op controller, so rollback is
 * simply never offered rather than offered and unable to work.
 */
function buildRollbackController(): RollbackController {
  const artifactPath = process.env.APPIMAGE ?? null;
  if (!artifactPath) return noopRollbackController;
  return new FsRollbackController({
    stateDir: app.getPath('userData'),
    artifactPath,
    platform: process.platform,
    io: {
      existsSync: (p) => fs.existsSync(p),
      readFileSync: (p) => fs.readFileSync(p, 'utf8'),
      writeFileSync: (p, d) => fs.writeFileSync(p, d),
      copyFileSync: (s, d) => fs.copyFileSync(s, d),
      renameSync: (s, d) => fs.renameSync(s, d),
      mkdirSync: (p) => fs.mkdirSync(p, { recursive: true }),
      rmSync: (p) => fs.rmSync(p, { force: true }),
      chmod: (p) => fs.chmodSync(p, 0o755),
    },
    relaunch: (execPath) => {
      // Relaunch the restored AppImage itself (execPath), not the extracted electron
      // binary of the version we're leaving, then exit so the new process takes over.
      app.relaunch({ execPath });
      app.exit(0);
    },
    now: () => new Date().toISOString(),
    log: (level, message) => console[level === 'error' ? 'error' : 'info'](`[update] ${message}`),
  });
}

/**
 * Auto-update IPC (Phase 20J WI3; GitHub-native since 2026-08). The renderer
 * supplies the channel (from settings) on check; the service delegates the check
 * and, when packaged, the download/install to electron-updater (which reads
 * latest.yml from the GitHub Releases feed). Status changes are
 * broadcast to every window so the update UI stays live. All update lifecycle
 * events are logged with an `[update]` prefix (low-volume, operationally useful).
 */
export function registerUpdateIpc(): void {
  let service: UpdateService | null = null;

  const broadcast = (status: UpdateStatus): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IpcChannels.UpdateStatusEvent, status);
    }
  };

  const ensure = (channel: UpdateChannel): UpdateService => {
    if (service) {
      service.setChannel(channel);
      return service;
    }
    service = new UpdateService({
      currentVersion: app.getVersion(),
      channel,
      log: (level, message) => console[level === 'error' ? 'error' : 'info'](`[update] ${message}`),
      rollback: buildRollbackController(),
    });
    service.onDidChangeStatus(broadcast);
    return service;
  };

  ipcMain.handle(IpcChannels.UpdateCheck, (_event, options: { channel: UpdateChannel }) => {
    if (!isUpdateChannel(options?.channel)) throw new Error('Invalid update channel.');
    return ensure(options.channel).check();
  });
  ipcMain.handle(IpcChannels.UpdateDownload, () => service?.download() ?? null);
  ipcMain.handle(IpcChannels.UpdateInstall, () => {
    return service?.install() ?? null;
  });
  ipcMain.handle(IpcChannels.UpdateRollback, () => service?.rollback() ?? null);
  ipcMain.handle(IpcChannels.UpdateStatusGet, () => service?.current() ?? null);
}
