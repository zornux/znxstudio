/**
 * Pure data-browsing synthesis (Phase 8E). Zornux has no external row driver —
 * rows are read THROUGH the ORM. We synthesize a temp program (the source, which
 * seeds/opens the store, plus a `for each … show` loop that prints each row's
 * columns behind a marker) and parse the captured output into a grid. Repo-safe
 * (runs from OS temp). No DOM / no Monaco.
 */
export const ROW_MARK = '__ROW__';
export const CELL_SEP = '<|>';

/**
 * Build a runnable program that prints every row of `database.table`, one line
 * per row: `__ROW__<col0><|><col1>…`. Columns should exclude private fields
 * (they aren't readable from outside the class).
 */
export function buildBrowseProgram(
  source: string,
  database: string,
  table: string,
  columns: string[],
): string {
  const cells = columns.map((column) => `text(row.${column})`).join(` + "${CELL_SEP}" + `);
  const show = cells === '' ? `"${ROW_MARK}"` : `"${ROW_MARK}" + ${cells}`;
  return `${source}\nfor each row in find all from ${database}.${table}\n    show ${show}\nend\n`;
}

/** Parse the captured output into rows of cell strings (marker lines only). */
export function parseRows(output: string): string[][] {
  const rows: string[][] = [];
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf(ROW_MARK);
    if (index === -1) continue;
    const rest = line.slice(index + ROW_MARK.length);
    rows.push(rest === '' ? [] : rest.split(CELL_SEP));
  }
  return rows;
}
