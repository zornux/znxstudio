import { ServiceKeys, type EditorService, type SettingsService, type StatusService, type WorkspaceService } from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import type { WorkspaceInfo, WorkspaceType } from '../../shared/types';
import { addRecentWorkspace } from '../editor/unsavedGuard';
import { WorkspaceFolderSet } from './workspaceFolders';

const TYPE_LABELS: Record<WorkspaceType, string> = {
  'zornux-api': 'Zornux API',
  'zoijs-frontend': 'Zoijs Frontend',
  'zornux-zoijs-fullstack': 'Zornux + Zoijs',
  generic: 'Generic',
};

/**
 * Owns workspace state and detection. Headless by design — the explorer,
 * status bar and diagnostics all consume this via WorkspaceService, so state
 * and view stay decoupled. All filesystem work happens in the main process.
 *
 * Phase 5A: multi-root. The workspace holds a set of folders; the FIRST is the
 * primary, and the single-root accessors + `onDidChangeWorkspace` track it so
 * existing consumers are unaffected. Multi-root consumers use `folders()` /
 * `onDidChangeFolders`. `onDidChangeWorkspace` fires only when the PRIMARY
 * changes, so adding a secondary folder never restarts the language server, etc.
 */
export class WorkspaceModule implements IModule, WorkspaceService {
  readonly id = 'znxstudio.workspace';
  readonly displayName = 'Workspace';

  private context!: ModuleContext;
  private readonly folderSet = new WorkspaceFolderSet();

  private readonly changeEmitter = new Emitter<WorkspaceInfo | null>();
  private readonly foldersEmitter = new Emitter<WorkspaceInfo[]>();
  readonly onDidChangeWorkspace = this.changeEmitter.event;
  readonly onDidChangeFolders = this.foldersEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    context.services.register(ServiceKeys.Workspace, this);
    context.commands.register(
      CommandIds.WorkspaceOpenFolder,
      (path?: string) => this.openFolder(path),
      'Workspace: Open Folder…',
    );
    context.commands.register(
      CommandIds.WorkspaceAddFolder,
      (path?: string) => this.addFolder(path),
      'Workspace: Add Folder…',
    );
    context.commands.register(
      CommandIds.WorkspaceRemoveFolder,
      (root?: string) => {
        if (root) this.removeFolder(root);
      },
      'Workspace: Remove Folder',
    );
    context.commands.register(CommandIds.WorkspaceRefresh, () => this.refresh(), 'Workspace: Refresh Explorer');
    this.publishStatus();
    void selfTestCoordinator.run('workspace', () => this.maybeSelfTest());
  }

  /* ----- single-root accessors (primary folder) ----- */
  currentFolder(): string | null {
    return this.folderSet.primary()?.root ?? null;
  }
  currentWorkspace(): WorkspaceInfo | null {
    return this.folderSet.primary();
  }

  /* ----- multi-root ----- */
  folders(): WorkspaceInfo[] {
    return this.folderSet.list();
  }
  folderContaining(path: string): WorkspaceInfo | null {
    return this.folderSet.containing(path);
  }

  async openFolder(path?: string): Promise<void> {
    const target = path ?? (await window.znxstudio.dialog.openFolder());
    if (!target) return;
    const previous = this.currentFolder();
    this.folderSet.set([await window.znxstudio.workspace.load(target)]);
    this.recordRecent(target);
    this.emit(previous);
    // A project is now open — dismiss the welcome/start overlay so the IDE reflects it.
    this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.hideView();
  }

  /** Track recently opened workspaces for the Welcome screen / session restore (Phase 20J WI2). */
  private recordRecent(root: string): void {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    if (!settings) return;
    settings.set('workbench.recentWorkspaces', addRecentWorkspace(settings.get('workbench.recentWorkspaces', []), root));
  }

  /** The recently opened workspace roots, most-recent first. */
  recentWorkspaces(): string[] {
    const settings = this.context.services.tryGet<SettingsService>(ServiceKeys.Settings);
    return settings ? settings.get<string[]>('workbench.recentWorkspaces', []) : [];
  }

  async addFolder(path?: string): Promise<void> {
    const target = path ?? (await window.znxstudio.dialog.openFolder());
    if (!target) return;
    const previous = this.currentFolder();
    this.folderSet.add(await window.znxstudio.workspace.load(target));
    this.emit(previous);
  }

  removeFolder(root: string): void {
    const previous = this.currentFolder();
    if (this.folderSet.remove(root)) this.emit(previous);
  }

  async refresh(): Promise<void> {
    const roots = this.folderSet.list().map((folder) => folder.root);
    if (roots.length === 0) return;
    const reloaded = await Promise.all(roots.map((root) => window.znxstudio.workspace.load(root)));
    this.folderSet.set(reloaded);
    // A refresh reloads content even when the primary root is unchanged, so force
    // the single-root change event.
    this.emit(this.currentFolder(), true);
  }

  /**
   * Announce a workspace mutation. Always fires `onDidChangeFolders`; fires
   * `onDidChangeWorkspace` only when the primary root actually changed (or when
   * forced, e.g. a refresh) so single-root consumers don't churn on secondary
   * folder edits.
   */
  private emit(previousPrimaryRoot: string | null, force = false): void {
    this.foldersEmitter.fire(this.folderSet.list());
    const primary = this.folderSet.primary();
    if (force || (primary?.root ?? null) !== previousPrimaryRoot) this.changeEmitter.fire(primary);
    this.publishStatus();
  }

  private publishStatus(): void {
    const status = this.context.services.tryGet<StatusService>(ServiceKeys.Status);
    if (!status) return;

    const folders = this.folderSet.list();
    if (folders.length === 0) {
      status.setItem('workspace.project', { text: 'No folder', side: 'left', priority: 10 });
      status.removeItem('workspace.type');
      return;
    }

    const primary = folders[0];
    const name = primary.project?.name ?? baseName(primary.root);
    const extra = folders.length > 1 ? ` +${folders.length - 1}` : '';
    status.setItem('workspace.project', {
      text: `📦 ${name}${extra}`,
      tooltip:
        folders.length > 1
          ? `${folders.length} folders:\n${folders.map((folder) => folder.root).join('\n')}`
          : primary.root,
      side: 'left',
      priority: 10,
    });
    status.setItem('workspace.type', {
      text: TYPE_LABELS[primary.detectedType],
      tooltip: 'Detected project type (primary folder)',
      side: 'left',
      priority: 11,
    });
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    try {
      enabled = (await window.znxstudio.app.getInfo()).selftest === true;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    try {
      // Non-invasive: load two real folders and exercise the multi-root set
      // WITHOUT mutating the live workspace (no events, no LSP churn).
      const dirA = 'C:\\Studio Apps\\xojin\\examples\\oop';
      const dirB = 'C:\\Studio Apps\\xojin\\examples\\web';
      const [infoA, infoB] = await Promise.all([
        window.znxstudio.workspace.load(dirA),
        window.znxstudio.workspace.load(dirB),
      ]);
      const set = new WorkspaceFolderSet();
      set.set([infoA]);
      const added = set.add(infoB);
      const dup = set.add(infoA); // already present → refresh, not add
      const owner = set.containing(`${dirA}\\shapes.zx`);
      log(
        `workspace multi-root: folders=${set.list().length} added=${added} dupRejected=${!dup} primary=${baseName(set.primary()?.root ?? '')} containing(oop file)=${owner ? baseName(owner.root) : 'none'}`,
      );
      set.remove(dirB);
      log(`workspace remove: folders=${set.list().length} primary=${baseName(set.primary()?.root ?? '')}`);
      log(`workspace live service: folders=${this.folders().length} api=[folders, addFolder, removeFolder, folderContaining, onDidChangeFolders]`);
    } catch (error) {
      log(`workspace self-test failed: ${(error as Error).message}`);
    }
  }
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
