import { describe, expect, test } from './harness';
import {
  ContextStore,
  diagnosticContextItem,
  fileContextItem,
  filterSecrets,
  formatDependencies,
  formatProjectMap,
  scanDeclarations,
  selectionContextItem,
  terminalContextItem,
  truncateForContext,
  type DeclarationSummary,
} from '../src/renderer/ai/context';

describe('AI context — declaration scanning', () => {
  const source = [
    'module Auth',
    '  function login with email, password',
    '    give back true',
    '  end',
    'end',
    '',
    'class User',
    '  has name as Text',
    'end',
    '',
    'service UserService',
    '  function find with id',
    '    give back nothing',
    '  end',
    'end',
  ].join('\n');

  test('scanDeclarations finds top-level module, class, and service', () => {
    const decls = scanDeclarations(source, 'auth.zx');
    expect(decls.length).toBe(3);
    expect(decls[0].kind).toBe('module');
    expect(decls[0].name).toBe('Auth');
    expect(decls[0].line).toBe(1);
    expect(decls[1].kind).toBe('class');
    expect(decls[1].name).toBe('User');
    expect(decls[2].kind).toBe('service');
    expect(decls[2].name).toBe('UserService');
  });

  test('formatProjectMap groups declarations by file', () => {
    const decls: DeclarationSummary[] = [
      { file: 'auth.zx', name: 'Auth', kind: 'module', line: 1 },
      { file: 'auth.zx', name: 'User', kind: 'class', line: 7 },
      { file: 'main.zx', name: 'main', kind: 'function', line: 1 },
    ];
    const map = formatProjectMap(decls);
    expect(map).toContain('auth.zx:');
    expect(map).toContain('module Auth (L1)');
    expect(map).toContain('main.zx:');
    expect(map).toContain('function main (L1)');
  });

  test('formatProjectMap returns placeholder for empty list', () => {
    expect(formatProjectMap([])).toBe('(no declarations found)');
  });
});

describe('AI context — context items', () => {
  test('fileContextItem creates a file context with truncation', () => {
    const item = fileContextItem('src/main.zx', 'function main\nend');
    expect(item.id).toBe('file:src/main.zx');
    expect(item.kind).toBe('file');
    expect(item.label).toBe('main.zx');
    expect(item.source).toBe('auto');
    expect(item.content).toContain('File: src/main.zx');
  });

  test('fileContextItem respects pinned flag', () => {
    const item = fileContextItem('src/main.zx', 'code', true);
    expect(item.source).toBe('pinned');
  });

  test('selectionContextItem captures selection with line', () => {
    const item = selectionContextItem('src/main.zx', 'let x = 1', 5);
    expect(item.id).toBe('selection:src/main.zx:5');
    expect(item.kind).toBe('selection');
    expect(item.content).toContain('line 5');
  });

  test('diagnosticContextItem formats diagnostic info', () => {
    const item = diagnosticContextItem('ZX0110', 'reserved word', 'main.zx', 3);
    expect(item.id).toBe('diagnostic:ZX0110:3');
    expect(item.kind).toBe('diagnostic');
    expect(item.content).toContain('ZX0110');
    expect(item.content).toContain('main.zx:3');
  });

  test('terminalContextItem truncates long output', () => {
    const long = 'x'.repeat(5000);
    const item = terminalContextItem('build', long);
    expect(item.kind).toBe('terminal');
    expect(item.chars < 2100).toBe(true);
  });
});

describe('AI context — context store', () => {
  test('add/remove/has/all work correctly', () => {
    const store = new ContextStore();
    const item = fileContextItem('a.zx', 'code');
    store.add(item);
    expect(store.has('file:a.zx')).toBe(true);
    expect(store.all().length).toBe(1);
    store.remove('file:a.zx');
    expect(store.has('file:a.zx')).toBe(false);
    expect(store.all().length).toBe(0);
  });

  test('clear keeps pinned items by default', () => {
    const store = new ContextStore();
    store.add(fileContextItem('a.zx', 'code', true));
    store.add(fileContextItem('b.zx', 'code'));
    store.clear();
    expect(store.all().length).toBe(1);
    expect(store.pinned().length).toBe(1);
  });

  test('clear(false) removes everything', () => {
    const store = new ContextStore();
    store.add(fileContextItem('a.zx', 'code', true));
    store.clear(false);
    expect(store.all().length).toBe(0);
  });

  test('assemble respects budget and prioritizes pinned', () => {
    const store = new ContextStore();
    store.add(fileContextItem('pinned.zx', 'important code', true));
    store.add(fileContextItem('auto.zx', 'auto code'));
    const assembled = store.assemble(100000);
    expect(assembled).toContain('pinned.zx');
    expect(assembled).toContain('auto.zx');
  });

  test('dedup by id', () => {
    const store = new ContextStore();
    store.add(fileContextItem('a.zx', 'version 1'));
    store.add(fileContextItem('a.zx', 'version 2'));
    expect(store.all().length).toBe(1);
    expect(store.all()[0].content).toContain('version 2');
  });
});

describe('AI context — truncation', () => {
  test('truncateForContext passes short text through', () => {
    expect(truncateForContext('short')).toBe('short');
  });

  test('truncateForContext truncates long text with indicator', () => {
    const long = 'x'.repeat(10000);
    const result = truncateForContext(long, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain('truncated');
  });
});

describe('AI context — dependency formatting', () => {
  test('formatDependencies handles empty', () => {
    expect(formatDependencies([])).toBe('(no dependencies)');
  });

  test('formatDependencies truncates beyond 50', () => {
    const edges = Array.from({ length: 60 }, (_, i) => `a${i} → b${i}`);
    const result = formatDependencies(edges);
    expect(result).toContain('10 more');
  });
});

describe('AI context — secret filtering', () => {
  test('filterSecrets redacts long tokens in quotes', () => {
    const input = 'key = "sk-abcdefghij1234567890abcdefghij1234567890"';
    const result = filterSecrets(input);
    expect(result).toContain('[REDACTED]');
    expect(result.includes('abcdefghij')).toBe(false);
  });

  test('filterSecrets redacts api_key assignments', () => {
    const input = "api_key = 'mysecret123'";
    const result = filterSecrets(input);
    expect(result).toContain('[REDACTED]');
  });

  test('filterSecrets redacts PEM certificates', () => {
    const input = '-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----';
    const result = filterSecrets(input);
    expect(result).toContain('[REDACTED CERTIFICATE]');
    expect(result.includes('MIIE')).toBe(false);
  });

  test('filterSecrets leaves normal code alone', () => {
    const input = 'function add with a, b\n    give back a + b\nend';
    expect(filterSecrets(input)).toBe(input);
  });
});
