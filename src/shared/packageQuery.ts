/**
 * Pure parsers for `zornux` package *query* commands (search / info / registry
 * list). Unlike add/remove/restore, these print human-readable text on success
 * (they do NOT emit JSON for results — only failures honour `--json`, arriving
 * as a `[{code,message,help}]` diagnostics array). Kept pure so they are
 * unit-testable without spawning the CLI. Formats mirror the compiler:
 *   search: `{Name} {Version} ({Registry})` per line (or `No matching packages.`)
 *   info:   line 1 = the package name; then `  {Registry}: {v1, v2, …}`
 *   registry list: `{Name}  {Location}` — with a trailing `  (default)` marker
 */
import { parsePackageDiagnostics, type PackageDiagnostic } from './packageProtocol';

export interface PackageSearchResult {
  name: string;
  version: string;
  registry: string;
}

export interface PackageSearchOutcome {
  results: PackageSearchResult[];
  diagnostics: PackageDiagnostic[];
}

const SEARCH_LINE = /^(\S+)\s+(\S+)\s+\((.+)\)$/;

export function parseSearchResults(exitCode: number, stdout: string, _stderr: string): PackageSearchOutcome {
  if (exitCode !== 0) {
    return { results: [], diagnostics: parsePackageDiagnostics(stdout) };
  }
  const results: PackageSearchResult[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line === 'No matching packages.') continue;
    const match = SEARCH_LINE.exec(line);
    if (match) results.push({ name: match[1], version: match[2], registry: match[3] });
  }
  return { results, diagnostics: [] };
}

export interface PackageInfoSource {
  registry: string;
  versions: string[];
}

export interface PackageInfo {
  name: string;
  sources: PackageInfoSource[];
}

export interface PackageInfoOutcome {
  info: PackageInfo | null;
  diagnostics: PackageDiagnostic[];
}

export function parsePackageInfo(exitCode: number, stdout: string, _stderr: string): PackageInfoOutcome {
  if (exitCode !== 0) {
    return { info: null, diagnostics: parsePackageDiagnostics(stdout) };
  }
  let name = '';
  const sources: PackageInfoSource[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indented = raw.startsWith(' ') || raw.startsWith('\t');
    if (!indented) {
      // The first flush-left line is the package name (the CLI emits it once).
      if (!name) name = raw.trim();
      continue;
    }
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const registry = raw.slice(0, colon).trim();
    const versions = raw
      .slice(colon + 1)
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (registry) sources.push({ registry, versions });
  }
  return { info: name ? { name, sources } : null, diagnostics: [] };
}

export interface RegistryEntry {
  name: string;
  location: string;
  isDefault: boolean;
}

const DEFAULT_MARKER = '(default)';

export function parseRegistryList(stdout: string): RegistryEntry[] {
  const entries: RegistryEntry[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    let isDefault = false;
    if (line.endsWith(DEFAULT_MARKER)) {
      isDefault = true;
      line = line.slice(0, -DEFAULT_MARKER.length).trim();
    }
    // Name and location are separated by a run of 2+ spaces (names never
    // contain whitespace; a location may contain single spaces).
    const parts = line.split(/\s{2,}/);
    const name = (parts[0] ?? '').trim();
    const location = parts.slice(1).join('  ').trim();
    if (name) entries.push({ name, location, isDefault });
  }
  return entries;
}
