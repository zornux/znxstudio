import { ipcMain } from 'electron';
import { IpcChannels } from '../../shared/ipc';
import type {
  SearchApplyRequest,
  SearchReplaceRequest,
  SearchSymbolRequest,
  SearchTextRequest,
} from '../../shared/types';
import { SearchService } from '../services/SearchService';

/** Workspace search — Find in Files + Find Symbols (7A) + Replace (7B). */
export function registerSearchIpc(): void {
  const search = new SearchService();
  ipcMain.handle(IpcChannels.SearchText, (_event, request: SearchTextRequest) => search.searchText(request));
  ipcMain.handle(IpcChannels.SearchSymbols, (_event, request: SearchSymbolRequest) => search.searchSymbols(request));
  ipcMain.handle(IpcChannels.SearchPreviewReplace, (_event, request: SearchReplaceRequest) => search.previewReplace(request));
  ipcMain.handle(IpcChannels.SearchApplyReplace, (_event, request: SearchApplyRequest) => search.applyReplace(request));
  ipcMain.handle(IpcChannels.SearchFiles, (_event, root: string) => search.listFiles(root));
}
