import { ServiceKeys, type EditorService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureFocus, markCombobox, markDialog, markListbox, markOption, setActiveDescendant } from '../ui/ariaListbox';
import { fuzzyFilter } from './fuzzy';

/**
 * Quick Open (Phase 7J). A Ctrl+P fuzzy file finder over the workspace. Loads the
 * file list from the (7A) search walker, ranks it with the pure fuzzy matcher,
 * and opens the picked file. The file list is cached and refreshed on folder
 * change.
 */
export class QuickOpenModule implements IModule {
  readonly id = 'znxstudio.quickOpen';
  readonly displayName = 'Quick Open';

  private context!: ModuleContext;
  private editor!: EditorService;
  private workspace!: WorkspaceService;
  private files: string[] = [];
  private loaded = false;
  private root: string | null = null;
  private picker: HTMLElement | undefined;
  private restoreFocus: (() => void) | undefined;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);

    context.commands.register(CommandIds.QuickOpen, () => void this.open(), 'Go: Quick Open File');

    this.workspace.onDidChangeWorkspace(() => {
      this.loaded = false;
      this.files = [];
    });

    // Ctrl+P belongs to the KeybindingService (Phase 17D), which dispatches
    // `QuickOpen` — one listener owns the keyboard, so the binding is rebindable
    // and a conflict is detectable. Escape merely dismisses the picker.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.picker) this.closePicker();
      },
      true,
    );

    void selfTestCoordinator.run('quickopen', () => this.maybeSelfTest());
  }

  private async ensureFiles(): Promise<void> {
    const root = this.workspace.currentFolder();
    if (this.loaded && root === this.root) return;
    this.root = root;
    this.files = root ? await window.znxstudio.search.files(root) : [];
    this.loaded = true;
  }

  private async open(): Promise<void> {
    const root = this.workspace.currentFolder();
    if (!root) {
      this.context.layout.showToast('Open a folder to use Quick Open.', 'info');
      return;
    }
    await this.ensureFiles();
    this.showPicker(root);
  }

  private showPicker(root: string): void {
    this.closePicker();
    const rootLen = root.replace(/[\\/]+$/, '').length + 1;
    const relative = (path: string) => path.slice(rootLen).replace(/\\/g, '/');

    const overlay = document.createElement('div');
    overlay.className = 'znxstudio-quickopen';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) this.closePicker();
    });

    const box = document.createElement('div');
    box.className = 'znxstudio-quickopen-box';
    const input = document.createElement('input');
    input.className = 'znxstudio-quickopen-input';
    input.placeholder = `Go to file… (${this.files.length} files)`;
    const list = document.createElement('ul');
    list.className = 'znxstudio-quickopen-list';

    // Screen-reader semantics (Phase 20J WI4): modal combobox over a listbox.
    markDialog(overlay, 'Go to File');
    markListbox(list, 'znxstudio-quickopen-listbox', 'Files');
    markCombobox(input, 'znxstudio-quickopen-listbox');

    let selection = 0;
    let shown: string[] = [];

    const render = (query: string) => {
      const ranked = query.trim()
        ? fuzzyFilter(query, this.files, relative).slice(0, 50).map((r) => r.item)
        : this.files.slice(0, 50);
      shown = ranked;
      selection = 0;
      list.replaceChildren();
      ranked.forEach((path, index) => {
        const item = document.createElement('li');
        item.className = `znxstudio-quickopen-item${index === selection ? ' is-selected' : ''}`;
        markOption(item, `znxstudio-quickopen-opt-${index}`, index === selection);
        const name = document.createElement('span');
        name.className = 'znxstudio-quickopen-name';
        name.textContent = relative(path).split('/').pop() ?? path;
        const dir = document.createElement('span');
        dir.className = 'znxstudio-quickopen-dir';
        dir.textContent = relative(path);
        item.append(name, dir);
        item.addEventListener('click', () => this.choose(path));
        list.appendChild(item);
      });
      setActiveDescendant(input, shown.length ? `znxstudio-quickopen-opt-${selection}` : null);
    };

    const move = (delta: number) => {
      if (shown.length === 0) return;
      selection = (selection + delta + shown.length) % shown.length;
      [...list.children].forEach((el, i) => {
        const active = i === selection;
        el.classList.toggle('is-selected', active);
        el.setAttribute('aria-selected', String(active));
      });
      setActiveDescendant(input, `znxstudio-quickopen-opt-${selection}`);
      list.children[selection]?.scrollIntoView({ block: 'nearest' });
    };

    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        move(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (shown[selection]) this.choose(shown[selection]);
      }
    });

    box.append(input, list);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    this.picker = overlay;
    this.restoreFocus = captureFocus();
    render('');
    input.focus();
  }

  private choose(path: string): void {
    this.closePicker();
    // A picked file opens as a reusable preview tab (VS Code Quick Open feel).
    void this.editor.openFile(path, { preview: true });
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = undefined;
    this.restoreFocus?.();
    this.restoreFocus = undefined;
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
      const root = 'C:\\Studio Apps\\xojin\\examples';
      const files = await window.znxstudio.search.files(root);
      log(`quickopen listFiles(examples): count=${files.length}`);
      const relative = (path: string) => path.slice(root.length + 1).replace(/\\/g, '/');
      const ranked = fuzzyFilter('clzx', files, relative).slice(0, 3).map((r) => relative(r.item));
      log(`quickopen fuzzy('clzx'): top=[${ranked.join(', ')}]`);
      const conf = fuzzyFilter('config', files, relative).slice(0, 2).map((r) => relative(r.item));
      log(`quickopen fuzzy('config'): top=[${conf.join(', ')}]`);
    } catch (error) {
      log(`quickopen self-test failed: ${(error as Error).message}`);
    }
  }
}
