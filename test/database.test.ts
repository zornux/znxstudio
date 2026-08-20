import { describe, expect, test } from './harness';
import {
  describeTarget,
  isFileBackedProvider,
  parseDatabaseBlocks,
} from '../src/renderer/database/databaseModel';

const DURABLE = `class Note
    has id
    has title
end

database Notebook
    provider sqlite
    connection "store.sqlite"
    table Notes from Note
    migrate on open
end
`;

const MULTI = `database AppDb
    provider memory
    table Users from User
    table Sessions from Session
end

database Analytics
    provider sqlite
    connection "metrics.db"
    table Events from Event
end
`;

describe('parseDatabaseBlocks', () => {
  test('parses a full sqlite database block', () => {
    const blocks = parseDatabaseBlocks(DURABLE);
    expect(blocks).toHaveLength(1);
    const db = blocks[0];
    expect(db.name).toBe('Notebook');
    expect(db.provider).toBe('sqlite');
    expect(db.connection).toBe('store.sqlite');
    expect(db.tables).toEqual([{ table: 'Notes', from: 'Note' }]);
    expect(db.migrateOnOpen).toBe(true);
    expect(db.line).toBe(5);
  });

  test('parses multiple databases and multiple tables', () => {
    const blocks = parseDatabaseBlocks(MULTI);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].name).toBe('AppDb');
    expect(blocks[0].tables).toHaveLength(2);
    expect(blocks[0].tables[1]).toEqual({ table: 'Sessions', from: 'Session' });
    expect(blocks[1].name).toBe('Analytics');
    expect(blocks[1].connection).toBe('metrics.db');
  });

  test('a memory database has no connection string and migrate defaults false', () => {
    const blocks = parseDatabaseBlocks('database D\n    provider memory\n    table T from C\nend\n');
    expect(blocks[0].connection).toBeFalsy();
    expect(blocks[0].migrateOnOpen).toBe(false);
    expect(blocks[0].provider).toBe('memory');
  });

  test('no database blocks yields an empty list', () => {
    expect(parseDatabaseBlocks('class X\n    has y\nend\n')).toHaveLength(0);
  });

  test('parses a postgres database block with a connection string', () => {
    const source = `database ShopDb\n    provider postgres\n    connection "host=localhost dbname=shop"\n    table Products from Product\n    table Orders from Order\n    migrate on open\nend\n`;
    const blocks = parseDatabaseBlocks(source);
    expect(blocks).toHaveLength(1);
    const db = blocks[0];
    expect(db.name).toBe('ShopDb');
    expect(db.provider).toBe('postgres');
    expect(db.connection).toBe('host=localhost dbname=shop');
    expect(db.tables).toHaveLength(2);
    expect(db.migrateOnOpen).toBe(true);
  });
});

describe('helpers', () => {
  test('isFileBackedProvider is true only for sqlite', () => {
    expect(isFileBackedProvider('sqlite')).toBe(true);
    expect(isFileBackedProvider('SQLite')).toBe(true);
    expect(isFileBackedProvider('memory')).toBe(false);
    expect(isFileBackedProvider('postgres')).toBe(false);
  });

  test('describeTarget prefers the connection string, else summarises', () => {
    const blocks = parseDatabaseBlocks(MULTI);
    expect(describeTarget(blocks[0])).toBe('in-memory (ephemeral)');
    expect(describeTarget(blocks[1])).toBe('metrics.db');
  });

  test('describeTarget shows connection string for postgres', () => {
    const blocks = parseDatabaseBlocks('database Db\n    provider postgres\n    connection "host=db.example.com dbname=app"\nend\n');
    expect(describeTarget(blocks[0])).toBe('host=db.example.com dbname=app');
  });
});
