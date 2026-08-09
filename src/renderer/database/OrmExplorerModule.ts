import { ServiceKeys, type EditorService, type StatusService } from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { examplePath } from '../core/selftestFixtures';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { LanguageServiceKeys } from '../language/api';
import type { DocumentManager } from '../language/DocumentManager';
import { analyzeOrm, type OrmAnalysis } from './ormModel';

/**
 * ORM Explorer (Phase 8G — the Database capstone). Analyzes the ACTIVE .zx file's
 * ORM usage, cross-checking `create/save/delete/find` against the declared
 * databases + schema: entity↔table map, per-table CRUD coverage, and diagnostics
 * (type mismatches, unknown refs). Ties 8A/8B/8C together. Renderer-only.
 */
export class OrmExplorerModule implements IModule {
  readonly id = 'znxstudio.orm';
  readonly displayName = 'ORM Explorer';

  private context!: ModuleContext;
  private documents!: DocumentManager;
  private status: StatusService | undefined;
  private panel!: HTMLElement;
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  activate(context: ModuleContext): void {
    this.context = context;
    this.documents = context.services.get<DocumentManager>(LanguageServiceKeys.Documents);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-orm';
    context.layout.addPanelView({ id: 'orm', title: 'ORM', element: this.panel });
    context.commands.register(CommandIds.OrmExplorerShow, () => this.context.layout.showPanelView('orm'), 'Database: Show ORM Explorer');

    const editor = context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (editor) context.subscriptions.push(editor.onDidChangeActiveFile(() => this.scheduleRefresh(0)));
    context.subscriptions.push(this.documents.onDidChange((doc) => {
      if (doc.uri === this.documents.getActive()?.uri) this.scheduleRefresh(400);
    }));

    this.renderMessage('Open a .zx file with ORM operations.');
    void selfTestCoordinator.run('orm', () => this.maybeSelfTest());
  }

  private scheduleRefresh(delay: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.refresh(), delay);
  }

  private refresh(): void {
    const active = this.documents.getActive();
    if (!active || active.languageId !== 'zornux') {
      this.renderMessage('Open a .zx file with ORM operations.');
      this.status?.removeItem('editor.orm');
      return;
    }
    const analysis = analyzeOrm(active.document.getText());
    this.render(analysis);

    const errors = analysis.diagnostics.filter((d) => d.severity === 'error').length;
    if (analysis.tables.length === 0 && analysis.operations.length === 0) {
      this.status?.removeItem('editor.orm');
    } else {
      this.status?.setItem('editor.orm', {
        text: `ORM ${analysis.operations.length}${errors ? ` ✗${errors}` : ''}`,
        tooltip: 'ORM operations — click for details',
        command: CommandIds.OrmExplorerShow,
        side: 'right',
        priority: 27,
      });
    }
  }

  private renderMessage(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-orm-empty';
    empty.textContent = message;
    this.panel.replaceChildren(empty);
  }

  private render(analysis: OrmAnalysis): void {
    if (analysis.tables.length === 0 && analysis.operations.length === 0) {
      this.renderMessage('No ORM usage in this file.');
      return;
    }
    this.panel.replaceChildren();

    // Per-table CRUD coverage.
    this.panel.appendChild(this.heading('Tables'));
    for (const table of analysis.tables) {
      const row = document.createElement('div');
      row.className = 'znxstudio-orm-row';
      const name = document.createElement('span');
      name.className = 'znxstudio-orm-name';
      name.textContent = `${table.database}.${table.table}`;
      const from = document.createElement('span');
      from.className = 'znxstudio-orm-from';
      from.textContent = `⟵ ${table.from}`;
      const crud = document.createElement('span');
      crud.className = 'znxstudio-orm-crud';
      crud.append(
        this.badge('C', table.creates > 0, `${table.creates} save`),
        this.badge('R', table.reads > 0, `${table.reads} find`),
        this.badge('D', table.deletes > 0, `${table.deletes} delete`),
      );
      row.append(name, from, crud);
      this.panel.appendChild(row);
    }

    // Diagnostics.
    if (analysis.diagnostics.length > 0) {
      this.panel.appendChild(this.heading('Diagnostics'));
      for (const diagnostic of analysis.diagnostics) {
        const row = document.createElement('div');
        row.className = `znxstudio-orm-diag znxstudio-orm-diag--${diagnostic.severity}`;
        row.textContent = `${diagnostic.severity === 'error' ? '✗' : '⚠'} ${diagnostic.message} (line ${diagnostic.line + 1})`;
        row.addEventListener('click', () => this.reveal(diagnostic.line));
        this.panel.appendChild(row);
      }
    } else {
      const ok = document.createElement('div');
      ok.className = 'znxstudio-orm-ok';
      ok.textContent = '✓ No ORM problems.';
      this.panel.appendChild(ok);
    }
  }

  private heading(text: string): HTMLElement {
    const heading = document.createElement('div');
    heading.className = 'znxstudio-orm-heading';
    heading.textContent = text;
    return heading;
  }

  private badge(letter: string, on: boolean, tooltip: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = `znxstudio-orm-badge${on ? ' is-on' : ''}`;
    badge.textContent = letter;
    badge.title = tooltip;
    return badge;
  }

  private reveal(line: number): void {
    this.context.services.tryGet<EditorService>(ServiceKeys.Editor)?.revealPosition(line, 0);
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
      const path = await examplePath('data', 'user_crud.zx');
      if (!path) {
        log('orm skipped (no examples root)');
        return;
      }
      const source = await window.znxstudio.fs.readFile(path);
      const analysis = analyzeOrm(source);
      const users = analysis.tables.find((t) => t.table === 'Users');
      log(`orm user_crud: ops=${analysis.operations.length} tables=${analysis.tables.length} Users(C=${users?.creates} R=${users?.reads} D=${users?.deletes} from=${users?.from}) diagnostics=${analysis.diagnostics.length}`);
      log(`orm entities: ${analysis.entities.map((e) => `${e.className}→[${e.tables.join(',')}]`).join(' ')}`);

      // Crafted type mismatch: saving a Product into a Users table.
      const bad =
        'class User\n    has id\nend\nclass Product\n    has id\nend\n' +
        'database AppDb\n    provider memory\n    table Users from User\nend\n' +
        'create p from Product\nsave p into AppDb.Users\n' +
        'save q into Ghost.Nope\n';
      const badAnalysis = analyzeOrm(bad);
      log(`orm mismatch: errors=${badAnalysis.diagnostics.filter((d) => d.severity === 'error').length} warnings=${badAnalysis.diagnostics.filter((d) => d.severity === 'warning').length} first="${badAnalysis.diagnostics[0]?.message}"`);
    } catch (error) {
      log(`orm self-test failed: ${(error as Error).message}`);
    }
  }
}
