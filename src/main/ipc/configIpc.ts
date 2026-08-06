import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ConfigQueryRequest } from '../../shared/types';
import { ConfigService } from '../services/ConfigService';

/** Configuration/profile bridge — `zornux config show|validate --profile` (Phase 5F). */
export function registerConfigIpc(): void {
  const config = new ConfigService();
  ipcMain.handle(IpcChannels.ConfigQuery, (_event, request: ConfigQueryRequest) => config.query(request));
}
