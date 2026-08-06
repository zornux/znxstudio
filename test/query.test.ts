import { describe, expect, test } from './harness';
import {
  buildRunExpression,
  parseQuery,
  validateQuery,
  whereClause,
} from '../src/renderer/database/queryModel';

describe('parseQuery — find', () => {
  test('parses a simple find all', () => {
    const q = parseQuery('find all from Db.People');
    expect(q.ok).toBe(true);
    expect(q.kind).toBe('find');
    expect(q.resultMode).toBe('all');
    expect(q.database).toBe('Db');
    expect(q.table).toBe('People');
    expect(q.where).toHaveLength(0);
  });

  test('parses where with a multi-word operator', () => {
    const q = parseQuery('find count from Db.People where age is greater than or equal to 18');
    expect(q.resultMode).toBe('count');
    expect(q.where).toHaveLength(1);
    expect(q.where[0]).toEqual({
      field: 'age',
      operator: 'is greater than or equal to',
      value: '18',
      connector: null,
    });
  });

  test('parses and/or conditions, sorted by, and first', () => {
    const q = parseQuery('find all from Db.People where city is "London" and age is greater than 20 sorted by age descending first 2');
    expect(q.where).toHaveLength(2);
    expect(q.where[0]).toEqual({ field: 'city', operator: 'is', value: '"London"', connector: null });
    expect(q.where[1]).toEqual({ field: 'age', operator: 'is greater than', value: '20', connector: 'and' });
    expect(q.sortBy).toBe('age');
    expect(q.sortDir).toBe('descending');
    expect(q.limit).toBe(2);
  });
});

describe('parseQuery — aggregate + errors', () => {
  test('parses an aggregate', () => {
    const q = parseQuery('average of age from Db.People');
    expect(q.kind).toBe('aggregate');
    expect(q.aggregate).toBe('average');
    expect(q.aggregateField).toBe('age');
    expect(q.table).toBe('People');
  });

  test('rejects a non-query', () => {
    expect(parseQuery('select * from users').ok).toBe(false);
    expect(parseQuery('').ok).toBe(false);
  });

  test('rejects a bad source', () => {
    expect(parseQuery('find all from People').ok).toBe(false);
  });
});

describe('validateQuery', () => {
  const cols = { People: ['name', 'age', 'city'] };

  test('accepts a well-formed query', () => {
    expect(validateQuery(parseQuery('find all from Db.People where age is greater than 10'), cols)).toHaveLength(0);
  });

  test('flags an unknown table', () => {
    expect(validateQuery(parseQuery('find all from Db.Ghost'), cols)[0]).toContain('Unknown table');
  });

  test('flags unknown fields in where and sort', () => {
    const diags = validateQuery(parseQuery('find all from Db.People where nope is 1 sorted by bad'), cols);
    expect(diags).toHaveLength(2);
    expect(diags[0]).toContain('nope');
    expect(diags[1]).toContain('bad');
  });
});

describe('whereClause + buildRunExpression', () => {
  test('reconstructs a where clause', () => {
    const q = parseQuery('find one from Db.People where age is 5 and city is "X"');
    expect(whereClause(q.where)).toBe(' where age is 5 and city is "X"');
  });

  test('find of any mode becomes find count', () => {
    expect(buildRunExpression(parseQuery('find all from Db.People where age is greater than 18'))).toBe(
      'find count from Db.People where age is greater than 18',
    );
  });

  test('aggregate stays itself', () => {
    expect(buildRunExpression(parseQuery('sum of age from Db.People'))).toBe('sum of age from Db.People');
  });
});
