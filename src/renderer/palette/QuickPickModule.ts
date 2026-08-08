import type { IModule, ModuleContext } from '../core/Module';
import {
  ServiceKeys,
  type QuickPickItem,
  type QuickPickOptions,
  type QuickPickService,
} from '../core/Contracts';
import { captureFocus, markCombobox, markDialog, markListbox, markOption, setActiveDescendant } from '../ui/ariaListbox';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { claimOverlay } from '../ui/overlayCoordinator';

/**
 * A reusable, command-palette-style chooser (`ServiceKeys.QuickPick`). Any module
 * can call `pick(items)` to present a filterable, keyboard-operable modal list —
 * the same overlay chrome and ARIA as the command palette — and await the chosen
 * value. The terminal's shell picker is the first consumer, so choosing a shell
 * from Ctrl+Shift+P works like every other palette in the IDE.
 */
export class QuickPickModule implements IModule, QuickPickService {
  readonly id = 'znxstudio.quickpick';
  readonly displayName = 'Quick Pick';

  private root!: HTMLElement;
  private input!: HTMLInputElement;
  private list!: HTMLElement;
  private items: QuickPickItem[] = [];
  private filtered: QuickPickItem[] = [];
  private selection = 0;
  private open = false;
  private restoreFocus: (() => void) | undefined;
  /** Resolver for the in-flight pick; called once with the value or undefined. */
  private settle: ((value: unknown) => void) | null = null;
  private releaseOverlay: (() => void) | undefined;

  activate(context: ModuleContext): void {
    context.services.register<QuickPickService>(ServiceKeys.QuickPick, this);
    this.buildDom();

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && this.open) this.resolve(undefined);
    };
    window.addEventListener('keydown', onKeyDown, true);
    context.subscriptions.push({
      dispose: () => {
        window.removeEventListener('keydown', onKeyDown, true);
        this.resolve(undefined);
        this.root.remove();
      },
    });

    void selfTestCoordinator.run('quickpick', () => this.maybeSelfTest());
  }

  /** Present the chooser and resolve with the chosen value (or undefined). */
  pick<T>(items: QuickPickItem<T>[], options: QuickPickOptions = {}): Promise<T | undefined> {
    // Only one pick at a time: cancel any prior overlay before opening a new one.
    if (this.open) this.resolve(undefined);
    this.items = items as QuickPickItem[];
    this.input.placeholder = options.placeholder ?? 'Type to filter…';
    this.open = true;
    this.releaseOverlay = claimOverlay(this, () => this.resolve(undefined));
    this.restoreFocus = captureFocus();
    this.root.classList.add('is-open');
    this.input.value = '';
    this.filter('');
    this.input.focus();
    return new Promise<T | undefined>((resolve) => {
      this.settle = resolve as (value: unknown) => void;
    });
  }

  private buildDom(): void {
    this.root = document.createElement('div');
    // Reuse the palette's chrome so quick-picks look identical to the palette.
    this.root.className = 'znxstudio-palette';
    this.root.innerHTML = `
      <div class="znxstudio-palette-box">
        <input class="znxstudio-palette-input" type="text" data-role="input" />
        <ul class="znxstudio-palette-list" data-role="list"></ul>
      </div>
    `;
    this.input = this.root.querySelector<HTMLInputElement>('[data-role="input"]')!;
    this.list = this.root.querySelector<HTMLElement>('[data-role="list"]')!;

    markDialog(this.root, 'Quick Pick');
    markListbox(this.list, 'znxstudio-quickpick-listbox', 'Choices');
    markCombobox(this.input, 'znxstudio-quickpick-listbox');
    // The placeholder is set per-pick, so give the input a stable accessible name.
    this.input.setAttribute('aria-label', 'Quick pick filter');

    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.resolve(undefined);
    });
    this.input.addEventListener('input', () => this.filter(this.input.value));
    this.input.addEventListener('keydown', (event) => this.onInputKey(event));

    document.body.appendChild(this.root);
  }

  private filter(query: string): void {
    const needle = query.trim().toLowerCase();
    this.filtered = needle
      ? this.items.filter(
          (item) =>
            item.label.toLowerCase().includes(needle) ||
            (item.description?.toLowerCase().includes(needle) ?? false),
        )
      : this.items;
    this.selection = 0;
    this.renderList();
  }

  private renderList(): void {
    this.list.replaceChildren();
    if (this.filtered.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'znxstudio-palette-empty';
      empty.textContent = 'No matching choices.';
      this.list.appendChild(empty);
      setActiveDescendant(this.input, null);
      return;
    }
    this.filtered.forEach((item, index) => {
      const selected = index === this.selection;
      const row = document.createElement('li');
      row.className = `znxstudio-palette-item${selected ? ' is-selected' : ''}`;
      markOption(row, `znxstudio-quickpick-opt-${index}`, selected);
      row.innerHTML = `<span class="znxstudio-palette-title"></span><span class="znxstudio-palette-id"></span>`;
      row.querySelector('.znxstudio-palette-title')!.textContent = item.label;
      row.querySelector('.znxstudio-palette-id')!.textContent = item.description ?? '';
      row.addEventListener('click', () => this.resolve(item.value));
      this.list.appendChild(row);
    });
    setActiveDescendant(this.input, this.filtered.length ? `znxstudio-quickpick-opt-${this.selection}` : null);
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
      const item = this.filtered[this.selection];
      this.resolve(item ? item.value : undefined);
    }
  }

  /** Close the overlay and settle the pending promise exactly once. */
  private resolve(value: unknown): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('is-open');
    this.releaseOverlay?.();
    this.releaseOverlay = undefined;
    setActiveDescendant(this.input, null);
    this.restoreFocus?.();
    this.restoreFocus = undefined;
    const settle = this.settle;
    this.settle = null;
    settle?.(value);
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
    const log = (message: string): void => console.info(`[selftest] ${message}`);

    const picked = this.pick(
      [
        { label: 'PowerShell', description: 'powershell.exe', value: 'powershell' },
        { label: 'Git Bash', description: 'bash.exe', value: 'git-bash' },
      ],
      { placeholder: 'Select a shell' },
    );
    const role = this.root.getAttribute('role');
    const modal = this.root.getAttribute('aria-modal');
    const rows = this.list.querySelectorAll('[role="option"]').length;
    const active = this.input.getAttribute('aria-activedescendant');
    // Filter to a single match, then Enter to choose it.
    this.input.value = 'git';
    this.filter('git');
    const filteredRows = this.list.querySelectorAll('[role="option"]').length;
    this.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    const chosen = await picked;
    log(
      `quickpick REAL DOM: dialog=${role}/${modal} rows=${rows} activedescendant=${active ? 'set' : 'none'} ` +
        `filteredTo=${filteredRows} chose=${chosen} (expect dialog/true, 2 rows, filter→1, chose git-bash)`,
    );
  }
}
