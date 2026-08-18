/**
 * Transactional installer for marketplace extensions (main process owns integrity +
 * persistence). Pipeline: download bytes → verify raw-payload checksum BEFORE any decode
 * → UTF-8 decode → parse → strict manifest validation → atomic persist → return the
 * validated, data-only contribution model for the renderer to apply. Any failure leaves
 * nothing installed. Startup loads only enabled records and quarantines malformed ones.
 */
import { createHash } from 'node:crypto';
import { SDK_VERSION } from '../../shared/extensions/manifest';
import {
  parseExtensionBundle,
  validateExtensionManifest,
  type ValidatedExtension,
  type InstalledExtensionSummary,
  type LoadEnabledResult,
} from '../../shared/extensions/registry';
import {
  MarketplaceRegistryService,
  type MarketplaceSearchParams,
} from './MarketplaceRegistryService';
import { InstalledExtensionsStore, type InstallRecord } from './InstalledExtensionsStore';
import { DEFAULT_MARKETPLACE_BASE_URL } from './marketplaceUrlPolicy';

/** Hard cap on the artifact payload (the marketplace body cap is 8 MB). */
const MAX_ARTIFACT_CHARS = 8 * 1024 * 1024;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}
/** Strict UTF-8 decode of a base64 payload; throws on invalid UTF-8. */
function decodeUtf8(base64: string): string {
  const bytes = Buffer.from(base64, 'base64');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export class ExtensionInstaller {
  constructor(
    private readonly registry: MarketplaceRegistryService,
    private readonly store: InstalledExtensionsStore,
    private readonly source: string = DEFAULT_MARKETPLACE_BASE_URL,
  ) {}

  search(params: MarketplaceSearchParams): Promise<{ items: unknown[]; total: number }> {
    return this.registry.search(params);
  }
  detail(publisher: string, slug: string): Promise<unknown> {
    return this.registry.detail(publisher, slug);
  }

  /** Download → checksum → decode → validate → persist. Returns the contribution model. */
  async install(publisher: string, slug: string, version: string): Promise<ValidatedExtension> {
    const artifact = await this.registry.downloadArtifact(publisher, slug, version);

    // 1) Integrity FIRST — hash the raw (base64) payload exactly as the marketplace does.
    if (artifact.contentBase64.length > MAX_ARTIFACT_CHARS) throw new Error('Extension artifact is too large.');
    const expected = artifact.checksum.replace(/^sha256:/i, '').toLowerCase();
    const actual = sha256Hex(artifact.contentBase64);
    if (!expected || actual !== expected) throw new Error('Extension checksum verification failed.');

    // 2) Only now decode + parse + validate.
    let text: string;
    try {
      text = decodeUtf8(artifact.contentBase64);
    } catch {
      throw new Error('Extension artifact is not valid UTF-8.');
    }
    const parsed = parseExtensionBundle(text);
    if (!parsed.ok) throw new Error(parsed.errors.join(' '));
    const result = validateExtensionManifest(
      parsed.manifest,
      { publisherHandle: publisher, slug, version },
      SDK_VERSION,
    );
    if (!result.ok || !result.extension) throw new Error(result.errors.join(' '));

    // 3) Persist atomically (transactional; save rolls back a partial write).
    const record: InstallRecord = {
      source: this.source,
      publisher,
      slug,
      version,
      sha256: `sha256:${actual}`,
      manifestHash: sha256Hex(JSON.stringify(parsed.manifest)),
      extensionHash: sha256Hex(JSON.stringify(result.extension)),
      installedAt: new Date().toISOString(),
      enabled: true,
    };
    await this.store.save({ record, extension: result.extension });
    return result.extension;
  }

  async uninstall(publisher: string, slug: string, version: string): Promise<void> {
    await this.store.remove(publisher, slug, version);
  }
  async setEnabled(publisher: string, slug: string, version: string, enabled: boolean): Promise<void> {
    await this.store.setEnabled(publisher, slug, version, enabled);
  }

  /** Summaries of everything installed (for the Manager UI's Installed section). */
  async listInstalled(): Promise<InstalledExtensionSummary[]> {
    const items = await this.store.list();
    return items.map(({ record, extension }) => ({
      id: extension.id,
      publisher: record.publisher,
      slug: record.slug,
      version: record.version,
      name: extension.name,
      enabled: record.enabled,
    }));
  }

  /**
   * Enabled extensions to apply at startup, revalidated against the current SDK. A record
   * that no longer validates (schema/compat drift) is quarantined — returned disabled with
   * a reason instead of applied — never crashing startup.
   */
  async loadEnabled(): Promise<LoadEnabledResult> {
    const apply: ValidatedExtension[] = [];
    const quarantined: { id: string; reason: string }[] = [];
    for (const { record, extension } of await this.store.list()) {
      if (!record.enabled) continue;
      if (record.extensionHash) {
        const currentHash = sha256Hex(JSON.stringify(extension));
        if (currentHash !== record.extensionHash) {
          quarantined.push({ id: extension.id, reason: 'On-disk extension data has been modified since installation.' });
          continue;
        }
      }
      const revalidated = validateExtensionManifest(
        toManifest(extension),
        { publisherHandle: record.publisher, slug: record.slug, version: record.version },
        SDK_VERSION,
      );
      if (revalidated.ok && revalidated.extension) apply.push(revalidated.extension);
      else quarantined.push({ id: extension.id, reason: revalidated.errors.join(' ') || 'revalidation failed' });
    }
    return { apply, quarantined };
  }
}

/** Reconstruct a manifest-shaped object from a stored validated extension for revalidation. */
function toManifest(ext: ValidatedExtension): unknown {
  return {
    schemaVersion: 1,
    id: ext.id,
    name: ext.name,
    publisher: ext.publisher,
    version: ext.version,
    description: ext.description,
    engines: ext.engines,
    contributes: {
      commands: ext.contributions.commands,
      snippets: ext.contributions.snippets,
      keybindings: ext.contributions.keybindings,
      // Rebuild themes as token→color so the shared validator re-checks them. The stored
      // id is `${ext.id}.${themeId}`; strip the extension-id PREFIX (not the last dot) so a
      // themeId that itself contains a dot round-trips to the same id after a restart.
      themes: ext.contributions.themes.map((t) => ({
        id: t.id.startsWith(`${ext.id}.`) ? t.id.slice(ext.id.length + 1) : t.id,
        label: t.label,
        type: t.type,
        colors: cssVarsToTokens(t.cssVars),
      })),
    },
  };
}
function cssVarsToTokens(cssVars: Record<string, string>): Record<string, string> {
  const inverse: Record<string, string> = {};
  // Local inverse of THEME_TOKENS (kept here to avoid a circular import of the map).
  const map: Record<string, string> = {
    '--z-bg': 'editor.background', '--z-fg': 'editor.foreground', '--z-bg-panel': 'panel.background',
    '--z-bg-elevated': 'elevated.background', '--z-border': 'border', '--z-fg-muted': 'foreground.muted',
    '--z-accent': 'accent', '--z-accent-fg': 'accent.foreground', '--z-activity-bg': 'activityBar.background',
    '--z-status-bg': 'statusBar.background', '--z-status-fg': 'statusBar.foreground', '--z-hover': 'hover.background',
  };
  for (const [cssVar, color] of Object.entries(cssVars)) {
    const token = map[cssVar];
    if (token) inverse[token] = color;
  }
  return inverse;
}
