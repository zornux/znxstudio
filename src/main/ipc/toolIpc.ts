import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { ToolExecRequest } from '../../shared/types';
import { ToolService } from '../services/ToolService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/** Deployment tooling — runs allowlisted CLIs (docker/kubectl/cloud) (Phase 13). */
export function registerToolIpc(): void {
  const tool = new ToolService();
  ipcMain.handle(IpcChannels.ToolExec, (_event, request: ToolExecRequest) => {
    // Trust gate: external command execution is disabled in Restricted Mode.
    sharedWorkspaceTrust().assertTrusted('external tools');
    return tool.exec(request);
  });
}
