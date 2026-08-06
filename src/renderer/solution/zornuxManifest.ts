/**
 * Pure parser for a Zornux `zornux.project` manifest — the hand-editable
 * `key = value` format with `dependency Name = constraint [from Registry]` and
 * `registry Name = location` lines. Mirrors the compiler's
 * `Zornux.PackageManager.PackageManifest.Parse` so ZnxStudio reads the SAME file
 * the CLI writes (via `zornux add`), keeping project references in sync with the
 * toolchain rather than a parallel format. Monaco/IPC-free → unit-testable.
 */
export interface PackageDependency {
  name: string;
  /** Version constraint text, e.g. "^1.0.0" (interpreted by `zornux restore`, not here). */
  constraint: string;
  /** Optional registry the dependency is scoped to ("... from store"). */
  registry?: string;
}

export interface ZornuxManifest {
  name: string;
  version: string;
  entry: string | null;
  source: string;
  defaultRegistry: string | null;
  /**
   * The project's pinned Zornux toolchain VERSION, if any (a `toolchain = X`
   * line — read by ZnxStudio for multi-toolchain resolution; the compiler ignores
   * a field it doesn't use). Null when unpinned.
   */
  toolchain: string | null;
  dependencies: PackageDependency[];
}

export function parseZornuxManifest(text: string): ZornuxManifest {
  const values = new Map<string, string>();
  const dependencies: PackageDependency[] = [];

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (line.startsWith('dependency ')) {
      const dependency = parseDependency(line);
      if (dependency) dependencies.push(dependency);
      continue;
    }
    if (line.startsWith('registry ')) continue; // registries aren't needed for references

    const eq = line.indexOf('=');
    if (eq > 0) values.set(line.slice(0, eq).trim().toLowerCase(), line.slice(eq + 1).trim());
  }

  return {
    name: values.get('name') ?? 'project',
    version: values.get('version') ?? '0.1.0',
    entry: values.get('entry') ?? null,
    source: values.get('source') ?? '.',
    defaultRegistry: values.get('default-registry') ?? null,
    toolchain: values.get('toolchain') ?? null,
    dependencies,
  };
}

function parseDependency(line: string): PackageDependency | null {
  const rest = line.slice('dependency '.length);
  const eq = rest.indexOf('=');
  if (eq <= 0) return null;

  const name = rest.slice(0, eq).trim();
  let constraint = rest.slice(eq + 1).trim();
  let registry: string | undefined;

  // An optional trailing "from Registry" scopes the dependency to one registry.
  const from = constraint.indexOf(' from ');
  if (from >= 0) {
    registry = constraint.slice(from + ' from '.length).trim();
    constraint = constraint.slice(0, from).trim();
  }

  if (!name || !constraint) return null;
  return registry ? { name, constraint, registry } : { name, constraint };
}
