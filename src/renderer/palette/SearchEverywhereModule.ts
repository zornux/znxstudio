import { ServiceKeys, type EditorService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import type { CommandRegistry } from '../commands/CommandRegistry';
import { CommandIds } from '../commands/CommandIds';
import { captureFocus, markCombobox, markDialog, markListbox, markOption, setActiveDescendant } from '../ui/ariaListbox';
import { SETTINGS_DESCRIPTIONS } from '../settings/SettingsSchema';
import { LanguageServiceKeys, type DocumentSymbol } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import type { LanguageRegistry } from '../language/LanguageRegistry';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  CATEGORY_SIGIL,
  flattenGroups,
  searchEverywhere,
  type RankedHit,
  type ResultCategory,
  type SearchCandidate,
  type SearchScope,
} from './searchEverywhere';

/** Commands that are internal plumbing — hidden from every search surface. */
const HIDDEN_COMMANDS = new Set<string>([CommandIds.RunScript]);

interface CandidateAction {
  candidate: SearchCandidate;
  run: () => void | Promise<void>;
}

/**
 * Search Everywhere (UX-4). One overlay (Ctrl+Shift+A) that reaches every corner
 * of the IDE — commands, workspace files, the active file's symbols, settings and
 * views — so no feature is buried. It reuses the same registries the rest of the
 * shell exposes (the command bus, the search walker, the language registry, the
 * activity bar) rather than knowing any feature module directly, and the ranking
 * / grouping decisions live in the pure `searchEverywhere` model.
 *
 * The Command Palette (Ctrl+Shift+P) stays as the commands-only view; this is the
 * superset for people who don't want to remember which picker holds what.
 */
export class SearchEverywhereModule implements IModule {
  readonly id = 'znxstudio.searchEverywhere';
  readonly displayName = 'Search Everywhere';

  private context!: ModuleContext;
  private commands!: CommandRegistry;

  private root!: HTMLElement;
  private input!: HTMLInputElement;
  private tabsEl!: HTMLElement;
  private listEl!: HTMLElement;

  private open = false;
  private restoreFocus: (() => void) | undefined;
  private scope: SearchScope = 'all';
  private selection = 0;
  private hits: RankedHit[] = [];
  /** Per-open snapshot: every candidate + how to run it, keyed `category::id`. */
  private actions = new Map<string, CandidateAction>();

  activate(context: ModuleContext): void {
    this.context = context;
    this.commands = context.commands;

    context.commands.register(
      CommandIds.SearchEverywhere,
      () => void this.show(),
      'Go: Search Everywhere',
    );

    this.buildDom();

    // Ctrl+Shift+A is dispatched by the KeybindingService (17D) so it stays
    // rebindable; Escape merely dismisses whatever overlay is open.
    window.addEventListener(
      'keydown',
      (event) => {
        if (event.key === 'Escape' && this.open) this.hide();
      },
      true,
    );

    void selfTestCoordinator.run('searcheverywhere', () => this.maybeSelfTest());
  }

  private buildDom(): void {
    this.root = document.createElement('div');
    this.root.className = 'znxstudio-everywhere';
    this.root.innerHTML = `
      <div class="znxstudio-everywhere-box">
        <div class="znxstudio-everywhere-tabs" data-role="tabs"></div>
        <input class="znxstudio-everywhere-input" type="text"
               placeholder="Search everywhere — commands, files, symbols, settings…" data-role="input" />
        <div class="znxstudio-everywhere-list" data-role="list"></div>
      </div>
    `;
    this.input = this.root.querySelector<HTMLInputElement>('[data-role="input"]')!;
    this.tabsEl = this.root.querySelector<HTMLElement>('[data-role="tabs"]')!;
    this.listEl = this.root.querySelector<HTMLElement>('[data-role="list"]')!;

    // Screen-reader semantics (Phase 20J WI4): modal combobox over a listbox.
    markDialog(this.root, 'Search Everywhere');
    markListbox(this.listEl, 'znxstudio-everywhere-listbox', 'Results');
    markCombobox(this.input, 'znxstudio-everywhere-listbox');

    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.hide();
    });
    this.input.addEventListener('input', () => this.refresh());
    this.input.addEventListener('keydown', (event) => this.onInputKey(event));

    this.renderTabs();
    document.body.appendChild(this.root);
  }

  /* ----- lifecycle ----- */

  private async show(scope: SearchScope = 'all'): Promise<void> {
    this.scope = scope;
    await this.collectCandidates();
    this.open = true;
    this.restoreFocus = captureFocus();
    this.root.classList.add('is-open');
    this.input.value = scope !== 'all' ? (CATEGORY_SIGIL[scope] ?? '') : '';
    this.renderTabs();
    this.refresh();
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private hide(): void {
    this.open = false;
    this.root.classList.remove('is-open');
    setActiveDescendant(this.input, null);
    this.restoreFocus?.();
    this.restoreFocus = undefined;
    this.actions.clear();
  }

  /* ----- candidate collection (per open) ----- */

  private async collectCandidates(): Promise<void> {
    this.actions.clear();
    this.addCommands();
    this.addSettings();
    this.addViews();
    await this.addFiles();
    await this.addSymbols();
  }

  private register(candidate: SearchCandidate, run: () => void | Promise<void>): void {
    this.actions.set(`${candidate.category}::${candidate.id}`, { candidate, run });
  }

  private addCommands(): void {
    for (const command of this.commands.list()) {
      if (HIDDEN_COMMANDS.has(command.id)) continue;
      this.register(
        {
          category: 'commands',
          id: command.id,
          label: command.title,
          detail: command.enabled ? command.id : `${command.id} · unavailable`,
          keywords: command.id,
        },
        () => {
          if (!this.commands.isEnabled(command.id)) {
            this.context.layout.showToast(`“${command.title}” is not available in the current context.`, 'info');
            return;
          }
          void this.commands.execute(command.id);
        },
      );
    }
  }

  private addSettings(): void {
    for (const setting of SETTINGS_DESCRIPTIONS) {
      this.register(
        { category: 'settings', id: setting.key, label: setting.key, detail: setting.description, keywords: setting.description },
        () => void this.commands.execute(CommandIds.SettingsOpen),
      );
    }
  }

  private addViews(): void {
    for (const item of this.context.layout.activityItemsList()) {
      this.register(
        { category: 'views', id: item.id, label: item.label, detail: 'View', keywords: item.id },
        () => this.context.layout.selectActivityById(item.id),
      );
    }
  }

  private async addFiles(): Promise<void> {
    const workspace = this.context.services.tryGet<WorkspaceService>(ServiceKeys.Workspace);
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const root = workspace?.currentFolder();
    if (!root || !editor) return;
    let files: string[];
    try {
      files = await window.znxstudio.search.files(root);
    } catch {
      return;
    }
    const rootLen = root.replace(/[\\/]+$/, '').length + 1;
    for (const path of files) {
      const relative = path.slice(rootLen).replace(/\\/g, '/');
      const name = relative.split('/').pop() ?? relative;
      this.register(
        { category: 'files', id: path, label: name, detail: relative, keywords: relative },
        () => void editor.openFile(path, { preview: true }),
      );
    }
  }

  private async addSymbols(): Promise<void> {
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    const registry = this.context.services.tryGet<LanguageRegistry>(LanguageServiceKeys.Registry);
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const active = documents?.getActive();
    if (!active || !registry || !editor) return;
    const service = registry.get(active.languageId);
    if (!service || !registry.isActive(active.languageId) || !service.documentSymbols) return;

    let symbols: DocumentSymbol[];
    try {
      symbols = await service.documentSymbols.provideDocumentSymbols(active.document);
    } catch {
      return;
    }

    let index = 0;
    const walk = (nodes: DocumentSymbol[], trail: string): void => {
      for (const symbol of nodes) {
        const id = `sym-${index++}`;
        const position = symbol.selectionRange.start;
        this.register(
          {
            category: 'symbols',
            id,
            label: symbol.name,
            detail: trail ? `${symbol.kind} · ${trail}` : symbol.kind,
            keywords: symbol.kind,
          },
          () => editor.revealPosition(position.line, position.character),
        );
        if (symbol.children?.length) walk(symbol.children, trail ? `${trail} › ${symbol.name}` : symbol.name);
      }
    };
    walk(symbols, '');
  }

  /* ----- rendering ----- */

  private setScope(scope: SearchScope): void {
    this.scope = scope;
    const sigil = scope === 'all' ? '' : (CATEGORY_SIGIL[scope] ?? '');
    // A sigil-scoped category prefills the sigil; a non-sigil one (files/views)
    // keeps the raw term and relies on the explicit scope.
    const term = this.termWithoutSigil();
    this.input.value = sigil ? `${sigil}${term}` : term;
    this.renderTabs();
    this.refresh();
    this.input.focus();
    this.input.setSelectionRange(this.input.value.length, this.input.value.length);
  }

  private termWithoutSigil(): string {
    const value = this.input.value;
    const sigil = value[0];
    return sigil && Object.values(CATEGORY_SIGIL).includes(sigil) ? value.slice(1).trimStart() : value.trim();
  }

  private renderTabs(): void {
    const scopes: SearchScope[] = ['all', ...CATEGORY_ORDER];
    this.tabsEl.replaceChildren();
    for (const scope of scopes) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = `znxstudio-everywhere-tab${scope === this.scope ? ' is-active' : ''}`;
      tab.textContent = scope === 'all' ? 'All' : CATEGORY_LABEL[scope as ResultCategory];
      tab.dataset.scope = scope;
      tab.addEventListener('click', () => this.setScope(scope));
      this.tabsEl.appendChild(tab);
    }
  }

  private refresh(): void {
    const candidates = [...this.actions.values()].map((action) => action.candidate);
    const { parsed, groups } = searchEverywhere(this.input.value, candidates, this.scope);
    // A sigil in the box drives the active tab so the UI agrees with the parse.
    if (parsed.scope !== this.scope) {
      this.scope = parsed.scope;
      this.renderTabs();
    }
    this.hits = flattenGroups(groups);
    this.selection = 0;

    this.listEl.replaceChildren();
    if (!this.hits.length) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-everywhere-empty';
      empty.textContent = parsed.term ? 'No matches.' : 'Type to search across the IDE.';
      this.listEl.appendChild(empty);
      return;
    }
    let flatIndex = 0;
    for (const group of groups) {
      const header = document.createElement('div');
      header.className = 'znxstudio-everywhere-group';
      header.textContent = group.label;
      this.listEl.appendChild(header);
      for (const hit of group.hits) {
        this.listEl.appendChild(this.renderHit(hit, flatIndex));
        flatIndex += 1;
      }
    }
    this.highlight();
  }

  private renderHit(hit: RankedHit, index: number): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-everywhere-item';
    row.dataset.index = String(index);
    markOption(row, `znxstudio-everywhere-opt-${index}`, index === this.selection);
    const label = document.createElement('span');
    label.className = 'znxstudio-everywhere-label';
    label.textContent = hit.label;
    row.appendChild(label);
    if (hit.detail) {
      const detail = document.createElement('span');
      detail.className = 'znxstudio-everywhere-detail';
      detail.textContent = hit.detail;
      row.appendChild(detail);
    }
    row.addEventListener('click', () => this.run(hit));
    return row;
  }

  private highlight(): void {
    const rows = [...this.listEl.querySelectorAll<HTMLElement>('.znxstudio-everywhere-item')];
    rows.forEach((row, i) => {
      const active = i === this.selection;
      row.classList.toggle('is-selected', active);
      row.setAttribute('aria-selected', String(active));
    });
    setActiveDescendant(this.input, rows.length ? `znxstudio-everywhere-opt-${this.selection}` : null);
    rows[this.selection]?.scrollIntoView({ block: 'nearest' });
  }

  private onInputKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selection = Math.min(this.selection + 1, this.hits.length - 1);
      this.highlight();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selection = Math.max(this.selection - 1, 0);
      this.highlight();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      this.cycleScope(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const hit = this.hits[this.selection];
      if (hit) this.run(hit);
    }
  }

  private cycleScope(delta: number): void {
    const scopes: SearchScope[] = ['all', ...CATEGORY_ORDER];
    const current = scopes.indexOf(this.scope);
    const next = scopes[(current + delta + scopes.length) % scopes.length];
    this.setScope(next);
  }

  private run(hit: RankedHit): void {
    const action = this.actions.get(`${hit.category}::${hit.id}`);
    this.hide();
    void action?.run();
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
      await this.show('all');
      const tabs = this.tabsEl.querySelectorAll('.znxstudio-everywhere-tab').length;
      // Drive the real input the way a user would, then read the rendered DOM.
      this.input.value = '>run';
      this.refresh();
      const scopedTab = this.tabsEl.querySelector('.znxstudio-everywhere-tab.is-active')?.textContent;
      const commandHits = [...this.listEl.querySelectorAll('.znxstudio-everywhere-item')].length;
      const groups = this.listEl.querySelectorAll('.znxstudio-everywhere-group').length;
      log(
        `searcheverywhere REAL DOM: tabs=${tabs} sigil>run→activeTab=${scopedTab} groups=${groups} commandHits=${commandHits}`,
      );
      // And an unscoped term fans across sections.
      this.input.value = 'view';
      this.refresh();
      const allGroups = [...this.listEl.querySelectorAll('.znxstudio-everywhere-group')].map((g) => g.textContent);
      log(`searcheverywhere REAL DOM: term "view" → sections=[${allGroups.join(', ')}]`);
      this.hide();
    } catch (error) {
      log(`searcheverywhere self-test failed: ${(error as Error).message}`);
    }
  }
}
