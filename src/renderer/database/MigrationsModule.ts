import {
  ServiceKeys,
  type CompilerService,
  type DatabaseService,
  type EditorService,
  type InputBoxService,
  type QuickPickService,
} from '../core/Contracts';
import { selfTestCoordinator } from '../core/SelfTestCoordinator';
import { examplePath } from '../core/selftestFixtures';
import type { IModule, ModuleContext } from '../core/Module';
import { CommandIds } from '../commands/CommandIds';
import { joinPath } from '../explorer/paths';
import {
  generateMigration,
  parseDbStatus,
  parseMigrations,
  type DbMigrationStatus,
  type Migration,
  type MigrationSpec,
} from './migrationModel';
import { captureTask } from './runCapture';

interface FileSection {
  file: string;
  databases: string[];
  migrations: Migration[];
  statuses: DbMigrationStatus[];
}

const OP_ICON: Record<string, string> = { 'create-table': '➕▦', 'add-field': '➕', other: '•' };

/**
 * Migration Designer (Phase 8D). Lists each file's `migration` blocks with live
 * applied/pending status from the REAL `zornux db status`, drives `db migrate` /
 * `db rollback`, and generates new migration blocks. CLI calls reuse the task
 * capture (no new IPC). Grounded in xojin/examples/data/migrations.zx.
 */
export class MigrationsModule implements IModule {
  readonly id = 'znxstudio.migrations';
  readonly displayName = 'Migrations';

  private context!: ModuleContext;
  private database: DatabaseService | undefined;
  private panel!: HTMLElement;
  private sections: FileSection[] = [];
  private busy = false;
  private creatingMigration = false;

  activate(context: ModuleContext): void {
    this.context = context;
    this.database = context.services.tryGet<DatabaseService>(ServiceKeys.Database);

    this.panel = document.createElement('div');
    this.panel.className = 'znxstudio-migrations';
    context.layout.addPanelView({ id: 'migrations', title: 'Migrations', element: this.panel });

    context.commands.register(CommandIds.MigrationsShow, () => this.context.layout.showPanelView('migrations'), 'Database: Show Migrations');
    context.commands.register(CommandIds.MigrationsRefresh, () => this.discover(), 'Database: Refresh Migrations');
    context.commands.register(CommandIds.MigrationNew, () => this.newMigration(), 'Database: New Migration');
    context.commands.addEnablementRule((id) => id === CommandIds.MigrationNew
      ? !this.creatingMigration && Boolean(context.services.tryGet<EditorService>(ServiceKeys.Editor)?.currentFile()?.toLowerCase().endsWith('.zx'))
      : undefined);

    if (this.database) context.subscriptions.push(this.database.onDidChange(() => void this.discover()));
    this.renderMessage('Open a folder with `migration … end` blocks.');
    void this.discover();
    void selfTestCoordinator.run('migrations', () => this.maybeSelfTest());
  }

  private async compilerPath(): Promise<string | null> {
    const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
    const info = compiler ? await compiler.info() : null;
    return info?.available && info.path ? info.path : null;
  }

  private dirOf(file: string): string {
    return file.replace(/[\\/][^\\/]*$/, '');
  }

  private async discover(): Promise<void> {
    const connections = this.database?.connections() ?? [];
    const files = [...new Set(connections.map((c) => c.file))];
    if (files.length === 0) {
      this.sections = [];
      this.renderMessage('No databases/migrations in this workspace.');
      return;
    }

    const compilerPath = await this.compilerPath();
    const sections: FileSection[] = [];
    for (const file of files) {
      let text: string;
      try {
        text = await window.znxstudio.fs.readFile(file);
      } catch {
        continue;
      }
      const migrations = parseMigrations(text);
      if (migrations.length === 0) continue;
      let statuses: DbMigrationStatus[] = [];
      if (compilerPath) {
        const { output } = await captureTask(`"${compilerPath}" db status "${file}"`, this.dirOf(file));
        statuses = parseDbStatus(output);
      }
      sections.push({
        file,
        databases: connections.filter((c) => c.file === file).map((c) => c.name),
        migrations,
        statuses,
      });
    }
    this.sections = sections;
    this.render();
  }

  private async runDb(subcommand: 'migrate' | 'rollback', file: string): Promise<void> {
    if (this.busy) return;
    const compilerPath = await this.compilerPath();
    if (!compilerPath) {
      this.context.layout.showToast('Zornux compiler not available.', 'error');
      return;
    }
    this.busy = true;
    try {
      const { output } = await captureTask(`"${compilerPath}" db ${subcommand} "${file}"`, this.dirOf(file));
      const summary = output.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' — ') || `${subcommand} done`;
      this.context.layout.showToast(summary, 'success');
    } catch (error) {
      this.context.layout.showToast(`db ${subcommand} failed: ${(error as Error).message}`, 'error');
    } finally {
      this.busy = false;
    }
    await this.discover();
  }

  private renderMessage(message: string): void {
    const empty = document.createElement('div');
    empty.className = 'znxstudio-migrations-empty';
    empty.textContent = message;
    this.panel.replaceChildren(empty);
  }

  private render(): void {
    if (this.sections.length === 0) {
      this.renderMessage('No migrations found.');
      return;
    }
    this.panel.replaceChildren();

    for (const section of this.sections) {
      const appliedSet = new Set(section.statuses.flatMap((s) => s.applied));

      const header = document.createElement('div');
      header.className = 'znxstudio-migrations-file';
      const name = document.createElement('span');
      name.textContent = `${this.basename(section.file)} · ${section.databases.join(', ')}`;
      const migrate = document.createElement('button');
      migrate.className = 'znxstudio-btn-small';
      migrate.textContent = '▲ Migrate';
      migrate.title = 'Apply pending migrations (zornux db migrate)';
      migrate.addEventListener('click', () => void this.runDb('migrate', section.file));
      const rollback = document.createElement('button');
      rollback.className = 'znxstudio-btn-small';
      rollback.textContent = '▼ Rollback';
      rollback.title = 'Undo the last migration (zornux db rollback)';
      rollback.addEventListener('click', () => void this.runDb('rollback', section.file));
      header.append(name, migrate, rollback);
      this.panel.appendChild(header);

      for (const migration of section.migrations) {
        this.panel.appendChild(this.renderMigration(migration, appliedSet.has(migration.name), section.file));
      }
    }
  }

  private renderMigration(migration: Migration, applied: boolean, file: string): HTMLElement {
    const row = document.createElement('div');
    row.className = 'znxstudio-migrations-row';

    const status = document.createElement('span');
    status.className = `znxstudio-migrations-status znxstudio-migrations-status--${applied ? 'applied' : 'pending'}`;
    status.textContent = applied ? 'applied' : 'pending';

    const name = document.createElement('span');
    name.className = 'znxstudio-migrations-name';
    name.textContent = migration.name;
    name.addEventListener('click', () => void this.open(file, migration.line));

    const ops = document.createElement('span');
    ops.className = 'znxstudio-migrations-ops';
    ops.textContent = migration.operations
      .map((op) => `${OP_ICON[op.kind] ?? '•'} ${op.text}`)
      .join('   ');

    row.append(status, name, ops);
    return row;
  }

  private async newMigration(): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    const sourceUri = editor?.currentUri();
    if (!editor || !sourceUri || !editor.currentFile()?.toLowerCase().endsWith('.zx')) {
      this.context.layout.showToast('Open a .zx file to insert the migration.', 'info');
      return;
    }
    if (this.creatingMigration) return;

    this.creatingMigration = true;
    this.context.commands.notifyEnablementChanged();
    try {
      const input = this.context.services.get<InputBoxService>(ServiceKeys.InputBox);
      const picker = this.context.services.get<QuickPickService>(ServiceKeys.QuickPick);
      const existingNames = new Set(parseMigrations(editor.activeText() ?? '').map((migration) => migration.name));
      const nameValue = await input.prompt({
        title: 'New Database Migration',
        label: 'Migration name',
        value: 'AddField',
        placeholder: 'For example: AddSkuToProducts',
        submitLabel: 'Choose Operation',
        validate: (value) => validateIdentifier(value, 'Migration name')
          ?? (existingNames.has(value.trim()) ? 'A migration with this name already exists in the file.' : null),
      });
      if (nameValue === null) return;
      const name = nameValue.trim();

      const kind = await picker.pick<MigrationSpec['kind']>([
        { label: 'Create Table', description: 'Create a table from an existing class', value: 'create-table' },
        { label: 'Add Field', description: 'Add one field to an existing table', value: 'add-field' },
      ], { placeholder: 'Select a migration operation' });
      if (kind === undefined) return;

      let spec: MigrationSpec;
      if (kind === 'create-table') {
        const table = await input.prompt({
          title: 'New Database Migration · Create Table',
          label: 'Table name',
          value: 'Products',
          submitLabel: 'Next',
          validate: (value) => validateIdentifier(value, 'Table name'),
        });
        if (table === null) return;
        const from = await input.prompt({
          title: 'New Database Migration · Create Table',
          label: 'Source class',
          value: 'Product',
          submitLabel: 'Insert Migration',
          validate: (value) => validateIdentifier(value, 'Class name'),
        });
        if (from === null) return;
        spec = { name, kind, table: table.trim(), from: from.trim() };
      } else {
        const field = await input.prompt({
          title: 'New Database Migration · Add Field',
          label: 'Field name',
          value: 'sku',
          submitLabel: 'Next',
          validate: (value) => validateIdentifier(value, 'Field name'),
        });
        if (field === null) return;
        const table = await input.prompt({
          title: 'New Database Migration · Add Field',
          label: 'Target table',
          value: 'Products',
          submitLabel: 'Insert Migration',
          validate: (value) => validateIdentifier(value, 'Table name'),
        });
        if (table === null) return;
        spec = { name, kind, field: field.trim(), table: table.trim() };
      }

      if (editor.currentUri() !== sourceUri) {
        this.context.layout.showToast('Migration creation cancelled because the active editor changed.', 'info');
        return;
      }
      editor.insertText(`${generateMigration(spec)}\n`);
      this.context.layout.showToast(`Inserted migration "${name}".`, 'success');
    } catch (error) {
      this.context.layout.showToast(`Could not create migration: ${(error as Error).message}`, 'error');
    } finally {
      this.creatingMigration = false;
      this.context.commands.notifyEnablementChanged();
    }
  }

  private async open(file: string, line: number): Promise<void> {
    const editor = this.context.services.tryGet<EditorService>(ServiceKeys.Editor);
    if (!editor) return;
    await editor.openFile(file);
    editor.revealPosition(line, 0);
  }

  private basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
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

    // Pure parse + status parse + generate.
    const src =
      'class Product\n    has id\n    has name\nend\n\n' +
      'migration CreateProducts\n    create table Products from Product\nend\n\n' +
      'migration AddSku\n    add field sku to Products\nend\n\n' +
      'database Store\n    provider memory\n    table Products from Product\n    migrate on open\nend\n';
    const migrations = parseMigrations(src);
    log(`migrations parse: n=${migrations.length} names=[${migrations.map((m) => m.name).join(',')}] op0=${migrations[0]?.operations[0]?.kind}(${migrations[0]?.operations[0]?.table}) op1=${migrations[1]?.operations[0]?.kind}(${migrations[1]?.operations[0]?.field})`);
    const status = parseDbStatus('Store:\n  applied (1): CreateProducts\n  pending (1): AddSku\n');
    log(`migrations parseStatus: db=${status[0]?.database} applied=[${status[0]?.applied.join(',')}] pending=[${status[0]?.pending.join(',')}]`);
    log(`migrations generate: ${JSON.stringify(generateMigration({ name: 'AddPrice', kind: 'add-field', field: 'price', table: 'Products' }))}`);

    // Real CLI on a TEMP copy of migrations.zx (memory db → no files written).
    try {
      const compiler = this.context.services.tryGet<CompilerService>(ServiceKeys.Compiler);
      const info = compiler ? await compiler.info() : null;
      if (info?.available && info.path && tempDir) {
        const example = await examplePath('data', 'migrations.zx');
        if (!example) {
          log('migrations REAL: no examples root — skipped');
          return;
        }
        const original = await window.znxstudio.fs.readFile(example);
        const copy = joinPath(tempDir, 'znxstudio-mig.zx');
        await window.znxstudio.fs.writeFile(copy, original);
        const statusOut = await captureTask(`"${info.path}" db status "${copy}"`, tempDir);
        const parsed = parseDbStatus(statusOut.output);
        log(`migrations REAL status: ${parsed.map((s) => `${s.database} applied=[${s.applied}] pending=[${s.pending}]`).join(' | ')}`);
        const migrateOut = await captureTask(`"${info.path}" db migrate "${copy}"`, tempDir);
        log(`migrations REAL migrate: "${migrateOut.output.trim().split(/\r?\n/).pop()}"`);
      } else {
        log('migrations REAL: compiler unavailable — skipped');
      }
    } catch (error) {
      log(`migrations REAL failed: ${(error as Error).message}`);
    }
  }
}

function validateIdentifier(value: string, label: string): string | null {
  const normalized = value.trim();
  if (!normalized) return `${label} is required.`;
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)
    ? null
    : `${label} must start with a letter or underscore and contain only letters, numbers, or underscores.`;
}
