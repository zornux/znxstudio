import { createHash } from 'node:crypto';
import { describe, expect, test } from './harness';
import { ExtensionInstaller } from '../src/main/services/ExtensionInstaller';
import type { MarketplaceRegistryService, MarketplaceArtifact } from '../src/main/services/MarketplaceRegistryService';
import type { InstalledExtensionsStore, InstalledExtension } from '../src/main/services/InstalledExtensionsStore';

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: 'zornux.midnight',
  name: 'Midnight',
  publisher: 'zornux',
  version: '1.0.0',
  engines: { znxstudio: '>=1.0.0' },
  contributes: { themes: [{ id: 'midnight', label: 'Midnight', type: 'dark', colors: { 'editor.background': '#101018' } }] },
};

/** Build a download artifact whose checksum matches the base64 payload (as the server computes it). */
function artifactFor(manifestObj: unknown): MarketplaceArtifact {
  const text = JSON.stringify({ manifest: manifestObj });
  const contentBase64 = Buffer.from(text, 'utf8').toString('base64');
  const checksum = 'sha256:' + createHash('sha256').update(contentBase64, 'utf8').digest('hex');
  return { contentBase64, checksum, mimeType: 'application/vnd.zornux.znxstudio-extension+json', filename: 'midnight.json', version: '1.0.0' };
}

function fakes(artifact: MarketplaceArtifact): { installer: ExtensionInstaller; saved: InstalledExtension[] } {
  const saved: InstalledExtension[] = [];
  const registry = { downloadArtifact: async () => artifact } as unknown as MarketplaceRegistryService;
  const store = {
    save: async (e: InstalledExtension) => void saved.push(e),
    remove: async () => undefined,
    setEnabled: async () => undefined,
    list: async () => [],
  } as unknown as InstalledExtensionsStore;
  return { installer: new ExtensionInstaller(registry, store, 'https://marketplace.zornux.com'), saved };
}

async function throws(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

describe('ExtensionInstaller — transactional install', () => {
  test('installs a valid extension and persists it once', async () => {
    const { installer, saved } = fakes(artifactFor(VALID_MANIFEST));
    const ext = await installer.install('zornux', 'midnight', '1.0.0');
    expect(ext.id).toBe('zornux.midnight');
    expect(saved).toHaveLength(1);
  });

  test('the returned model carries NO raw artifact text (IPC contract)', async () => {
    const { installer } = fakes(artifactFor(VALID_MANIFEST));
    const ext = await installer.install('zornux', 'midnight', '1.0.0');
    const allowed = new Set(['id', 'name', 'publisher', 'slug', 'version', 'description', 'engines', 'contributions']);
    for (const key of Object.keys(ext)) expect(allowed.has(key)).toBe(true);
    const serialized = JSON.stringify(ext);
    expect(serialized.includes(artifactFor(VALID_MANIFEST).contentBase64)).toBe(false);
  });

  test('rejects a checksum mismatch BEFORE parsing, and persists nothing', async () => {
    const artifact = artifactFor(VALID_MANIFEST);
    artifact.checksum = 'sha256:' + 'd'.repeat(64); // tampered
    const { installer, saved } = fakes(artifact);
    expect(await throws(() => installer.install('zornux', 'midnight', '1.0.0'))).toBe(true);
    expect(saved).toHaveLength(0);
  });

  test('rejects an oversized artifact', async () => {
    const artifact = artifactFor(VALID_MANIFEST);
    artifact.contentBase64 = 'A'.repeat(9 * 1024 * 1024);
    artifact.checksum = 'sha256:' + createHash('sha256').update(artifact.contentBase64, 'utf8').digest('hex');
    const { installer, saved } = fakes(artifact);
    expect(await throws(() => installer.install('zornux', 'midnight', '1.0.0'))).toBe(true);
    expect(saved).toHaveLength(0);
  });

  test('rejects an executable manifest and persists nothing', async () => {
    const { installer, saved } = fakes(artifactFor({ ...VALID_MANIFEST, main: 'index.js' }));
    expect(await throws(() => installer.install('zornux', 'midnight', '1.0.0'))).toBe(true);
    expect(saved).toHaveLength(0);
  });

  test('rejects an identity mismatch (typosquat guard)', async () => {
    const { installer, saved } = fakes(artifactFor(VALID_MANIFEST));
    // Marketplace says the publisher is "attacker" but the manifest says "zornux".
    expect(await throws(() => installer.install('attacker', 'midnight', '1.0.0'))).toBe(true);
    expect(saved).toHaveLength(0);
  });
});
