import { app, BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import {
  CollabService,
  type CollabHostOptions,
  type CollabJoinOptions,
  type CollabMessage,
} from '../services/CollabService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/**
 * Collaboration bridge (Phase 16A). The renderer never touches a socket: it asks
 * the main process to host or join, and receives frames as events. Exactly one
 * session may run at a time.
 */
export function registerCollabIpc(): void {
  const broadcastToRenderer = (channel: string, payload: unknown): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };

  const collab = new CollabService({
    onMessage: (message: CollabMessage) => broadcastToRenderer(IpcChannels.CollabMessage, message),
    onPeerJoined: (peerId, name) => broadcastToRenderer(IpcChannels.CollabPeerJoined, { peerId, name }),
    onPeerLeft: (peerId) => broadcastToRenderer(IpcChannels.CollabPeerLeft, { peerId }),
    onClosed: (reason) => broadcastToRenderer(IpcChannels.CollabClosed, { reason }),
  });

  ipcMain.handle(IpcChannels.CollabHost, (_event, options: CollabHostOptions) => {
    sharedWorkspaceTrust().assertTrusted('Collaboration Host');
    return collab.host(options);
  });
  ipcMain.handle(IpcChannels.CollabJoin, (_event, options: CollabJoinOptions) => {
    sharedWorkspaceTrust().assertTrusted('Collaboration Join');
    return collab.join(options);
  });
  ipcMain.handle(IpcChannels.CollabSend, (_event, payload: unknown) => {
    sharedWorkspaceTrust().assertTrusted('Collaboration Send');
    collab.broadcast(payload);
  });
  ipcMain.handle(IpcChannels.CollabSendTo, (_event, peerId: string, payload: unknown) => {
    sharedWorkspaceTrust().assertTrusted('Collaboration Send');
    if (typeof peerId !== 'string') throw new Error('Invalid peer ID.');
    collab.sendTo(peerId, payload);
  });
  ipcMain.handle(IpcChannels.CollabLeave, () => {
    collab.leave();
  });

  app.on('will-quit', () => collab.leave());
}
