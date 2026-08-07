import { SDK_VERSION, isEngineCompatible } from './manifest';

/**
 * Extension marketplace model (Phase 11D). Pure catalog metadata + search / sort
 * / installability. The concrete installable packages (manifest + code) live in
 * the renderer; this shared layer is what the marketplace UI filters and ranks,
 * and is fully unit-tested.
 */

export interface MarketplaceEntry {
  id: string;
  name: string;
  publisher: string;
  version: string;
  description: string;
  categories: string[];
  engines: { znxstudio: string };
  installs?: number;
  rating?: number;
  /** Ships enabled and cannot be uninstalled. */
  preinstalled?: boolean;
  // --- Remote (live marketplace) entries carry these; bundled entries leave them unset. ---
  /** Marks a live-marketplace result (vs a bundled sample). Drives the remote install path. */
  remote?: boolean;
  /** Publisher handle + asset slug — the identity used to install/detail from the API. */
  publisherHandle?: string;
  slug?: string;
  /** Publisher trust tier (`official` | `verified` | `community`) — displayed, never conflated. */
  trustTier?: string;
  /** Whether the publisher is verified. Publisher status only — NOT an artifact signature. */
  verified?: boolean;
  /** Download count as reported by the marketplace (no ratings — the API doesn't provide them). */
  downloads?: number;
  updatedAt?: string;
  /** The marketplace asset type (e.g. `znxstudio-extension`). */
  assetType?: string;
  iconUrl?: string;
}

export type MarketplaceSort = 'installs' | 'rating' | 'name';

/** Rank entries against a query (name-start > name-contains > metadata match). */
export function searchMarketplace(entries: MarketplaceEntry[], query: string): MarketplaceEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return sortMarketplace(entries, 'installs');
  const scored: { entry: MarketplaceEntry; score: number }[] = [];
  for (const entry of entries) {
    const name = entry.name.toLowerCase();
    const haystack = [name, entry.publisher, entry.description, ...entry.categories].join(' ').toLowerCase();
    let score: number;
    if (name.startsWith(q)) score = 0;
    else if (name.includes(q)) score = 1;
    else if (haystack.includes(q)) score = 2;
    else continue;
    scored.push({ entry, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || (b.entry.installs ?? 0) - (a.entry.installs ?? 0))
    .map((s) => s.entry);
}

export function sortMarketplace(entries: MarketplaceEntry[], by: MarketplaceSort): MarketplaceEntry[] {
  const copy = [...entries];
  switch (by) {
    case 'installs':
      return copy.sort((a, b) => (b.installs ?? 0) - (a.installs ?? 0));
    case 'rating':
      return copy.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Whether an entry can run on this SDK. */
export function isInstallable(entry: MarketplaceEntry, sdkVersion: string = SDK_VERSION): boolean {
  return isEngineCompatible(entry.engines.znxstudio, sdkVersion);
}
