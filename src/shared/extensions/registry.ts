/**
 * Marketplace extension registry — the PURE, Electron-free trust layer shared by the
 * main process (which owns integrity/persistence) and the tests. It maps marketplace
 * catalog cards to entries and STRICTLY validates a downloaded extension package into a
 * normalized, data-only "contribution model". It never executes code and never touches
 * I/O; byte-level checksum verification happens in the main process BEFORE anything here
 * is called, so a package whose integrity already failed is never parsed.
 *
 * V1 is declarative-only: an installed extension may contribute snippets, keybindings,
 * themes, and command *aliases* to an allowlisted set of existing IDE commands. Anything
 * that could reach executable/privileged behaviour (`main`, `scripts`, permissions,
 * un-allowlisted command targets, raw CSS) is rejected here.
 */
import {
  isEngineCompatible,
  SDK_VERSION,
  type ContributedTheme,
} from './manifest';
import type { MarketplaceEntry } from './marketplace';

/** Canonical marketplace asset type for IDE extensions. */
export const EXTENSION_ASSET_TYPE = 'znxstudio-extension';
/** Canonical marketplace category slug. */
export const EXTENSION_CATEGORY = 'extensions';
/** Content type of a V1 extension artifact (single bounded JSON document — no ZIP). */
export const EXTENSION_CONTENT_TYPE = 'application/vnd.zornux.znxstudio-extension+json';

/** Bounds (defence-in-depth against oversized/abusive declarative data). */
export const LIMITS = {
  maxCommands: 100,
  maxSnippets: 200,
  maxKeybindings: 100,
  maxThemes: 8,
  maxPrefix: 64,
  maxSnippetBody: 8192,
  maxDescription: 256,
  maxThemeTokens: 64,
} as const;

/**
 * Commands an extension may reference from a `runs` alias or a keybinding. This is a
 * curated set of BENIGN navigation/reveal/editor commands only. Privileged actions
 * (terminal, filesystem, workspace mutation, Git, debug, preview, trust, updates) are
 * deliberately excluded so declarative data can never become privileged execution.
 * `test/marketplaceregistry.test.ts` asserts each id here is a real registered command.
 */
export const EXTENSION_CONTRIBUTABLE_COMMANDS: readonly string[] = [
  'znxstudio.view.welcome',
  'znxstudio.view.problems',
  'znxstudio.search.show',
  'znxstudio.bookmark.show',
  'znxstudio.tasks.show',
  'znxstudio.metrics.show',
  'znxstudio.todo.show',
  'znxstudio.snippet.insert',
  'znxstudio.quickOpen',
  'znxstudio.theme.select',
  'znxstudio.view.zoomIn',
  'znxstudio.view.zoomOut',
  'znxstudio.view.zoomReset',
  'znxstudio.nav.back',
  'znxstudio.nav.forward',
  'znxstudio.fold.all',
  'znxstudio.fold.unfoldAll',
  'znxstudio.fold.toggle',
  'znxstudio.bookmark.toggle',
  'znxstudio.bookmark.next',
  'znxstudio.bookmark.previous',
];

/**
 * The ONLY theme tokens a contributed theme may set, each mapped to the IDE's CSS
 * variable (see `renderer/styles/main.css`). Unknown keys are rejected — a theme is
 * validated data, never raw CSS.
 */
export const THEME_TOKENS: Readonly<Record<string, string>> = {
  'editor.background': '--z-bg',
  'editor.foreground': '--z-fg',
  'panel.background': '--z-bg-panel',
  'elevated.background': '--z-bg-elevated',
  'border': '--z-border',
  'foreground.muted': '--z-fg-muted',
  'accent': '--z-accent',
  'accent.foreground': '--z-accent-fg',
  'activityBar.background': '--z-activity-bg',
  'statusBar.background': '--z-status-bg',
  'statusBar.foreground': '--z-status-fg',
  'hover.background': '--z-hover',
};

/** Snippet languages an extension may target. */
export const SUPPORTED_SNIPPET_LANGUAGES: readonly string[] = [
  'zornux', 'javascript', 'typescript', 'json', 'jsonc', 'markdown', 'html', 'css', 'plaintext',
];

/** Context keys a keybinding `when` clause may reference (small declarative grammar; no JS). */
const ALLOWED_WHEN_KEYS: readonly string[] = [
  'always', 'editorFocus', 'editorTextFocus', 'sideBarFocus', 'terminalFocus', 'searchFocus',
];

const COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ID_RE = /^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
// A key chord: one or two chords of `Mod+Key`. Modifiers: Ctrl/Cmd/Mod/Shift/Alt.
const CHORD_RE = /^([A-Za-z0-9]+|(?:(?:Ctrl|Cmd|Mod|Shift|Alt)\+)+[A-Za-z0-9]+)(?:\s+([A-Za-z0-9]+|(?:(?:Ctrl|Cmd|Mod|Shift|Alt)\+)+[A-Za-z0-9]+))?$/;

// ---------------------------------------------------------------- validated model

/** A normalized, data-only theme ready to apply (no raw CSS ever crosses this boundary). */
export interface ValidatedTheme {
  id: string;
  label: string;
  type: 'light' | 'dark';
  /** `--z-*` CSS variable → hex color. */
  cssVars: Record<string, string>;
}
export interface ValidatedCommandAlias {
  command: string;
  title: string;
  category?: string;
  runs: string;
}
export interface ValidatedSnippet {
  language: string;
  prefix: string;
  body: string;
  description?: string;
}
export interface ValidatedKeybinding {
  key: string;
  command: string;
  when?: string;
}
export interface ValidatedContributions {
  commands: ValidatedCommandAlias[];
  snippets: ValidatedSnippet[];
  keybindings: ValidatedKeybinding[];
  themes: ValidatedTheme[];
}
/** The install result the main process hands the renderer to apply. No code, no raw bytes. */
export interface ValidatedExtension {
  id: string;
  name: string;
  publisher: string;
  slug: string;
  version: string;
  description?: string;
  engines: { znxstudio: string };
  contributions: ValidatedContributions;
}

export interface ValidationResult {
  ok: boolean;
  extension?: ValidatedExtension;
  errors: string[];
}

/** Summary of an installed extension (for the Installed list in the manager UI). */
export interface InstalledExtensionSummary {
  id: string;
  publisher: string;
  slug: string;
  version: string;
  name: string;
  enabled: boolean;
}

/** Startup load result: enabled extensions to apply + any quarantined (skipped) records. */
export interface LoadEnabledResult {
  apply: ValidatedExtension[];
  quarantined: { id: string; reason: string }[];
}

/** Identity + version the marketplace advertised — the manifest must match it exactly. */
export interface ExpectedIdentity {
  publisherHandle: string;
  slug: string;
  version: string;
}

// ---------------------------------------------------------------- helpers

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}
/** Reject anything that could smuggle a URL/expression/markup into a "color" value. */
function isSafeColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (!COLOR_RE.test(v)) return false;
  return !/[(){}<>;:]|url|var|expression|@import|script/i.test(v);
}
function validWhen(when: string): boolean {
  // Only allowlisted context keys combined with ! && || and spaces — never JS.
  if (when.length > 128) return false;
  if (/[^a-zA-Z0-9\s!&|]/.test(when)) return false;
  const idents = when.split(/[\s!&|]+/).filter(Boolean);
  return idents.length > 0 && idents.every((k) => ALLOWED_WHEN_KEYS.includes(k));
}

// ---------------------------------------------------------------- card → entry

/** Map a marketplace catalog card (camelCase JSON) to a MarketplaceEntry for the UI. */
export function assetCardToEntry(card: unknown): MarketplaceEntry | null {
  const c = asRecord(card);
  if (!c) return null;
  const pub = asRecord(c.publisher);
  const handle = pub ? str(pub.handle) : str(c.publisher);
  const publisherName = (pub && str(pub.name)) || handle;
  const slug = str(c.slug);
  const version = str(c.latestVersion);
  const assetType = str(c.type);
  if (!handle || !slug || !ID_RE.test(`${handle}.${slug}`) || !SEMVER_RE.test(version)) return null;
  if (assetType && assetType !== EXTENSION_ASSET_TYPE) return null;
  const category = str(c.category);
  const downloads = typeof c.downloads === 'number' ? c.downloads : undefined;
  return {
    id: `${handle}.${slug}`,
    name: str(c.name) || slug,
    publisher: publisherName,
    version,
    description: str(c.summary),
    categories: category ? [category] : [],
    engines: { znxstudio: '*' }, // real range is validated at install from the manifest
    installs: downloads,
    remote: true,
    publisherHandle: handle,
    slug,
    trustTier: str(c.trustTier) || undefined,
    verified: c.verified === true,
    downloads,
    updatedAt: str(c.updatedAt) || undefined,
    assetType: assetType || undefined,
    iconUrl: str(c.iconUrl) || undefined,
  };
}

// ---------------------------------------------------------------- bundle parse

export interface ParsedBundle {
  ok: boolean;
  manifest?: unknown;
  errors: string[];
}
/** Parse the decoded artifact text into its `{ manifest }` envelope. Never throws. */
export function parseExtensionBundle(text: string): ParsedBundle {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Artifact is not valid JSON.'] };
  }
  const obj = asRecord(root);
  if (!obj) return { ok: false, errors: ['Artifact must be a JSON object.'] };
  if (obj.manifest === undefined) return { ok: false, errors: ['Artifact is missing `manifest`.'] };
  return { ok: true, manifest: obj.manifest, errors: [] };
}

// ---------------------------------------------------------------- manifest validation

/**
 * Strictly validate a marketplace extension manifest into a data-only contribution model.
 * Rejects executable surfaces and enforces the advertised marketplace identity/version.
 */
export function validateExtensionManifest(
  raw: unknown,
  expected: ExpectedIdentity,
  sdkVersion: string = SDK_VERSION,
): ValidationResult {
  const errors: string[] = [];
  const m = asRecord(raw);
  if (!m) return { ok: false, errors: ['Manifest must be a JSON object.'] };

  if (m.schemaVersion !== 1) errors.push('Unsupported manifest `schemaVersion` (expected 1).');

  // Reject any executable surface up front.
  if (m.main !== undefined) errors.push('`main` (executable entry) is not allowed for marketplace extensions.');
  if (m.scripts !== undefined) errors.push('`scripts` are not allowed for marketplace extensions.');
  if (Array.isArray(m.permissions) && m.permissions.length > 0) {
    errors.push('Declarative extensions must not request permissions.');
  } else if (m.permissions !== undefined && !Array.isArray(m.permissions)) {
    errors.push('`permissions` must be an array.');
  }
  if (Array.isArray(m.activationEvents) && m.activationEvents.length > 0) {
    errors.push('Declarative extensions must not declare activationEvents.');
  }

  const publisher = str(m.publisher);
  const name = str(m.name);
  const version = str(m.version);
  const id = str(m.id).toLowerCase();
  if (!name) errors.push('`name` is required.');
  if (!publisher) errors.push('`publisher` is required.');
  if (!SEMVER_RE.test(version)) errors.push(`\`version\` must be semver (got "${version}").`);
  if (!ID_RE.test(id)) errors.push(`\`id\` must look like "publisher.name" (got "${id}").`);
  if (/[/\\]|\.\./.test(id)) errors.push('`id` must not contain path segments.');

  // Identity must match what the marketplace advertised (defence against swap/typosquat).
  if (publisher && publisher.toLowerCase() !== expected.publisherHandle.toLowerCase()) {
    errors.push(`Manifest publisher "${publisher}" does not match marketplace publisher "${expected.publisherHandle}".`);
  }
  if (version && version !== expected.version) {
    errors.push(`Manifest version "${version}" does not match marketplace version "${expected.version}".`);
  }

  const engines = asRecord(m.engines);
  const engineRange = engines ? str(engines.znxstudio) : '';
  if (!engineRange) errors.push('`engines.znxstudio` is required.');
  else if (!isEngineCompatible(engineRange, sdkVersion)) {
    errors.push(`Requires ZnxStudio ${engineRange}; this build's SDK is ${sdkVersion}.`);
  }

  const contributes = asRecord(m.contributes) ?? {};
  const known = new Set(['commands', 'snippets', 'keybindings', 'themes']);
  for (const key of Object.keys(contributes)) {
    if (!known.has(key)) errors.push(`Unknown contribution type: \`contributes.${key}\`.`);
  }

  const contributions: ValidatedContributions = { commands: [], snippets: [], keybindings: [], themes: [] };
  const ownCommandIds = new Set<string>();

  // commands — declarative aliases only (must run an allowlisted command).
  if (contributes.commands !== undefined) {
    if (!Array.isArray(contributes.commands)) errors.push('`contributes.commands` must be an array.');
    else if (contributes.commands.length > LIMITS.maxCommands) errors.push('Too many commands.');
    else contributes.commands.forEach((entry, i) => {
      const e = asRecord(entry);
      const command = e ? str(e.command) : '';
      const title = e ? str(e.title) : '';
      const runs = e ? str(e.runs) : '';
      if (!command || !title) { errors.push(`commands[${i}] needs command + title.`); return; }
      if (id && !command.startsWith(`${id}.`)) errors.push(`Command "${command}" must be namespaced under "${id}.".`);
      if (!runs) { errors.push(`commands[${i}] ("${command}") must declare \`runs\` (declarative alias).`); return; }
      if (!EXTENSION_CONTRIBUTABLE_COMMANDS.includes(runs)) {
        errors.push(`commands[${i}] runs "${runs}", which is not an extension-contributable command.`);
        return;
      }
      ownCommandIds.add(command);
      contributions.commands.push({ command, title, category: e && str(e.category) ? str(e.category) : undefined, runs });
    });
  }

  // keybindings — bind a chord to an allowlisted command (or this extension's own alias).
  if (contributes.keybindings !== undefined) {
    if (!Array.isArray(contributes.keybindings)) errors.push('`contributes.keybindings` must be an array.');
    else if (contributes.keybindings.length > LIMITS.maxKeybindings) errors.push('Too many keybindings.');
    else contributes.keybindings.forEach((entry, i) => {
      const e = asRecord(entry);
      const key = e ? str(e.key) : '';
      const command = e ? str(e.command) : '';
      const when = e ? str(e.when) : '';
      if (!key || !command) { errors.push(`keybindings[${i}] needs key + command.`); return; }
      if (!CHORD_RE.test(key)) { errors.push(`keybindings[${i}] has an invalid key "${key}".`); return; }
      if (!EXTENSION_CONTRIBUTABLE_COMMANDS.includes(command) && !ownCommandIds.has(command)) {
        errors.push(`keybindings[${i}] targets non-contributable command "${command}".`);
        return;
      }
      if (when && !validWhen(when)) { errors.push(`keybindings[${i}] has an invalid \`when\` clause.`); return; }
      contributions.keybindings.push({ key, command, when: when || undefined });
    });
  }

  // snippets — bounded, literal text.
  if (contributes.snippets !== undefined) {
    if (!Array.isArray(contributes.snippets)) errors.push('`contributes.snippets` must be an array.');
    else if (contributes.snippets.length > LIMITS.maxSnippets) errors.push('Too many snippets.');
    else contributes.snippets.forEach((entry, i) => {
      const e = asRecord(entry);
      const language = e ? str(e.language) : '';
      const prefix = e ? str(e.prefix) : '';
      const body = e && typeof e.body === 'string' ? e.body : '';
      const description = e ? str(e.description) : '';
      if (!language || !prefix || !body) { errors.push(`snippets[${i}] needs language + prefix + body.`); return; }
      if (!SUPPORTED_SNIPPET_LANGUAGES.includes(language)) { errors.push(`snippets[${i}] language "${language}" is unsupported.`); return; }
      if (prefix.length > LIMITS.maxPrefix) { errors.push(`snippets[${i}] prefix too long.`); return; }
      if (body.length > LIMITS.maxSnippetBody) { errors.push(`snippets[${i}] body too long.`); return; }
      if (description.length > LIMITS.maxDescription) { errors.push(`snippets[${i}] description too long.`); return; }
      contributions.snippets.push({ language, prefix, body, description: description || undefined });
    });
  }

  // themes — validated tokens only, mapped to CSS variables.
  if (contributes.themes !== undefined) {
    if (!Array.isArray(contributes.themes)) errors.push('`contributes.themes` must be an array.');
    else if (contributes.themes.length > LIMITS.maxThemes) errors.push('Too many themes.');
    else contributes.themes.forEach((entry, i) => {
      const t = asRecord(entry) as (ContributedTheme & Record<string, unknown>) | null;
      const themeId = t ? str(t.id) : '';
      const label = t ? str(t.label) : '';
      const type = t ? str(t.type) : '';
      const colors = t ? asRecord(t.colors) : null;
      if (!themeId || !label) { errors.push(`themes[${i}] needs id + label.`); return; }
      if (/[/\\]|\.\./.test(themeId)) { errors.push(`themes[${i}] id must not contain path segments.`); return; }
      if (type !== 'light' && type !== 'dark') { errors.push(`themes[${i}] type must be "light" or "dark".`); return; }
      if (!colors || Object.keys(colors).length === 0) { errors.push(`themes[${i}] needs \`colors\`.`); return; }
      if (Object.keys(colors).length > LIMITS.maxThemeTokens) { errors.push(`themes[${i}] has too many tokens.`); return; }
      const cssVars: Record<string, string> = {};
      let bad = false;
      for (const [token, value] of Object.entries(colors)) {
        const cssVar = THEME_TOKENS[token];
        if (!cssVar) { errors.push(`themes[${i}] has unsupported token "${token}".`); bad = true; break; }
        if (!isSafeColor(value)) { errors.push(`themes[${i}] token "${token}" is not a valid color.`); bad = true; break; }
        cssVars[cssVar] = (value as string).trim();
      }
      if (bad) return;
      contributions.themes.push({ id: `${id}.${themeId}`, label, type, cssVars });
    });
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    extension: {
      id,
      name,
      publisher,
      slug: expected.slug,
      version,
      description: str(m.description) || undefined,
      engines: { znxstudio: engineRange },
      contributions,
    },
  };
}
