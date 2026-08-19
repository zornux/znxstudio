import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ConfigQueryRequest } from '../../shared/types';
import { ConfigService } from '../services/ConfigService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/** Configuration/profile bridge — `zornux config show|validate --profile` (Phase 5F). */
export function registerConfigIpc(): void {
  const config = new ConfigService();
  const trust = sharedWorkspaceTrust();

  ipcMain.handle(IpcChannels.ConfigQuery, (_event, request: ConfigQueryRequest) => {
    trust.assertTrusted('Config Query');
    const validSubs = ['show', 'validate'] as const;
    if (!validSubs.includes(request.subcommand as typeof validSubs[number])) {
      throw new Error(`Invalid subcommand: '${request.subcommand}'.`);
    }
    if (request.cwd) {
      const safe = confineToRoots(request.cwd, trust.getRoots());
      if (!safe) throw new Error('Config cwd is outside workspace boundaries.');
      request = { ...request, cwd: safe };
    }
    if (request.file) {
      const safe = confineToRoots(request.file, trust.getRoots());
      if (!safe) throw new Error('Config file path is outside workspace boundaries.');
      request = { ...request, file: safe };
    }
    delete (request as unknown as Record<string, unknown>).compilerPath;
    return config.query(request);
  });
}
