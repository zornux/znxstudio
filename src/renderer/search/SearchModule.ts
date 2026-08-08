import * as monaco from 'monaco-editor';
import { ServiceKeys, type EditorService, type WorkspaceService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { buildSearchRegex } from '../../shared/textSearch';
import { expandReplacement, replaceAll } from '../../shared/textReplace';
import type { ReplaceFileResult, SearchFileResult, SearchSymbolHit } from '../../shared/types';

/** Grow a search textarea to fit its content, up to a few rows, then scroll. */
const SEARCH_FIELD_MAX_HEIGHT = 120;
function autosize(field: HTMLTextAreaElement): void {
  field.style.height = 'auto';
  const next = Math.min(field.scrollHeight, SEARCH_FIELD_MAX_HEIGHT);
  field.style.height = `${next}px`;
  field.style.overflowY = field.scrollHeight > SEARCH_FIELD_MAX_HEIGHT ? 'auto' : 'hidden';
}

const KIND_ICON: Record<string, string> = {
  function: '🔧',
  class: '🏛',
  record: '🧱',
  type: '📐',
  module: '📥',
  policy: '🛡',
  service: '🌐',
  configuration: '⚙',
  variable: '📦',
};

/**
 * Find in Files / Symbols (Phase 7A). A sidebar search view backed by the
 * main-process SearchService: grep-style text search (with case / whole-word /
 * regex options) and a workspace symbol search, both over the primary folder.
 * Results are click-to-navigate.
 */
export class SearchModule implements IModule {
  readonly id = 'znxstudio.search';
  readonly displayName = 'Search';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private results!: HTMLElement;
  private input?: HTMLTextAreaElement;
  private replaceInput?: HTMLTextAreaElement;
  private mode: 'text' | 'symbols' = 'text';
  private caseSensitive = false;
  private wholeWord = false;
  private isRegex = false;
  private readonly excluded = new Set<string>();
  private lastPreview: ReplaceFileResult[] = [];

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.results = document.createElement('div');
    this.results.className = 'znxstudio-search-results';

    context.commands.register(CommandIds.SearchShow, () => this.reveal(), 'Search: Find in Files');
    context.layout.addActivityItem({
      id: 'search',
      label: 'Search',
      icon: '⌕',
      onSelect: () => this.reveal(),
    });

    void selfTestCoordinator.run('search', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.setSideBar('Search', this.shell());
    this.context.layout.focusSideBar();
    this.input?.focus();
  }

  private shell(): HTMLElement {
    const shell = document.createElement('div');
    shell.className = 'znxstudio-search';

    const input = this.searchField('Search…', this.input?.value ?? '');
    this.input = input;

    const replace = this.searchField('Replace… (leave blank to search only)', this.replaceInput?.value ?? '');
    this.replaceInput = replace;

    const options = document.createElement('div');
    options.className = 'znxstudio-search-options';
    options.append(
      this.toggle('Aa', 'Match case', () => this.caseSensitive, (v) => (this.caseSensitive = v)),
      this.toggle('⌗', 'Whole word', () => this.wholeWord, (v) => (this.wholeWord = v)),
      this.toggle('.*', 'Regular expression', () => this.isRegex, (v) => (this.isRegex = v)),
    );

    const modes = document.createElement('div');
    modes.className = 'znxstudio-search-modes';
    modes.append(
      this.modeButton('Text', 'text'),
      this.modeButton('Symbols', 'symbols'),
    );

    shell.append(input, replace, options, modes, this.results);
    return shell;
  }

  /**
   * A VS Code-style search field: a textarea that grows with its content (up to a few
   * rows, then scrolls) rather than a fixed single line, so long queries and multi-line
   * regex stay fully visible. Enter runs the search; Shift+Enter inserts a newline.
   */
  private searchField(placeholder: string, value: string): HTMLTextAreaElement {
    const field = document.createElement('textarea');
    field.className = 'znxstudio-input znxstudio-search-field';
    field.placeholder = placeholder;
    field.rows = 1;
    field.value = value;
    field.spellcheck = false;
    field.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.run();
      }
    });
    field.addEventListener('input', () => autosize(field));
    // Fit the restored value once the field is attached to the DOM.
    queueMicrotask(() => autosize(field));
    return field;
  }

  private toggle(label: string, title: string, get: () => boolean, set: (v: boolean) => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'znxstudio-search-toggle';
    button.textContent = label;
    button.title = title;
    button.classList.toggle('is-on', get());
    button.addEventListener('click', () => {
      set(!get());
      button.classList.toggle('is-on', get());
      void this.run();
    });
    return button;
  }

  private modeButton(label: string, mode: 'text' | 'symbols'): HTMLButtonElement {
    const button = document.createElement('button');
    button.className = 'znxstudio-search-mode';
    button.textContent = label;
    button.classList.toggle('is-active', this.mode === mode);
    button.addEventListener('click', () => {
      this.mode = mode;
      for (const el of button.parentElement?.children ?? []) el.classList.toggle('is-active', el === button);
      void this.run();
    });
    return button;
  }

  private async run(): Promise<void> {
    const query = this.input?.value.trim() ?? '';
    const root = this.workspace.currentFolder();
    if (!root) {
      this.renderMessage('Open a folder to search.');
      return;
    }
    if (!query) {
      this.results.replaceChildren();
      return;
    }
    this.renderMessage('Searching…');
    this.excluded.clear();

    try {
      if (this.mode === 'symbols') {
        const result = await window.znxstudio.search.symbols({ root, query });
        this.renderSymbols(result.symbols, result.truncated);
        return;
      }

      const opts = { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord, isRegex: this.isRegex };
      const replacement = this.replaceInput?.value ?? '';
      if (replacement) {
        const preview = await window.znxstudio.search.previewReplace({ root, query, replacement, ...opts });
        this.lastPreview = preview.files;
        this.renderReplacePreview(preview.files, preview.totalMatches, preview.truncated);
      } else {
        const result = await window.znxstudio.search.text({ root, query, ...opts });
        this.renderText(result.files, result.totalMatches, result.truncated);
      }
    } catch (error) {
      // Never leave the panel stuck on "Searching…" or drop an unhandled rejection.
      this.renderMessage(`Search failed: ${(error as Error).message}`);
    }
  }

  /* ----- rendering ----- */

  private renderMessage(message: string): void {
    const el = document.createElement('div');
    el.className = 'znxstudio-search-status';
    el.textContent = message;
    this.results.replaceChildren(el);
  }

  private renderText(files: SearchFileResult[], total: number, truncated: boolean): void {
    if (files.length === 0) {
      this.renderMessage('No results.');
      return;
    }
    const fragment = document.createDocumentFragment();
    const summary = document.createElement('div');
    summary.className = 'znxstudio-search-status';
    summary.textContent = `${total} match${total === 1 ? '' : 'es'} in ${files.length} file${files.length === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`;
    fragment.appendChild(summary);

    for (const file of files) {
      const group = document.createElement('div');
      group.className = 'znxstudio-search-file';
      const header = document.createElement('div');
      header.className = 'znxstudio-tree-row znxstudio-search-file-header';
      header.textContent = `${this.basename(file.file)}  ·  ${file.matches.length}`;
      header.title = file.file;
      group.appendChild(header);
      for (const match of file.matches) group.appendChild(this.matchRow(file.file, match.line, match.text, match.ranges));
      fragment.appendChild(group);
    }
    this.results.replaceChildren(fragment);
  }

  private matchRow(file: string, line: number, text: string, ranges: [number, number][]): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-search-match';
    const num = document.createElement('span');
    num.className = 'znxstudio-search-lineno';
    num.textContent = String(line + 1);
    const body = document.createElement('span');
    body.className = 'znxstudio-search-linetext';
    this.highlight(body, text, ranges);
    row.append(num, body);
    row.addEventListener('click', () => void this.open(file, line, ranges[0]?.[0] ?? 0));
    return row;
  }

  /** Render `text` with the matched ranges wrapped in <mark> (or <del> for a removed preview). */
  private highlight(host: HTMLElement, text: string, ranges: [number, number][], tag: 'mark' | 'del' = 'mark'): void {
    let cursor = 0;
    for (const [start, end] of ranges) {
      if (start > cursor) host.appendChild(document.createTextNode(text.slice(cursor, start)));
      const el = document.createElement(tag);
      el.textContent = text.slice(start, end);
      host.appendChild(el);
      cursor = end;
    }
    if (cursor < text.length) host.appendChild(document.createTextNode(text.slice(cursor)));
  }

  /* ----- replace (7B) ----- */

  private renderReplacePreview(files: ReplaceFileResult[], total: number, truncated: boolean): void {
    if (files.length === 0) {
      this.renderMessage('No results.');
      return;
    }
    const fragment = document.createDocumentFragment();

    const bar = document.createElement('div');
    bar.className = 'znxstudio-search-replacebar';
    const summary = document.createElement('span');
    summary.className = 'znxstudio-search-status';
    summary.textContent = `${total} match${total === 1 ? '' : 'es'} in ${files.length} file${files.length === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`;
    const apply = document.createElement('button');
    apply.className = 'znxstudio-btn primary znxstudio-btn-small';
    apply.textContent = 'Replace All';
    apply.addEventListener('click', () => void this.applyReplaceAll());
    bar.append(summary, apply);
    fragment.appendChild(bar);

    for (const file of files) {
      const group = document.createElement('div');
      group.className = 'znxstudio-search-file';

      const header = document.createElement('div');
      header.className = 'znxstudio-tree-row znxstudio-search-file-header';
      const check = document.createElement('input');
      check.type = 'checkbox';
      check.checked = !this.excluded.has(file.file);
      check.addEventListener('change', () => {
        if (check.checked) this.excluded.delete(file.file);
        else this.excluded.add(file.file);
      });
      const name = document.createElement('span');
      name.textContent = `${this.basename(file.file)}  ·  ${file.matches.length}`;
      name.title = file.file;
      header.append(check, name);
      group.appendChild(header);

      for (const match of file.matches) {
        const block = document.createElement('div');
        block.className = 'znxstudio-search-replace-block';
        const oldLine = document.createElement('div');
        oldLine.className = 'znxstudio-search-match znxstudio-search-old';
        oldLine.appendChild(this.lineNo(match.line));
        const oldText = document.createElement('span');
        oldText.className = 'znxstudio-search-linetext';
        this.highlight(oldText, match.text, match.ranges, 'del');
        oldLine.appendChild(oldText);
        oldLine.addEventListener('click', () => void this.open(file.file, match.line, match.ranges[0]?.[0] ?? 0));

        const newLine = document.createElement('div');
        newLine.className = 'znxstudio-search-match znxstudio-search-new';
        newLine.appendChild(this.lineNo(match.line));
        const newText = document.createElement('span');
        newText.className = 'znxstudio-search-linetext';
        newText.textContent = match.newText;
        newLine.appendChild(newText);

        block.append(oldLine, newLine);
        group.appendChild(block);
      }
      fragment.appendChild(group);
    }
    this.results.replaceChildren(fragment);
  }

  private lineNo(line: number): HTMLElement {
    const num = document.createElement('span');
    num.className = 'znxstudio-search-lineno';
    num.textContent = String(line + 1);
    return num;
  }

  private async applyReplaceAll(): Promise<void> {
    const query = this.input?.value.trim() ?? '';
    const root = this.workspace.currentFolder();
    const replacement = this.replaceInput?.value ?? '';
    if (!root || !query) return;

    const opts = { caseSensitive: this.caseSensitive, wholeWord: this.wholeWord, isRegex: this.isRegex };
    const regex = buildSearchRegex(query, opts);
    if (!regex) {
      this.context.layout.showToast('Invalid search pattern.', 'error');
      return;
    }
    const targets = this.lastPreview.map((f) => f.file).filter((f) => !this.excluded.has(f));
    if (targets.length === 0) {
      this.context.layout.showToast('No files selected.', 'error');
      return;
    }

    // Open files are edited through their editor model (never clobber unsaved
    // changes; live + undoable); closed files are rewritten on disk.
    const documents = this.context.services.tryGet<DocumentManager>(LanguageServiceKeys.Documents);
    const expanded = expandReplacement(replacement, this.isRegex);
    const closed: string[] = [];
    let openEdited = 0;

    for (const path of targets) {
      const uri = monaco.Uri.file(path).toString();
      const managed = documents?.getManaged(uri);
      if (managed) {
        if (this.editModel(managed.model, query, opts, expanded)) openEdited += 1;
      } else {
        closed.push(path);
      }
    }

    let filesChanged = openEdited;
    let replacements = 0;
    if (closed.length) {
      try {
        const result = await window.znxstudio.search.applyReplace({ root, query, replacement, ...opts, files: closed });
        filesChanged += result.filesChanged;
        replacements += result.replacements;
      } catch (error) {
        this.context.layout.showToast(`Replace failed: ${(error as Error).message}`, 'error');
        return;
      }
    }

    this.context.layout.showToast(
      `Replaced in ${filesChanged} file${filesChanged === 1 ? '' : 's'}${openEdited ? ` (${openEdited} open editor${openEdited === 1 ? '' : 's'})` : ''}.`,
      'success',
    );
    void this.run(); // refresh preview
  }

  /** Apply the replacement to an open model as a single undoable edit. */
  private editModel(
    model: monaco.editor.ITextModel,
    query: string,
    opts: { caseSensitive: boolean; wholeWord: boolean; isRegex: boolean },
    expanded: string,
  ): boolean {
    const regex = buildSearchRegex(query, opts);
    if (!regex) return false;
    const value = model.getValue();
    const { text, count } = replaceAll(value, regex, expanded);
    if (count === 0 || text === value) return false;
    model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
    return true;
  }

  private renderSymbols(symbols: SearchSymbolHit[], truncated: boolean): void {
    if (symbols.length === 0) {
      this.renderMessage('No symbols.');
      return;
    }
    const fragment = document.createDocumentFragment();
    const summary = document.createElement('div');
    summary.className = 'znxstudio-search-status';
    summary.textContent = `${symbols.length} symbol${symbols.length === 1 ? '' : 's'}${truncated ? ' (truncated)' : ''}`;
    fragment.appendChild(summary);

    for (const symbol of symbols) {
      const row = document.createElement('div');
      row.className = 'znxstudio-tree-row znxstudio-search-symbol';
      const icon = document.createElement('span');
      icon.className = 'znxstudio-icon';
      icon.textContent = KIND_ICON[symbol.kind] ?? '•';
      const name = document.createElement('span');
      name.className = 'znxstudio-search-symbol-name';
      name.textContent = symbol.name;
      const location = document.createElement('span');
      location.className = 'znxstudio-search-symbol-loc';
      location.textContent = `${this.basename(symbol.file)}:${symbol.line + 1}`;
      row.append(icon, name, location);
      row.title = `${symbol.kind} · ${symbol.file}`;
      row.addEventListener('click', () => void this.open(symbol.file, symbol.line, symbol.col));
      fragment.appendChild(row);
    }
    this.results.replaceChildren(fragment);
  }

  private async open(file: string, line: number, col: number): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    await editor.openFile(file);
    editor.revealPosition(line, col);
  }

  private basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
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

    const root = 'C:\\Studio Apps\\xojin\\examples';
    try {
      const text = await window.znxstudio.search.text({ root, query: 'publish', wholeWord: true });
      const first = text.files[0];
      log(`search text('publish'): files=${text.files.length} matches=${text.totalMatches} scanned=${text.filesScanned} first=${first ? `${first.file.split(/[\\/]/).pop()}:${(first.matches[0].line ?? 0) + 1}` : '-'}`);

      const regex = await window.znxstudio.search.text({ root, query: 'on port \\d+', isRegex: true });
      log(`search regex('on port \\\\d+'): files=${regex.files.length} matches=${regex.totalMatches}`);

      const symbols = await window.znxstudio.search.symbols({ root, query: 'Greeter' });
      const hit = symbols.symbols[0];
      log(`search symbols('Greeter'): count=${symbols.symbols.length} first=${hit ? `${hit.kind} ${hit.name} @ ${hit.file.split(/[\\/]/).pop()}:${hit.line + 1}` : '-'}`);

      const allServices = await window.znxstudio.search.symbols({ root, query: '' });
      const kinds = [...new Set(allServices.symbols.map((s) => s.kind))].sort();
      log(`search symbols(all): count=${allServices.symbols.length} kinds=[${kinds.join(',')}]`);

      // 7B: preview + apply replace in an ISOLATED temp dir (never the repo).
      // fs.writeFile can't mkdir — the dir is pre-created by the harness.
      const tmp = 'C:\\Users\\jerem\\AppData\\Local\\Temp\\znxstudio-7b';
      await window.znxstudio.fs.writeFile(`${tmp}\\sample.zx`, 'create x = 1\ncreate y = 2\n');
      const preview = await window.znxstudio.search.previewReplace({ root: tmp, query: 'create', replacement: 'make' });
      log(`replace preview: files=${preview.files.length} matches=${preview.totalMatches} newLine="${preview.files[0]?.matches[0]?.newText ?? '-'}"`);
      const applied = await window.znxstudio.search.applyReplace({ root: tmp, query: 'create', replacement: 'make' });
      const after = await window.znxstudio.fs.readFile(`${tmp}\\sample.zx`);
      log(`replace apply: filesChanged=${applied.filesChanged} replacements=${applied.replacements} content="${after.replace(/\n/g, '\\n')}"`);

      // Regex replace with a capture group.
      await window.znxstudio.fs.writeFile(`${tmp}\\sample.zx`, 'create alpha = 1\n');
      const rx = await window.znxstudio.search.applyReplace({ root: tmp, query: 'create (\\w+)', replacement: 'let $1', isRegex: true });
      const rxAfter = await window.znxstudio.fs.readFile(`${tmp}\\sample.zx`);
      log(`replace regex($1): filesChanged=${rx.filesChanged} content="${rxAfter.trim()}"`);
    } catch (error) {
      log(`search self-test failed: ${(error as Error).message}`);
    }
  }
}
