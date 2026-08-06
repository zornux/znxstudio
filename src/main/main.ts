import { app, BrowserWindow, Menu, dialog } from 'electron';
import { createMainWindow } from './AppWindow';
import { registerIpcHandlers } from './ipc/registerIpc';
import { setPackaged } from './util/selftest';

// Record whether this is a packaged build so the self-test flag (which opens the
// trust gate) is honored only in dev/CI, never in a shipped binary.
setPackaged(app.isPackaged);

/**
 * Main-process entry point. Responsible only for app lifecycle and wiring
 * the IPC surface — no IDE/domain logic lives here.
 */

let mainWindow: BrowserWindow | null = null;

function bootstrap(): void {
  // The app ships its own themed menu bar in the custom title bar, so drop
  // Electron's default OS menu — it duplicated the View menu and left an empty
  // File menu on Windows/Linux.
  Menu.setApplicationMenu(null);
  registerIpcHandlers();
  mainWindow = createMainWindow();
}

// A failure during startup must not leave a window-less, unrecoverable process.
// Surface the error and exit cleanly instead of hanging with no UI.
app.whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    try {
      dialog.showErrorBox('ZnxStudio failed to start', String((error as Error)?.stack ?? error));
    } catch {
      /* dialog unavailable this early — fall through to exit */
    }
    app.exit(1);
  });

app.on('activate', () => {
  // macOS: re-create a window when the dock icon is clicked and none are open.
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createMainWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
