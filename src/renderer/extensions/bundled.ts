import type { ExtensionManifest } from '../../shared/extensions/manifest';
import type { MarketplaceEntry } from '../../shared/extensions/marketplace';
import type { ZnxStudioExtension } from './sdk';
import { HELLO_MANIFEST, helloWorldExtension } from './samples/helloWorld';
import { LINE_COUNTER_MANIFEST, lineCounterExtension } from './samples/lineCounter';
import { SAMPLE_TOOLS_MANIFEST, sampleToolsExtension } from './samples/sampleTools';

/**
 * The bundled marketplace catalog (Phase 11D). Real, SDK-authored extensions
 * shipped with the IDE. `hello-world` is pre-installed; the rest are installable
 * from the marketplace. A later phase swaps this for a real registry + disk load;
 * the shape (metadata + manifest + instance) stays the same.
 */
export interface BundledPackage {
  entry: MarketplaceEntry;
  manifest: ExtensionManifest;
  instance: ZnxStudioExtension;
  /** Installed automatically at startup (cannot be uninstalled). */
  preinstalled: boolean;
}

function toEntry(manifest: ExtensionManifest, extras: Partial<MarketplaceEntry>): MarketplaceEntry {
  return {
    id: manifest.id,
    name: manifest.name,
    publisher: manifest.publisher,
    version: manifest.version,
    description: manifest.description ?? '',
    categories: [],
    engines: manifest.engines,
    ...extras,
  };
}

export const BUNDLED_PACKAGES: BundledPackage[] = [
  {
    entry: toEntry(HELLO_MANIFEST, { categories: ['Examples'], installs: 12000, rating: 4.8, preinstalled: true }),
    manifest: HELLO_MANIFEST,
    instance: helloWorldExtension,
    preinstalled: true,
  },
  {
    entry: toEntry(LINE_COUNTER_MANIFEST, { categories: ['Editor', 'Productivity'], installs: 8400, rating: 4.5 }),
    manifest: LINE_COUNTER_MANIFEST,
    instance: lineCounterExtension,
    preinstalled: false,
  },
  {
    entry: toEntry(SAMPLE_TOOLS_MANIFEST, { categories: ['Other'], installs: 3100, rating: 4.1 }),
    manifest: SAMPLE_TOOLS_MANIFEST,
    instance: sampleToolsExtension,
    preinstalled: false,
  },
];
