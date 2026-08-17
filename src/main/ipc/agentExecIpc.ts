import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { AgentExecRequest } from '../../shared/ai/agentExec';
import { AgentExecService } from '../services/AgentExecService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

export function registerAgentExecIpc(): void {
  const service = new AgentExecService();

  ipcMain.handle(IpcChannels.AgentExec, async (_event, request: AgentExecRequest) => {
    sharedWorkspaceTrust().assertTrusted('AI agent command execution');
    const roots = sharedWorkspaceTrust().getRoots();
    return service.run(request, roots);
  });

  ipcMain.on(IpcChannels.AgentExecCancel, (_event, payload: { execId: string }) => {
    service.cancel(payload.execId);
  });
}
