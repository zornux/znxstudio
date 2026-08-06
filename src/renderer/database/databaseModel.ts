/**
 * Pure parser for Zornux `database` declarations (Phase 8A). A Zornux "database
 * connection" is source-declared via a top-level `database … end` block (real
 * ORM grammar, verified against xojin/examples/data):
 *
 *   database Notebook
 *       provider sqlite
 *       connection "store.sqlite"
 *       table Notes from Note
 *       migrate on open
 *   end
 *
 * No DOM / no Monaco — the Database module reads files and renders what this
 * returns.
 */
export interface TableMapping {
  table: string;
  from: string;
}

export interface DatabaseConnection {
  name: string;
  /** 'memory' | 'sqlite' | … (whatever the source declares). */
  provider: string;
  /** The connection string (e.g. a SQLite file path), if declared. */
  connection?: string;
  tables: TableMapping[];
  migrateOnOpen: boolean;
  /** 0-based line of the `database` declaration. */
  line: number;
}

const DATABASE_RE = /^database\s+([A-Za-z_]\w*)/;
const PROVIDER_RE = /^provider\s+([A-Za-z_]\w*)/;
const CONNECTION_RE = /^connection\s+"([^"]*)"/;
const TABLE_RE = /^table\s+([A-Za-z_]\w*)\s+from\s+([A-Za-z_]\w*)/;
const MIGRATE_RE = /^migrate\s+on\s+open\b/;

/** Every top-level `database … end` block in the source. */
export function parseDatabaseBlocks(text: string): DatabaseConnection[] {
  const lines = text.split(/\r?\n/);
  const blocks: DatabaseConnection[] = [];

  for (let i = 0; i < lines.length; i += 1) {
    const header = DATABASE_RE.exec(lines[i]);
    if (!header) continue;

    const connection: DatabaseConnection = {
      name: header[1],
      provider: 'unknown',
      tables: [],
      migrateOnOpen: false,
      line: i,
    };

    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const trimmed = lines[j].trim();
      if (trimmed === 'end' || /^end\b/.test(trimmed)) break;

      const provider = PROVIDER_RE.exec(trimmed);
      if (provider) {
        connection.provider = provider[1];
        continue;
      }
      const conn = CONNECTION_RE.exec(trimmed);
      if (conn) {
        connection.connection = conn[1];
        continue;
      }
      const table = TABLE_RE.exec(trimmed);
      if (table) {
        connection.tables.push({ table: table[1], from: table[2] });
        continue;
      }
      if (MIGRATE_RE.test(trimmed)) connection.migrateOnOpen = true;
    }

    blocks.push(connection);
    i = j; // resume after the block's `end`
  }

  return blocks;
}

/** True for providers whose connection string points at a real on-disk store. */
export function isFileBackedProvider(provider: string): boolean {
  return provider.toLowerCase() === 'sqlite';
}

/** A short human summary of a connection's target. */
export function describeTarget(connection: DatabaseConnection): string {
  if (connection.connection) return connection.connection;
  return connection.provider === 'memory' ? 'in-memory (ephemeral)' : '(no connection string)';
}
