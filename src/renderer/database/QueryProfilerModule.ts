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
import { buildProfileProgram, clampIterations, parseProfile, perQueryMicros } from './profiler';
import { captureTask } from './runCapture';

interface EngineResult {
  engine: string;
  iterations: number;
  totalMs: number;
  perQueryMicros: number;
  result: string;
}

const ENGINES: { label: string; command: 'run' | 'vm-run' }[] = [
  { label: 'interpreter', command: 'run' },
  { label: 'vm', command: 'vm-run' },
];

/**
 * Query Profiler (Phase 8F). Times an ORM query with the language's own clock
 * (`elapsed_time`) across N iterations, on BOTH engines Zornux ships
 * (interpreter `run` + bytecode `vm-run`), and reports mean per-query time. No
 * EXPLAIN exists — this is real measured execution. Repo-safe (OS temp).
 */
export class QueryProfilerModule implements IModule {
  readonly id = 'znxstudio.queryProfiler';
  readonly displayName = 'Query Profiler';

  private context!: ModuleContext;
  private database: DatabaseService | undefined;
  private panel!: HTMLElement;
  private dbSelect!: HTMLSelectElement;
  private tableSelect!: HTMLSelectElement;
  private queryInput!: HTMLTextAreaElement;
  private iterationsInput!: HTMLInputElement;
  private results!: HTMLElement;
  private profileButton!: HTMLButtonElement;

  activate(context: ModuleContext): void {
    this.context = context;
    this.database = context.services.tryGet<DatabaseService>(ServiceKeys.Database);

    this.buildPanel();
    context.layout.addPanelView({ id: 'profiler', title: 'Query Profiler', element: this.panel });
    context.commands.register(CommandIds.QueryProfilerShow, () => this.context.layout.showPanelView('profiler'), 'Database: Show Query Profiler');

    this.database?.onDidChange(() => this.refreshDatabases());
    this.refreshDatabases();

    void selfTestCoordinator.run('queryprofiler', () => this.maybeSelfTest());
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
    this.iterationsInput = document.createElement('input');
    this.iterationsInput.className = 'znxstudio-query-select';
    this.iterationsInput.type = 'number';
    this.iterationsInput.value = '1000';
    this.iterationsInput.title = 'Iterations';
    this.iterationsInput.style.maxWidth = '90px';
    row.append(this.dbSelect, this.tableSelect, this.iterationsInput);

    this.queryInput = document.createElement('textarea');
    this.queryInput.className = 'znxstudio-query-input';
    this.queryInput.setAttribute('aria-label', 'SQL query');
    this.queryInput.rows = 2;
    this.queryInput.spellcheck = false;

    const actions = document.createElement('div');
    actions.className = 'znxstudio-query-actions';
    this.profileButton = document.createElement('button');
    this.profileButton.className = 'znxstudio-btn-small';
    this.profileButton.textContent = '⏱ Profile';
    this.profileButton.addEventListener('click', () => void this.profile());
    actions.appendChild(this.profileButton);

    this.results = document.createElement('div');
    this.results.className = 'znxstudio-query-result is-info';

    this.panel.append(row, this.queryInput, actions, this.results);
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
  }

  private async profile(): Promise<void> {
    const connection = this.selectedConnection();
    if (!connection) return;
    const query = parseQuery(this.queryInput.value);
    const problems = validateQuery(query, this.columnsByTable(connection));
    if (problems.length) {
      this.showMessage(problems.join('  ·  '), true);
      return;
    }

    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    if (!info?.available || !info.path) {
      this.showMessage('Zornux compiler not available.', true);
      return;
    }

    const source = await window.znxstudio.fs.readFile(connection.file);
    if (/(^|\n)\s*(service |publish )/.test(source)) {
      this.showMessage('Cannot profile: this file starts a service (running it would block).', true);
      return;
    }

    const iterations = clampIterations(Number(this.iterationsInput.value));
    this.iterationsInput.value = String(iterations);
    this.showMessage('Profiling…', false);

    const program = buildProfileProgram(source, buildRunExpression(query), iterations);
    const tempDir = (await window.znxstudio.app.getInfo()).tempDir;
    const file = `${tempDir}\\znxstudio-profile.zx`;
    try {
      await window.znxstudio.fs.writeFile(file, program);
    } catch (error) {
      this.showMessage(`Could not write temp program: ${(error as Error).message}`, true);
      return;
    }

    const results: EngineResult[] = [];
    for (const engine of ENGINES) {
      const { output } = await captureTask(`"${info.path}" ${engine.command} "${file}"`, tempDir);
      const sample = parseProfile(output);
      if (!sample) {
        results.push({ engine: engine.label, iterations, totalMs: NaN, perQueryMicros: NaN, result: '—' });
        continue;
      }
      results.push({
        engine: engine.label,
        iterations,
        totalMs: sample.seconds * 1000,
        perQueryMicros: perQueryMicros(sample.seconds, iterations),
        result: sample.result,
      });
    }
    this.renderResults(query.kind === 'aggregate' ? `${query.aggregate}(${query.aggregateField})` : 'count', results);
  }

  private renderResults(label: string, results: EngineResult[]): void {
    this.results.className = 'znxstudio-query-result';
    this.results.replaceChildren();

    const table = document.createElement('table');
    table.className = 'znxstudio-data-table znxstudio-profiler-table';
    const head = document.createElement('tr');
    for (const column of ['engine', 'iterations', 'total (ms)', 'per-query (µs)', label]) {
      const th = document.createElement('th');
      th.textContent = column;
      head.appendChild(th);
    }
    table.appendChild(head);

    for (const result of results) {
      const tr = document.createElement('tr');
      const cells = [
        result.engine,
        String(result.iterations),
        Number.isNaN(result.totalMs) ? '—' : result.totalMs.toFixed(2),
        Number.isNaN(result.perQueryMicros) ? '—' : result.perQueryMicros.toFixed(2),
        result.result,
      ];
      for (const value of cells) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    this.results.appendChild(table);
  }

  private showMessage(text: string, error: boolean): void {
    this.results.className = `znxstudio-query-result ${error ? 'is-error' : 'is-info'}`;
    this.results.textContent = text;
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

    // Pure synthesis + parse + math.
    const program = buildProfileProgram('# src', 'find count from Db.People', 500);
    log(`profiler build: iters-line="${program.split('\n').find((l) => l.startsWith('repeat'))}" showsClock=${program.includes('elapsed_time(zprof_began)')}`);
    const sample = parseProfile('noise\n__PROF__0.0108789|6000\n');
    log(`profiler parse: seconds=${sample?.seconds} result=${sample?.result} perQueryUs=${sample ? perQueryMicros(sample.seconds, 2000).toFixed(3) : '-'}`);
    log(`profiler clamp: ${clampIterations(-5)} ${clampIterations(3.9)} ${clampIterations(1e9)}`);

    // Real profile of a query on BOTH engines over advanced_queries.zx.
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const source = await window.znxstudio.fs.readFile('C:\\Studio Apps\\xojin\\examples\\data\\advanced_queries.zx');
        const runExpr = buildRunExpression(parseQuery('find count from Db.People where age is greater than 18'));
        const file = `${tempDir}\\znxstudio-profile.zx`;
        await window.znxstudio.fs.writeFile(file, buildProfileProgram(source, runExpr, 2000));
        for (const engine of ENGINES) {
          const { output } = await captureTask(`"${info.path}" ${engine.command} "${file}"`, tempDir);
          const s = parseProfile(output);
          log(`profiler REAL ${engine.label}: total=${s ? (s.seconds * 1000).toFixed(2) : '-'}ms perQuery=${s ? perQueryMicros(s.seconds, 2000).toFixed(2) : '-'}µs acc=${s?.result}`);
        }
      } else {
        log('profiler REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`profiler REAL failed: ${(error as Error).message}`);
    }
  }
}
