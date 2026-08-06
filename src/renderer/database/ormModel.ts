/**
 * Pure ORM analysis (Phase 8G — the Database capstone). Cross-checks a file's ORM
 * operations against its declared databases (8A) + schema (8B). Real ORM surface
 * (xojin/examples/data): `create <v> from <Class>`, `save <v> into <Db>.<Table>`,
 * `delete <v> from <Db>.<Table>`, `find all|one|any|count from <Db>.<Table>`.
 * Surfaces type mismatches (saving the wrong entity), unknown references, and a
 * per-table CRUD summary. No DOM / no Monaco.
 */
import { buildSchema } from './schemaModel';
import { parseTypeFields } from './schemaModel';

export type OrmOpKind = 'create' | 'save' | 'delete' | 'find';

export interface OrmOperation {
  kind: OrmOpKind;
  line: number;
  variable?: string;
  className?: string;
  database?: string;
  table?: string;
  resultMode?: string;
}

export interface OrmDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  line: number;
}

export interface TableUsage {
  database: string;
  table: string;
  from: string;
  creates: number;
  reads: number;
  deletes: number;
}

export interface OrmAnalysis {
  operations: OrmOperation[];
  diagnostics: OrmDiagnostic[];
  tables: TableUsage[];
  /** Class name → the tables (Db.Table) it is stored in. */
  entities: { className: string; tables: string[] }[];
}

const CREATE_FROM_RE = /^\s*create\s+(\w+)\s+from\s+(\w+)/;
const CREATE_BIND_RE = /^\s*create\s+(\w+)\s*=\s*(.+)$/;
const SAVE_RE = /^\s*save\s+(\w+)\s+into\s+(\w+)\.(\w+)/;
const DELETE_RE = /^\s*delete\s+(\w+)\s+from\s+(\w+)\.(\w+)/;
const FIND_RE = /find\s+(all|one|any|count)\s+from\s+(\w+)\.(\w+)/g;
const FIND_ONE_BIND_RE = /find\s+one\s+from\s+(\w+)\.(\w+)/;

export function analyzeOrm(text: string): OrmAnalysis {
  const schemas = buildSchema(text);
  const classes = new Set(parseTypeFields(text).keys());

  const databases = new Set<string>();
  const tableFrom = new Map<string, string>(); // "Db.Table" -> class
  for (const db of schemas) {
    databases.add(db.name);
    for (const table of db.tables) tableFrom.set(`${db.name}.${table.table}`, table.from);
  }

  const usage = new Map<string, TableUsage>();
  for (const db of schemas) {
    for (const table of db.tables) {
      usage.set(`${db.name}.${table.table}`, {
        database: db.name,
        table: table.table,
        from: table.from,
        creates: 0,
        reads: 0,
        deletes: 0,
      });
    }
  }

  const operations: OrmOperation[] = [];
  const diagnostics: OrmDiagnostic[] = [];
  const varClass = new Map<string, string>();
  const lines = text.split(/\r?\n/);

  const checkRef = (database: string, table: string, line: number): boolean => {
    if (!databases.has(database)) {
      diagnostics.push({ severity: 'warning', message: `References undeclared database "${database}".`, line });
      return false;
    }
    if (!tableFrom.has(`${database}.${table}`)) {
      diagnostics.push({ severity: 'warning', message: `Unknown table "${database}.${table}".`, line });
      return false;
    }
    return true;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const createFrom = CREATE_FROM_RE.exec(line);
    if (createFrom) {
      varClass.set(createFrom[1], createFrom[2]);
      operations.push({ kind: 'create', line: i, variable: createFrom[1], className: createFrom[2] });
      if (!classes.has(createFrom[2])) {
        diagnostics.push({ severity: 'warning', message: `Unknown class "${createFrom[2]}".`, line: i });
      }
    } else {
      const bind = CREATE_BIND_RE.exec(line);
      if (bind) {
        const findOne = FIND_ONE_BIND_RE.exec(bind[2]);
        if (findOne) {
          const from = tableFrom.get(`${findOne[1]}.${findOne[2]}`);
          if (from) varClass.set(bind[1], from);
        }
      }
    }

    const save = SAVE_RE.exec(line);
    if (save) {
      const key = `${save[2]}.${save[3]}`;
      operations.push({ kind: 'save', line: i, variable: save[1], database: save[2], table: save[3] });
      if (checkRef(save[2], save[3], i)) {
        usage.get(key)!.creates += 1;
        const declared = varClass.get(save[1]);
        const stores = tableFrom.get(key);
        if (declared && stores && declared !== stores) {
          diagnostics.push({
            severity: 'error',
            message: `Saving a ${declared} into ${key}, which stores ${stores}.`,
            line: i,
          });
        }
      }
    }

    const del = DELETE_RE.exec(line);
    if (del) {
      const key = `${del[2]}.${del[3]}`;
      operations.push({ kind: 'delete', line: i, variable: del[1], database: del[2], table: del[3] });
      if (checkRef(del[2], del[3], i)) usage.get(key)!.deletes += 1;
    }

    FIND_RE.lastIndex = 0;
    let find: RegExpExecArray | null;
    while ((find = FIND_RE.exec(line))) {
      const key = `${find[2]}.${find[3]}`;
      operations.push({ kind: 'find', line: i, resultMode: find[1], database: find[2], table: find[3] });
      if (checkRef(find[2], find[3], i)) usage.get(key)!.reads += 1;
    }
  }

  const entities = [...classes].sort().map((className) => ({
    className,
    tables: [...tableFrom.entries()].filter(([, from]) => from === className).map(([key]) => key),
  }));

  return { operations, diagnostics, tables: [...usage.values()], entities };
}
