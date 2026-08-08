import * as monaco from 'monaco-editor';
import {
  ServiceKeys,
  type EditorService,
  type InputBoxService,
  type SettingsService,
  type SnippetService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { Disposable, IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import {
  BUILTIN_SNIPPETS,
  escapeSnippetBody,
  matchSnippets,
  parseUserSnippets,
  renderSnippetPreview,
  snippetsFor,
  type Snippet,
} from './snippets';

const USER_KEY = 'znxstudio.snippets.user';
/** Languages the completion provider offers built-in snippets for. */
const SNIPPET_LANGUAGES = ['zornux'];

/**
 * Snippets (Phase 7F). A snippet system layered on the editor: built-in Zornux
 * idioms (real v1.0 syntax) plus user snippets, offered as IntelliSense
 * completions, insertable from a picker, and creatable from a selection. The
 * module owns no editor state — it drives the Editor service's snippet insert.
 */
export class SnippetsModule implements IModule {
  readonly id = 'znxstudio.snippets';
  readonly displayName = 'Snippets';

  private context!: ModuleContext;
  private editor!: EditorService;
  private documents!: DocumentManager;
  private settings: SettingsService | undefined;
  private userSnippets: Snippet[] = [];
  private externalSnippets: Snippet[] = [];
  private picker: HTMLElement | undefined;
  private savingSelection = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.editor = context.services.get<EditorService>(ServiceKeys.Editor);
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);
    this.settings = context.services.tryGet<SettingsService>(ServiceKeys.Settings);

    this.userSnippets = parseUserSnippets(this.settings?.get<unknown[]>(USER_KEY, []) ?? []);
    if (this.settings) context.subscriptions.push(this.settings.onDidChange((event) => {
      if (event.key === USER_KEY) this.userSnippets = parseUserSnippets(event.value as unknown[]);
    }));

    const snippetService: SnippetService = { addExternal: (snippets) => this.addExternal(snippets) };
    context.services.register<SnippetService>(ServiceKeys.Snippets, snippetService);

    context.subscriptions.push(this.registerProvider());
    context.commands.register(CommandIds.SnippetInsert, () => this.openPicker(), 'Editor: Insert Snippet');
    context.commands.register(
      CommandIds.SnippetSaveSelection,
      () => void this.saveSelection(),
      'Snippets: Save Selection as Snippet',
    );
    context.commands.addEnablementRule((id) => id === CommandIds.SnippetSaveSelection
      ? !this.savingSelection && Boolean(this.editor.selectedText().trim())
      : undefined);

    void selfTestCoordinator.run('snippets', () => this.maybeSelfTest());
  }

  private allSnippets(): Snippet[] {
    return [...BUILTIN_SNIPPETS, ...this.userSnippets, ...this.externalSnippets];
  }

  /** Add extension-contributed snippets; the completion provider reads them live. */
  private addExternal(snippets: Snippet[]): Disposable {
    this.externalSnippets.push(...snippets);
    return {
      dispose: () => {
        for (const snippet of snippets) {
          const index = this.externalSnippets.indexOf(snippet);
          if (index >= 0) this.externalSnippets.splice(index, 1);
        }
      },
    };
  }

  private activeLanguage(): string {
    return this.documents.getActive()?.languageId ?? 'zornux';
  }

  private registerProvider(): monaco.IDisposable {
    return monaco.languages.registerCompletionItemProvider(SNIPPET_LANGUAGES, {
      provideCompletionItems: (model, position) => {
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(
          position.lineNumber,
          word.startColumn,
          position.lineNumber,
          word.endColumn,
        );
        const suggestions = snippetsFor(model.getLanguageId(), this.allSnippets()).map((snippet) => ({
          label: snippet.prefix,
          kind: monaco.languages.CompletionItemKind.Snippet,
          detail: `${snippet.name} — snippet`,
          documentation: { value: '```\n' + renderSnippetPreview(snippet.body) + '\n```' },
          insertText: snippet.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        }));
        return { suggestions };
      },
    });
  }

  private async saveSelection(): Promise<void> {
    if (this.savingSelection) return;
    const text = this.editor.selectedText();
    if (!text.trim()) {
      this.context.layout.showToast('Select some code first, then save it as a snippet.', 'info');
      return;
    }
    const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
    this.savingSelection = true;
    this.context.commands.notifyEnablementChanged();
    let prefix: string | null = null;
    let name: string | null = null;
    try {
      prefix = await input.prompt({
        title: 'Save Selection as Snippet',
        label: 'Trigger prefix',
        value: 'mysnippet',
        placeholder: 'Type this prefix to insert the snippet',
        submitLabel: 'Next',
        validate: (value) => {
          const normalized = value.trim();
          if (!normalized) return 'Enter a snippet prefix.';
          if (/\s/.test(normalized)) return 'The snippet prefix cannot contain spaces.';
          return null;
        },
      });
      if (prefix === null) return;
      prefix = prefix.trim();

      name = await input.prompt({
        title: 'Save Selection as Snippet',
        label: 'Snippet name',
        value: prefix,
        placeholder: 'A descriptive name for this snippet',
        submitLabel: 'Save Snippet',
        validate: (value) => value.trim() ? null : 'Enter a snippet name.',
      });
      if (name === null) return;
      name = name.trim();

      const language = this.activeLanguage();
      const existingIndex = this.userSnippets.findIndex((snippet) =>
        snippet.prefix === prefix && snippet.languages.includes(language));
      if (existingIndex >= 0) {
        const replace = await input.confirm({
          title: 'Replace Snippet?',
          message: `A user snippet with the prefix “${prefix}” already exists for ${language}. Replace it?`,
          confirmLabel: 'Replace',
        });
        if (!replace) return;
      }

      const snippet: Snippet = {
        name,
        prefix,
        description: 'User snippet',
        body: escapeSnippetBody(text),
        languages: [language],
      };
      this.userSnippets = existingIndex >= 0
        ? this.userSnippets.map((entry, index) => index === existingIndex ? snippet : entry)
        : [...this.userSnippets, snippet];
      this.settings?.set(USER_KEY, this.userSnippets);
      this.context.layout.showToast(`${existingIndex >= 0 ? 'Updated' : 'Saved'} snippet “${prefix}” for ${language}.`, 'success');
    } finally {
      this.savingSelection = false;
      this.context.commands.notifyEnablementChanged();
    }
  }

  /* ----- insert picker ----- */
  private openPicker(): void {
    const language = this.activeLanguage();
    const available = snippetsFor(language, this.allSnippets());
    if (available.length === 0) {
      this.context.layout.showToast(`No snippets for ${language}.`, 'info');
      return;
    }
    this.closePicker();

    const root = document.createElement('div');
    root.className = 'znxstudio-snippet-picker';
    root.addEventListener('click', (event) => {
      if (event.target === root) this.closePicker();
    });

    const box = document.createElement('div');
    box.className = 'znxstudio-snippet-box';

    const input = document.createElement('input');
    input.className = 'znxstudio-snippet-input';
    input.placeholder = `Insert snippet (${language})…`;

    const list = document.createElement('ul');
    list.className = 'znxstudio-snippet-list';

    const renderList = (query: string) => {
      list.replaceChildren();
      for (const snippet of matchSnippets(query, available)) {
        const item = document.createElement('li');
        item.className = 'znxstudio-snippet-item';
        const head = document.createElement('div');
        head.className = 'znxstudio-snippet-head';
        head.innerHTML = `<span class="znxstudio-snippet-prefix"></span><span class="znxstudio-snippet-name"></span>`;
        head.querySelector('.znxstudio-snippet-prefix')!.textContent = snippet.prefix;
        head.querySelector('.znxstudio-snippet-name')!.textContent = snippet.description;
        const preview = document.createElement('pre');
        preview.className = 'znxstudio-snippet-preview';
        preview.textContent = renderSnippetPreview(snippet.body);
        item.append(head, preview);
        item.addEventListener('click', () => {
          this.closePicker();
          this.editor.insertSnippet(snippet.body);
        });
        list.appendChild(item);
      }
    };

    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closePicker();
    });

    box.append(input, list);
    root.appendChild(box);
    document.body.appendChild(root);
    this.picker = root;
    renderList('');
    input.focus();
  }

  private closePicker(): void {
    this.picker?.remove();
    this.picker = undefined;
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

    const zx = snippetsFor('zornux', BUILTIN_SNIPPETS);
    log(`snippets catalog: zornux=${zx.length} prefixes=[${zx.map((s) => s.prefix).slice(0, 6).join(',')}]`);
    const service = zx.find((s) => s.prefix === 'service');
    log(`snippets preview(service): "${service ? renderSnippetPreview(service.body).split('\n')[0] : '-'}"`);
    log(`snippets match('for'): [${matchSnippets('for', zx).map((s) => s.prefix).join(',')}]`);
    log(`snippets escape: "${escapeSnippetBody('cost = $5 * ${x}')}"`);

    // Prove insertion through a REAL Monaco editor + snippet controller.
    let host: HTMLElement | undefined;
    let editor: monaco.editor.IStandaloneCodeEditor | undefined;
    let model: monaco.editor.ITextModel | undefined;
    try {
      host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-9999px;width:400px;height:200px';
      document.body.appendChild(host);
      model = monaco.editor.createModel('', 'zornux');
      editor = monaco.editor.create(host, { model });
      const controller = editor.getContribution('snippetController2') as unknown as
        | { insert(template: string): void }
        | null;
      controller?.insert('for each ${1:item} in ${2:items}\n\t$0\nend');
      const value = model.getValue().replace(/\n/g, '\\n');
      const inSnippet = (editor.getSelections()?.length ?? 0) >= 1;
      log(`snippets insert(for): value="${value}" tabstopSelected=${inSnippet}`);
    } catch (error) {
      log(`snippets self-test failed: ${(error as Error).message}`);
    } finally {
      editor?.dispose();
      model?.dispose();
      host?.remove();
    }
  }
}
