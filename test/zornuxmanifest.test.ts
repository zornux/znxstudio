import { describe, expect, test } from './harness';
import { parseZornuxManifest } from '../src/renderer/solution/zornuxManifest';

describe('parseZornuxManifest', () => {
  test('reads key = value fields with defaults', () => {
    const m = parseZornuxManifest('name = greeter-app\nversion = 0.2.0\nentry = main.zx\nsource = src/\n');
    expect(m.name).toBe('greeter-app');
    expect(m.version).toBe('0.2.0');
    expect(m.entry).toBe('main.zx');
    expect(m.source).toBe('src/');
    expect(m.dependencies).toHaveLength(0);
  });

  test('applies defaults for an empty/absent manifest', () => {
    const m = parseZornuxManifest('');
    expect(m.name).toBe('project');
    expect(m.version).toBe('0.1.0');
    expect(m.entry).toBeNull();
    expect(m.source).toBe('.');
  });

  test('parses a dependency with a version constraint', () => {
    const m = parseZornuxManifest('name = app\ndependency Utils = ^1.2.0\n');
    expect(m.dependencies).toHaveLength(1);
    expect(m.dependencies[0]).toEqual({ name: 'Utils', constraint: '^1.2.0' });
  });

  test('parses a dependency scoped to a registry ("... from store")', () => {
    const m = parseZornuxManifest('dependency Greetings = ^1.0.0 from store\n');
    expect(m.dependencies[0]).toEqual({ name: 'Greetings', constraint: '^1.0.0', registry: 'store' });
  });

  test('ignores comments, blank lines and registry declarations', () => {
    const m = parseZornuxManifest('# a comment\n\nname = x\nregistry store = ./s\ndependency A = 1.0.0\n');
    expect(m.name).toBe('x');
    expect(m.dependencies).toHaveLength(1);
  });

  test('drops a malformed dependency line', () => {
    const m = parseZornuxManifest('dependency broken-no-equals\ndependency Good = 1.0.0\n');
    expect(m.dependencies).toHaveLength(1);
    expect(m.dependencies[0].name).toBe('Good');
  });

  test('tolerates CRLF line endings', () => {
    const m = parseZornuxManifest('name = crlf\r\nversion = 1.0.0\r\n');
    expect(m.name).toBe('crlf');
    expect(m.version).toBe('1.0.0');
  });
});
