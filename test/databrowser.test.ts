import { describe, expect, test } from './harness';
import { buildBrowseProgram, CELL_SEP, parseRows, ROW_MARK } from '../src/renderer/database/dataBrowser';

describe('buildBrowseProgram', () => {
  test('appends a print loop over the table columns', () => {
    const program = buildBrowseProgram('# seed', 'Db', 'People', ['id', 'name', 'age']);
    expect(program).toContain('# seed');
    expect(program).toContain('for each row in find all from Db.People');
    expect(program).toContain(`show "${ROW_MARK}" + text(row.id) + "${CELL_SEP}" + text(row.name) + "${CELL_SEP}" + text(row.age)`);
  });

  test('handles a single column', () => {
    expect(buildBrowseProgram('x', 'D', 'T', ['id'])).toContain(`show "${ROW_MARK}" + text(row.id)`);
  });

  test('handles no columns', () => {
    expect(buildBrowseProgram('x', 'D', 'T', [])).toContain(`show "${ROW_MARK}"`);
  });
});

describe('parseRows', () => {
  test('extracts marker lines into cells and ignores other output', () => {
    const output = ['Products: 4', `${ROW_MARK}1${CELL_SEP}Ada${CELL_SEP}36`, 'noise', `${ROW_MARK}2${CELL_SEP}Bob${CELL_SEP}17`].join('\n');
    expect(parseRows(output)).toEqual([
      ['1', 'Ada', '36'],
      ['2', 'Bob', '17'],
    ]);
  });

  test('a marker with no cells yields an empty row', () => {
    expect(parseRows(`${ROW_MARK}`)).toEqual([[]]);
  });

  test('no markers yields no rows', () => {
    expect(parseRows('nothing here\nat all')).toHaveLength(0);
  });
});
