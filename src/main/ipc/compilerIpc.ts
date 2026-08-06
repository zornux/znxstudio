import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  CompilerBuildRequest,
  CompilerCheckProjectRequest,
  CompilerCheckRequest,
  GraphBuildRequest,
} from '../../shared/types';
import { CompilerService } from '../services/CompilerService';
import { DependencyGraphService } from '../services/DependencyGraphService';

/** Zornux compiler availability + checking + builds + the dependency graph. */
export function registerCompilerIpc(): void {
  const compiler = new CompilerService();
  const graph = new DependencyGraphService();

  ipcMain.handle(IpcChannels.CompilerInfo, () => compiler.info());
  ipcMain.handle(IpcChannels.ToolchainInfo, (_event, override?: string | null) =>
    compiler.capabilities(override),
  );
  ipcMain.handle(IpcChannels.CompilerCheck, (_event, request: CompilerCheckRequest) =>
    compiler.check(request),
  );
  ipcMain.handle(IpcChannels.CompilerBuild, (_event, request: CompilerBuildRequest) =>
    compiler.build(request),
  );
  ipcMain.handle(IpcChannels.CompilerCheckProject, (_event, request: CompilerCheckProjectRequest) =>
    compiler.checkProject(request),
  );
  ipcMain.handle(IpcChannels.CompilerCacheStats, () => compiler.cacheStats());
  ipcMain.handle(IpcChannels.CompilerCacheClear, () => compiler.clearCache());
  ipcMain.handle(IpcChannels.CompilerCacheConfig, (_event, enabled: boolean) =>
    compiler.setCacheEnabled(enabled),
  );
  ipcMain.handle(IpcChannels.CompilerProfile, () => compiler.profile());
  ipcMain.handle(IpcChannels.CompilerProfileReset, () => compiler.resetProfile());
  ipcMain.handle(IpcChannels.CompilerFormat, (_event, request: { source: string; cwd?: string }) =>
    compiler.format(request.source, request.cwd),
  );
  ipcMain.handle(IpcChannels.GraphBuild, (_event, request: GraphBuildRequest) => graph.build(request));
}
