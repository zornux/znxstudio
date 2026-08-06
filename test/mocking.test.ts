import { describe, expect, test } from './harness';
import { dependents, generateMock, parseComponents } from '../src/renderer/testing/mocking';

const SOURCE = `repository UserRepository
    async function save with user
        save user into AppDb.Users
        give back user
    end

    async function all
        give back find all from AppDb.Users
    end
end

service UserService
    use UserRepository
    async function register with request
        validate request
        give back wait for UserRepository.save(user)
    end
end

application
    use UserRepository
    use UserService
end
`;

describe('parseComponents', () => {
  const components = parseComponents(SOURCE);

  test('parses repository, service and application with uses + functions', () => {
    expect(components.map((c) => c.name)).toEqual(['UserRepository', 'UserService', 'application']);
    const repo = components[0];
    expect(repo.kind).toBe('repository');
    expect(repo.functions.map((f) => f.name)).toEqual(['save', 'all']);
    expect(repo.functions[0]).toEqual({ name: 'save', async: true, params: ['user'] });
  });

  test('collects use dependencies (function-body ends do not truncate the block)', () => {
    const service = components.find((c) => c.name === 'UserService')!;
    expect(service.uses).toEqual(['UserRepository']);
    expect(service.functions.map((f) => f.name)).toEqual(['register']); // reached past save's nested `end`
    expect(components.find((c) => c.name === 'application')!.uses).toEqual(['UserRepository', 'UserService']);
  });
});

describe('dependents', () => {
  test('finds components that use a given one', () => {
    const components = parseComponents(SOURCE);
    expect(dependents(components, 'UserRepository')).toEqual(['UserService', 'application']);
    expect(dependents(components, 'UserService')).toEqual(['application']);
  });
});

describe('generateMock', () => {
  const repo = parseComponents(SOURCE)[0];
  const mock = generateMock(repo);

  test('mirrors the interface with stub returns', () => {
    expect(mock).toContain('repository MockUserRepository');
    expect(mock).toContain('async function save with user');
    expect(mock).toContain('give back user'); // save echoes the entity param
    expect(mock).toContain('give back []'); // all -> collection stub
    expect(mock).toContain('use UserRepository → use MockUserRepository');
  });

  test('respects a custom mock name', () => {
    expect(generateMock(repo, 'FakeRepo')).toContain('repository FakeRepo');
  });
});
