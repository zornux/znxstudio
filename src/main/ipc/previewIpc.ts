import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { PreviewProxy } from '../../shared/types';
import { PreviewServer } from '../services/PreviewServer';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/** Live Preview static-server bridge (Phase 6G) + full-stack proxy (6H). */
export function registerPreviewIpc(): void {
  const preview = new PreviewServer();
  const trust = sharedWorkspaceTrust();

  ipcMain.handle(IpcChannels.PreviewStart, (_event, root: string, proxy?: PreviewProxy) => {
    trust.assertTrusted('Live Preview');
    const safe = confineToRoots(root, trust.getRoots());
    if (!safe) throw new Error('Path is outside workspace boundaries.');
    return preview.start(safe, proxy);
  });
  ipcMain.handle(IpcChannels.PreviewStop, () => preview.stop());
  app.on('will-quit', () => void preview.stop());
}
