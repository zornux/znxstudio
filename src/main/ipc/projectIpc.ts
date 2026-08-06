import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { CreateProjectOptions, ScaffoldRequest } from '../../shared/types';
import { ProjectService } from '../services/ProjectService';

/** Project scaffolding + workspace loading/validation. */
export function registerProjectIpc(): void {
  const projects = new ProjectService();

  ipcMain.handle(IpcChannels.ProjectCreate, (_event, options: CreateProjectOptions) =>
    projects.createProject(options),
  );
  ipcMain.handle(IpcChannels.ProjectScaffold, (_event, request: ScaffoldRequest) =>
    projects.scaffoldProject(request),
  );
  ipcMain.handle(IpcChannels.WorkspaceLoad, (_event, folder: string) =>
    projects.loadWorkspace(folder),
  );
}
