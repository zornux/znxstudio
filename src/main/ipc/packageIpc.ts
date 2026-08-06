import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type { PackageCommandRequest, PackageQueryRequest } from '../../shared/types';
import { PackageService } from '../services/PackageService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';

/** Package manager bridge — `zornux add/remove/restore` (5D) + search/info/registry (5E). */
export function registerPackageIpc(): void {
  const packages = new PackageService();
  ipcMain.handle(IpcChannels.PackageRun, (_event, request: PackageCommandRequest) => {
    // Trust gate: package operations resolve/run manifests, so they need trust.
    // Read-only queries (search/info) stay available in Restricted Mode.
    sharedWorkspaceTrust().assertTrusted('package operations');
    return packages.run(request);
  });
  ipcMain.handle(IpcChannels.PackageQuery, (_event, request: PackageQueryRequest) => packages.query(request));
}
