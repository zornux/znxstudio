import type { CommandRegistry } from '../commands/CommandRegistry';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { captureFocus, markCombobox, markDialog, markListbox, markOption, setActiveDescendant } from '../ui/ariaListbox';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { claimOverlay } from '../ui/overlayCoordinator';

interface Entry {
  id: string;
  title: string;
  enabled: boolean;
}

/** Commands hidden from the palette (internal plumbing). */
const HIDDEN = new Set<string>([CommandIds.PaletteShow, CommandIds.RunScript]);

/**
 * Command palette. A keyboard-driven overlay (Ctrl+Shift+P) that lists every
 * command registered in the CommandRegistry and dispatches the chosen one.
 * Reads only the registry — it knows nothing about individual feature modules.
 */
export class CommandPaletteModule implements IModule {
  readonly id = 'znxstudio.palette';
  readonly displayName = 'Command Palette';

  private commands!: CommandRegistry;
  private layout!: ModuleContext['layout'];
  private root!: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private entries: Entry[] = [];
  private filtered: Entry[] = [];
  private selection = 0;
  private open = false;
  private restoreFocus: (() => void) | undefined;
  private releaseOverlay: (() => void) | undefined;

  activate(context: ModuleContext): void {
    this.commands = context.commands;
    this.layout = context.layout;
    context.commands.register(CommandIds.PaletteShow, () => this.show(), 'View: Show Command Palette');

    this.buildDom();

    // Ctrl+Shift+P belongs to the KeybindingService (Phase 17D), which dispatches
    // `PaletteShow` — so the shortcut is rebindable and appears in the shortcuts
    // editor. Escape is not a binding: it dismisses whatever overlay is open.
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.open) this.hide();
    };
    window.addEventListener('keydown', onKeyDown, true);
    context.subscriptions.push({
      dispose: () => {
        window.removeEventListener('keydown', onKeyDown, true);
        this.hide();
        this.root.remove();
      },
    });

    void selfTestCoordinator.run('palette-a11y', () => this.maybeSelfTest());
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

    this.show();
    const role = this.root.getAttribute('role');
    const modal = this.root.getAttribute('aria-modal');
    const inputRole = this.input.getAttribute('role');
    const listRole = this.list.getAttribute('role');
    const active = this.input.getAttribute('aria-activedescendant');
    const firstOptionRole = this.list.querySelector('[role="option"]')?.getAttribute('role') ?? 'none';
    log(
      `palette-a11y REAL DOM: dialog=${role}/${modal} input=${inputRole} list=${listRole} ` +
        `activedescendant=${active ? 'set' : 'none'} option=${firstOptionRole} (expect dialog/true combobox listbox set option)`,
    );
    this.hide();
  }

  private buildDom(): void {
    this.root = document.createElement('div');
    this.root.className = 'znxstudio-palette';
    this.root.innerHTML = `
      <div class="znxstudio-palette-box">
        <input class="znxstudio-palette-input" type="text" placeholder="Type a command…" data-role="input" />
        <ul class="znxstudio-palette-list" data-role="list"></ul>
      </div>
    `;
    this.input = this.root.querySelector<HTMLInputElement>('[data-role="input"]')!;
    this.list = this.root.querySelector<HTMLElement>('[data-role="list"]')!;

    // Screen-reader semantics (Phase 20J WI4): a modal combobox over a listbox.
    markDialog(this.root, 'Command Palette');
    markListbox(this.list, 'znxstudio-palette-listbox', 'Commands');
    markCombobox(this.input, 'znxstudio-palette-listbox');

    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.hide();
    });
    this.input.addEventListener('input', () => this.filter(this.input.value));
    this.input.addEventListener('keydown', (event) => this.onInputKey(event));

    document.body.appendChild(this.root);
  }

  private toggle(): void {
    if (this.open) this.hide(); else this.show();
  }

  private show(): void {
    if (this.open) {
      this.input.focus();
      this.input.select();
      return;
    }
    this.entries = this.commands
      .list()
      .filter((command) => !HIDDEN.has(command.id))
      .sort((a, b) => a.title.localeCompare(b.title));
    this.open = true;
    this.releaseOverlay = claimOverlay(this, () => this.hide());
    this.restoreFocus = captureFocus();
    this.root.classList.add('is-open');
    this.input.value = '';
    this.filter('');
    this.input.focus();
  }

  private hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
    this.releaseOverlay?.();
    this.releaseOverlay = undefined;
    setActiveDescendant(this.input, null);
    // Return focus to wherever it was before the palette opened.
    this.restoreFocus?.();
    this.restoreFocus = undefined;
  }

  private filter(query: string): void {
    const needle = query.trim().toLowerCase();
    this.filtered = needle
      ? this.entries.filter(
          (entry) =>
            entry.title.toLowerCase().includes(needle) || entry.id.toLowerCase().includes(needle),
        )
      : this.entries;
    this.selection = 0;
    this.renderList();
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (this.filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'znxstudio-palette-empty';
      empty.textContent = 'No matching commands.';
      this.list.appendChild(empty);
      setActiveDescendant(this.input, null);
      return;
    }
    this.filtered.forEach((entry, index) => {
      const item = document.createElement('li');
      const selected = index === this.selection;
      item.className = `znxstudio-palette-item${selected ? ' is-selected' : ''}${entry.enabled ? '' : ' is-disabled'}`;
      markOption(item, `znxstudio-palette-opt-${index}`, selected);
      if (!entry.enabled) item.setAttribute('aria-disabled', 'true');
      item.innerHTML = `<span class="znxstudio-palette-title"></span><span class="znxstudio-palette-id"></span>`;
      item.querySelector('.znxstudio-palette-title')!.textContent = entry.title;
      item.querySelector('.znxstudio-palette-id')!.textContent = entry.id;
      item.addEventListener('click', () => this.run(entry));
      this.list.appendChild(item);
    });
    // Announce the highlighted option to assistive tech.
    setActiveDescendant(this.input, this.filtered.length ? `znxstudio-palette-opt-${this.selection}` : null);
    this.list.querySelector<HTMLElement>('.znxstudio-palette-item.is-selected')?.scrollIntoView({ block: 'nearest' });
  }

  private onInputKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selection = Math.min(this.selection + 1, this.filtered.length - 1);
      this.renderList();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selection = Math.max(this.selection - 1, 0);
      this.renderList();
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = this.filtered[this.selection];
      if (entry) this.run(entry);
    }
  }

  private run(entry: Entry): void {
    this.hide();
    if (!entry.enabled) {
      this.layout.showToast(`“${entry.title}” is not available in the current context.`, 'info');
      return;
    }
    void this.commands.execute(entry.id).catch((error) => {
      const detail = error instanceof Error ? error.message : String(error);
      this.layout.showToast(`Could not run “${entry.title}”: ${detail}`, 'error');
    });
  }
}
