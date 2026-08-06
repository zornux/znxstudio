import { describe, expect, test } from './harness';
import { buildSchema, parseTypeFields } from '../src/renderer/database/schemaModel';

const SOURCE = `class User
    has id
    has name
    private has secret

    function greet
        show name
    end
end

record CreateUserRequest
    has name
        required
        minimum length 2
    has email
        required
        email
end

database AppDb
    provider memory
    table Users from User
    table Requests from CreateUserRequest
    table Orphans from Missing
end
`;

describe('parseTypeFields', () => {
  test('collects has fields and skips methods (nested end)', () => {
    const types = parseTypeFields(SOURCE);
    const user = types.get('User')!;
    expect(user.map((c) => c.name)).toEqual(['id', 'name', 'secret']);
    expect(user[0].isId).toBe(true);
    expect(user[2].isPrivate).toBe(true);
  });

  test('captures indented validation constraints', () => {
    const request = parseTypeFields(SOURCE).get('CreateUserRequest')!;
    expect(request.map((c) => c.name)).toEqual(['name', 'email']);
    expect(request[0].constraints).toEqual(['required', 'minimum length 2']);
    expect(request[1].constraints).toEqual(['required', 'email']);
  });
});

describe('buildSchema', () => {
  test('resolves table columns from the mapped type', () => {
    const schema = buildSchema(SOURCE);
    expect(schema).toHaveLength(1);
    const [db] = schema;
    expect(db.name).toBe('AppDb');

    const users = db.tables.find((t) => t.table === 'Users')!;
    expect(users.resolved).toBe(true);
    expect(users.columns.map((c) => c.name)).toEqual(['id', 'name', 'secret']);

    const requests = db.tables.find((t) => t.table === 'Requests')!;
    expect(requests.columns.map((c) => c.name)).toEqual(['name', 'email']);
  });

  test('marks a table whose class is missing as unresolved', () => {
    const orphans = buildSchema(SOURCE)[0].tables.find((t) => t.table === 'Orphans')!;
    expect(orphans.resolved).toBe(false);
    expect(orphans.columns).toHaveLength(0);
  });
});
