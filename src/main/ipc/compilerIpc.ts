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
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/** Zornux compiler availability + checking + builds + the dependency graph. */
export function registerCompilerIpc(): void {
  const compiler = new CompilerService();
  const graph = new DependencyGraphService();
  const trust = sharedWorkspaceTrust();

  function confinePath(raw: string): string {
    const safe = confineToRoots(raw, trust.getRoots());
    if (!safe) throw new Error('Path is outside workspace boundaries.');
    return safe;
  }

  ipcMain.handle(IpcChannels.CompilerInfo, (_event, override?: string | null) => compiler.info(override));
  ipcMain.handle(IpcChannels.ToolchainInfo, (_event, override?: string | null) =>
    compiler.capabilities(override),
  );
  ipcMain.handle(IpcChannels.CompilerCheck, (_event, request: CompilerCheckRequest) => {
    trust.assertTrusted('Compiler Check');
    if (request.path) request = { ...request, path: confinePath(request.path) };
    if (request.workspaceRoot) request = { ...request, workspaceRoot: confinePath(request.workspaceRoot) };
    return compiler.check(request);
  });
  ipcMain.handle(IpcChannels.CompilerBuild, (_event, request: CompilerBuildRequest) => {
    trust.assertTrusted('Compiler Build');
    request = { ...request, path: confinePath(request.path) };
    if (request.workspaceRoot) request = { ...request, workspaceRoot: confinePath(request.workspaceRoot) };
    return compiler.build(request);
  });
  ipcMain.handle(IpcChannels.CompilerCheckProject, (_event, request: CompilerCheckProjectRequest) => {
    trust.assertTrusted('Compiler Check Project');
    request = { ...request, sourceDir: confinePath(request.sourceDir) };
    if (request.workspaceRoot) request = { ...request, workspaceRoot: confinePath(request.workspaceRoot) };
    return compiler.checkProject(request);
  });
  ipcMain.handle(IpcChannels.CompilerCacheStats, () => compiler.cacheStats());
  ipcMain.handle(IpcChannels.CompilerCacheClear, () => compiler.clearCache());
  ipcMain.handle(IpcChannels.CompilerCacheConfig, (_event, enabled: boolean) =>
    compiler.setCacheEnabled(enabled),
  );
  ipcMain.handle(IpcChannels.CompilerProfile, () => compiler.profile());
  ipcMain.handle(IpcChannels.CompilerProfileReset, () => compiler.resetProfile());
  ipcMain.handle(IpcChannels.CompilerFormat, (_event, request: { source: string; cwd?: string }) => {
    trust.assertTrusted('Compiler Format');
    if (request.cwd) request = { ...request, cwd: confinePath(request.cwd) };
    return compiler.format(request.source, request.cwd);
  });
  ipcMain.handle(IpcChannels.GraphBuild, (_event, request: GraphBuildRequest) => {
    trust.assertTrusted('Dependency Graph');
    request = { ...request, root: confinePath(request.root), sourceDir: confinePath(request.sourceDir) };
    return graph.build(request);
  });
}
