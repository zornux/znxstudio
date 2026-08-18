/**
 * Typed settings schema + defaults. The interactive settings.json editor is
 * validated against SETTINGS_JSON_SCHEMA; consumers read keys with these types.
 */

/** A readable, VS Code-like editor default across display densities. */
export function defaultFontSize(): number {
  return 14;
}

export const DEFAULT_FONT_SIZE = defaultFontSize();

/** Shared coding font stack used by Monaco, terminals, and code surfaces. */
export const DEFAULT_EDITOR_FONT_FAMILY = "'Cascadia Code', 'Cascadia Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

/** Default syntax color for language keywords (a vivid pink/magenta). */
export const DEFAULT_KEYWORD_COLOR = '#ff5c9d';

export interface ZnxStudioSettings {
  'editor.fontSize': number;
  'editor.fontFamily': string;
  'editor.tabSize': number;
  /** Format the document with the active formatter on every explicit save. */
  'editor.formatOnSave': boolean;
  /** Syntax highlight color for language keywords (hex, e.g. #ff5c9d). */
  'editor.keywordColor': string;
  'workbench.theme': string;
  'workbench.locale': string;
  /** UI zoom level (Phase 20J WI4); 0 = 100%, each step ×1.2. */
  'workbench.zoomLevel': number;
  /** Auto-update (Phase 20F). `mode` off = enterprise-managed / manual only. */
  'update.channel': string;
  'update.mode': string;
  'files.autosave': boolean;
  'files.autosaveDelay': number;
  /**
   * Autosave trigger (Phase 20J WI2): off | afterDelay | onFocusChange | onWindowChange.
   * Undefaulted (optional) so an existing `files.autosave: true` still maps to
   * afterDelay until the user explicitly picks a mode — no silent behavior change.
   */
  'files.autosaveMode'?: string;
  /** Persisted editor session (open tabs + active) for restore-on-restart (internal). */
  'workbench.session': unknown;
  /** Recently opened workspace roots, most-recent first (internal). */
  'workbench.recentWorkspaces': string[];
  'zornux.compiler.enabled': boolean;
  'zornux.compiler.path': string;
  'zornux.compiler.cache.enabled': boolean;
  'zornux.errorLens.enabled': boolean;
  'zornux.diagnostics.docsUrl': string;
  'zornux.debug.transport': string;
  'zornux.debug.remoteHost': string;
  'zornux.debug.remotePort': number;
  /** Active environment profile per workspace root (Phase 5F). */
  'zornux.profiles.byRoot': Record<string, string>;
  /** AI provider (Phase 10). 'none' disables all AI features. */
  'ai.provider': string;
  'ai.model': string;
  'ai.apiKey': string;
  'ai.baseUrl': string;
  'marketplace.baseUrl': string;
  'ai.deployment': string;
  'ai.apiVersion': string;
  'ai.temperature': number;
  'ai.maxTokens': number;
  /** Inline AI completion (Phase 10B). */
  'ai.completion.enabled': boolean;
  'ai.completion.auto': boolean;
  'ai.completion.maxTokens': number;
  /** Deployment (Phase 13). */
  'deploy.profiles': unknown[];
  'deploy.activeProfile': string;
  'deploy.port': number;
  'deploy.cloud.provider': string;
  'deploy.ci.provider': string;
}

export const SETTINGS_DEFAULTS: ZnxStudioSettings = {
  'editor.fontSize': DEFAULT_FONT_SIZE,
  'editor.fontFamily': DEFAULT_EDITOR_FONT_FAMILY,
  'editor.tabSize': 2,
  'editor.formatOnSave': true,
  'editor.keywordColor': DEFAULT_KEYWORD_COLOR,
  'workbench.theme': 'znxstudio-dark',
  'workbench.locale': 'en',
  'workbench.zoomLevel': 0,
  'update.channel': 'stable',
  'update.mode': 'auto',
  'files.autosave': false,
  'files.autosaveDelay': 1000,
  // 'files.autosaveMode' is intentionally omitted (optional) — see the interface.
  'workbench.session': null,
  'workbench.recentWorkspaces': [],
  'zornux.compiler.enabled': true,
  'zornux.compiler.path': '',
  'zornux.compiler.cache.enabled': true,
  'zornux.errorLens.enabled': true,
  'zornux.diagnostics.docsUrl': '',
  'zornux.debug.transport': 'stdio',
  'zornux.debug.remoteHost': '127.0.0.1',
  'zornux.debug.remotePort': 0,
  'zornux.profiles.byRoot': {},
  'ai.provider': 'none',
  'ai.model': '',
  'ai.apiKey': '',
  'ai.baseUrl': '',
  'marketplace.baseUrl': 'https://marketplace.zornux.com',
  'ai.deployment': '',
  'ai.apiVersion': '',
  'ai.temperature': 0.2,
  'ai.maxTokens': 1024,
  'ai.completion.enabled': true,
  'ai.completion.auto': false,
  'ai.completion.maxTokens': 128,
  'deploy.profiles': [],
  'deploy.activeProfile': '',
  'deploy.port': 8080,
  'deploy.cloud.provider': 'none',
  'deploy.ci.provider': 'github',
};

/** JSON Schema wired into Monaco for live validation + hover docs. */
export const SETTINGS_JSON_SCHEMA = {
  type: 'object',
  title: 'ZnxStudio Settings',
  properties: {
    'editor.fontSize': {
      type: 'number',
      description: 'Editor font size in pixels.',
      minimum: 8,
      maximum: 40,
    },
    'editor.fontFamily': {
      type: 'string',
      description: 'Editor font family. Uses the first installed font in the comma-separated list.',
    },
    'editor.tabSize': {
      type: 'number',
      description: 'Number of spaces a tab is equal to.',
      minimum: 1,
      maximum: 8,
    },
    'editor.formatOnSave': {
      type: 'boolean',
      description: 'Format the document with the active formatter (zornux format) on every explicit save.',
    },
    'editor.keywordColor': {
      type: 'string',
      pattern: '^#?[0-9a-fA-F]{6}$',
      description: 'Syntax highlight color for language keywords, as a hex value (e.g. #ff5c9d).',
    },
    'workbench.theme': {
      type: 'string',
      description: 'Active color theme. "system" follows the OS light/dark preference.',
      enum: [
        'system',
        'znxstudio-dark',
        'znxstudio-light',
        'znxstudio-tide',
        'znxstudio-dune',
        'znxstudio-hc-dark',
        'znxstudio-hc-light',
      ],
    },
    'workbench.locale': {
      type: 'string',
      description: 'UI language. "pseudo" is an accented preview locale for localization testing.',
      enum: ['en', 'pseudo'],
    },
    'update.channel': {
      type: 'string',
      description: 'Update channel: stable, preview (rc/beta), or nightly.',
      enum: ['stable', 'preview', 'nightly'],
    },
    'update.mode': {
      type: 'string',
      description: 'Auto-update behaviour. "off" for enterprise-managed / manual updates only.',
      enum: ['auto', 'notify', 'off'],
    },
    'files.autosave': {
      type: 'boolean',
      description: 'Automatically save dirty documents after a delay.',
    },
    'files.autosaveMode': {
      type: 'string',
      enum: ['off', 'afterDelay', 'onFocusChange', 'onWindowChange'],
      description: 'When to auto-save changed documents.',
    },
    'files.autosaveDelay': {
      type: 'number',
      description: 'Delay in milliseconds before autosaving a changed document.',
      minimum: 100,
      maximum: 10000,
    },
    'zornux.compiler.enabled': {
      type: 'boolean',
      description: 'Use the real Zornux compiler for authoritative diagnostics.',
    },
    'zornux.compiler.path': {
      type: 'string',
      description: 'Explicit path to the zornux CLI executable (blank = auto-detect).',
    },
    'zornux.compiler.cache.enabled': {
      type: 'boolean',
      description: 'Persist compiler results on disk to speed up checks/builds across restarts.',
    },
    'zornux.errorLens.enabled': {
      type: 'boolean',
      description: 'Show diagnostic messages inline in the editor (Error Lens).',
    },
    'zornux.diagnostics.docsUrl': {
      type: 'string',
      description: 'Base URL for diagnostic docs; a ZX#### code links to <url>#<code>. Blank disables links.',
    },
    'zornux.debug.transport': {
      type: 'string',
      description: 'Transport for locally-launched debug sessions: piped stdio, or a TCP socket to `zornux dap --tcp`.',
      enum: ['stdio', 'tcp'],
    },
    'zornux.debug.remoteHost': {
      type: 'string',
      description: 'Host of a remote Zornux DAP server for "Attach to Remote Adapter".',
    },
    'zornux.debug.remotePort': {
      type: 'number',
      description: 'Port of a remote Zornux DAP server (0 = attach disabled).',
      minimum: 0,
      maximum: 65535,
    },
    'ai.provider': {
      type: 'string',
      description: 'AI provider. "none" disables all AI features (nothing is sent anywhere).',
      enum: ['none', 'openai', 'anthropic', 'google', 'ollama', 'azure', 'custom'],
    },
    'ai.model': {
      type: 'string',
      description: 'Model / deployment name (blank = provider default).',
    },
    'ai.apiKey': {
      type: 'string',
      description: 'Provider API key. Leave blank to source it from the provider\'s environment variable.',
    },
    'ai.baseUrl': {
      type: 'string',
      description: 'Override endpoint (Ollama host, Azure resource endpoint, or custom base URL).',
    },
    'marketplace.baseUrl': {
      type: 'string',
      description: 'Extension marketplace URL. Honored only in development builds; production is pinned to the canonical host.',
    },
    'ai.deployment': {
      type: 'string',
      description: 'Azure OpenAI deployment name.',
    },
    'ai.apiVersion': {
      type: 'string',
      description: 'Azure OpenAI api-version (blank = a sensible default).',
    },
    'ai.temperature': {
      type: 'number',
      description: 'Sampling temperature for AI completions.',
      minimum: 0,
      maximum: 2,
    },
    'ai.maxTokens': {
      type: 'number',
      description: 'Maximum tokens per AI completion.',
      minimum: 16,
      maximum: 32000,
    },
    'ai.completion.enabled': {
      type: 'boolean',
      description: 'Enable inline AI code completion (ghost text).',
    },
    'ai.completion.auto': {
      type: 'boolean',
      description: 'Request completions automatically as you type (off = explicit trigger only).',
    },
    'ai.completion.maxTokens': {
      type: 'number',
      description: 'Maximum tokens per inline completion (keep small for speed).',
      minimum: 16,
      maximum: 2000,
    },
    'workbench.zoomLevel': {
      type: 'number',
      description: 'UI zoom level (0 = 100%). Applied live.',
      minimum: -5,
      maximum: 8,
    },
    'deploy.activeProfile': {
      type: 'string',
      description: 'Name of the active deployment profile (blank = none).',
    },
    'deploy.port': {
      type: 'number',
      description: 'Port the deployed app listens on.',
      minimum: 1,
      maximum: 65535,
    },
    'deploy.cloud.provider': {
      type: 'string',
      description: 'Target cloud provider for deployment.',
      enum: ['none', 'fly', 'render', 'railway', 'aws', 'gcp', 'azure', 'custom'],
    },
    'deploy.ci.provider': {
      type: 'string',
      description: 'CI provider for generated pipelines.',
      enum: ['github', 'gitlab'],
    },
  },
  additionalProperties: true,
} as const;

/**
 * Settings whose change needs a window reload to take full effect. Most settings apply live (theme,
 * fonts, zoom, autosave, diagnostics); the locale only re-translates strings rendered *after* the change,
 * so already-drawn UI keeps the old language until the window reloads. The form shows a badge for these.
 */
export const RELOAD_REQUIRED_KEYS: ReadonlySet<string> = new Set(['workbench.locale']);

interface SettingConstraint {
  type?: 'string' | 'number' | 'boolean';
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  pattern?: string;
}

/**
 * Validates a setting value against {@link SETTINGS_JSON_SCHEMA} and returns a value safe to persist:
 * the (possibly clamped) value when it can be made valid, or `{ ok: false }` when it violates the schema
 * with no safe coercion. A key with no schema entry is unconstrained and passes through unchanged, so
 * this never rejects settings the schema does not describe (backward compatible).
 */
export function coerceSetting(key: string, value: unknown): { ok: true; value: unknown } | { ok: false } {
  const prop = (SETTINGS_JSON_SCHEMA.properties as Record<string, SettingConstraint | undefined>)[key];
  if (!prop) return { ok: true, value }; // unknown key — no constraint to enforce

  if (prop.type === 'boolean') {
    return typeof value === 'boolean' ? { ok: true, value } : { ok: false };
  }

  if (prop.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return { ok: false };
    let clamped = n;
    if (prop.minimum !== undefined) clamped = Math.max(prop.minimum, clamped);
    if (prop.maximum !== undefined) clamped = Math.min(prop.maximum, clamped);
    return { ok: true, value: clamped };
  }

  if (prop.type === 'string') {
    if (typeof value !== 'string') return { ok: false };
    if (prop.enum && !prop.enum.includes(value)) return { ok: false };
    if (prop.pattern && !new RegExp(prop.pattern).test(value)) return { ok: false };
    return { ok: true, value };
  }

  return { ok: true, value };
}

/** Descriptions rendered in the settings side pane. */
export const SETTINGS_DESCRIPTIONS: { key: keyof ZnxStudioSettings; description: string }[] = [
  { key: 'editor.fontSize', description: 'Editor font size in pixels.' },
  { key: 'editor.fontFamily', description: 'Editor font family stack.' },
  { key: 'editor.tabSize', description: 'Spaces per tab.' },
  { key: 'editor.formatOnSave', description: 'Format the document on every explicit save.' },
  { key: 'editor.keywordColor', description: 'Keyword syntax color (hex, e.g. #ff5c9d).' },
  { key: 'workbench.theme', description: 'Active color theme. "System" follows the OS light/dark preference.' },
  { key: 'files.autosave', description: 'Auto-save changed documents.' },
  { key: 'files.autosaveMode', description: 'When to auto-save: off, afterDelay, onFocusChange, onWindowChange.' },
  { key: 'files.autosaveDelay', description: 'Autosave delay in milliseconds.' },
  { key: 'zornux.compiler.enabled', description: 'Use the real Zornux compiler for diagnostics.' },
  { key: 'zornux.compiler.path', description: 'Path to the zornux CLI (blank = auto-detect).' },
  { key: 'zornux.compiler.cache.enabled', description: 'Persist compiler results on disk across restarts.' },
  { key: 'zornux.errorLens.enabled', description: 'Show diagnostic messages inline (Error Lens).' },
  { key: 'zornux.diagnostics.docsUrl', description: 'Base URL for ZX#### diagnostic docs (blank = off).' },
  { key: 'zornux.debug.transport', description: 'Local debug transport: stdio or tcp.' },
  { key: 'zornux.debug.remoteHost', description: 'Remote DAP server host for attach.' },
  { key: 'zornux.debug.remotePort', description: 'Remote DAP server port (0 = off).' },
  { key: 'ai.provider', description: 'AI provider (none / openai / anthropic / google / ollama / azure / custom).' },
  { key: 'ai.model', description: 'AI model / deployment (blank = provider default).' },
  { key: 'ai.apiKey', description: 'AI provider API key (blank = use environment variable).' },
  { key: 'marketplace.baseUrl', description: 'Extension marketplace URL (development builds only).' },
];

export const SETTINGS_MODEL_URI = 'inmemory://model/znxstudio-settings.json';
