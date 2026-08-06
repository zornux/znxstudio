import {
  ServiceKeys,
  type CompilerService,
  type DatabaseConnectionInfo,
  type DatabaseService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { buildRunExpression, parseQuery, validateQuery } from './queryModel';
import { captureTask } from './runCapture';

/**
 * Query Console (Phase 8C). A console for Zornux's English ORM query surface —
 * pick a discovered database + table, write a `find …`/aggregate query, get live
 * parse + schema validation, and Run it against the REAL ORM. Running synthesizes
 * a repo-safe temp program (the source + an appended `show text(count/aggregate)`)
 * and executes it via `zornux run`, capturing the result. No raw SQL.
 */
export class QueryConsoleModule implements IModule {
  readonly id = 'znxstudio.queryConsole';
  readonly displayName = 'Query Console';

  private context!: ModuleContext;
  private database: DatabaseService | undefined;
  private panel!: HTMLElement;
  private dbSelect!: HTMLSelectElement;
  private tableSelect!: HTMLSelectElement;
  private queryInput!: HTMLTextAreaElement;
  private diagnostics!: HTMLElement;
  private result!: HTMLElement;
  private runButton!: HTMLButtonElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.database = context.services.tryGet<DatabaseService>(ServiceKeys.Database);

    this.buildPanel();
    context.layout.addPanelView({ id: 'query', title: 'Query Console', element: this.panel });
    context.commands.register(CommandIds.QueryConsoleShow, () => this.context.layout.showPanelView('query'), 'Database: Show Query Console');

    this.database?.onDidChange(() => this.refreshDatabases());
    this.refreshDatabases();

    void selfTestCoordinator.run('queryconsole', () => this.maybeSelfTest());
  }

  private connections(): DatabaseConnectionInfo[] {
    return this.database?.connections() ?? [];
  }

  private selectedConnection(): DatabaseConnectionInfo | undefined {
    return this.connections().find((c) => c.name === this.dbSelect.value);
  }

  private columnsByTable(connection: DatabaseConnectionInfo): Record<string, string[]> {
    const map: Record<string, string[]> = {};
    for (const table of connection.tables) map[table.table] = table.columns;
    return map;
  }

  private buildPanel(): void {
    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-query';

    const row = document.createElement('div');
    row.className = 'znxstudio-query-row';
    this.dbSelect = document.createElement('select');
    this.dbSelect.className = 'znxstudio-query-select';
    this.dbSelect.setAttribute('aria-label', 'Database connection');
    this.dbSelect.addEventListener('change', () => this.onDatabaseChange());
    this.tableSelect = document.createElement('select');
    this.tableSelect.className = 'znxstudio-query-select';
    this.tableSelect.setAttribute('aria-label', 'Table');
    this.tableSelect.addEventListener('change', () => this.seedQuery());
    row.append(this.dbSelect, this.tableSelect);

    this.queryInput = document.createElement('textarea');
    this.queryInput.className = 'znxstudio-query-input';
    this.queryInput.setAttribute('aria-label', 'SQL query');
    this.queryInput.rows = 2;
    this.queryInput.spellcheck = false;
    this.queryInput.addEventListener('input', () => this.validate());

    this.diagnostics = document.createElement('div');
    this.diagnostics.className = 'znxstudio-query-diag';

    const actions = document.createElement('div');
    actions.className = 'znxstudio-query-actions';
    this.runButton = document.createElement('button');
    this.runButton.className = 'znxstudio-btn-small';
    this.runButton.textContent = '▶ Run';
    this.runButton.addEventListener('click', () => void this.runQuery());
    actions.appendChild(this.runButton);

    this.result = document.createElement('div');
    this.result.className = 'znxstudio-query-result';

    this.panel.append(row, this.queryInput, this.diagnostics, actions, this.result);
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
    this.seedQuery();
  }

  private seedQuery(): void {
    const connection = this.selectedConnection();
    const table = this.tableSelect.value;
    if (connection && table) this.queryInput.value = `find all from ${connection.name}.${table}`;
    this.validate();
  }

  private validate(): void {
    const connection = this.selectedConnection();
    if (!connection) {
      this.diagnostics.textContent = 'No database selected.';
      this.diagnostics.className = 'znxstudio-query-diag is-error';
      return;
    }
    const query = parseQuery(this.queryInput.value);
    const problems = validateQuery(query, this.columnsByTable(connection));
    if (problems.length === 0) {
      this.diagnostics.textContent = '✓ valid';
      this.diagnostics.className = 'znxstudio-query-diag is-ok';
    } else {
      this.diagnostics.textContent = problems.join('  ·  ');
      this.diagnostics.className = 'znxstudio-query-diag is-error';
    }
  }

  private async runQuery(): Promise<void> {
    const connection = this.selectedConnection();
    if (!connection) return;
    const query = parseQuery(this.queryInput.value);
    const problems = validateQuery(query, this.columnsByTable(connection));
    if (problems.length) {
      this.showResult(problems.join('  ·  '), 'error');
      return;
    }

    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.showResult('Zornux compiler not available to run the query.', 'error');
      return;
    }

    const source = await window.znxstudio.fs.readFile(connection.file);
    if (/(^|\n)\s*(service |publish )/.test(source)) {
      this.showResult('Run unavailable: this file starts a service (running it would block).', 'error');
      return;
    }

    this.showResult('Running…', 'info');
    const result = await this.execute(source, query, info.path);
    this.showResult(result.text, result.ok ? 'success' : 'error');
  }

  /** Synthesize a repo-safe temp program and run it, capturing the marked result. */
  private async execute(
    source: string,
    query: ReturnType<typeof parseQuery>,
    compilerPath: string,
  ): Promise<{ ok: boolean; text: string }> {
    const tempDir = (await window.znxstudio.app.getInfo()).tempDir;
    const program = `${source}\nshow "__ZQ__" + text(${buildRunExpression(query)})\n`;
    const file = `${tempDir}\\znxstudio-query.zx`;
    try {
      await window.znxstudio.fs.writeFile(file, program);
    } catch (error) {
      return { ok: false, text: `Could not write temp program: ${(error as Error).message}` };
    }

    let output: string;
    try {
      ({ output } = await captureTask(`"${compilerPath}" run "${file}"`, tempDir));
    } catch (error) {
      return { ok: false, text: `Run failed: ${(error as Error).message}` };
    }

    const marker = /__ZQ__([^\n\r]*)/.exec(output);
    const label = query.kind === 'aggregate' ? `${query.aggregate} of ${query.aggregateField}` : 'matching rows';
    if (marker) return { ok: true, text: `${label}: ${marker[1].trim()}` };
    return { ok: false, text: `No result captured. Output: ${output.trim().slice(-200) || '(empty)'}` };
  }

  private showResult(text: string, kind: 'success' | 'error' | 'info'): void {
    this.result.textContent = text;
    this.result.className = `znxstudio-query-result is-${kind}`;
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

    // Pure parse + validate + run-expression.
    const q = parseQuery('find count from Db.People where age is greater than or equal to 18');
    log(`query parse: ok=${q.ok} mode=${q.resultMode} table=${q.table} where=${q.where.length} op="${q.where[0]?.operator}" val="${q.where[0]?.value}"`);
    log(`query validate(good): ${JSON.stringify(validateQuery(q, { People: ['name', 'age', 'city'] }))}`);
    log(`query validate(bad field): ${JSON.stringify(validateQuery(parseQuery('find all from Db.People sorted by nope'), { People: ['name', 'age'] }))}`);
    log(`query runExpr: "${buildRunExpression(q)}"`);
    const agg = parseQuery('average of age from Db.People');
    log(`query aggregate: agg=${agg.aggregate} field=${agg.aggregateField} runExpr="${buildRunExpression(agg)}"`);

    // Real run against the ORM: advanced_queries.zx seeds 4 People in-code (memory).
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const cinfo = compiler ? await compiler.info() : null;
      if (cinfo?.available && cinfo.path && tempDir) {
        const source = await window.znxstudio.fs.readFile('C:\\Studio Apps\\xojin\\examples\\data\\advanced_queries.zx');
        const result = await this.execute(source, q, cinfo.path);
        log(`query run(adults, advanced_queries): ${result.ok ? result.text : 'FAILED ' + result.text}`);
      } else {
        log('query run: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`query run failed: ${(error as Error).message}`);
    }
  }
}
