import { describe, expect, test } from './harness';
import { buildSearchRegex, findMatches } from '../src/shared/textSearch';
import { isSymbolScannable, scanSymbols } from '../src/shared/symbolScan';

describe('buildSearchRegex', () => {
  test('escapes a plain query and is case-insensitive by default', () => {
    const re = buildSearchRegex('a.b()', {})!;
    expect(re.test('xAyBz')).toBeFalsy(); // the dot is literal, parens literal
    expect(findMatches('call a.b() now', re)).toHaveLength(1);
  });

  test('honors case sensitivity', () => {
    expect(findMatches('Foo foo', buildSearchRegex('foo', {})!)).toHaveLength(2);
    expect(findMatches('Foo foo', buildSearchRegex('foo', { caseSensitive: true })!)).toHaveLength(1);
  });

  test('whole-word wraps in word boundaries', () => {
    const re = buildSearchRegex('port', { wholeWord: true })!;
    expect(findMatches('port export important port', re)).toHaveLength(2);
  });

  test('regex mode passes the pattern through; invalid regex → null', () => {
    expect(findMatches('on port 8080', buildSearchRegex('port \\d+', { isRegex: true })!)).toHaveLength(1);
    expect(buildSearchRegex('(', { isRegex: true })).toBeNull();
    expect(buildSearchRegex('', {})).toBeNull();
  });
});

describe('findMatches', () => {
  test('finds every occurrence and is zero-width safe', () => {
    expect(findMatches('a a a', buildSearchRegex('a', {})!)).toHaveLength(3);
    // A pattern that can match empty must not spin forever.
    expect(findMatches('abc', buildSearchRegex('x*', { isRegex: true })!).length).toBeGreaterThan(0);
  });
});

describe('scanSymbols — Zornux', () => {
  const ZX = [
    'module Shop.Orders',
    'class Account',
    '    function deposit with amount',
    'record Money',
    'type Currency',
    'policy SalesOnly',
    'service Reports',
    'configuration AppConfig',
    '# function commented_out',
  ].join('\n');

  test('extracts the real declaration kinds', () => {
    const symbols = scanSymbols(ZX, 'zx');
    const byName = new Map(symbols.map((s) => [s.name, s.kind]));
    expect(byName.get('Shop.Orders')).toBe('module');
    expect(byName.get('Account')).toBe('class');
    expect(byName.get('deposit')).toBe('function');
    expect(byName.get('Money')).toBe('record');
    expect(byName.get('Currency')).toBe('type');
    expect(byName.get('SalesOnly')).toBe('policy');
    expect(byName.get('Reports')).toBe('service');
    expect(byName.get('AppConfig')).toBe('configuration');
  });

  test('ignores commented-out declarations', () => {
    expect(scanSymbols(ZX, 'zx').some((s) => s.name === 'commented_out')).toBeFalsy();
  });

  test('reports the name column for navigation', () => {
    const deposit = scanSymbols(ZX, 'zx').find((s) => s.name === 'deposit')!;
    expect(deposit.line).toBe(2);
    expect(deposit.col).toBe('    function '.length);
  });
});

describe('scanSymbols — JS/TS', () => {
  test('extracts functions, classes, and exported consts only', () => {
    const src = 'export function App() {}\nclass Widget {}\nexport const routes = {};\nconst local = 1;';
    const symbols = scanSymbols(src, 'js');
    const names = symbols.map((s) => s.name);
    expect(names).toContain('App');
    expect(names).toContain('Widget');
    expect(names).toContain('routes');
    expect(names.includes('local')).toBeFalsy(); // non-exported local — not a workspace symbol
  });

  test('isSymbolScannable covers zx + js family, not others', () => {
    expect(isSymbolScannable('zx')).toBeTruthy();
    expect(isSymbolScannable('ts')).toBeTruthy();
    expect(isSymbolScannable('md')).toBeFalsy();
  });
});
