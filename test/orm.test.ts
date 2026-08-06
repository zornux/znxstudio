import { describe, expect, test } from './harness';
import { analyzeOrm } from '../src/renderer/database/ormModel';

const CRUD = `class User
    has id
    has name
    has email
end

database AppDb
    provider memory
    table Users from User
end

create alice from User
alice.name = "Alice"
save alice into AppDb.Users

show "Users: " + text(length(find all from AppDb.Users))
create found = find one from AppDb.Users where email is "x"
delete alice from AppDb.Users
`;

describe('analyzeOrm — clean CRUD', () => {
  const analysis = analyzeOrm(CRUD);

  test('tracks per-table CRUD coverage', () => {
    const users = analysis.tables.find((t) => t.table === 'Users')!;
    expect(users.from).toBe('User');
    expect(users.creates).toBe(1); // one save
    expect(users.reads).toBe(2); // find all + find one
    expect(users.deletes).toBe(1);
  });

  test('maps entities to their tables', () => {
    expect(analysis.entities.find((e) => e.className === 'User')!.tables).toEqual(['AppDb.Users']);
  });

  test('has no diagnostics for correct usage', () => {
    expect(analysis.diagnostics).toHaveLength(0);
  });

  test('collects the operations', () => {
    expect(analysis.operations.filter((o) => o.kind === 'save')).toHaveLength(1);
    expect(analysis.operations.filter((o) => o.kind === 'find')).toHaveLength(2);
    expect(analysis.operations.filter((o) => o.kind === 'delete')).toHaveLength(1);
  });
});

describe('analyzeOrm — diagnostics', () => {
  test('flags a type mismatch (saving the wrong entity) as an error', () => {
    const source = `class User
    has id
end
class Product
    has id
end
database AppDb
    provider memory
    table Users from User
end
create p from Product
save p into AppDb.Users
`;
    const analysis = analyzeOrm(source);
    const errors = analysis.diagnostics.filter((d) => d.severity === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Saving a Product into AppDb.Users');
    expect(errors[0].message).toContain('stores User');
  });

  test('warns on an undeclared database and unknown table', () => {
    const analysis = analyzeOrm('save q into Ghost.Nope\nsave r into AppDb.Missing\ndatabase AppDb\n    provider memory\n    table Users from User\nend\n');
    const messages = analysis.diagnostics.map((d) => d.message);
    expect(messages.some((m) => m.includes('undeclared database "Ghost"'))).toBe(true);
    expect(messages.some((m) => m.includes('Unknown table "AppDb.Missing"'))).toBe(true);
  });

  test('warns on create from an unknown class', () => {
    const analysis = analyzeOrm('create x from Nonexistent\n');
    expect(analysis.diagnostics[0].message).toContain('Unknown class "Nonexistent"');
  });
});
