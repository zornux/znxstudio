import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { isSafeExternalUrl } from '../../shared/security';
import { FileSystemService } from '../services/FileSystemService';
import { createMainWindow } from '../AppWindow';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';
import { isSelfTest } from '../util/selftest';

/**
 * Reads ZORNUX_SELFTEST_CONCURRENCY into a positive integer (default 1). Any
 * unset/blank/invalid/<1 value falls back to 1 so self-tests stay serial.
 */
function selfTestConcurrency(): number {
  const raw = process.env.ZORNUX_SELFTEST_CONCURRENCY;
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
}

/** App info, folder dialogs and filesystem access. */
export function registerCoreIpc(): void {
  const files = new FileSystemService();

  // Confine every renderer-supplied fs path to the open workspace roots so a
  // renderer-side compromise can't read/write arbitrary files (SSH keys, rc
  // files, autostart). No workspace open ⇒ nothing untrusted is loaded ⇒ allowed.
  const confined = (path: string): string => {
    const safe = confineToRoots(path, sharedWorkspaceTrust().getRoots());
    if (safe === null) throw new Error(`Access denied: '${path}' is outside the open workspace.`);
    return safe;
  };

  async function pick(properties: Electron.OpenDialogOptions['properties']): Promise<string | null> {
    const window = BrowserWindow.getFocusedWindow();
    const options: Electron.OpenDialogOptions = { properties };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  }

  ipcMain.handle(IpcChannels.AppGetInfo, () => ({
    name: 'ZnxStudio',
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    selftest: isSelfTest(),
    selftestConcurrency: selfTestConcurrency(),
    tempDir: app.getPath('temp'),
    homeDir: app.getPath('home'),
  }));

  ipcMain.handle(IpcChannels.ShellOpenExternal, async (_event, url: string) => {
    if (isSafeExternalUrl(url)) await shell.openExternal(url);
  });

  ipcMain.handle(IpcChannels.DialogOpenFolder, () => pick(['openDirectory']));
  ipcMain.handle(IpcChannels.DialogOpenFile, () => pick(['openFile']));

  // New Window / Exit for the File menu. New Window opens a second main window;
  // Close routes through the same guarded close as the window's X (unsaved prompt).
  ipcMain.handle(IpcChannels.AppNewWindow, () => {
    createMainWindow();
  });
  ipcMain.handle(IpcChannels.WindowClose, () => {
    BrowserWindow.getFocusedWindow()?.close();
  });

  // Existence check for the recent-projects list. Recents are the user's own
  // previously-opened folders, which live outside the workspace roots, so this is
  // deliberately NOT confined. It discloses only a boolean (does this path exist),
  // never any content, so a stale/moved project can be pruned from the menu.
  ipcMain.handle(IpcChannels.FsDirectoryExists, (_event, path: string) =>
    typeof path === 'string' && path.length > 0 ? files.directoryExists(path) : Promise.resolve(false),
  );
  ipcMain.handle(IpcChannels.FsReadDirectory, (_event, path: string) =>
    files.readDirectory(confined(path)),
  );
  ipcMain.handle(IpcChannels.FsReadFile, (_event, path: string) => files.readFile(confined(path)));
  ipcMain.handle(IpcChannels.FsWriteFile, (_event, path: string, content: string) =>
    files.writeFile(confined(path), content),
  );
  // Existence check for any path (file or directory) — used to reject duplicate
  // names before creating. Confined to the workspace like the other write paths.
  ipcMain.handle(IpcChannels.FsPathExists, (_event, path: string) =>
    typeof path === 'string' && path.length > 0 ? files.pathExists(confined(path)) : Promise.resolve(false),
  );
  ipcMain.handle(IpcChannels.FsCreateDirectory, (_event, path: string) =>
    files.createDirectory(confined(path)),
  );
  ipcMain.handle(IpcChannels.FsRename, (_event, from: string, to: string) =>
    files.rename(confined(from), confined(to)),
  );
  ipcMain.handle(IpcChannels.FsDelete, (_event, path: string) => files.delete(confined(path)));

  // Reveal a workspace file/folder in the OS file manager (Explorer/Finder). The
  // path is confined so only workspace items can be revealed.
  ipcMain.handle(IpcChannels.ShellShowItemInFolder, (_event, path: string) => {
    shell.showItemInFolder(confined(path));
  });
}
