import { describe, expect, test } from './harness';
import {
  GENERATORS,
  generatorsFor,
  kebabCase,
  parseList,
  pascalCase,
} from '../src/renderer/codegen/generators';

function gen(id: string) {
  return GENERATORS.find((g) => g.id === id)!;
}

describe('string helpers', () => {
  test('parseList trims and drops empties', () => {
    expect(parseList('a, b ,, c')).toEqual(['a', 'b', 'c']);
    expect(parseList('   ')).toHaveLength(0);
  });

  test('pascalCase and kebabCase', () => {
    expect(pascalCase('user profile')).toBe('UserProfile');
    expect(pascalCase('account')).toBe('Account');
    expect(kebabCase('UserCard')).toBe('user-card');
    expect(kebabCase('my thing')).toBe('my-thing');
  });
});

describe('generatorsFor', () => {
  test('filters by language', () => {
    expect(generatorsFor('zornux').every((g) => g.languages.includes('zornux'))).toBe(true);
    expect(generatorsFor('javascript').every((g) => g.languages.includes('javascript'))).toBe(true);
    expect(generatorsFor('python')).toHaveLength(0);
  });
});

describe('zx-record', () => {
  test('emits a record with each field, PascalCased name', () => {
    const code = gen('zx-record').generate({ name: 'user profile', fields: 'name, email' });
    expect(code).toContain('record UserProfile');
    expect(code).toContain('    has name');
    expect(code).toContain('    has email');
    expect(code.trimEnd().endsWith('end')).toBe(true);
  });

  test('falls back to a placeholder field when none given', () => {
    expect(gen('zx-record').generate({ name: 'X', fields: '' })).toContain('has field');
  });
});

describe('zx-service', () => {
  test('emits a route per spec and a publish line', () => {
    const code = gen('zx-service').generate({ name: 'greeter', routes: 'GET /greeting, post /users', port: '9000' });
    expect(code).toContain('service Greeter');
    expect(code).toContain('on GET "/greeting"');
    expect(code).toContain('on POST "/users"'); // method upper-cased
    expect(code).toContain('publish Greeter on port 9000');
  });

  test('defaults the port to 8080', () => {
    expect(gen('zx-service').generate({ name: 'S', routes: '', port: '' })).toContain('on port 8080');
  });
});

describe('zx-policy', () => {
  test('one require line per requirement', () => {
    const code = gen('zx-policy').generate({ name: 'CanEdit', requirements: 'authentication, role "Manager"' });
    expect(code).toContain('policy CanEdit');
    expect(code).toContain('    require authentication');
    expect(code).toContain('    require role "Manager"');
  });
});

describe('zx-configuration', () => {
  test('maps name:type fields to typed defaults', () => {
    const code = gen('zx-configuration').generate({ name: 'AppConfig', fields: 'host:text, port:whole, on:truth' });
    expect(code).toContain('has host as text is ""');
    expect(code).toContain('has port as whole is 0');
    expect(code).toContain('has on as truth is false');
  });
});

describe('zoijs-component', () => {
  test('emits an exported component with a kebab class', () => {
    const code = gen('zoijs-component').generate({ name: 'user card' });
    expect(code).toContain("import { html } from '@zoijs/core';");
    expect(code).toContain('export function UserCard()');
    expect(code).toContain('class="user-card"');
  });

  test('stateful variant wires createState and a handler', () => {
    const code = gen('zoijs-state-component').generate({ name: 'Counter', state: 'count' });
    expect(code).toContain('const count = createState(0);');
    expect(code).toContain('count.set(count.get() + 1)');
  });
});
