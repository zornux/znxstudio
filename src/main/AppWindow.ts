import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { HARDENED_WEB_PREFERENCES, isAllowedNavigation, windowOpenDecision } from '../shared/security';
import { IpcChannels } from '../shared/ipc';
import { isSelfTest } from './util/selftest';

/**
 * Creates the primary IDE window with a hardened, secure webPreferences profile
 * (no node integration in the renderer; all privileged access flows through the
 * preload context bridge) and locks down navigation + new-window creation
 * (Phase 20C): the renderer can only stay on its own file:// page, and any
 * `window.open` is denied — a safe http(s) URL is handed to the OS browser.
 */
export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#1a1b1e',
    title: 'ZnxStudio',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      ...HARDENED_WEB_PREFERENCES,
    },
  });

  hardenNavigation(window);
  guardUnsavedOnClose(window);

  window.once('ready-to-show', () => window.show());
  window.loadFile(join(__dirname, '../renderer/index.html')).catch((err) => {
    dialog.showErrorBox('ZnxStudio', `Failed to load UI: ${err instanceof Error ? err.message : String(err)}`);
  });

  return window;
}

/**
 * Unsaved-changes guard (Phase 20J WI2). A window close (the × button OR an app
 * quit, which closes each window) is intercepted and handed to the renderer,
 * which prompts to Save / Don't Save / Cancel. The window closes only after the
 * renderer confirms — so work is never lost to a close or quit. Under the
 * self-test harness the guard stays out of the way (nothing to prompt, and the
 * headless run must be able to exit).
 */
function guardUnsavedOnClose(window: BrowserWindow): void {
  if (isSelfTest()) return;
  let allowClose = false;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  /** Last-resort cap: only fires when the renderer neither confirms NOR cancels
   * (i.e. no close handler at all). An explicit Cancel clears it, so a real
   * cancel never loses work; a genuinely hung renderer is caught by 'unresponsive'. */
  const CONFIRM_TIMEOUT_MS = 30_000;

  const clearPending = (): void => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };
  const forceClose = (): void => {
    allowClose = true;
    clearPending();
    if (!window.isDestroyed()) window.destroy();
  };

  const onConfirm = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    allowClose = true;
    clearPending();
    window.close();
  };
  const onCancel = (event: Electron.IpcMainEvent): void => {
    if (event.sender !== window.webContents) return;
    // The user chose Cancel — abort the pending force-close and keep the window
    // (and its unsaved buffers) open. Without this, the fallback timer could not
    // tell "cancelled" from "no response" and would destroy the window → data loss.
    clearPending();
  };
  ipcMain.on(IpcChannels.WindowConfirmClose, onConfirm);
  ipcMain.on(IpcChannels.WindowCancelClose, onCancel);
  window.on('closed', () => {
    ipcMain.removeListener(IpcChannels.WindowConfirmClose, onConfirm);
    ipcMain.removeListener(IpcChannels.WindowCancelClose, onCancel);
    clearPending();
  });
  // A hung renderer during a pending close can't answer — let the close proceed.
  // Only force-close if a close is actually pending, to avoid data loss during
  // legitimate heavy operations (large file parse, extension loading, etc.).
  window.on('unresponsive', () => { if (pendingTimer) forceClose(); });

  window.on('close', (event) => {
    if (allowClose) return;
    // If the renderer is already gone, there's nothing to ask — allow the close.
    if (window.webContents.isDestroyed() || window.webContents.isCrashed()) return;
    event.preventDefault();
    clearPending(); // never stack timers across repeated close attempts
    window.webContents.send(IpcChannels.WindowQueryClose);
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      if (!allowClose) forceClose();
    }, CONFIRM_TIMEOUT_MS);
  });
}

/** Deny in-app new windows and block navigation away from the app's own page. */
function hardenNavigation(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    const decision = windowOpenDecision(url);
    if (decision.externalUrl) void shell.openExternal(decision.externalUrl);
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) event.preventDefault();
  });
}
