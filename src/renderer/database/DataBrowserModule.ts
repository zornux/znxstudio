import {
  ServiceKeys,
  type CompilerService,
  type DatabaseConnectionInfo,
  type DatabaseService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import { buildSchema } from './schemaModel';
import { buildBrowseProgram, parseRows } from './dataBrowser';
import { captureTask } from './runCapture';

const MAX_ROWS = 500;

/**
 * Data Browser (Phase 8E). Reads real rows THROUGH the ORM (no external driver):
 * synthesizes a temp program (the source + a print loop over a table) and renders
 * the captured rows as a grid. Repo-safe (OS temp). Run is gated off for files
 * that start a service. Reuses the query capture + schema derivation.
 */
export class DataBrowserModule implements IModule {
  readonly id = 'znxstudio.dataBrowser';
  readonly displayName = 'Data Browser';

  private context!: ModuleContext;
  private database: DatabaseService | undefined;
  private panel!: HTMLElement;
  private dbSelect!: HTMLSelectElement;
  private tableSelect!: HTMLSelectElement;
  private grid!: HTMLElement;
  private status!: HTMLElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.database = context.services.tryGet<DatabaseService>(ServiceKeys.Database);

    this.buildPanel();
    context.layout.addPanelView({ id: 'data', title: 'Data', element: this.panel });
    context.commands.register(CommandIds.DataBrowserShow, () => this.context.layout.showPanelView('data'), 'Database: Show Data Browser');

    if (this.database) context.subscriptions.push(this.database.onDidChange(() => this.refreshDatabases()));
    this.refreshDatabases();

    void selfTestCoordinator.run('databrowser', () => this.maybeSelfTest());
  }

  private connections(): DatabaseConnectionInfo[] {
    return this.database?.connections() ?? [];
  }

  private selectedConnection(): DatabaseConnectionInfo | undefined {
    return this.connections().find((c) => c.name === this.dbSelect.value);
  }

  private buildPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-data';

    const row = document.createElement('div');
    row.className = 'znxstudio-data-row';
    this.dbSelect = document.createElement('select');
    this.dbSelect.className = 'znxstudio-query-select';
    this.dbSelect.setAttribute('aria-label', 'Database connection');
    this.dbSelect.addEventListener('change', () => this.onDatabaseChange());
    this.tableSelect = document.createElement('select');
    this.tableSelect.className = 'znxstudio-query-select';
    this.tableSelect.setAttribute('aria-label', 'Table');
    const load = document.createElement('button');
    load.className = 'znxstudio-btn-small';
    load.textContent = '⟳ Load';
    load.addEventListener('click', () => void this.load());
    row.append(this.dbSelect, this.tableSelect, load);

    this.status = document.createElement('div');
    this.status.className = 'znxstudio-data-status';
    this.grid = document.createElement('div');
    this.grid.className = 'znxstudio-data-grid';

    this.panel.append(row, this.status, this.grid);
  }

  private refreshDatabases(): void {
    const connections = this.connections();
    const previous = this.dbSelect.value;
    this.dbSelect.replaceChildren();
    for (const connection of connections) {
      const option = document.createElement('option');
      option.value = connection.name;
      option.textContent = `${connection.name} (${connection.provider})`;
      this.dbSelect.appendChild(option);
    }
    if (connections.some((c) => c.name === previous)) this.dbSelect.value = previous;
    this.onDatabaseChange();
  }

  private onDatabaseChange(): void {
    const connection = this.selectedConnection();
    this.tableSelect.replaceChildren();
    for (const table of connection?.tables ?? []) {
      const option = document.createElement('option');
      option.value = table.table;
      option.textContent = table.table;
      this.tableSelect.appendChild(option);
    }
  }

  private async load(): Promise<void> {
    const connection = this.selectedConnection();
    const table = this.tableSelect.value;
    if (!connection || !table) return;

    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.setStatus('Zornux compiler not available.', true);
      return;
    }

    const source = await window.znxstudio.fs.readFile(connection.file);
    if (/(^|\n)\s*(service |publish )/.test(source)) {
      this.setStatus('Cannot browse: this file starts a service (running it would block).', true);
      return;
    }

    const schema = buildSchema(source).find((d) => d.name === connection.name);
    const tableSchema = schema?.tables.find((t) => t.table === table);
    const columns = (tableSchema?.columns ?? []).filter((c) => !c.isPrivate).map((c) => c.name);
    if (columns.length === 0) {
      this.setStatus('No readable columns for this table.', true);
      return;
    }

    this.setStatus('Loading…', false);
    this.grid.replaceChildren();

    const program = buildBrowseProgram(source, connection.name, table, columns);
    const tempDir = (await window.znxstudio.app.getInfo()).tempDir;
    const file = joinPath(tempDir, 'znxstudio-browse.zx');
    try {
      await window.znxstudio.fs.writeFile(file, program);
      const { output } = await captureTask(`"${info.path}" run "${file}"`, tempDir);
      const rows = parseRows(output);
      this.renderGrid(columns, rows);
    } catch (error) {
      this.setStatus(`Load failed: ${(error as Error).message}`, true);
    }
  }

  private renderGrid(columns: string[], rows: string[][]): void {
    const shown = rows.slice(0, MAX_ROWS);
    this.setStatus(
      rows.length === 0
        ? 'No rows.'
        : `${rows.length} row${rows.length === 1 ? '' : 's'}${rows.length > MAX_ROWS ? ` (showing ${MAX_ROWS})` : ''}`,
      false,
    );

    const table = document.createElement('table');
    table.className = 'znxstudio-data-table';

    const head = document.createElement('tr');
    for (const column of columns) {
      const th = document.createElement('th');
      th.textContent = column;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const cells of shown) {
      const tr = document.createElement('tr');
      for (let i = 0; i < columns.length; i += 1) {
        const td = document.createElement('td');
        td.textContent = cells[i] ?? '';
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    this.grid.replaceChildren(table);
  }

  private setStatus(text: string, error: boolean): void {
    this.status.textContent = text;
    this.status.className = `znxstudio-data-status${error ? ' is-error' : ''}`;
  }

  /* ----- optional headless self-test (ZNXSTUDIO_SELFTEST=1) ----- */
  private async maybeSelfTest(): Promise<void> {
    let enabled = false;
    let tempDir = '';
    try {
      const info = await window.znxstudio.app.getInfo();
      enabled = info.selftest === true;
      tempDir = info.tempDir;
    } catch {
      enabled = false;
    }
    if (!enabled) return;
    const log = (message: string) => console.info(`[selftest] ${message}`);

    // Pure synthesis + row parsing.
    const program = buildBrowseProgram('# src', 'Db', 'People', ['id', 'name']);
    log(`databrowser buildProgram: "${program.split('\n')[1]}" / "${program.split('\n')[2]}"`);
    log(`databrowser parseRows: ${JSON.stringify(parseRows('noise\n__ROW__1<|>Ada\n__ROW__2<|>Bob\ntail'))}`);

    // Real browse of advanced_queries.zx (Db.People, 4 seeded rows, memory).
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const source = await window.znxstudio.fs.readFile('C:\\Studio Apps\\xojin\\examples\\data\\advanced_queries.zx');
        const schema = buildSchema(source).find((d) => d.name === 'Db');
        const columns = (schema?.tables.find((t) => t.table === 'People')?.columns ?? [])
          .filter((c) => !c.isPrivate)
          .map((c) => c.name);
        const file = joinPath(tempDir, 'znxstudio-browse.zx');
        await window.znxstudio.fs.writeFile(file, buildBrowseProgram(source, 'Db', 'People', columns));
        const { output } = await captureTask(`"${info.path}" run "${file}"`, tempDir);
        const rows = parseRows(output);
        log(`databrowser REAL browse Db.People: cols=[${columns.join(',')}] rows=${rows.length} first=[${rows[0]?.join('|')}]`);
      } else {
        log('databrowser REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`databrowser REAL failed: ${(error as Error).message}`);
    }
  }
}
