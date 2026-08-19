import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { CreateProjectOptions, ScaffoldRequest } from '../../shared/types';
import { ProjectService } from '../services/ProjectService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { hasPathTraversal } from '../../shared/ai/agentExec';

/** Project scaffolding + workspace loading/validation. */
export function registerProjectIpc(): void {
  const projects = new ProjectService();
  const trust = sharedWorkspaceTrust();

  ipcMain.handle(IpcChannels.ProjectCreate, (_event, options: CreateProjectOptions) => {
    trust.assertTrusted('Project Create');
    if (typeof options?.name !== 'string' || typeof options?.location !== 'string') {
      throw new Error('Invalid project options.');
    }
    return projects.createProject(options);
  });
  ipcMain.handle(IpcChannels.ProjectScaffold, (_event, request: ScaffoldRequest) => {
    trust.assertTrusted('Project Scaffold');
    if (typeof request?.name !== 'string' || typeof request?.location !== 'string') {
      throw new Error('Invalid scaffold request.');
    }
    if (request.files) {
      for (const f of request.files) {
        if (hasPathTraversal(f.path)) throw new Error(`Path traversal rejected: ${f.path}`);
      }
    }
    return projects.scaffoldProject(request);
  });
  ipcMain.handle(IpcChannels.WorkspaceLoad, (_event, folder: string) => {
    if (typeof folder !== 'string') throw new Error('Invalid workspace folder.');
    return projects.loadWorkspace(folder);
  });
}
