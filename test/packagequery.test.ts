import { describe, expect, test } from './harness';
import { parsePackageInfo, parseRegistryList, parseSearchResults } from '../src/shared/packageQuery';

describe('parseSearchResults', () => {
  test('parses `Name Version (Registry)` lines', () => {
    const stdout = 'Greetings 1.0.0 (store)\nMathTools 2.3.1 (public)\n';
    const outcome = parseSearchResults(0, stdout, '');
    expect(outcome.results).toHaveLength(2);
    expect(outcome.results[0].name).toBe('Greetings');
    expect(outcome.results[0].version).toBe('1.0.0');
    expect(outcome.results[0].registry).toBe('store');
    expect(outcome.results[1].registry).toBe('public');
  });

  test('treats "No matching packages." as empty', () => {
    const outcome = parseSearchResults(0, 'No matching packages.\n', '');
    expect(outcome.results).toHaveLength(0);
    expect(outcome.diagnostics).toHaveLength(0);
  });

  test('parses --json failure diagnostics on non-zero exit', () => {
    const json = JSON.stringify([{ code: 'ZP2100', message: "No registry named 'nope'." }]);
    const outcome = parseSearchResults(1, json, '');
    expect(outcome.results).toHaveLength(0);
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0].code).toBe('ZP2100');
  });

  test('ignores stray non-matching lines', () => {
    const outcome = parseSearchResults(0, '\n  \nGreetings 1.0.0 (store)\n', '');
    expect(outcome.results).toHaveLength(1);
  });
});

describe('parsePackageInfo', () => {
  test('parses the name line and per-registry versions', () => {
    const stdout = 'Greetings\n  store: 1.0.0, 1.1.0\n  public: 2.0.0\n';
    const outcome = parsePackageInfo(0, stdout, '');
    expect(outcome.info).toBeTruthy();
    expect(outcome.info?.name).toBe('Greetings');
    expect(outcome.info?.sources).toHaveLength(2);
    expect(outcome.info?.sources[0].registry).toBe('store');
    expect(outcome.info?.sources[0].versions).toHaveLength(2);
    expect(outcome.info?.sources[0].versions[1]).toBe('1.1.0');
    expect(outcome.info?.sources[1].versions[0]).toBe('2.0.0');
  });

  test('a name with no registry lines yields sources = []', () => {
    const outcome = parsePackageInfo(0, 'Greetings\n', '');
    expect(outcome.info?.name).toBe('Greetings');
    expect(outcome.info?.sources).toHaveLength(0);
  });

  test('failure returns null info and parsed diagnostics', () => {
    const json = JSON.stringify([{ code: 'ZP2200', message: 'No registry has that package.' }]);
    const outcome = parsePackageInfo(1, json, '');
    expect(outcome.info).toBeNull();
    expect(outcome.diagnostics).toHaveLength(1);
    expect(outcome.diagnostics[0].code).toBe('ZP2200');
  });
});

describe('parseRegistryList', () => {
  test('parses name/location and the default marker', () => {
    const stdout = 'store  ./greetings-store  (default)\npublic  https://packages.zornux.dev\n';
    const entries = parseRegistryList(stdout);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe('store');
    expect(entries[0].location).toBe('./greetings-store');
    expect(entries[0].isDefault).toBeTruthy();
    expect(entries[1].name).toBe('public');
    expect(entries[1].location).toBe('https://packages.zornux.dev');
    expect(entries[1].isDefault).toBeFalsy();
  });

  test('preserves single spaces inside a location path', () => {
    const entries = parseRegistryList('local  C:\\My Packages\\store\n');
    expect(entries).toHaveLength(1);
    expect(entries[0].location).toBe('C:\\My Packages\\store');
  });

  test('empty output yields no entries', () => {
    expect(parseRegistryList('\n  \n')).toHaveLength(0);
  });
});
