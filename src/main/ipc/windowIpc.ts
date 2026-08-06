import { BrowserWindow, ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { WindowState } from '../../shared/types';

/**
 * Window management (Phase 17C). The renderer cannot touch `BrowserWindow`, so
 * fullscreen, maximize and the window's own geometry come through here.
 *
 * Only the window that SENT the request is affected — never every window — so a
 * second window can never be resized by the first.
 */
export function registerWindowIpc(): void {
  const senderWindow = (event: Electron.IpcMainInvokeEvent): BrowserWindow | null =>
    BrowserWindow.fromWebContents(event.sender);

  const stateOf = (window: BrowserWindow | null): WindowState => {
    if (!window) return { fullScreen: false, maximized: false, focused: false };
    return {
      fullScreen: window.isFullScreen(),
      maximized: window.isMaximized(),
      focused: window.isFocused(),
    };
  };

  ipcMain.handle(IpcChannels.WindowGetState, (event) => stateOf(senderWindow(event)));

  ipcMain.handle(IpcChannels.WindowSetFullScreen, (event, fullScreen: boolean) => {
    const window = senderWindow(event);
    // Leaving fullscreen while maximized must not also un-maximize; setting the
    // flag is enough, and Electron restores the prior bounds itself.
    window?.setFullScreen(fullScreen);
    return stateOf(window);
  });

  ipcMain.handle(IpcChannels.WindowToggleMaximize, (event) => {
    const window = senderWindow(event);
    if (!window) return stateOf(null);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return stateOf(window);
  });

  ipcMain.handle(IpcChannels.WindowMinimize, (event) => {
    senderWindow(event)?.minimize();
  });

  // UI zoom (Phase 20J WI4). The renderer computes the factor from a zoom level;
  // scaling the whole page (chrome + editor) is a webContents capability the
  // renderer can't reach directly under contextIsolation.
  ipcMain.handle(IpcChannels.WindowSetZoom, (event, factor: number) => {
    const safe = Number.isFinite(factor) && factor > 0 ? factor : 1;
    event.sender.setZoomFactor(safe);
  });
}
