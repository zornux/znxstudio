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

  ipcMain.on(IpcChannels.TerminalInput, (_event, { id, data }: InputPayload) =>
    terminals.write(id, data),
  );
  ipcMain.on(IpcChannels.TerminalResize, (_event, { id, cols, rows }: ResizePayload) =>
    terminals.resize(id, cols, rows),
  );
  ipcMain.on(IpcChannels.TerminalDispose, (_event, { id }: { id: string }) =>
    terminals.dispose(id),
  );
  // Kill every PTY on quit so no shell process is left orphaned.
  app.on('will-quit', () => terminals.disposeAll());
}
