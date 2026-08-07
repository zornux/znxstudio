/**
 * Extension manifest (Phase 11A). The public, versioned contract an extension
 * declares itself with — parsed and validated here (pure, no I/O) so both the
 * runtime and the tests share one source of truth. The manifest is intentionally
 * small and stable; the executable surface lives behind the SDK API.
 */

/** The ZnxStudio Extension API (SDK) version extensions target via `engines.znxstudio`. */
export const SDK_VERSION = '1.0.0';

export interface ContributedCommand {
  command: string;
  title: string;
  category?: string;
  /**
   * Declarative alias: when invoked, run this EXISTING command id instead of
   * executing extension code. Marketplace (data-only) extensions contribute
   * palette entries this way; the target must be on the extension-contributable
   * allowlist (see `shared/extensions/registry.ts`). Bundled code extensions
   * leave this unset and provide a handler instead.
   */
  runs?: string;
}

/** A declarative snippet contribution (data only — inserted as literal text). */
export interface ContributedSnippet {
  language: string;
  prefix: string;
  body: string;
  description?: string;
}

/** A declarative keybinding contribution — binds a chord to an allowlisted command. */
export interface ContributedKeybinding {
  key: string;
  command: string;
  when?: string;
}

/** A declarative color theme — validated tokens only, mapped to the IDE's theme system. */
export interface ContributedTheme {
  id: string;
  label: string;
  type: 'light' | 'dark';
  colors: Record<string, string>;
}

export interface ExtensionContributions {
  commands?: ContributedCommand[];
  snippets?: ContributedSnippet[];
  keybindings?: ContributedKeybinding[];
  themes?: ContributedTheme[];
}

export interface ExtensionManifest {
  /** Fully-qualified id, `publisher.name` (lowercase). */
  id: string;
  /** Human-readable display name. */
  name: string;
  version: string;
  publisher: string;
  description?: string;
  /** Entry module path (used by disk loading in a later phase). */
  main?: string;
  engines: { znxstudio: string };
  activationEvents: string[];
  contributes: ExtensionContributions;
  permissions: string[];
}

export interface ManifestParseResult {
  ok: boolean;
  manifest?: ExtensionManifest;
  errors: string[];
}

/** Permissions an extension may request; the SDK gates capabilities on these. */
export const KNOWN_PERMISSIONS = [
  'commands',
  'statusBar',
  'notifications',
  'workspace',
  'editor',
  'output',
  'storage',
] as const;

const ID_RE = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ACTIVATION_RE = /^(?:\*|onStartup|onCommand:.+|onLanguage:.+|onView:.+)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Parse + validate a raw manifest object. Never throws; returns collected
 * errors. On success `manifest` is a fully-normalized ExtensionManifest.
 */
export function parseExtensionManifest(raw: unknown): ManifestParseResult {
  const errors: string[] = [];
  const root = asRecord(raw);
  if (!root) return { ok: false, errors: ['Manifest must be a JSON object.'] };

  const name = typeof root.name === 'string' ? root.name.trim() : '';
  const publisher = typeof root.publisher === 'string' ? root.publisher.trim() : '';
  const version = typeof root.version === 'string' ? root.version.trim() : '';
  if (!name) errors.push('`name` is required.');
  if (!publisher) errors.push('`publisher` is required.');
  if (!version) errors.push('`version` is required.');
  else if (!SEMVER_RE.test(version)) errors.push(`\`version\` must be semver (got "${version}").`);

  const id = typeof root.id === 'string' && root.id.trim()
    ? root.id.trim().toLowerCase()
    : `${publisher}.${name}`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-');
  if (!ID_RE.test(id)) errors.push(`\`id\` must look like "publisher.name" (got "${id}").`);

  const engines = asRecord(root.engines);
  const engineRange = engines && typeof engines.znxstudio === 'string' ? engines.znxstudio.trim() : '';
  if (!engineRange) errors.push('`engines.znxstudio` is required (e.g. "^1.0.0" or "*").');

  const activationEvents: string[] = [];
  if (root.activationEvents !== undefined) {
    if (!Array.isArray(root.activationEvents)) {
      errors.push('`activationEvents` must be an array.');
    } else {
      root.activationEvents.forEach((event, index) => {
        if (typeof event !== 'string' || !ACTIVATION_RE.test(event)) {
          errors.push(`\`activationEvents[${index}]\` is not a valid activation event.`);
        } else {
          activationEvents.push(event);
        }
      });
    }
  }

  const contributes: ExtensionContributions = {};
  const rawContrib = asRecord(root.contributes);
  if (rawContrib && rawContrib.commands !== undefined) {
    if (!Array.isArray(rawContrib.commands)) {
      errors.push('`contributes.commands` must be an array.');
    } else {
      const commands: ContributedCommand[] = [];
      rawContrib.commands.forEach((entry, index) => {
        const command = asRecord(entry);
        const cmd = command && typeof command.command === 'string' ? command.command.trim() : '';
        const title = command && typeof command.title === 'string' ? command.title.trim() : '';
        if (!cmd || !title) {
          errors.push(`\`contributes.commands[${index}]\` needs \`command\` and \`title\`.`);
          return;
        }
        if (!cmd.startsWith(`${id}.`)) {
          errors.push(`Command "${cmd}" must be namespaced under the extension id ("${id}.…").`);
        }
        const category = typeof command!.category === 'string' ? command!.category : undefined;
        const runs = typeof command!.runs === 'string' && command!.runs.trim() ? command!.runs.trim() : undefined;
        commands.push({ command: cmd, title, category, runs });
      });
      contributes.commands = commands;
    }
  }

  const permissions: string[] = [];
  if (root.permissions !== undefined) {
    if (!Array.isArray(root.permissions)) {
      errors.push('`permissions` must be an array.');
    } else {
      for (const permission of root.permissions) {
        if (typeof permission !== 'string' || !(KNOWN_PERMISSIONS as readonly string[]).includes(permission)) {
          errors.push(`Unknown permission: ${JSON.stringify(permission)}.`);
        } else {
          permissions.push(permission);
        }
      }
    }
  }

  if (errors.length) return { ok: false, errors };

  const manifest: ExtensionManifest = {
    id,
    name,
    publisher,
    version,
    description: typeof root.description === 'string' ? root.description : undefined,
    main: typeof root.main === 'string' ? root.main : undefined,
    engines: { znxstudio: engineRange },
    activationEvents,
    contributes,
    permissions,
  };
  return { ok: true, manifest, errors: [] };
}

interface Version {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(value: string): Version | null {
  const match = value.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function compareVersions(a: Version, b: Version): number {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch;
}

/**
 * Whether the SDK satisfies an `engines.znxstudio` range. Supports `*`/empty,
 * exact `x.y.z`, caret `^x.y.z` (same major, ≥), and `>=x.y.z` / `>x.y.z`.
 */
export function isEngineCompatible(range: string, sdkVersion: string = SDK_VERSION): boolean {
  const r = (range ?? '').trim();
  if (r === '' || r === '*' || r === 'x') return true;
  const version = parseVersion(sdkVersion);
  if (!version) return false;

  if (r.startsWith('^')) {
    const base = parseVersion(r.slice(1));
    return !!base && version.major === base.major && compareVersions(version, base) >= 0;
  }
  if (r.startsWith('>=')) {
    const base = parseVersion(r.slice(2));
    return !!base && compareVersions(version, base) >= 0;
  }
  if (r.startsWith('>')) {
    const base = parseVersion(r.slice(1));
    return !!base && compareVersions(version, base) > 0;
  }
  const base = parseVersion(r);
  if (base) return compareVersions(version, base) === 0;
  // Plain major ("1") or major.minor ("1.0").
  const parts = r.split('.').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return false;
  if (parts.length === 1) return version.major === parts[0];
  return version.major === parts[0] && version.minor === parts[1];
}

/** Whether an extension's activation events fire for a given trigger. */
export function activationMatches(events: string[], trigger: string): boolean {
  return events.includes('*') || events.includes(trigger);
}
