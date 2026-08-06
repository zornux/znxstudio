import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { PreviewProxy } from '../../shared/types';
import { PreviewServer } from '../services/PreviewServer';

/** Live Preview static-server bridge (Phase 6G) + full-stack proxy (6H). */
export function registerPreviewIpc(): void {
  const preview = new PreviewServer();
  ipcMain.handle(IpcChannels.PreviewStart, (_event, root: string, proxy?: PreviewProxy) => preview.start(root, proxy));
  ipcMain.handle(IpcChannels.PreviewStop, () => preview.stop());
  app.on('will-quit', () => void preview.stop());
}
