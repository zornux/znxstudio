import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  SearchApplyRequest,
  SearchReplaceRequest,
  SearchSymbolRequest,
  SearchTextRequest,
} from '../../shared/types';
import { SearchService } from '../services/SearchService';
import { sharedWorkspaceTrust } from '../services/WorkspaceTrustService';
import { confineToRoots } from '../util/pathBoundary';

/** Workspace search — Find in Files + Find Symbols (7A) + Replace (7B). */
export function registerSearchIpc(): void {
  const search = new SearchService();
  const trust = sharedWorkspaceTrust();

  function confinePath(raw: string): string {
    const safe = confineToRoots(raw, trust.getRoots());
    if (!safe) throw new Error('Path is outside workspace boundaries.');
    return safe;
  }

  ipcMain.handle(IpcChannels.SearchText, (_event, request: SearchTextRequest) =>
    search.searchText({ ...request, root: confinePath(request.root) }),
  );
  ipcMain.handle(IpcChannels.SearchSymbols, (_event, request: SearchSymbolRequest) =>
    search.searchSymbols({ ...request, root: confinePath(request.root) }),
  );
  ipcMain.handle(IpcChannels.SearchPreviewReplace, (_event, request: SearchReplaceRequest) =>
    search.previewReplace({ ...request, root: confinePath(request.root) }),
  );
  ipcMain.handle(IpcChannels.SearchApplyReplace, (_event, request: SearchApplyRequest) => {
    trust.assertTrusted('Search Replace');
    return search.applyReplace({ ...request, root: confinePath(request.root) });
  });
  ipcMain.handle(IpcChannels.SearchFiles, (_event, root: string) => search.listFiles(confinePath(root)));
}
