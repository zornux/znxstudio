/**
 * Pure schema derivation (Phase 8B). A Zornux table maps to a class/record
 * (`table Notes from Note`); its columns are that type's `has` fields, with any
 * indented validation constraints (required / minimum length N / email …). Class
 * bodies contain nested `function … end` methods, so a type block is bounded by
 * a COLUMN-0 `end` (nested ends are indented). Builds on 8A's block parser.
 * No DOM / no Monaco.
 */
import { parseDatabaseBlocks, type DatabaseConnection } from './databaseModel';

export interface Column {
  name: string;
  /** The conventional primary key — a field literally named `id`. */
  isId: boolean;
  isPrivate: boolean;
  /** Trimmed constraint lines under the field (required, minimum length 2, …). */
  constraints: string[];
}

export interface TableSchema {
  table: string;
  from: string;
  columns: Column[];
  /** False when the mapped class/record wasn't found in the same source. */
  resolved: boolean;
}

export interface DatabaseSchema extends Omit<DatabaseConnection, 'tables'> {
  tables: TableSchema[];
}

const TYPE_RE = /^(class|record)\s+([A-Za-z_]\w*)/;
const HAS_RE = /^(private\s+)?has\s+([A-Za-z_]\w*)/;
const METHOD_RE = /^(async\s+)?function\b/;

/** Map every class/record name in the source to its ordered field columns. */
export function parseTypeFields(text: string): Map<string, Column[]> {
  const lines = text.split(/\r?\n/);
  const types = new Map<string, Column[]>();

  for (let i = 0; i < lines.length; i += 1) {
    const header = TYPE_RE.exec(lines[i]);
    if (!header) continue;

    const columns: Column[] = [];
    let current: Column | null = null;
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      if (/^end\b/.test(lines[j])) break; // column-0 end closes the type
      const trimmed = lines[j].trim();
      if (trimmed === '') continue;

      const field = HAS_RE.exec(trimmed);
      if (field) {
        current = { name: field[2], isId: field[2] === 'id', isPrivate: Boolean(field[1]), constraints: [] };
        columns.push(current);
        continue;
      }
      if (METHOD_RE.test(trimmed) || /^use\b/.test(trimmed)) {
        current = null; // methods/dependencies end the field list scope
        continue;
      }
      if (current) current.constraints.push(trimmed);
    }

    types.set(header[2], columns);
    i = j;
  }

  return types;
}

/** Resolve each database's tables to their column schema from types in the same source. */
export function buildSchema(text: string): DatabaseSchema[] {
  const types = parseTypeFields(text);
  return parseDatabaseBlocks(text).map((db) => ({
    name: db.name,
    provider: db.provider,
    connection: db.connection,
    migrateOnOpen: db.migrateOnOpen,
    line: db.line,
    tables: db.tables.map((table) => {
      const columns = types.get(table.from);
      return {
        table: table.table,
        from: table.from,
        columns: columns ?? [],
        resolved: columns !== undefined,
      };
    }),
  }));
}
