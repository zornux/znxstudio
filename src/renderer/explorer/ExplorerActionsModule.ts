import {
  ServiceKeys,
  type EditorService,
  type ExplorerService,
  type InputBoxService,
  type TrustService,
  type WorkspaceService,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import {
  findItemDef,
  isDuplicate,
  NEW_ITEMS,
  newItemCommandId,
  resolveExtension,
  resolveFileName,
  templateContext,
  validateItemName,
  type NewItemDef,
  type ScriptExt,
} from './newItem';
import { baseName, dirName, joinPath } from './paths';

/**
 * The Explorer's create/manage commands (New File/Folder + every Zornux/Zoijs/
 * standard type, Rename, Delete, Copy Path, Reveal in OS, Open in Terminal,
 * Refresh). All logic lives here as commands so it is reachable from BOTH the
 * Explorer context menu and the command palette — never from a DOM handler.
 * File creation is confined to the workspace but is NOT trust-gated (it works in
 * Restricted Mode); only Open-in-Terminal requires trust.
 */
export class ExplorerActionsModule implements IModule {
  readonly id = 'znxstudio.explorer.actions';
  readonly displayName = 'Explorer Actions';

  private context!: ModuleContext;

  activate(context: ModuleContext): void {
    this.context = context;

    const explorerCommands = new Set<string>([
      ...NEW_ITEMS.map((def) => newItemCommandId(def.id)),
      CommandIds.ExplorerRename,
      CommandIds.ExplorerDelete,
      CommandIds.ExplorerCopyPath,
      CommandIds.ExplorerRevealInOs,
      CommandIds.ExplorerOpenInTerminal,
      CommandIds.ExplorerRefresh,
    ]);
    context.subscriptions.push(
      context.commands.addEnablementRule((id) => {
        if (!explorerCommands.has(id)) return undefined;
        if (!this.hasWorkspaceTarget()) return false;
        if (id === CommandIds.ExplorerOpenInTerminal) {
          return context.services.tryGet<TrustService>(ServiceKeys.Trust)?.isTrusted() ?? true;
        }
        return true;
      }),
    );

    const workspace = context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    if (workspace) {
      context.subscriptions.push(
        workspace.onDidChangeFolders(() => context.commands.notifyEnablementChanged()),
      );
    }

    // One "New <Type>" command per catalog entry — all appear in the palette
    // (operating on the current Explorer folder) and in the context menu.
    for (const def of NEW_ITEMS) {
      context.commands.register(
        newItemCommandId(def.id),
        (dir?: string) => void this.createItem(def, dir),
        `New: ${def.label}`,
      );
    }

    context.commands.register(CommandIds.ExplorerRename, (path?: string) => void this.rename(path), 'Explorer: Rename');
    context.commands.register(CommandIds.ExplorerDelete, (path?: string) => void this.remove(path), 'Explorer: Delete');
    context.commands.register(CommandIds.ExplorerCopyPath, (path?: string) => void this.copyPath(path), 'Explorer: Copy Path');
    context.commands.register(CommandIds.ExplorerRevealInOs, (path?: string) => void this.revealInOs(path), 'Explorer: Reveal in File Explorer');
    context.commands.register(CommandIds.ExplorerOpenInTerminal, (path?: string) => void this.openInTerminal(path), 'Explorer: Open in Integrated Terminal');
    context.commands.register(CommandIds.ExplorerRefresh, (path?: string) => void this.refresh(path), 'Explorer: Refresh');
  }

  /* ----- services ----- */
  private explorer(): ExplorerService | undefined {
    return this.context.services.tryGet<ExplorerService>(ServiceKeys.Explorer);
  }
  private input(): InputBoxService | undefined {
    return this.context.services.tryGet<InputBoxService>(ServiceKeys.InputBox);
  }
  private toast(message: string, kind: 'info' | 'success' | 'error' = 'info'): void {
    this.context.layout.showToast(message, kind);
  }

  /** The directory a palette-invoked action targets: the Explorer context, else the first root. */
  private targetDir(explicit?: string): string | null {
    if (explicit) return explicit;
    const dir = this.explorer()?.contextDirectory();
    if (dir) return dir;
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    return workspace?.currentFolder() ?? null;
  }

  private hasWorkspaceTarget(): boolean {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    return Boolean(workspace?.folders().length && this.targetDir());
  }

  /** Detect the project's script extension: `.ts` when a tsconfig.json is present, else `.js`. */
  private async scriptExtFor(dir: string): Promise<ScriptExt> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const root = workspace?.currentFolder() ?? dir;
    try {
      if (await window.znxstudio.fs.pathExists(joinPath(root, 'tsconfig.json'))) return '.ts';
    } catch {
      /* fall through to the default */
    }
    return '.js';
  }

  /* ----- create ----- */
  private async createItem(def: NewItemDef, explicitDir?: string): Promise<void> {
    const dir = this.targetDir(explicitDir);
    if (!dir) {
      this.toast('Open a folder to create files.', 'error');
      return;
    }
    const scriptExt = def.ext === 'script' ? await this.scriptExtFor(dir) : '.js';
    const ext = resolveExtension(def, scriptExt);

    const name = await this.input()?.prompt({
      title: `New ${def.label}`,
      label: 'Name',
      placeholder: def.category === 'folder' ? 'folder name' : `name${ext}`,
      submitLabel: 'Create',
      validate: validateItemName,
    });
    if (name === null || name === undefined) return; // cancelled

    const fileName = resolveFileName(name, ext);
    const fullPath = joinPath(dir, fileName);

    // Duplicate guard: check the directory listing (fs.writeFile would overwrite).
    try {
      const existing = (await window.znxstudio.fs.readDirectory(dir)).map((n) => n.name);
      if (isDuplicate(fileName, existing)) {
        this.toast(`"${fileName}" already exists in this folder.`, 'error');
        return;
      }
    } catch {
      /* directory unreadable — the create below will surface the real error */
    }

    try {
      if (def.category === 'folder') {
        await window.znxstudio.fs.createDirectory(fullPath);
      } else {
        const content = def.template ? def.template(templateContext(fileName)) : '';
        await window.znxstudio.fs.writeFile(fullPath, content);
      }
    } catch (error) {
      this.toast(`Could not create "${fileName}": ${(error as Error).message}`, 'error');
      return;
    }

    await this.explorer()?.refreshDirectory(dir);
    if (def.category !== 'folder') {
      await this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.openFile(fullPath);
    }
    await this.explorer()?.revealPath(fullPath);
    this.toast(`Created ${fileName}.`, 'success');
  }

  /* ----- rename / delete / copy / reveal / terminal / refresh ----- */
  private async rename(explicitPath?: string): Promise<void> {
    const path = explicitPath ?? this.explorer()?.contextDirectory();
    if (!path) return;
    const current = baseName(path);
    const newName = await this.input()?.prompt({
      title: 'Rename',
      label: 'New name',
      value: current,
      submitLabel: 'Rename',
      validate: validateItemName,
    });
    if (!newName || newName === current) return;

    const parent = dirName(path);
    const target = joinPath(parent, newName);
    try {
      const existing = (await window.znxstudio.fs.readDirectory(parent)).map((n) => n.name);
      if (isDuplicate(newName, existing)) {
        this.toast(`"${newName}" already exists in this folder.`, 'error');
        return;
      }
    } catch {
      /* ignore — rename will surface the real error */
    }
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const closeEditors = editor ? await editor.prepareEditorsForPath(path) : () => undefined;
    if (!closeEditors) return;
    try {
      await window.znxstudio.fs.rename(path, target);
    } catch (error) {
      this.toast(`Could not rename: ${(error as Error).message}`, 'error');
      return;
    }
    closeEditors();
    await this.explorer()?.refreshDirectory(parent);
    await this.explorer()?.revealPath(target);
    this.toast(`Renamed to ${newName}.`, 'success');
  }

  private async remove(explicitPath?: string): Promise<void> {
    const path = explicitPath ?? this.explorer()?.contextDirectory();
    if (!path) return;
    const name = baseName(path);
    const confirmed = await this.input()?.confirm({
      title: 'Delete',
      message: `Delete "${name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!confirmed) return;
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const closeEditors = editor ? await editor.prepareEditorsForPath(path) : () => undefined;
    if (!closeEditors) return;
    try {
      await window.znxstudio.fs.delete(path);
    } catch (error) {
      this.toast(`Could not delete "${name}": ${(error as Error).message}`, 'error');
      return;
    }
    closeEditors();
    await this.explorer()?.refreshDirectory(dirName(path));
    this.toast(`Deleted ${name}.`, 'success');
  }

  private async copyPath(explicitPath?: string): Promise<void> {
    const path = explicitPath ?? this.explorer()?.contextDirectory();
    if (!path) return;
    try {
      await navigator.clipboard?.writeText(path);
      this.toast('Path copied to clipboard.', 'success');
    } catch {
      this.toast('Could not copy the path.', 'error');
    }
  }

  private async revealInOs(explicitPath?: string): Promise<void> {
    const path = explicitPath ?? this.explorer()?.contextDirectory();
    if (!path) return;
    try {
      await window.znxstudio.shell.showItemInFolder(path);
    } catch (error) {
      this.toast(`Could not reveal: ${(error as Error).message}`, 'error');
    }
  }

  private async openInTerminal(explicitPath?: string): Promise<void> {
    const dir = this.targetDir(explicitPath);
    if (!dir) return;
    // Starting a shell is execution — respect Workspace Trust.
    const trust = this.context.services.tryGet<TrustService>(ServiceKeys.Trust);
    if (trust && !trust.requireTrust('Open in Integrated Terminal')) return;
    await this.context.commands.execute(CommandIds.TerminalNewAt, dir);
  }

  private async refresh(explicitPath?: string): Promise<void> {
    const dir = this.targetDir(explicitPath);
    if (dir) await this.explorer()?.refreshDirectory(dir);
    else await this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace)?.refresh();
  }
}
