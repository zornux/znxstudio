import {
  ServiceKeys,
  type EditorService,
  type ExplorerSection,
  type ExplorerService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import type { IModule, ModuleContext } from '../core/Module';
import type { MenuEntry } from '../core/LayoutManager';
import { CommandIds } from '../commands/CommandIds';
import type { FileNode, WorkspaceInfo } from '../../shared/types';
import { fileIcon, folderIcon } from './fileIcons';
import { isCollapsed, setCollapsed, sortSections } from './explorerSections';
import { NEW_ITEMS, newItemCommandId } from './newItem';
import { dirName } from './paths';

const COLLAPSE_KEY = 'znxstudio.explorer.collapsed';
const VISIBILITY_KEY = 'znxstudio.explorer.sectionVisibility';
const OPT_IN_SECTIONS = new Set(['openEditors', 'outline', 'bookmarks']);

const SOURCE_DIRS = ['src', 'app', 'source', 'lib', 'components', 'pages'];
const GENERATED_DIRS = ['dist', 'out', 'build', 'node_modules', '.git', 'bin', 'obj', 'target'];
const CONFIG_FILES = [
  'znxstudio.project.json',
  'package.json',
  'tsconfig.json',
  '.gitignore',
  '.editorconfig',
  'readme.md',
];

/**
 * Structured project explorer. Groups the workspace root into Scripts, Source,
 * Config, Generated and remaining Files/Folders sections, with per-type icons
 * and refresh. Consumes WorkspaceService + EditorService only — no direct
 * imports of sibling view modules.
 */
export class ProjectExplorerModule implements IModule, ExplorerService {
  readonly id = 'znxstudio.explorer';
  readonly displayName = 'Project Explorer';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private container!: HTMLElement;
  private sectionsHost!: HTMLElement;
  private shell!: HTMLElement;
  private createButton!: HTMLButtonElement;
  private refreshButton!: HTMLButtonElement;
  private activePath: string | null = null;
  /** The directory the last context menu targeted (right-clicked node's folder). */
  private contextDir: string | null = null;
  /** Per-folder "expand/refresh" handles, keyed by folder path (rebuilt each render). */
  private readonly folderHandles = new Map<string, () => Promise<void>>();
  private readonly scriptRows: HTMLElement[] = [];

  private readonly sections = new Map<string, ExplorerSection>();
  private collapsed: Record<string, boolean> = {};
  private sectionVisibility: Record<string, boolean> = {};
  private renderGeneration = 0;
  private readonly sectionsEmitter = new Emitter<void>();
  readonly onDidChange = this.sectionsEmitter.event;

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.collapsed = this.loadCollapsed();
    this.sectionVisibility = this.loadSectionVisibility();

    this.container = document.createElement('div');
    this.container.className = 'znxstudio-explorer';
    // Right-clicking empty Explorer space targets the (first) workspace root.
    this.container.addEventListener('contextmenu', (event) => {
      if ((event.target as HTMLElement).closest('.znxstudio-tree-row')) return; // a row handles its own
      const root = this.workspace.currentFolder();
      if (!root) return;
      event.preventDefault();
      this.openContextMenu(root, true, event.clientX, event.clientY);
    });
    this.shell = this.buildShell();
    context.services.register(ServiceKeys.Explorer, this);
    context.layout.setSideBar('Explorer', this.shell);

    context.layout.addActivityItem({
      id: 'explorer',
      label: 'Explorer',
      icon: '≡',
      // Swap the shared sidebar back to the file explorer (Solution may hold it).
      onSelect: () => {
        context.layout.setSideBar('Explorer', this.shell);
        context.layout.focusSideBar();
      },
    });

    this.workspace.onDidChangeFolders(() => {
      this.contextDir = null;
      this.refreshToolbarState();
      void this.render();
    });
    context.subscriptions.push(
      context.commands.onDidChangeEnablement(() => {
        this.refreshScriptRows();
        this.refreshToolbarState();
        this.renderSections();
      }),
    );

    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    editor?.onDidChangeActiveFile((path) => this.highlight(path));

    void this.render();
  }

  /** Sidebar body: a header with a refresh button, plus the tree container. */
  private buildShell(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'znxstudio-explorer-shell';

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-explorer-toolbar';
    const refresh = document.createElement('button');
    this.refreshButton = refresh;
    refresh.className = 'znxstudio-icon-btn';
    refresh.title = 'Refresh Explorer';
    refresh.setAttribute('aria-label', 'Refresh Explorer');
    refresh.textContent = '⟳';
    refresh.addEventListener('click', () => {
      if (this.context.commands.has(CommandIds.ExplorerRefresh) &&
          this.context.commands.isEnabled(CommandIds.ExplorerRefresh)) {
        this.context.commands.executeFromUi(CommandIds.ExplorerRefresh);
      }
    });
    const create = document.createElement('button');
    this.createButton = create;
    create.className = 'znxstudio-icon-btn';
    create.title = 'New File or Folder';
    create.setAttribute('aria-label', 'New File or Folder');
    create.textContent = '+';
    create.addEventListener('click', () => this.openNewMenu(create));
    const sections = document.createElement('button');
    sections.className = 'znxstudio-icon-btn';
    sections.title = 'Explorer Sections';
    sections.setAttribute('aria-label', 'Choose Explorer sections');
    sections.textContent = '⋯';
    sections.addEventListener('click', () => this.openSectionsMenu(sections));
    toolbar.append(create, refresh, sections);
    this.refreshToolbarState();

    // Contributed sections (Open Editors / Outline / Bookmarks) stack here, above
    // the file tree — their render paths never touch the tree container.
    this.sectionsHost = document.createElement('div');
    this.sectionsHost.className = 'znxstudio-explorer-sections';

    shell.append(toolbar, this.sectionsHost, this.container);
    return shell;
  }

  /* ----- ExplorerService: contributed collapsible sections (UX-6) ----- */
  registerSection(section: ExplorerSection): void {
    this.sections.set(section.id, section);
    this.renderSections();
    this.sectionsEmitter.fire();
  }

  removeSection(id: string): void {
    if (this.sections.delete(id)) {
      this.renderSections();
      this.sectionsEmitter.fire();
    }
  }

  private renderSections(): void {
    this.sectionsHost.replaceChildren();
    for (const section of sortSections([...this.sections.values()]).filter((item) => this.isSectionVisible(item.id))) {
      this.sectionsHost.appendChild(this.renderSection(section));
    }
  }

  private renderSection(section: ExplorerSection): HTMLElement {
    const collapsed = isCollapsed(this.collapsed, section.id, section.collapsed ?? false);

    const wrap = document.createElement('div');
    wrap.className = `znxstudio-explorer-cs${collapsed ? ' is-collapsed' : ''}`;
    wrap.dataset.section = section.id;

    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-cs-header';

    const bodyId = `znxstudio-explorer-cs-body-${section.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    // The disclosure is a real <button>: it gets native Enter/Space activation and focus for free, and
    // exposes the section's expanded state to assistive tech (aria-expanded + aria-controls). The action
    // buttons stay siblings so no interactive control is nested inside another.
    const disclosure = document.createElement('button');
    disclosure.type = 'button';
    disclosure.className = 'znxstudio-explorer-cs-disclosure';
    disclosure.setAttribute('aria-expanded', String(!collapsed));
    disclosure.setAttribute('aria-controls', bodyId);

    const twisty = document.createElement('span');
    twisty.className = 'znxstudio-icon';
    twisty.setAttribute('aria-hidden', 'true'); // decorative — the button's label is the section title
    twisty.textContent = collapsed ? '▸' : '▾';

    const title = document.createElement('span');
    title.className = 'znxstudio-explorer-cs-title';
    title.textContent = section.title;

    disclosure.append(twisty, title);
    header.append(disclosure);

    if (section.actions?.length) {
      const actions = document.createElement('span');
      actions.className = 'znxstudio-explorer-cs-actions';
      for (const action of section.actions) {
        const btn = document.createElement('button');
        btn.className = 'znxstudio-icon-btn';
        btn.title = action.tooltip;
        btn.setAttribute('aria-label', action.tooltip);
        btn.textContent = action.icon;
        const enabled = !action.commandId ||
          (this.context.commands.has(action.commandId) && this.context.commands.isEnabled(action.commandId));
        btn.disabled = !enabled;
        btn.setAttribute('aria-disabled', String(!enabled));
        btn.addEventListener('click', (event) => {
          event.stopPropagation();
          if (action.commandId &&
              (!this.context.commands.has(action.commandId) || !this.context.commands.isEnabled(action.commandId))) {
            return;
          }
          action.run();
        });
        actions.appendChild(btn);
      }
      header.appendChild(actions);
    }

    const body = document.createElement('div');
    body.className = 'znxstudio-explorer-cs-body';
    body.id = bodyId;
    body.appendChild(section.element);
    if (collapsed) body.style.display = 'none';

    disclosure.addEventListener('click', () => {
      const nowCollapsed = body.style.display !== 'none';
      body.style.display = nowCollapsed ? 'none' : '';
      twisty.textContent = nowCollapsed ? '▸' : '▾';
      wrap.classList.toggle('is-collapsed', nowCollapsed);
      disclosure.setAttribute('aria-expanded', String(!nowCollapsed));
      this.collapsed = setCollapsed(this.collapsed, section.id, nowCollapsed);
      this.saveCollapsed();
    });

    wrap.append(header, body);
    return wrap;
  }

  private loadCollapsed(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(COLLAPSE_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  }

  private saveCollapsed(): void {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(this.collapsed));
    } catch {
      /* ignore quota / disabled storage */
    }
  }

  private loadSectionVisibility(): Record<string, boolean> {
    try {
      const raw = localStorage.getItem(VISIBILITY_KEY);
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, boolean>)
        : {};
    } catch {
      return {};
    }
  }

  private isSectionVisible(id: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.sectionVisibility, id)
      ? this.sectionVisibility[id]
      : !OPT_IN_SECTIONS.has(id);
  }

  private setSectionVisible(id: string, visible: boolean): void {
    this.sectionVisibility = { ...this.sectionVisibility, [id]: visible };
    try {
      localStorage.setItem(VISIBILITY_KEY, JSON.stringify(this.sectionVisibility));
    } catch {
      /* disabled storage only affects persistence */
    }
    this.renderSections();
    this.sectionsEmitter.fire();
  }

  private openSectionsMenu(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const entries = (): MenuEntry[] => [
      { header: 'Explorer Sections' },
      ...sortSections([...this.sections.values()]).map((section) => ({
        label: section.title,
        checked: this.isSectionVisible(section.id),
        onToggle: () => this.setSectionVisible(section.id, !this.isSectionVisible(section.id)),
      }) as MenuEntry),
    ];
    this.context.layout.openFloatingMenu(rect.right, rect.bottom + 2, entries);
  }

  private openNewMenu(anchor: HTMLElement): void {
    const rect = anchor.getBoundingClientRect();
    const dir = this.contextDirectory();
    const entries: MenuEntry[] = NEW_ITEMS.map((def) => {
      const id = newItemCommandId(def.id);
      const enabled = this.context.commands.has(id) && this.context.commands.isEnabled(id);
      return {
        label: def.label,
        disabled: !enabled,
        onClick: () => {
          if (this.context.commands.has(id) && this.context.commands.isEnabled(id)) {
            this.context.commands.executeFromUi(id, undefined, dir ?? undefined);
          }
        },
      };
    });
    this.context.layout.openFloatingMenu(rect.left, rect.bottom + 2, () => entries);
  }

  private refreshToolbarState(): void {
    if (!this.createButton || !this.refreshButton) return;
    const createId = newItemCommandId(NEW_ITEMS[0]?.id ?? 'file');
    const canCreate = this.context.commands.has(createId) && this.context.commands.isEnabled(createId);
    const canRefresh = this.context.commands.has(CommandIds.ExplorerRefresh) &&
      this.context.commands.isEnabled(CommandIds.ExplorerRefresh);
    this.createButton.disabled = !canCreate;
    this.createButton.setAttribute('aria-disabled', String(!canCreate));
    this.refreshButton.disabled = !canRefresh;
    this.refreshButton.setAttribute('aria-disabled', String(!canRefresh));
  }

  private renderEmpty(): void {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-explorer-empty';

    const message = document.createElement('p');
    message.textContent = 'No folder opened';

    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'Open Folder';
    button.addEventListener('click', () => this.executeIfEnabled(CommandIds.WorkspaceOpenFolder));

    wrap.append(message, button);
    this.container.replaceChildren(wrap);
  }

  private async render(): Promise<void> {
    this.scriptRows.length = 0;
    const generation = ++this.renderGeneration;
    this.folderHandles.clear();
    const folders = this.workspace.folders();
    if (folders.length === 0) {
      this.renderEmpty();
      return;
    }

    const fragment = document.createDocumentFragment();
    if (folders.length === 1) {
      // Single root: the flat, header-less layout.
      fragment.appendChild(await this.renderFolderBody(folders[0]));
    } else {
      // Multi-root: each folder is a collapsible, removable root section.
      for (const folder of folders) fragment.appendChild(await this.renderRoot(folder));
    }
    if (generation !== this.renderGeneration) return;
    this.container.replaceChildren(fragment);
  }

  /** The categorized body (Scripts/Source/Folders/Config/Files/Generated) for one root. */
  private async renderFolderBody(info: WorkspaceInfo): Promise<HTMLElement> {
    const body = document.createElement('div');
    body.className = 'znxstudio-explorer-folder-body';

    let entries: FileNode[];
    try {
      entries = await window.znxstudio.fs.readDirectory(info.root);
    } catch (error) {
      // The root was moved, renamed, or deleted (e.g. a stale session-restored
      // folder). Degrade to an inline notice + Remove action instead of letting
      // the rejection escape and crash the renderer ("ENOENT: … scandir").
      return this.renderUnavailableRoot(info, error);
    }
    const groups = this.categorize(entries, info);

    const scripts = info.project?.scripts;
    if (scripts && Object.keys(scripts).length) body.appendChild(this.renderScripts(scripts, info.root));
    if (groups.source.length) body.appendChild(this.section('Source', this.tree(groups.source)));
    if (groups.folders.length) body.appendChild(this.section('Folders', this.tree(groups.folders)));
    if (groups.config.length) body.appendChild(this.section('Config', this.tree(groups.config)));
    if (groups.files.length) body.appendChild(this.section('Files', this.tree(groups.files)));
    if (groups.generated.length) body.appendChild(this.section('Generated', this.tree(groups.generated), true));
    return body;
  }

  /** Inline placeholder for a workspace root that can't be read (moved/deleted). */
  private renderUnavailableRoot(info: WorkspaceInfo, error: unknown): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-explorer-empty';

    const message = document.createElement('p');
    message.textContent = 'This folder is no longer available (moved, renamed, or deleted).';
    message.title = String((error as { message?: string })?.message ?? error);

    const button = document.createElement('button');
    button.className = 'znxstudio-btn';
    button.textContent = 'Remove from Workspace';
    button.addEventListener('click', () =>
      this.executeIfEnabled(CommandIds.WorkspaceRemoveFolder, info.root));

    wrap.append(message, button);
    return wrap;
  }

  /** A collapsible root section with a name + remove button (multi-root). */
  private async renderRoot(info: WorkspaceInfo): Promise<HTMLElement> {
    const root = document.createElement('div');
    root.className = 'znxstudio-explorer-root';

    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-root-header';
    header.title = info.root;

    const twisty = document.createElement('span');
    twisty.className = 'znxstudio-icon';
    twisty.textContent = '▾';
    const icon = document.createElement('span');
    icon.className = 'znxstudio-icon';
    icon.textContent = 'P';
    const name = document.createElement('span');
    name.className = 'znxstudio-explorer-root-name';
    name.textContent = info.project?.name ?? baseName(info.root);

    const remove = document.createElement('button');
    remove.className = 'znxstudio-icon-btn';
    remove.title = 'Remove Folder from Workspace';
    remove.setAttribute('aria-label', `Remove ${name.textContent ?? 'folder'} from workspace`);
    remove.textContent = '✕';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      this.executeIfEnabled(CommandIds.WorkspaceRemoveFolder, info.root);
    });

    const disclosure = document.createElement('div');
    disclosure.className = 'znxstudio-explorer-root-disclosure';
    disclosure.tabIndex = 0;
    disclosure.setAttribute('role', 'button');
    disclosure.setAttribute('aria-expanded', 'true');
    disclosure.setAttribute('aria-label', `${name.textContent ?? 'Workspace folder'} root`);
    disclosure.append(twisty, icon, name);
    header.append(disclosure, remove);

    const body = await this.renderFolderBody(info);
    const setExpanded = (expanded: boolean): void => {
      body.style.display = expanded ? '' : 'none';
      twisty.textContent = expanded ? '▾' : '▸';
      disclosure.setAttribute('aria-expanded', String(expanded));
    };
    const toggle = (): void => setExpanded(disclosure.getAttribute('aria-expanded') !== 'true');
    disclosure.addEventListener('click', toggle);
    disclosure.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setExpanded(true);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setExpanded(false);
      }
    });

    root.append(header, body);
    return root;
  }

  private categorize(entries: FileNode[], info: WorkspaceInfo) {
    const hints = info.project?.workspace;
    const sourceSet = new Set([...(hints?.sourceDirs ?? []), ...SOURCE_DIRS]);
    const generatedSet = new Set([...(hints?.generatedDirs ?? []), ...GENERATED_DIRS]);
    const configSet = new Set([...(hints?.configFiles ?? []), ...CONFIG_FILES].map(lower));

    const groups = {
      source: [] as FileNode[],
      folders: [] as FileNode[],
      config: [] as FileNode[],
      files: [] as FileNode[],
      generated: [] as FileNode[],
    };

    for (const entry of entries) {
      if (entry.type === 'directory') {
        if (generatedSet.has(entry.name)) groups.generated.push(entry);
        else if (sourceSet.has(entry.name)) groups.source.push(entry);
        else groups.folders.push(entry);
      } else if (configSet.has(lower(entry.name))) {
        groups.config.push(entry);
      } else {
        groups.files.push(entry);
      }
    }
    return groups;
  }

  /* ----- Rendering ----- */
  private section(title: string, body: HTMLElement, dimmed = false): HTMLElement {
    const section = document.createElement('div');
    section.className = `znxstudio-explorer-section${dimmed ? ' is-dimmed' : ''}`;
    const header = document.createElement('div');
    header.className = 'znxstudio-explorer-section-header';
    header.textContent = title;
    section.append(header, body);
    return section;
  }

  private renderScripts(scripts: Record<string, string>, root: string): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'znxstudio-tree';
    for (const [name, command] of Object.entries(scripts)) {
      const item = document.createElement('li');
      const row = document.createElement('div');
      row.className = 'znxstudio-tree-row';
      row.title = command;
      // Build via DOM (name is untrusted — never interpolate into innerHTML).
      row.append(iconSpan('▶'), labelSpan(name));
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      this.scriptRows.push(row);
      const run = (): void => {
        if (this.context.commands.has(CommandIds.RunScript) &&
            this.context.commands.isEnabled(CommandIds.RunScript)) {
          this.context.commands.executeFromUi(CommandIds.RunScript, undefined, name, root);
        }
      };
      row.addEventListener('click', run);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          run();
        }
      });
      item.appendChild(row);
      list.appendChild(item);
    }
    this.refreshScriptRows();
    return this.section('Scripts', list);
  }

  private refreshScriptRows(): void {
    const enabled = this.context.commands.has(CommandIds.RunScript) &&
      this.context.commands.isEnabled(CommandIds.RunScript);
    for (const row of this.scriptRows) {
      row.classList.toggle('is-disabled', !enabled);
      row.setAttribute('aria-disabled', String(!enabled));
      row.tabIndex = enabled ? 0 : -1;
    }
  }

  private executeIfEnabled(id: string, ...args: unknown[]): void {
    if (this.context.commands.has(id) && this.context.commands.isEnabled(id)) {
      this.context.commands.executeFromUi(id, undefined, ...args);
    }
  }

  // A file tree as an ARIA tree (WAI-ARIA tree pattern): the root <ul> is role="tree", nested child
  // lists are role="group", and each <li> is a role="treeitem" with its depth (aria-level) and, for
  // folders, its open state (aria-expanded). The root wires arrow-key navigation with a roving tabindex.
  private tree(nodes: FileNode[], level = 1, isRoot = true): HTMLElement {
    const list = document.createElement('ul');
    list.className = 'znxstudio-tree';
    list.setAttribute('role', isRoot ? 'tree' : 'group');
    for (const node of nodes) list.appendChild(this.node(node, level));
    if (isRoot) {
      list.addEventListener('keydown', (event) => this.onTreeKey(list, event));
      const first = list.querySelector<HTMLElement>('[role="treeitem"]');
      if (first) first.tabIndex = 0; // the tree's single tab stop; arrows move the roving focus
    }
    return list;
  }

  private node(node: FileNode, level: number): HTMLElement {
    const item = document.createElement('li');
    item.setAttribute('role', 'treeitem');
    item.setAttribute('aria-level', String(level));
    item.tabIndex = -1;
    item.dataset.path = node.path;

    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row';
    row.dataset.path = node.path;
    row.dataset.type = node.type;
    // Every row offers the create/manage context menu (files target their folder).
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openContextMenu(node.path, node.type === 'directory', event.clientX, event.clientY);
    });

    if (node.type === 'file') {
      const icon = iconSpan(fileIcon(node.name));
      icon.setAttribute('aria-hidden', 'true');
      row.append(icon, labelSpan(node.name));
      row.addEventListener('click', () => this.openFile(node.path));
      if (node.path === this.activePath) {
        row.classList.add('is-active');
        item.setAttribute('aria-selected', 'true');
      }
      item.appendChild(row);
      return item;
    }

    item.setAttribute('aria-expanded', 'false');
    let expanded = false;
    let childList: HTMLElement | null = null;
    const setLabel = () => {
      const twisty = iconSpan(expanded ? '▾' : '▸');
      const folder = iconSpan(folderIcon());
      twisty.setAttribute('aria-hidden', 'true'); // state is exposed via aria-expanded, not the glyph
      folder.setAttribute('aria-hidden', 'true');
      row.replaceChildren(twisty, folder, labelSpan(node.name));
    };
    setLabel();

    // Expand (re-)reads the directory so a freshly created child appears; exposed
    // via folderHandles so refreshDirectory()/revealPath() can drive it.
    const expand = async (): Promise<void> => {
      let children: FileNode[];
      try {
        children = await window.znxstudio.fs.readDirectory(node.path);
      } catch (error) {
        this.context.layout.showToast(`Could not open ${node.name}: ${(error as Error).message}`, 'error');
        return;
      }
      const fresh = this.tree(children, level + 1, false);
      if (childList) childList.replaceWith(fresh);
      else item.appendChild(fresh);
      childList = fresh;
      expanded = true;
      item.setAttribute('aria-expanded', 'true');
      setLabel();
    };
    const collapse = (): void => {
      childList?.remove();
      childList = null;
      expanded = false;
      item.setAttribute('aria-expanded', 'false');
      setLabel();
    };
    this.folderHandles.set(node.path, expand);

    row.addEventListener('click', () => {
      if (expanded) collapse();
      else void expand();
    });

    item.appendChild(row);
    return item;
  }

  // Keyboard navigation for the ARIA tree (WAI-ARIA APG): Up/Down move between visible items, Right
  // expands a folder (or steps into it), Left collapses it (or steps to the parent), Enter/Space
  // activates, Home/End jump to the ends. Visible items are re-read each keypress so lazily-loaded
  // children are always in range.
  private onTreeKey(root: HTMLElement, event: KeyboardEvent): void {
    const items = [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')].filter((el) => el.offsetParent !== null);
    const current = document.activeElement as HTMLElement | null;
    const index = current ? items.indexOf(current) : -1;
    const focusAt = (i: number): void => {
      const target = items[Math.max(0, Math.min(items.length - 1, i))];
      if (!target) return;
      for (const item of items) item.tabIndex = -1;
      target.tabIndex = 0;
      target.focus();
    };
    const activate = (): void => current?.querySelector<HTMLElement>('.znxstudio-tree-row')?.click();
    const expandedState = current?.getAttribute('aria-expanded');

    if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
      const row = current?.querySelector<HTMLElement>('.znxstudio-tree-row');
      const path = row?.dataset.path;
      if (row && path) {
        event.preventDefault();
        const rect = row.getBoundingClientRect();
        this.openContextMenu(path, row.dataset.type === 'directory', rect.left + 16, rect.bottom);
      }
      return;
    }

    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); focusAt(index + 1); break;
      case 'ArrowUp': event.preventDefault(); focusAt(index - 1); break;
      case 'Home': event.preventDefault(); focusAt(0); break;
      case 'End': event.preventDefault(); focusAt(items.length - 1); break;
      case 'Enter':
      case ' ': event.preventDefault(); activate(); break;
      case 'ArrowRight':
        event.preventDefault();
        if (expandedState === 'false') activate(); // expand
        else if (expandedState === 'true') focusAt(index + 1); // step into first child
        break;
      case 'ArrowLeft':
        event.preventDefault();
        if (expandedState === 'true') {
          activate(); // collapse
        } else {
          const parent = current?.parentElement?.closest<HTMLElement>('[role="treeitem"]');
          if (parent) focusAt(items.indexOf(parent));
        }
        break;
      default: break;
    }
  }

  private openFile(path: string): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    // Single click is a peek: opens a reusable preview tab (double-click/edit pins it).
    void editor?.openFile(path, { preview: true });
  }

  /**
   * The Explorer context menu. `New` is a submenu of every Zornux/Zoijs/standard
   * type + Folder; the rest are file-management actions. Each entry dispatches a
   * command (registered by ExplorerActionsModule) — no work happens here.
   * Rendered via the shared floating-menu (keyboard-navigable, viewport-clamped).
   */
  private openContextMenu(path: string, isDirectory: boolean, x: number, y: number): void {
    const dir = isDirectory ? path : dirName(path);
    this.contextDir = dir;
    const commandItem = (label: string, id: string, arg: string): MenuEntry => {
      const enabled = this.context.commands.has(id) && this.context.commands.isEnabled(id);
      return {
        label,
        disabled: !enabled,
        onClick: () => {
          if (this.context.commands.has(id) && this.context.commands.isEnabled(id)) {
            this.context.commands.executeFromUi(id, undefined, arg);
          }
        },
      };
    };
    const newSubmenu: MenuEntry[] = NEW_ITEMS.map((def) =>
      commandItem(def.label, newItemCommandId(def.id), dir));
    const entries: MenuEntry[] = [
      { label: 'New', submenu: () => newSubmenu },
      { separator: true },
      commandItem('Rename…', CommandIds.ExplorerRename, path),
      commandItem('Delete', CommandIds.ExplorerDelete, path),
      { separator: true },
      commandItem('Copy Path', CommandIds.ExplorerCopyPath, path),
      commandItem('Reveal in File Explorer', CommandIds.ExplorerRevealInOs, path),
      commandItem('Open in Integrated Terminal', CommandIds.ExplorerOpenInTerminal, dir),
      { separator: true },
      commandItem('Refresh', CommandIds.ExplorerRefresh, dir),
    ];
    this.context.layout.openFloatingMenu(x, y, () => entries);
  }

  /* ----- ExplorerService: context target + refresh/reveal ----- */
  contextDirectory(): string | null {
    return this.contextDir ?? this.workspace.currentFolder();
  }

  /** Re-read a directory that's expanded in the tree (or the whole tree for a root). */
  async refreshDirectory(dirPath: string): Promise<void> {
    const expand = this.folderHandles.get(dirPath);
    if (expand) {
      await expand();
      return;
    }
    // A workspace root (or a not-yet-rendered folder): re-render the tree.
    if (this.workspace.folders().some((f) => f.root === dirPath)) await this.render();
  }

  /** Expand the parent folder (surfacing the item), then highlight + scroll to it. */
  async revealPath(path: string): Promise<void> {
    await this.refreshDirectory(dirName(path));
    const rows = [...this.container.querySelectorAll<HTMLElement>('.znxstudio-tree-row')];
    const target = rows.find((row) => row.dataset.path === path);
    if (target) {
      this.highlight(path);
      const item = target.closest<HTMLElement>('[role="treeitem"]');
      if (item) {
        for (const treeItem of this.container.querySelectorAll<HTMLElement>('[role="treeitem"]')) {
          treeItem.tabIndex = -1;
        }
        item.tabIndex = 0;
        item.focus({ preventScroll: true });
      }
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  private highlight(path: string | null): void {
    this.activePath = path;
    for (const row of this.container.querySelectorAll<HTMLElement>('.znxstudio-tree-row')) {
      const active = row.dataset.path === path;
      row.classList.toggle('is-active', active);
      const item = row.closest<HTMLElement>('[role="treeitem"]');
      if (item) {
        if (active) item.setAttribute('aria-selected', 'true');
        else item.removeAttribute('aria-selected');
      }
    }
  }
}

function lower(value: string): string {
  return value.toLowerCase();
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** An icon span (glyphs are internal/safe). */
function iconSpan(glyph: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'znxstudio-icon';
  span.textContent = glyph;
  return span;
}

/** A label span for an untrusted name — set via textContent, never innerHTML. */
function labelSpan(name: string): HTMLElement {
  const span = document.createElement('span');
  span.textContent = name;
  return span;
}
