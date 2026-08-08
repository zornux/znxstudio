import { app, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { TerminalCreateOptions } from '../../shared/types';
import { TerminalService } from '../services/TerminalService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

interface ResizePayload {
  id: string;
  cols: number;
  rows: number;
}
interface InputPayload {
  id: string;
  data: string;
}

/** Streaming terminal channel backed by node-pty. */
export function registerTerminalIpc(): void {
  const terminals = new TerminalService();

  // Listing installed shells is read-only and safe in any trust state, so the
  // shell picker can populate even before a workspace is trusted.
  ipcMain.handle(IpcChannels.TerminalShells, () => terminals.listShells());

  ipcMain.handle(IpcChannels.TerminalCreate, (event, options: TerminalCreateOptions) => {
    // Trust gate: no interactive shell in a Restricted-Mode workspace.
    sharedWorkspaceTrust().assertTrusted('the integrated terminal');
    if (!terminals.isAvailable()) {
      throw new Error('PTY native module is unavailable on this platform.');
    }
    terminals.create(options, event.sender);
  });

  ipcMain.on(IpcChannels.TerminalInput, (event, payload: InputPayload) => {
    if (typeof payload?.id === 'string' && typeof payload.data === 'string') {
      terminals.write(event.sender, payload.id, payload.data);
    }
  });
  ipcMain.on(IpcChannels.TerminalResize, (event, payload: ResizePayload) => {
    if (typeof payload?.id === 'string' && Number.isInteger(payload.cols) && Number.isInteger(payload.rows) && payload.cols > 0 && payload.rows > 0) {
      terminals.resize(event.sender, payload.id, payload.cols, payload.rows);
    }
  });
  ipcMain.on(IpcChannels.TerminalDispose, (event, payload: { id: string }) => {
    if (typeof payload?.id === 'string') terminals.dispose(event.sender, payload.id);
  });
  // Kill every PTY on quit so no shell process is left orphaned.
  app.on('will-quit', () => terminals.disposeAll());
}
