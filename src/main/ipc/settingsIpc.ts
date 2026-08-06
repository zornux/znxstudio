import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import { SettingsStore } from '../services/SettingsStore';

/** Read/write access to the persisted settings file. */
export function registerSettingsIpc(): void {
  const store = new SettingsStore();

  ipcMain.handle(IpcChannels.SettingsRead, () => store.read());
  ipcMain.handle(IpcChannels.SettingsWrite, (_event, settings: Record<string, unknown>) =>
    store.write(settings),
  );
  ipcMain.handle(IpcChannels.SettingsPath, () => store.filePath());
}
