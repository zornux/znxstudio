import {
  ServiceKeys,
  type EditorService,
  type ExplorerService,
  type OpenEditor,
} from '../core/Contracts';
import type { IModule, ModuleContext } from '../core/Module';

/**
 * Open Editors (UX-6). The VS Code-style list of currently-open tabs, contributed
 * as a section at the top of the Explorer sidebar. It mirrors the editor's tab
 * model (the single source of truth) through the read-only `EditorService`
 * editors surface — click a row to focus, × to close, ● shows unsaved, preview
 * tabs are italic and pinned tabs carry a 📌. Degrades quietly when either the
 * editor or the explorer service is absent.
 */
export class OpenEditorsModule implements IModule {
  readonly id = 'znxstudio.openEditors';
  readonly displayName = 'Open Editors';

  private editor: EditorService | undefined;
  private list!: HTMLElement;

  activate(context: ModuleContext): void {
    this.editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const explorer = context.services.tryGet<ExplorerService>(ServiceKeys.Explorer);
    if (!this.editor || !explorer) return;

    this.list = document.createElement('div');
    this.list.className = 'znxstudio-open-editors';

    explorer.registerSection({
      id: 'openEditors',
      title: 'Open Editors',
      order: 10,
      element: this.list,
      collapsed: true,
      actions: [{ icon: '⨉', tooltip: 'Close All Editors', run: () => this.closeAll() }],
    });

    this.editor.onDidChangeEditors(() => this.render());
    this.render();
  }

  private closeAll(): void {
    for (const open of this.editor?.openEditors() ?? []) this.editor?.closeEditor(open.uri);
  }

  private render(): void {
    const editors = this.editor?.openEditors() ?? [];
    this.list.replaceChildren();

    if (!editors.length) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-open-editors-empty';
      empty.textContent = 'No open editors.';
      this.list.appendChild(empty);
      return;
    }

    for (const open of editors) this.list.appendChild(this.renderRow(open));
  }

  private renderRow(open: OpenEditor): HTMLElement {
    const row = document.createElement('div');
    row.className =
      'znxstudio-tree-row znxstudio-open-editors-row' +
      (open.active ? ' is-active' : '') +
      (open.preview ? ' is-preview' : '') +
      (open.dirty ? ' is-dirty' : '');
    row.title = open.path;

    const icon = document.createElement('span');
    icon.className = 'znxstudio-icon';
    icon.textContent = open.pinned ? '📌' : '📄';
    row.appendChild(icon);

    const label = document.createElement('span');
    label.className = 'znxstudio-open-editors-name';
    label.textContent = open.name;
    row.appendChild(label);

    const dirty = document.createElement('span');
    dirty.className = 'znxstudio-open-editors-dirty';
    dirty.textContent = '●';
    row.appendChild(dirty);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'znxstudio-open-editors-close';
    close.textContent = '×';
    close.title = 'Close';
    close.setAttribute('aria-label', `Close ${open.name}`);
    close.addEventListener('click', (event) => {
      event.stopPropagation();
      this.editor?.closeEditor(open.uri);
    });
    row.appendChild(close);

    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    row.setAttribute('aria-current', open.active ? 'true' : 'false');
    const activate = (): void => this.editor?.activateEditor(open.uri);
    row.addEventListener('click', activate);
    row.addEventListener('keydown', (event) => {
      if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        activate();
      }
    });
    row.addEventListener('mousedown', (event) => {
      if (event.button === 1) {
        event.preventDefault();
        this.editor?.closeEditor(open.uri);
      }
    });
    return row;
  }
}
