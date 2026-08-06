/**
 * Pure migration parsing + status (Phase 8D). Zornux migrations are ordered
 * `migration <Name> … end` blocks (real grammar from xojin/examples/data/
 * migrations.zx): `create table <T> from <Class>`, `add field <f> to <T>`. The
 * real CLI (`zornux db status|migrate|rollback <file>`) reports/applies them;
 * `parseDbStatus` reads the `status` text. No DOM / no Monaco.
 */
export type MigrationOpKind = 'create-table' | 'add-field' | 'other';

export interface MigrationOp {
  kind: MigrationOpKind;
  /** The raw operation line (trimmed). */
  text: string;
  table?: string;
  from?: string;
  field?: string;
}

export interface Migration {
  name: string;
  operations: MigrationOp[];
  /** 0-based line of the `migration` declaration. */
  line: number;
}

const MIGRATION_RE = /^migration\s+([A-Za-z_]\w*)/;
const CREATE_TABLE_RE = /^create\s+table\s+([A-Za-z_]\w*)\s+from\s+([A-Za-z_]\w*)/;
const ADD_FIELD_RE = /^add\s+field\s+([A-Za-z_]\w*)\s+to\s+([A-Za-z_]\w*)/;

/** Every top-level `migration … end` block in the source, in order. */
export function parseMigrations(text: string): Migration[] {
  const lines = text.split(/\r?\n/);
  const migrations: Migration[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = MIGRATION_RE.exec(lines[i]);
    if (!header) continue;

    const operations: MigrationOp[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (/^end\b/.test(lines[j])) break; // column-0 end
      const trimmed = lines[j].trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      operations.push(parseOperation(trimmed));
    }

    migrations.push({ name: header[1], operations, line: i });
    i = j;
  }

  return migrations;
}

function parseOperation(text: string): MigrationOp {
  const create = CREATE_TABLE_RE.exec(text);
  if (create) return { kind: 'create-table', text, table: create[1], from: create[2] };
  const add = ADD_FIELD_RE.exec(text);
  if (add) return { kind: 'add-field', text, field: add[1], table: add[2] };
  return { kind: 'other', text };
}

export interface DbMigrationStatus {
  database: string;
  applied: string[];
  pending: string[];
}

function statusList(value: string): string[] {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.toLowerCase() === 'none') return [];
  return trimmed.split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Parse `zornux db status` text:
 *   Store:
 *     applied (0): none
 *     pending (2): CreateProducts, AddSku
 */
export function parseDbStatus(output: string): DbMigrationStatus[] {
  const statuses: DbMigrationStatus[] = [];
  let current: DbMigrationStatus | null = null;

  for (const raw of output.split(/\r?\n/)) {
    const header = /^([A-Za-z_]\w*):\s*$/.exec(raw);
    if (header) {
      current = { database: header[1], applied: [], pending: [] };
      statuses.push(current);
      continue;
    }
    if (!current) continue;
    const applied = /^\s+applied\s+\(\d+\):\s*(.*)$/.exec(raw);
    if (applied) {
      current.applied = statusList(applied[1]);
      continue;
    }
    const pending = /^\s+pending\s+\(\d+\):\s*(.*)$/.exec(raw);
    if (pending) current.pending = statusList(pending[1]);
  }

  return statuses;
}

export type MigrationSpec =
  | { name: string; kind: 'create-table'; table: string; from: string }
  | { name: string; kind: 'add-field'; field: string; table: string };

/** Generate a `migration … end` block (the Designer's output). */
export function generateMigration(spec: MigrationSpec): string {
  const operation =
    spec.kind === 'create-table'
      ? `create table ${spec.table} from ${spec.from}`
      : `add field ${spec.field} to ${spec.table}`;
  return `migration ${spec.name}\n    ${operation}\nend\n`;
}
