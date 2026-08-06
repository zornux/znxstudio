/**
 * Pure Zornux ORM query parsing + validation (Phase 8C). Zornux has no raw SQL —
 * queries are the English ORM surface (verified against xojin/examples/data):
 *
 *   find all|one|any|count from Db.Table [where <cond> [and|or <cond>]…]
 *        [sorted by <field> [ascending|descending]] [first <N>]
 *   sum|average|minimum|maximum of <field> from Db.Table [where …]
 *
 * Conditions: `<field> <operator> <value>` — operators is / is not / contains /
 * is greater than [or equal to] / is less than [or equal to]. No DOM / no Monaco.
 */
export const RESULT_MODES = ['all', 'one', 'any', 'count'] as const;
export const AGGREGATES = ['sum', 'average', 'minimum', 'maximum'] as const;
// Longest-first so multi-word operators match before their prefixes.
export const OPERATORS = [
  'is greater than or equal to',
  'is less than or equal to',
  'is greater than',
  'is less than',
  'is not',
  'contains',
  'is',
] as const;

export type ResultMode = (typeof RESULT_MODES)[number];
export type Aggregate = (typeof AGGREGATES)[number];

export interface Condition {
  field: string;
  operator: string;
  value: string;
  /** How this condition joins the previous one (null for the first). */
  connector: 'and' | 'or' | null;
}

export interface ParsedQuery {
  ok: boolean;
  error?: string;
  raw: string;
  kind: 'find' | 'aggregate';
  resultMode?: ResultMode;
  aggregate?: Aggregate;
  aggregateField?: string;
  database: string;
  table: string;
  where: Condition[];
  sortBy?: string;
  sortDir?: 'ascending' | 'descending';
  limit?: number;
}

function fail(raw: string, error: string): ParsedQuery {
  return { ok: false, error, raw, kind: 'find', database: '', table: '', where: [] };
}

const SOURCE_RE = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$/;

/** Parse a single ORM query. Returns `ok:false` + a message on a syntax problem. */
export function parseQuery(input: string): ParsedQuery {
  const raw = input.trim();
  const text = raw.replace(/\s+/g, ' ');
  if (text === '') return fail(raw, 'Empty query.');

  const findMatch = /^find (all|one|any|count) from (\S+)(.*)$/i.exec(text);
  const aggMatch = /^(sum|average|minimum|maximum) of (\w+) from (\S+)(.*)$/i.exec(text);

  let base: ParsedQuery;
  let tail: string;

  if (aggMatch) {
    const source = parseSource(aggMatch[3]);
    if (!source) return fail(raw, `Expected "Database.Table", got "${aggMatch[3]}".`);
    base = {
      ok: true,
      raw,
      kind: 'aggregate',
      aggregate: aggMatch[1].toLowerCase() as Aggregate,
      aggregateField: aggMatch[2],
      database: source.database,
      table: source.table,
      where: [],
    };
    tail = aggMatch[4];
  } else if (findMatch) {
    const source = parseSource(findMatch[2]);
    if (!source) return fail(raw, `Expected "Database.Table", got "${findMatch[2]}".`);
    base = {
      ok: true,
      raw,
      kind: 'find',
      resultMode: findMatch[1].toLowerCase() as ResultMode,
      database: source.database,
      table: source.table,
      where: [],
    };
    tail = findMatch[3];
  } else {
    return fail(raw, 'Query must start with `find all|one|any|count from …` or an aggregate (`sum of … from …`).');
  }

  return parseTail(base, tail.trim());
}

function parseSource(token: string): { database: string; table: string } | null {
  const match = SOURCE_RE.exec(token);
  return match ? { database: match[1], table: match[2] } : null;
}

/** Parse the optional where / sorted by / first clauses. */
function parseTail(query: ParsedQuery, tail: string): ParsedQuery {
  if (tail === '') return query;

  // `first N` (pagination) — pull it off the end.
  const first = / first (\d+)$/i.exec(` ${tail}`);
  if (first) {
    query.limit = Number(first[1]);
    tail = tail.slice(0, tail.length - first[0].trim().length).trim();
  }

  // `sorted by <field> [ascending|descending]`
  const sort = /(^|\s)sorted by (\w+)( ascending| descending)?$/i.exec(tail);
  if (sort) {
    query.sortBy = sort[2];
    query.sortDir = sort[3] ? (sort[3].trim().toLowerCase() as 'ascending' | 'descending') : undefined;
    tail = tail.slice(0, sort.index).trim();
  }

  if (tail === '') return query;

  const whereMatch = /^where (.+)$/i.exec(tail);
  if (!whereMatch) return fail(query.raw, `Unexpected clause: "${tail}".`);

  const conditions = parseConditions(whereMatch[1]);
  if (typeof conditions === 'string') return fail(query.raw, conditions);
  query.where = conditions;
  return query;
}

/**
 * Parse a where body into conditions, or return an error string. Walks left to
 * right matching the LONGEST operator first — so the `or` inside `greater than
 * or equal to` is part of the operator, not a boolean connector — and reads
 * quoted values whole (so `and`/`or` inside a string never splits a condition).
 */
function parseConditions(body: string): Condition[] | string {
  const conditions: Condition[] = [];
  let rest = body.trim();
  let connector: 'and' | 'or' | null = null;

  while (rest.length > 0) {
    const fieldMatch = /^(\w+)\s+/.exec(rest);
    if (!fieldMatch) return `Bad condition near "${rest}".`;
    const field = fieldMatch[1];
    const afterField = rest.slice(fieldMatch[0].length);

    const operator = OPERATORS.find(
      (op) => afterField.toLowerCase() === op || afterField.toLowerCase().startsWith(`${op} `),
    );
    if (!operator) return `Unknown operator near "${afterField}".`;
    let afterOp = afterField.slice(operator.length).replace(/^\s+/, '');

    let value: string;
    if (afterOp.startsWith('"')) {
      const end = afterOp.indexOf('"', 1);
      if (end === -1) return 'Unterminated string in condition.';
      value = afterOp.slice(0, end + 1);
      afterOp = afterOp.slice(end + 1).trim();
    } else {
      const next = /\s(and|or)\s/i.exec(afterOp);
      value = (next ? afterOp.slice(0, next.index) : afterOp).trim();
      afterOp = next ? afterOp.slice(next.index).trim() : '';
    }

    conditions.push({ field, operator, value, connector });

    const connectorMatch = /^(and|or)\s+/i.exec(afterOp);
    if (connectorMatch) {
      connector = connectorMatch[1].toLowerCase() as 'and' | 'or';
      rest = afterOp.slice(connectorMatch[0].length).trim();
    } else if (afterOp === '') {
      rest = '';
    } else {
      return `Unexpected text in condition: "${afterOp}".`;
    }
  }

  return conditions;
}

/** Reconstruct the `where …` clause text from parsed conditions (or ''). */
export function whereClause(conditions: Condition[]): string {
  if (conditions.length === 0) return '';
  const parts = conditions.map(
    (condition, index) =>
      `${index === 0 ? '' : ` ${condition.connector} `}${condition.field} ${condition.operator}${condition.value ? ` ${condition.value}` : ''}`,
  );
  return ` where ${parts.join('')}`;
}

/**
 * A scalar expression that safely runs the query for a numeric result — a `find`
 * of any mode becomes `find count` (row count), an aggregate stays itself. Avoids
 * `text()`-of-collection issues so a query always yields a printable number.
 */
export function buildRunExpression(query: ParsedQuery): string {
  const source = `${query.database}.${query.table}`;
  if (query.kind === 'aggregate') {
    return `${query.aggregate} of ${query.aggregateField} from ${source}${whereClause(query.where)}`;
  }
  return `find count from ${source}${whereClause(query.where)}`;
}

/** Semantic validation against a database's tables → column names. */
export function validateQuery(query: ParsedQuery, columnsByTable: Record<string, string[]>): string[] {
  const diagnostics: string[] = [];
  if (!query.ok) {
    if (query.error) diagnostics.push(query.error);
    return diagnostics;
  }
  const columns = columnsByTable[query.table];
  if (!columns) {
    diagnostics.push(`Unknown table "${query.table}" in database "${query.database}".`);
    return diagnostics;
  }
  const known = new Set(columns);
  const check = (field: string | undefined, context: string) => {
    if (field && !known.has(field)) diagnostics.push(`Unknown field "${field}" in ${context}.`);
  };
  for (const condition of query.where) check(condition.field, 'the where clause');
  check(query.sortBy, '"sorted by"');
  check(query.aggregateField, 'the aggregate');
  return diagnostics;
}
