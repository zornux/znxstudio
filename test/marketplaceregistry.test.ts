import { describe, expect, test } from './harness';
import {
  assetCardToEntry,
  parseExtensionBundle,
  validateExtensionManifest,
  EXTENSION_CONTRIBUTABLE_COMMANDS,
  type ExpectedIdentity,
} from '../src/shared/extensions/registry';
import { assertSafeMarketplaceUrl, resolveBaseUrl, DEFAULT_MARKETPLACE_BASE_URL } from '../src/main/services/marketplaceUrlPolicy';
import { normalizeMarketplaceSearchParams } from '../src/main/services/MarketplaceRegistryService';
import { CommandIds } from '../src/renderer/commands/CommandIds';
import { readFileSync } from 'node:fs';

const EXPECTED: ExpectedIdentity = { publisherHandle: 'zornux', slug: 'midnight', version: '1.0.0' };

function manifest(overrides: Record<string, unknown> = {}): unknown {
  return {
    schemaVersion: 1,
    id: 'zornux.midnight',
    name: 'Midnight',
    publisher: 'zornux',
    version: '1.0.0',
    engines: { znxstudio: '>=1.0.0' },
    contributes: {
      themes: [{ id: 'midnight', label: 'Midnight', type: 'dark', colors: { 'editor.background': '#101018', 'accent': '#5b8cff' } }],
    },
    ...overrides,
  };
}

describe('assetCardToEntry', () => {
  test('maps a marketplace card to a remote entry', () => {
    const entry = assetCardToEntry({
      publisher: { handle: 'zornux', name: 'Zornux' },
      slug: 'midnight',
      name: 'Midnight',
      summary: 'A dark theme',
      latestVersion: '1.0.0',
      type: 'znxstudio-extension',
      category: 'extensions',
      downloads: 42,
      trustTier: 'official',
      verified: true,
    });
    expect(entry?.id).toBe('zornux.midnight');
    expect(entry?.remote).toBe(true);
    expect(entry?.publisherHandle).toBe('zornux');
    expect(entry?.slug).toBe('midnight');
    expect(entry?.verified).toBe(true);
  });
  test('returns null without publisher/slug', () => {
    expect(assetCardToEntry({ name: 'x' })).toBeNull();
  });
  test('rejects non-extension, malformed-version, and unsafe identity cards', () => {
    const base = { publisher: { handle: 'zornux' }, slug: 'tool', latestVersion: '1.0.0' };
    expect(assetCardToEntry({ ...base, type: 'container-image' })).toBeNull();
    expect(assetCardToEntry({ ...base, latestVersion: 'latest' })).toBeNull();
    expect(assetCardToEntry({ ...base, slug: '../tool' })).toBeNull();
  });
});

describe('marketplace search request normalization', () => {
  test('trims and bounds renderer-provided values', () => {
    expect(normalizeMarketplaceSearchParams({ query: `  ${'x'.repeat(250)}  ` })).toEqual({
      query: 'x'.repeat(200), page: 1, perPage: 30, sort: '',
    });
    expect(normalizeMarketplaceSearchParams({ page: -4, perPage: 50_000, sort: 'downloads_desc' })).toEqual({
      query: '', page: 1, perPage: 100, sort: 'downloads_desc',
    });
  });
});

describe('parseExtensionBundle', () => {
  test('extracts the manifest envelope', () => {
    const r = parseExtensionBundle(JSON.stringify({ manifest: { id: 'a.b' } }));
    expect(r.ok).toBe(true);
  });
  test('rejects non-JSON', () => {
    expect(parseExtensionBundle('not json').ok).toBe(false);
  });
  test('rejects a missing manifest', () => {
    expect(parseExtensionBundle('{}').ok).toBe(false);
  });
});

describe('validateExtensionManifest — positive', () => {
  test('accepts a valid theme extension and maps tokens to CSS vars', () => {
    const r = validateExtensionManifest(manifest(), EXPECTED);
    expect(r.ok).toBe(true);
    expect(r.extension?.contributions.themes.length).toBe(1);
    expect(r.extension?.contributions.themes[0].cssVars['--z-bg']).toBe('#101018');
    expect(r.extension?.contributions.themes[0].cssVars['--z-accent']).toBe('#5b8cff');
  });
  test('accepts an allowlisted command alias + snippet', () => {
    const r = validateExtensionManifest(
      manifest({
        contributes: {
          commands: [{ command: 'zornux.midnight.problems', title: 'Show Problems', runs: 'znxstudio.view.problems' }],
          snippets: [{ language: 'zornux', prefix: 'fn', body: 'function $1 with $2\\nend', description: 'function' }],
        },
      }),
      EXPECTED,
    );
    expect(r.ok).toBe(true);
    expect(r.extension?.contributions.commands[0].runs).toBe('znxstudio.view.problems');
  });
});

describe('validateExtensionManifest — negative (security)', () => {
  const bad = (o: Record<string, unknown>): boolean => validateExtensionManifest(manifest(o), EXPECTED).ok;
  test('rejects unknown schemaVersion', () => expect(bad({ schemaVersion: 2 })).toBe(false));
  test('rejects an executable main', () => expect(bad({ main: 'index.js' })).toBe(false));
  test('rejects scripts', () => expect(bad({ scripts: { postinstall: 'x' } })).toBe(false));
  test('rejects requested permissions', () => expect(bad({ permissions: ['workspace'] })).toBe(false));
  test('rejects activationEvents', () => expect(bad({ activationEvents: ['*'] })).toBe(false));
  test('rejects an unknown contribution type', () => expect(bad({ contributes: { webviews: [] } })).toBe(false));
  test('rejects a privileged command alias', () =>
    expect(bad({ contributes: { commands: [{ command: 'zornux.midnight.x', title: 'X', runs: 'znxstudio.terminal.new' }] } })).toBe(false));
  test('rejects a command alias with no runs', () =>
    expect(bad({ contributes: { commands: [{ command: 'zornux.midnight.x', title: 'X' }] } })).toBe(false));
  test('rejects a keybinding to a privileged command', () =>
    expect(bad({ contributes: { keybindings: [{ key: 'Ctrl+K', command: 'znxstudio.workspace.openFolder' }] } })).toBe(false));
  test('rejects a malformed when clause', () =>
    expect(bad({ contributes: { keybindings: [{ key: 'Ctrl+K', command: 'znxstudio.view.problems', when: 'process.exit()' }] } })).toBe(false));
  test('rejects an unsupported theme token', () =>
    expect(bad({ contributes: { themes: [{ id: 't', label: 'T', type: 'dark', colors: { 'evil.token': '#000000' } }] } })).toBe(false));
  test('rejects CSS/url() injection in a theme value', () =>
    expect(bad({ contributes: { themes: [{ id: 't', label: 'T', type: 'dark', colors: { 'editor.background': 'url(http://x)' } }] } })).toBe(false));
  test('rejects a path-bearing id', () => expect(bad({ id: '../../evil' })).toBe(false));
  test('rejects a publisher/marketplace mismatch', () => expect(bad({ publisher: 'someoneelse' })).toBe(false));
  test('rejects a version/marketplace mismatch', () => expect(bad({ version: '9.9.9' })).toBe(false));
  test('rejects an incompatible engine range', () => expect(bad({ engines: { znxstudio: '>=99.0.0' } })).toBe(false));
  test('rejects an unsupported snippet language', () =>
    expect(bad({ contributes: { snippets: [{ language: 'ruby', prefix: 'x', body: 'y' }] } })).toBe(false));
  test('rejects an oversized snippet body', () =>
    expect(bad({ contributes: { snippets: [{ language: 'zornux', prefix: 'x', body: 'a'.repeat(9000) }] } })).toBe(false));
});

describe('extension-contributable command allowlist', () => {
  test('every allowlisted command is a real built-in command id', () => {
    const known = new Set<string>(Object.values(CommandIds));
    for (const id of EXTENSION_CONTRIBUTABLE_COMMANDS) {
      expect(known.has(id)).toBe(true);
    }
  });
});

describe('reference extension bundle', () => {
  test('the official Midnight theme bundle parses and validates', () => {
    const text = readFileSync('samples/extensions/zornux.midnight-theme.json', 'utf8');
    const parsed = parseExtensionBundle(text);
    expect(parsed.ok).toBe(true);
    const result = validateExtensionManifest(parsed.manifest, {
      publisherHandle: 'zornux',
      slug: 'midnight-theme',
      version: '1.0.0',
    });
    expect(result.ok).toBe(true);
    expect(result.extension?.contributions.themes[0].cssVars['--z-bg']).toBe('#0f1117');
  });
});

describe('marketplace URL policy (anti-SSRF)', () => {
  const prod = { allowLocalhost: false };
  const dev = { allowLocalhost: true };
  test('allows the canonical https host', () => expect(assertSafeMarketplaceUrl('https://marketplace.zornux.com/api', prod).ok).toBe(true));
  test('rejects plain http in production', () => expect(assertSafeMarketplaceUrl('http://marketplace.zornux.com', prod).ok).toBe(false));
  test('rejects embedded credentials', () => expect(assertSafeMarketplaceUrl('https://u:p@marketplace.zornux.com', prod).ok).toBe(false));
  test('rejects non-http schemes', () => expect(assertSafeMarketplaceUrl('file:///etc/passwd', prod).ok).toBe(false));
  test('rejects a private/loopback host in production', () => {
    expect(assertSafeMarketplaceUrl('https://127.0.0.1/', prod).ok).toBe(false);
    expect(assertSafeMarketplaceUrl('https://10.0.0.5/', prod).ok).toBe(false);
    expect(assertSafeMarketplaceUrl('https://169.254.169.254/', prod).ok).toBe(false);
  });
  test('allows localhost only in dev', () => {
    expect(assertSafeMarketplaceUrl('http://localhost:8085/', dev).ok).toBe(true);
    expect(assertSafeMarketplaceUrl('http://localhost:8085/', prod).ok).toBe(false);
  });
  test('resolveBaseUrl pins the default in production, ignoring config', () => {
    expect(resolveBaseUrl('http://localhost:8085', prod)).toBe(DEFAULT_MARKETPLACE_BASE_URL);
    expect(resolveBaseUrl('https://evil.example', prod)).toBe(DEFAULT_MARKETPLACE_BASE_URL);
  });
  test('resolveBaseUrl honors a valid localhost config in dev', () => {
    expect(resolveBaseUrl('http://localhost:8085', dev)).toBe('http://localhost:8085');
  });
});
