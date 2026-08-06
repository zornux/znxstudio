import { describe, expect, test } from './harness';
import {
  isInstallable,
  searchMarketplace,
  sortMarketplace,
  type MarketplaceEntry,
} from '../src/shared/extensions/marketplace';
import { BUNDLED_PACKAGES } from '../src/renderer/extensions/bundled';

const CATALOG: MarketplaceEntry[] = [
  { id: 'a.alpha', name: 'Alpha Linter', publisher: 'a', version: '1.0.0', description: 'Lints code', categories: ['Linters'], engines: { znxstudio: '^1.0.0' }, installs: 100, rating: 4.0 },
  { id: 'b.beta', name: 'Beta Theme', publisher: 'b', version: '2.0.0', description: 'A dark theme', categories: ['Themes'], engines: { znxstudio: '^1.0.0' }, installs: 500, rating: 4.9 },
  { id: 'c.future', name: 'Future Tool', publisher: 'c', version: '1.0.0', description: 'linting helpers', categories: ['Linters'], engines: { znxstudio: '^2.0.0' }, installs: 5, rating: 3.0 },
];

describe('searchMarketplace', () => {
  test('ranks name-start above name-contains above metadata', () => {
    const results = searchMarketplace(CATALOG, 'lint');
    expect(results.map((e) => e.id)).toEqual(['a.alpha', 'c.future']); // Alpha "Linter" name; future via description
  });
  test('empty query returns everything, most-installed first', () => {
    const results = searchMarketplace(CATALOG, '');
    expect(results[0].id).toBe('b.beta');
  });
  test('matches publisher and categories', () => {
    expect(searchMarketplace(CATALOG, 'themes').map((e) => e.id)).toEqual(['b.beta']);
  });
});

describe('sortMarketplace', () => {
  test('by installs, rating, and name', () => {
    expect(sortMarketplace(CATALOG, 'installs')[0].id).toBe('b.beta');
    expect(sortMarketplace(CATALOG, 'rating')[0].id).toBe('b.beta');
    expect(sortMarketplace(CATALOG, 'name')[0].id).toBe('a.alpha');
  });
});

describe('isInstallable', () => {
  test('respects the SDK engine range', () => {
    expect(isInstallable(CATALOG[0], '1.5.0')).toBe(true);
    expect(isInstallable(CATALOG[2], '1.5.0')).toBe(false); // needs ^2.0.0
  });
});

describe('bundled catalog', () => {
  test('ships real, installable packages with one pre-installed', () => {
    expect(BUNDLED_PACKAGES.length).toBeGreaterThan(2);
    expect(BUNDLED_PACKAGES.filter((p) => p.preinstalled)).toHaveLength(1);
    for (const pkg of BUNDLED_PACKAGES) {
      expect(pkg.entry.id).toBe(pkg.manifest.id);
      expect(isInstallable(pkg.entry)).toBe(true);
    }
  });
});
