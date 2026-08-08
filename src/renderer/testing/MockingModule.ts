import { ServiceKeys, type EditorService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { dependents, generateMock, parseComponents, type Component } from './mocking';

const KIND_ICON: Record<string, string> = { repository: '🗃', service: '🌐', application: '🧩' };

/**
 * Mocking (Phase 9F). Surfaces the active file's DI components (repository /
 * service / application) with their `use` dependencies + methods, and generates
 * same-interface test doubles to register in a test's application block. Zornux
 * mocking is DI-substitution — no built-in mock keyword. Renderer-only.
 */
export class MockingModule implements IModule {
  readonly id = 'znxstudio.mocking';
  readonly displayName = 'Mocking';

  private context!: ModuleContext;
  private documents!: DocumentManager;
  private panel!: HTMLElement;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-mocking';
    context.layout.addPanelView({ id: 'mocking', title: 'Mocks', element: this.panel });
    context.commands.register(CommandIds.MockingShow, () => this.context.layout.showPanelView('mocking'), 'Test: Show Mocks');

    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) {
      context.subscriptions.push(editor.onDidChangeActiveFile(() => this.scheduleRefresh(0)));
    }
    context.subscriptions.push(
      this.documents.onDidChange((doc) => {
        if (doc.uri === this.documents.getActive()?.uri) this.scheduleRefresh(400);
      }),
      {
        dispose: () => {
          if (this.refreshTimer) clearTimeout(this.refreshTimer);
          this.refreshTimer = null;
        },
      },
    );

    this.renderMessage('Open a .zx file with repository/service components.');
    void selfTestCoordinator.run('mocking', () => this.maybeSelfTest());
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  private refresh(): void {
    const active = this.documents.getActive();
    if (!active || active.languageId !== 'zornux') {
      this.renderMessage('Open a .zx file with repository/service components.');
      return;
    }
    const components = parseComponents(active.document.getText());
    if (components.length === 0) {
      this.renderMessage('No DI components (repository/service/application) in this file.');
      return;
    }
    this.render(components, active.uri);
  }

  private renderMessage(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-mocking-empty';
    empty.textContent = message;
    this.panel.replaceChildren(empty);
  }

  private render(components: Component[], sourceUri: string): void {
    this.panel.replaceChildren();
    for (const component of components) {
      const card = document.createElement('div');
      card.className = 'znxstudio-mocking-comp';

      const head = document.createElement('div');
      head.className = 'znxstudio-mocking-head';
      const icon = document.createElement('span');
      icon.textContent = KIND_ICON[component.kind] ?? '•';
      icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.className = 'znxstudio-mocking-name';
      name.textContent = component.name;
      const kind = document.createElement('span');
      kind.className = 'znxstudio-mocking-kind';
      kind.textContent = component.kind;
      head.append(icon, name, kind);

      // A mockable component (repository/service with methods) gets a button.
      if (component.kind !== 'application' && component.functions.length > 0) {
        const mock = document.createElement('button');
        mock.className = 'znxstudio-btn-small';
        mock.textContent = '⧉ Mock';
        mock.title = 'Generate a test double and insert it at the cursor';
        mock.setAttribute('aria-label', `Insert mock for ${component.name}`);
        mock.addEventListener('click', () => this.insertMock(component, sourceUri));
        head.appendChild(mock);
      }
      card.appendChild(head);

      if (component.uses.length > 0) {
        const uses = document.createElement('div');
        uses.className = 'znxstudio-mocking-uses';
        uses.textContent = `uses: ${component.uses.join(', ')}`;
        card.appendChild(uses);
      }

      const usedBy = dependents(components, component.name);
      if (usedBy.length > 0) {
        const by = document.createElement('div');
        by.className = 'znxstudio-mocking-uses';
        by.textContent = `used by: ${usedBy.join(', ')}`;
        card.appendChild(by);
      }

      for (const fn of component.functions) {
        const row = document.createElement('div');
        row.className = 'znxstudio-mocking-fn';
        row.textContent = `${fn.async ? 'async ' : ''}${fn.name}(${fn.params.join(', ')})`;
        card.appendChild(row);
      }

      this.panel.appendChild(card);
    }
  }

  private insertMock(component: Component, sourceUri: string): void {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor || !editor.currentUri()) {
      this.context.layout.showToast('Open a .zx file to insert the mock.', 'info');
      return;
    }
    if (editor.currentUri() !== sourceUri) {
      this.context.layout.showToast('The active file changed. Select the component again before inserting a mock.', 'info');
      this.scheduleRefresh(0);
      return;
    }
    editor.insertText(`\n${generateMock(component)}`);
    this.context.layout.showToast(`Inserted Mock${component.name}.`, 'success');
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
      const source = await window.znxstudio.fs.readFile('C:\\Studio Apps\\xojin\\examples\\enterprise\\user_service.zx');
      const components = parseComponents(source);
      log(`mocking parse: [${components.map((c) => `${c.kind}:${c.name}(fns=${c.functions.length},uses=[${c.uses.join('+')}])`).join(' ')}]`);

      const repo = components.find((c) => c.name === 'UserRepository')!;
      log(`mocking dependents(UserRepository): [${dependents(components, 'UserRepository').join(',')}]`);
      const mock = generateMock(repo);
      log(`mocking generate(UserRepository): firstFn="${mock.split('\n')[1]}" return="${mock.split('\n').find((l) => l.includes('give back'))?.trim()}" swapHint=${mock.includes('use UserRepository → use MockUserRepository')}`);
    } catch (error) {
      log(`mocking self-test failed: ${(error as Error).message}`);
    }
  }
}
