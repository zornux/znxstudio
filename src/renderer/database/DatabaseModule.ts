import {
  ServiceKeys,
  type DatabaseConnectionInfo,
  type DatabaseService,
  type EditorService,
  type StatusService,
  type WorkspaceService,
} from '../core/Contracts';
import { Emitter } from '../core/Emitter';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { describeTarget, isFileBackedProvider } from './databaseModel';
import { buildSchema, type Column, type DatabaseSchema, type TableSchema } from './schemaModel';

interface DiscoveredConnection extends DatabaseSchema {
  file: string;
}

const PROVIDER_ICON: Record<string, string> = {
  sqlite: '🗃',
  memory: '⚡',
  postgres: '🐘',
  mysql: '🐬',
};

/**
 * Database Connections (Phase 8A). Surfaces every Zornux `database` declaration
 * across the workspace as a connection — the real ORM connection model is
 * source-declared (provider / connection / table … from …). A sidebar view lists
 * them (provider, target, tables), click-to-open at the declaration. Discovery
 * reuses the 7A workspace search; later sub-phases (schema, data browser) build
 * on the parsed tables. No new IPC.
 */
export class DatabaseModule implements IModule, DatabaseService {
  readonly id = 'znxstudio.database';
  readonly displayName = 'Database';

  private context!: ModuleContext;
  private workspace!: WorkspaceService;
  private status: StatusService | undefined;
  private shell!: HTMLElement;
  private list!: HTMLElement;
  private discovered: DiscoveredConnection[] = [];
  private readonly changeEmitter = new Emitter<DatabaseConnectionInfo[]>();
  readonly onDidChange = this.changeEmitter.event;

  /** DatabaseService: the discovered connections with resolved column names. */
  connections(): DatabaseConnectionInfo[] {
    return this.discovered.map((connection) => ({
      name: connection.name,
      provider: connection.provider,
      connection: connection.connection,
      file: connection.file,
      line: connection.line,
      migrateOnOpen: connection.migrateOnOpen,
      tables: connection.tables.map((table) => ({
        table: table.table,
        from: table.from,
        columns: table.columns.map((column) => column.name),
      })),
    }));
  }

  activate(context: ModuleContext): void {
    this.context = context;
    this.workspace = context.services.get<WorkspaceService>(ServiceKeys.Workspace);
    this.status = context.services.tryGet<StatusService>(ServiceKeys.Status);
    context.services.register(ServiceKeys.Database, this);

    this.buildShell();

    context.commands.register(CommandIds.DatabaseShow, () => this.reveal(), 'Database: Show Databases');
    context.commands.register(CommandIds.DatabaseRefresh, () => this.discover(), 'Database: Refresh Databases');
    context.layout.addActivityItem({
      id: 'database',
      label: 'Database',
      icon: '🗄',
      onSelect: () => this.reveal(),
    });

    this.workspace.onDidChangeWorkspace(() => void this.discover());
    void this.discover();
    void selfTestCoordinator.run('database', () => this.maybeSelfTest());
  }

  private reveal(): void {
    this.context.layout.setSideBar('Database', this.shell);
    this.context.layout.focusSideBar();
  }

  private buildShell(): void {
    this.shell = document.createElement('div');
    this.shell.className = 'znxstudio-database';

    const toolbar = document.createElement('div');
    toolbar.className = 'znxstudio-database-toolbar';
    const title = document.createElement('span');
    title.className = 'znxstudio-database-title';
    title.textContent = 'Connections';
    const refresh = document.createElement('button');
    refresh.className = 'znxstudio-btn-small';
    refresh.textContent = '⟳';
    refresh.title = 'Refresh';
    refresh.addEventListener('click', () => void this.discover());
    toolbar.append(title, refresh);

    this.list = document.createElement('div');
    this.list.className = 'znxstudio-database-list';

    this.shell.append(toolbar, this.list);
  }

  private async discover(): Promise<void> {
    const root = this.workspace.currentFolder();
    if (!root) {
      this.discovered = [];
      this.render();
      this.changeEmitter.fire(this.connections());
      return;
    }
    const result = await window.znxstudio.search.text({ root, query: '^database\\s+\\w', isRegex: true });
    const discovered: DiscoveredConnection[] = [];
    for (const file of result.files) {
      let text: string;
      try {
        text = await window.znxstudio.fs.readFile(file.file);
      } catch {
        continue;
      }
      for (const schema of buildSchema(text)) discovered.push({ ...schema, file: file.file });
    }
    discovered.sort((a, b) => a.name.localeCompare(b.name));
    this.discovered = discovered;
    this.render();
    this.updateStatus();
    this.changeEmitter.fire(this.connections());
  }

  private updateStatus(): void {
    if (!this.status) return;
    if (this.discovered.length === 0) {
      this.status.removeItem('database.count');
      return;
    }
    this.status.setItem('database.count', {
      text: `🗄 ${this.discovered.length}`,
      tooltip: 'Database connections — click to view',
      command: CommandIds.DatabaseShow,
      side: 'right',
      priority: 26,
    });
  }

  private render(): void {
    this.list.replaceChildren();
    if (this.discovered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'znxstudio-database-empty';
      empty.textContent = 'No database declarations found. Declare one with `database … end`.';
      this.list.appendChild(empty);
      return;
    }

    for (const connection of this.discovered) {
      this.list.appendChild(this.renderConnection(connection));
    }
  }

  private renderConnection(connection: DiscoveredConnection): HTMLElement {
    const card = document.createElement('div');
    card.className = 'znxstudio-database-conn';

    const head = document.createElement('div');
    head.className = 'znxstudio-database-conn-head';
    head.title = `${connection.file}:${connection.line + 1}`;
    head.addEventListener('click', () => void this.open(connection));

    const icon = document.createElement('span');
    icon.className = 'znxstudio-database-icon';
    icon.textContent = PROVIDER_ICON[connection.provider.toLowerCase()] ?? '🗄';
    const name = document.createElement('span');
    name.className = 'znxstudio-database-name';
    name.textContent = connection.name;
    const provider = document.createElement('span');
    provider.className = 'znxstudio-database-provider';
    provider.textContent = connection.provider;
    head.append(icon, name, provider);
    card.appendChild(head);

    const target = document.createElement('div');
    target.className = 'znxstudio-database-target';
    target.textContent = describeTarget(connection);
    if (isFileBackedProvider(connection.provider)) target.classList.add('is-file');
    card.appendChild(target);

    const meta = document.createElement('div');
    meta.className = 'znxstudio-database-meta';
    meta.textContent =
      `${connection.tables.length} table${connection.tables.length === 1 ? '' : 's'}` +
      (connection.migrateOnOpen ? ' · migrate on open' : '');
    card.appendChild(meta);

    for (const table of connection.tables) card.appendChild(this.renderTable(table, connection));

    return card;
  }

  /** A table row that expands to its column schema (Phase 8B). */
  private renderTable(table: TableSchema, connection: DiscoveredConnection): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'znxstudio-database-table-wrap';

    const row = document.createElement('div');
    row.className = 'znxstudio-tree-row znxstudio-database-table';
    const caret = document.createElement('span');
    caret.className = 'znxstudio-database-caret';
    caret.textContent = table.columns.length ? '▾' : '·';
    const label = document.createElement('span');
    label.className = 'znxstudio-database-table-name';
    label.textContent = `▦ ${table.table}`;
    const from = document.createElement('span');
    from.className = 'znxstudio-database-from';
    from.textContent = table.resolved ? `${table.columns.length} cols` : `from ${table.from} (unresolved)`;
    row.append(caret, label, from);
    wrap.appendChild(row);

    const columns = document.createElement('div');
    columns.className = 'znxstudio-database-columns';
    for (const column of table.columns) columns.appendChild(this.renderColumn(column));
    wrap.appendChild(columns);

    row.addEventListener('click', () => {
      const collapsed = columns.classList.toggle('is-collapsed');
      caret.textContent = table.columns.length ? (collapsed ? '▸' : '▾') : '·';
    });
    from.addEventListener('click', (event) => {
      event.stopPropagation();
      void this.open(connection);
    });

    return wrap;
  }

  private renderColumn(column: Column): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-database-column';
    const name = document.createElement('span');
    name.className = 'znxstudio-database-col-name';
    name.textContent = column.name;
    row.appendChild(name);
    if (column.isId) row.appendChild(this.tag('PK', 'pk'));
    if (column.isPrivate) row.appendChild(this.tag('private', 'private'));
    for (const constraint of column.constraints) row.appendChild(this.tag(constraint, 'constraint'));
    return row;
  }

  private tag(text: string, kind: string): HTMLElement {
    const badge = document.createElement('span');
    badge.className = `znxstudio-database-tag znxstudio-database-tag--${kind}`;
    badge.textContent = text;
    return badge;
  }

  private async open(connection: DiscoveredConnection): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    await editor.openFile(connection.file);
    editor.revealPosition(connection.line, 0);
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

    // Pure parse + schema on the canonical durable-store shape.
    const src =
      'class Note\n    has id\n    has title\n    function summary\n        show title\n    end\nend\n\n' +
      'database Notebook\n    provider sqlite\n    connection "store.sqlite"\n    table Notes from Note\n    migrate on open\nend\n';
    const schema = buildSchema(src);
    const notes = schema[0]?.tables[0];
    log(`database parse: n=${schema.length} name=${schema[0]?.name} provider=${schema[0]?.provider} conn=${schema[0]?.connection} migrate=${schema[0]?.migrateOnOpen}`);
    log(`database schema Notes: resolved=${notes?.resolved} cols=[${notes?.columns.map((c) => c.name + (c.isId ? '(PK)' : '')).join(',')}] (method excluded)`);

    // Real workspace discovery via the 7A search + parse.
    try {
      const root = 'C:\\Studio Apps\\xojin\\examples';
      const result = await window.znxstudio.search.text({ root, query: '^database\\s+\\w', isRegex: true });
      const conns: DiscoveredConnection[] = [];
      for (const file of result.files) {
        const text = await window.znxstudio.fs.readFile(file.file);
        for (const c of buildSchema(text)) conns.push({ ...c, file: file.file });
      }
      const providers = [...new Set(conns.map((c) => c.provider))].sort();
      const sqlite = conns.find((c) => c.provider === 'sqlite');
      log(`database discover(examples): connections=${conns.length} providers=[${providers.join(',')}] sqliteTarget=${sqlite ? describeTarget(sqlite) : '-'}`);
      const appDb = conns.find((c) => c.name === 'AppDb' && c.tables.some((t) => t.from === 'User'));
      const users = appDb?.tables.find((t) => t.from === 'User');
      log(`database schema(examples) AppDb.Users: resolved=${users?.resolved} cols=[${users?.columns.map((c) => c.name).join(',')}]`);
    } catch (error) {
      log(`database discover failed: ${(error as Error).message}`);
    }
  }
}
