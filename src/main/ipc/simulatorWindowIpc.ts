import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { IpcChannels } from '../../shared/ipc';
import { HARDENED_WEB_PREFERENCES, isAllowedNavigation } from '../../shared/security';
import type { MobileIRApp } from '../../shared/simulatorTypes';
import { simulatorWindowHtmlPath, simulatorWindowPreloadPath } from '../simulatorWindowPath';

interface SavedBounds { x?: number; y?: number; width: number; height: number; }
let simulatorWindow: BrowserWindow | null = null;
let ownerWindow: BrowserWindow | null = null;
let payload: MobileIRApp | null = null;

function statePath(): string { return join(app.getPath('userData'), 'simulator-window.json'); }
function readBounds(): SavedBounds {
  try { return JSON.parse(readFileSync(statePath(), 'utf8')) as SavedBounds; }
  catch { return { width: 560, height: 900 }; }
}
function visibleBounds(saved: SavedBounds): SavedBounds {
  const displays = screen.getAllDisplays().map((item) => item.workArea);
  const visible = saved.x === undefined || saved.y === undefined || displays.some((area) =>
    saved.x! < area.x + area.width && saved.x! + saved.width > area.x && saved.y! < area.y + area.height && saved.y! + 48 > area.y);
  return visible ? saved : { width: saved.width, height: saved.height };
}
function persistBounds(window: BrowserWindow): void {
  if (window.isDestroyed() || window.isMinimized() || window.isMaximized()) return;
  try { writeFileSync(statePath(), JSON.stringify(window.getBounds())); } catch { /* persistence is best effort */ }
}

export function registerSimulatorWindowIpc(): void {
  ipcMain.handle(IpcChannels.SimulatorWindowOpen, (event, appPayload: MobileIRApp) => {
    payload = appPayload;
    ownerWindow = BrowserWindow.fromWebContents(event.sender);
    if (simulatorWindow && !simulatorWindow.isDestroyed()) {
      simulatorWindow.show(); simulatorWindow.focus();
      void simulatorWindow.reload();
      return;
    }
    const bounds = visibleBounds(readBounds());
    simulatorWindow = new BrowserWindow({
      ...bounds, minWidth: 390, minHeight: 560, title: `${appPayload.name} — Znx Simulator`,
      backgroundColor: '#111318', show: false,
      webPreferences: { preload: simulatorWindowPreloadPath(__dirname), ...HARDENED_WEB_PREFERENCES },
    });
    simulatorWindow.setMenuBarVisibility(false);
    simulatorWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    simulatorWindow.webContents.on('will-navigate', (navigationEvent, url) => {
      if (!isAllowedNavigation(url)) navigationEvent.preventDefault();
    });
    const currentOwner = ownerWindow;
    currentOwner?.once('closed', () => {
      if (ownerWindow === currentOwner) {
        ownerWindow = null;
        simulatorWindow?.close();
      }
    });
    simulatorWindow.once('ready-to-show', () => simulatorWindow?.show());
    simulatorWindow.on('resize', () => { if (simulatorWindow) persistBounds(simulatorWindow); });
    simulatorWindow.on('move', () => { if (simulatorWindow) persistBounds(simulatorWindow); });
    simulatorWindow.on('closed', () => {
      simulatorWindow = null;
      if (ownerWindow && !ownerWindow.isDestroyed()) ownerWindow.webContents.send(IpcChannels.SimulatorWindowClosed);
    });
    void simulatorWindow.loadFile(simulatorWindowHtmlPath(__dirname));
  });
  ipcMain.handle(IpcChannels.SimulatorWindowPayload, () => payload);
  ipcMain.handle(IpcChannels.SimulatorWindowDock, () => {
    ownerWindow?.webContents.send(IpcChannels.SimulatorWindowDock);
    simulatorWindow?.close();
  });
}
