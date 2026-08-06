import { describe, expect, test } from './harness';
import {
  generateMigration,
  parseDbStatus,
  parseMigrations,
} from '../src/renderer/database/migrationModel';

const SOURCE = `class Product
    has id
    has name
end

migration CreateProducts
    create table Products from Product
end

migration AddSku
    # add a stock-keeping unit
    add field sku to Products
end

database Store
    provider memory
    table Products from Product
    migrate on open
end
`;

describe('parseMigrations', () => {
  test('parses ordered migration blocks with operations', () => {
    const migrations = parseMigrations(SOURCE);
    expect(migrations.map((m) => m.name)).toEqual(['CreateProducts', 'AddSku']);
    expect(migrations[0].operations[0]).toEqual({
      kind: 'create-table',
      text: 'create table Products from Product',
      table: 'Products',
      from: 'Product',
    });
  });

  test('parses add-field and skips comments', () => {
    const addSku = parseMigrations(SOURCE)[1];
    expect(addSku.operations).toHaveLength(1); // the comment line is skipped
    expect(addSku.operations[0]).toEqual({
      kind: 'add-field',
      text: 'add field sku to Products',
      field: 'sku',
      table: 'Products',
    });
  });

  test('no migrations yields an empty list', () => {
    expect(parseMigrations('class X\n    has y\nend\n')).toHaveLength(0);
  });
});

describe('parseDbStatus', () => {
  test('parses applied and pending lists', () => {
    const statuses = parseDbStatus('Store:\n  applied (1): CreateProducts\n  pending (1): AddSku\n');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].database).toBe('Store');
    expect(statuses[0].applied).toEqual(['CreateProducts']);
    expect(statuses[0].pending).toEqual(['AddSku']);
  });

  test('treats "none" as empty', () => {
    const statuses = parseDbStatus('Store:\n  applied (0): none\n  pending (2): A, B\n');
    expect(statuses[0].applied).toHaveLength(0);
    expect(statuses[0].pending).toEqual(['A', 'B']);
  });

  test('handles multiple databases', () => {
    const statuses = parseDbStatus('A:\n  applied (0): none\n  pending (0): none\nB:\n  applied (1): X\n  pending (0): none\n');
    expect(statuses.map((s) => s.database)).toEqual(['A', 'B']);
    expect(statuses[1].applied).toEqual(['X']);
  });
});

describe('generateMigration', () => {
  test('generates a create-table migration', () => {
    expect(generateMigration({ name: 'CreateUsers', kind: 'create-table', table: 'Users', from: 'User' })).toBe(
      'migration CreateUsers\n    create table Users from User\nend\n',
    );
  });

  test('generates an add-field migration', () => {
    expect(generateMigration({ name: 'AddEmail', kind: 'add-field', field: 'email', table: 'Users' })).toBe(
      'migration AddEmail\n    add field email to Users\nend\n',
    );
  });
});
