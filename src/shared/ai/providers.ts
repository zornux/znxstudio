/**
 * Vendor-neutral AI provider layer (Phase 10A).
 *
 * The whole point of this file: every AI feature in ZnxStudio — chat, completion,
 * refactoring, docs, test-gen, debugging, architecture — talks to ONE interface,
 * and the concrete vendor is a runtime choice. No single AI vendor becomes a
 * dependency, and AI is entirely optional (provider `none` disables it).
 *
 * This module is PURE (no I/O, no imports). It builds the HTTP request for the
 * selected provider and parses the provider's response back into plain text. The
 * main process performs the actual `fetch`; the renderer and the tests import
 * the same pure logic, so provider wiring is fully unit-testable without a key.
 */

export type AiRole = 'system' | 'user' | 'assistant';

export interface AiMessage {
  role: AiRole;
  content: string;
}

/** Every provider ZnxStudio can speak to. `none` means AI is turned off. */
export type AiProviderId =
  | 'none'
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'ollama'
  | 'azure'
  | 'custom';

/**
 * A resolved provider configuration. Assembled by the renderer from settings and
 * passed across IPC; the main process fills a blank `apiKey` from the provider's
 * environment variable so enterprises can avoid persisting secrets on disk.
 */
export interface AiProviderConfig {
  provider: AiProviderId;
  /** Secret. May be blank when supplied via environment variable in main. */
  apiKey?: string;
  /** Override base URL (Ollama host, Azure resource endpoint, custom endpoint). */
  baseUrl?: string;
  /** Model / deployment identifier. */
  model?: string;
  /** Azure OpenAI deployment name (defaults to `model` when blank). */
  deployment?: string;
  /** Azure OpenAI api-version. */
  apiVersion?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AiCompletionRequest {
  config: AiProviderConfig;
  messages: AiMessage[];
}

export interface AiCompletionResult {
  ok: boolean;
  text: string;
  provider: AiProviderId;
  model: string;
  /** HTTP status, when a request was actually made. */
  status?: number;
  /** Populated on any failure (disabled, misconfigured, transport, or provider error). */
  error?: string;
  /** True when a streamed request was cancelled by the caller (not a real error). */
  cancelled?: boolean;
}

/** A fully-formed HTTP request the main process can hand straight to `fetch`. */
export interface AiHttpRequest {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body?: string;
}

/** Static, user-facing metadata describing a provider and what it needs. */
export interface AiProviderDescriptor {
  id: AiProviderId;
  label: string;
  /** A one-line hint shown under the radio in AI settings. */
  blurb: string;
  needsKey: boolean;
  needsEndpoint: boolean;
  needsDeployment: boolean;
  /** True for on-device / self-hosted providers (no cloud call, no key). */
  local: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
  /** Suggested models shown as a datalist; free text is always allowed. */
  models: string[];
  /** Environment variables consulted (in order) when `apiKey` is blank. */
  envKeys: string[];
  keyLabel?: string;
  endpointLabel?: string;
  docsUrl?: string;
}

/**
 * The provider catalog, in the order shown in AI settings. Anthropic defaults to
 * the latest balanced Claude model; every list is a suggestion — any string is
 * accepted so new models and private deployments work without a ZnxStudio update.
 */
export const AI_PROVIDERS: readonly AiProviderDescriptor[] = [
  {
    id: 'none',
    label: 'None',
    blurb: 'AI features are turned off. Nothing is sent anywhere.',
    needsKey: false,
    needsEndpoint: false,
    needsDeployment: false,
    local: false,
    models: [],
    envKeys: [],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    blurb: 'OpenAI Chat Completions (api.openai.com).',
    needsKey: true,
    needsEndpoint: false,
    needsDeployment: false,
    local: false,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1-mini',
    models: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    envKeys: ['OPENAI_API_KEY'],
    keyLabel: 'OpenAI API key',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    blurb: 'Claude Messages API (api.anthropic.com).',
    needsKey: true,
    needsEndpoint: false,
    needsDeployment: false,
    local: false,
    defaultBaseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-5',
    models: ['claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5-20251001'],
    envKeys: ['ANTHROPIC_API_KEY'],
    keyLabel: 'Anthropic API key',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google',
    blurb: 'Gemini generateContent (generativelanguage.googleapis.com).',
    needsKey: true,
    needsEndpoint: false,
    needsDeployment: false,
    local: false,
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.5-flash',
    models: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    envKeys: ['GOOGLE_API_KEY', 'GEMINI_API_KEY'],
    keyLabel: 'Google AI API key',
    docsUrl: 'https://aistudio.google.com/app/apikey',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    blurb: 'Local models via Ollama. Private, no key, runs on your machine.',
    needsKey: false,
    needsEndpoint: false,
    needsDeployment: false,
    local: true,
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'llama3.1',
    models: ['llama3.1', 'qwen2.5-coder', 'codellama', 'mistral', 'phi3'],
    envKeys: [],
    endpointLabel: 'Ollama host',
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    blurb: 'Your Azure OpenAI resource + deployment.',
    needsKey: true,
    needsEndpoint: true,
    needsDeployment: true,
    local: false,
    defaultModel: '',
    models: [],
    envKeys: ['AZURE_OPENAI_API_KEY'],
    keyLabel: 'Azure OpenAI key',
    endpointLabel: 'Resource endpoint (https://<resource>.openai.azure.com)',
  },
  {
    id: 'custom',
    label: 'Custom (OpenAI-compatible)',
    blurb: 'Any OpenAI-compatible endpoint — company-hosted or self-run.',
    needsKey: false,
    needsEndpoint: true,
    needsDeployment: false,
    local: false,
    defaultModel: '',
    models: [],
    envKeys: [],
    keyLabel: 'API key (optional)',
    endpointLabel: 'Base URL (e.g. https://host/v1)',
  },
];

const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_AZURE_API_VERSION = '2024-06-01';

/* ----------------------------------------------------------- streaming parse */

/**
 * Incrementally turns a provider's streamed HTTP body into text deltas. Chunks
 * arrive split at arbitrary byte boundaries, so the parser buffers partial lines
 * and only emits from complete ones. Pure and per-provider so it is unit-tested
 * against captured chunk boundaries — the transport just feeds it `push(chunk)`.
 */
export interface StreamParser {
  push(chunk: string): string[];
}

type DeltaExtractor = (json: Record<string, unknown>) => string | null;

function pick(json: Record<string, unknown>, path: (string | number)[]): unknown {
  let node: unknown = json;
  for (const key of path) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string | number, unknown>)[key];
  }
  return node;
}

/**
 * A line-buffered parser. `sse` providers frame deltas as `data: <json>` lines
 * (terminated by `[DONE]`); Ollama streams newline-delimited JSON objects.
 */
function lineParser(sse: boolean, extract: DeltaExtractor): StreamParser {
  let buffer = '';
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const out: string[] = [];
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let payload = line;
        if (sse) {
          if (!line.startsWith('data:')) continue; // skip `event:`/comment/keep-alive lines
          payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
        }
        try {
          const delta = extract(JSON.parse(payload) as Record<string, unknown>);
          if (delta) out.push(delta);
        } catch {
          /* a partial or non-JSON keep-alive line — ignore */
        }
      }
      return out;
    },
  };
}

/** Build the streaming delta parser for a provider. */
export function createStreamParser(provider: AiProviderId): StreamParser {
  switch (provider) {
    case 'anthropic':
      return lineParser(true, (json) =>
        json.type === 'content_block_delta' && asObject(json.delta).type === 'text_delta'
          ? (asObject(json.delta).text as string) ?? null
          : null,
      );
    case 'google':
      return lineParser(true, (json) => {
        const text = pick(json, ['candidates', 0, 'content', 'parts', 0, 'text']);
        return typeof text === 'string' ? text : null;
      });
    case 'ollama':
      return lineParser(false, (json) => {
        const text = pick(json, ['message', 'content']);
        return typeof text === 'string' && text ? text : null;
      });
    case 'openai':
    case 'custom':
    case 'azure':
    default:
      return lineParser(true, (json) => {
        const text = pick(json, ['choices', 0, 'delta', 'content']);
        return typeof text === 'string' ? text : null;
      });
  }
}

/** A status worth retrying: rate limit (429) or a transient server error (5xx). */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

/**
 * Backoff before a retry. Honors a numeric `Retry-After` (seconds); otherwise
 * exponential (500ms, 1s, 2s, …). Capped at `maxMs`.
 */
export function retryDelayMs(attempt: number, retryAfter: string | null, maxMs = 20_000): number {
  const seconds = retryAfter ? Number(retryAfter.trim()) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, maxMs);
  return Math.min(2 ** attempt * 500, maxMs);
}

export function describeProvider(id: AiProviderId): AiProviderDescriptor {
  return AI_PROVIDERS.find((p) => p.id === id) ?? AI_PROVIDERS[0];
}

export function providerLabel(id: AiProviderId): string {
  return describeProvider(id).label;
}

/** The effective model: config override, else the provider's default, else ''. */
export function resolveModel(config: AiProviderConfig): string {
  const explicit = (config.model ?? '').trim();
  if (explicit) return explicit;
  return describeProvider(config.provider).defaultModel ?? '';
}

/** The environment key from which main may source a blank apiKey, or null. */
export function envKeyFor(id: AiProviderId): string[] {
  return describeProvider(id).envKeys;
}

/** Redact a secret for logs / status ("sk-…1234" or "(none)"). */
export function redactKey(key: string | undefined): string {
  const k = (key ?? '').trim();
  if (!k) return '(none)';
  if (k.length <= 6) return '••••';
  return `${k.slice(0, 3)}…${k.slice(-2)}`;
}

/**
 * Validate a config for use. Returns a human-readable reason it cannot run, or
 * null when it is ready. Used both to gate calls and to drive the settings UI.
 */
export function validateConfig(config: AiProviderConfig): string | null {
  const desc = describeProvider(config.provider);
  if (config.provider === 'none') return 'AI is disabled. Choose a provider in AI settings.';
  if (desc.needsKey && !(config.apiKey ?? '').trim()) {
    return `${desc.label} needs an API key (or set ${desc.envKeys.join(' / ')}).`;
  }
  if (desc.needsEndpoint && !(config.baseUrl ?? '').trim()) {
    return `${desc.label} needs an endpoint URL.`;
  }
  if (desc.needsDeployment && !(config.deployment ?? '').trim() && !(config.model ?? '').trim()) {
    return `${desc.label} needs a deployment name.`;
  }
  if (!desc.needsDeployment && !resolveModel(config)) {
    return `${desc.label} needs a model name.`;
  }
  return null;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function splitSystem(messages: AiMessage[]): { system: string; turns: AiMessage[] } {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n\n');
  const turns = messages.filter((m) => m.role !== 'system');
  return { system, turns };
}

/**
 * Build the concrete HTTP request for the selected provider. Throws a clear
 * error for `none` or a missing endpoint — callers should `validateConfig`
 * first for a friendly message.
 */
export function buildHttpRequest(
  config: AiProviderConfig,
  messages: AiMessage[],
  options: { stream?: boolean } = {},
): AiHttpRequest {
  const model = resolveModel(config);
  const temperature = config.temperature ?? DEFAULT_TEMPERATURE;
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS;
  const key = (config.apiKey ?? '').trim();
  const stream = options.stream ?? false;

  switch (config.provider) {
    case 'openai': {
      const base = trimSlash(config.baseUrl?.trim() || 'https://api.openai.com/v1');
      return {
        url: `${base}/chat/completions`,
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, temperature, stream }),
      };
    }
    case 'custom': {
      const base = requireEndpoint(config);
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (key) headers.authorization = `Bearer ${key}`;
      return {
        url: `${base}/chat/completions`,
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, temperature, stream }),
      };
    }
    case 'azure': {
      const base = requireEndpoint(config);
      const deployment = (config.deployment ?? '').trim() || model;
      const version = (config.apiVersion ?? '').trim() || DEFAULT_AZURE_API_VERSION;
      return {
        url: `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(version)}`,
        method: 'POST',
        headers: { 'content-type': 'application/json', 'api-key': key },
        body: JSON.stringify({ messages, temperature, stream }),
      };
    }
    case 'anthropic': {
      const base = trimSlash(config.baseUrl?.trim() || 'https://api.anthropic.com');
      const { system, turns } = splitSystem(messages);
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens,
        temperature,
        stream,
        messages: turns.map((m) => ({ role: m.role, content: m.content })),
      };
      if (system) body.system = system;
      return {
        url: `${base}/v1/messages`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      };
    }
    case 'google': {
      const base = trimSlash(
        config.baseUrl?.trim() || 'https://generativelanguage.googleapis.com/v1beta',
      );
      const { system, turns } = splitSystem(messages);
      const body: Record<string, unknown> = {
        contents: turns.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { temperature, maxOutputTokens: maxTokens },
      };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      // Streaming uses the SSE method + `alt=sse`; non-streaming the plain method.
      const method = stream ? 'streamGenerateContent' : 'generateContent';
      const query = stream ? `?alt=sse&key=${encodeURIComponent(key)}` : `?key=${encodeURIComponent(key)}`;
      return {
        url: `${base}/models/${encodeURIComponent(model)}:${method}${query}`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      };
    }
    case 'ollama': {
      const base = trimSlash(config.baseUrl?.trim() || 'http://localhost:11434');
      return {
        url: `${base}/api/chat`,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, stream, options: { temperature } }),
      };
    }
    case 'none':
    default:
      throw new Error('AI is disabled — choose a provider in AI settings.');
  }
}

function requireEndpoint(config: AiProviderConfig): string {
  const base = (config.baseUrl ?? '').trim();
  if (!base) {
    throw new Error(`${describeProvider(config.provider).label} needs an endpoint URL.`);
  }
  return trimSlash(base);
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Pull a provider's error message out of a parsed error body, if present. */
function extractError(provider: AiProviderId, json: Record<string, unknown>): string | undefined {
  if (provider === 'ollama') {
    return typeof json.error === 'string' ? json.error : undefined;
  }
  const err = asObject(json.error);
  const message = err.message;
  if (typeof message === 'string') return message;
  return typeof json.error === 'string' ? json.error : undefined;
}

/**
 * Parse a provider response (already read as text) into plain assistant text.
 * Handles the four wire shapes (OpenAI/Azure/custom, Anthropic, Gemini, Ollama)
 * and surfaces provider error payloads. Never throws.
 */
export function parseCompletion(
  provider: AiProviderId,
  status: number,
  bodyText: string,
): { ok: boolean; text: string; error?: string } {
  let json: Record<string, unknown>;
  try {
    json = asObject(JSON.parse(bodyText));
  } catch {
    if (status >= 400) return { ok: false, text: '', error: `HTTP ${status}: ${bodyText.slice(0, 300)}` };
    return { ok: false, text: '', error: 'Provider returned a non-JSON response.' };
  }

  const providerError = extractError(provider, json);
  if (status >= 400 || providerError) {
    return { ok: false, text: '', error: providerError ?? `HTTP ${status}` };
  }

  const text = extractText(provider, json);
  if (!text) return { ok: false, text: '', error: 'Provider returned no content.' };
  return { ok: true, text };
}

function extractText(provider: AiProviderId, json: Record<string, unknown>): string {
  switch (provider) {
    case 'openai':
    case 'azure':
    case 'custom': {
      const choices = json.choices;
      if (Array.isArray(choices) && choices[0]) {
        const message = asObject(asObject(choices[0]).message);
        if (typeof message.content === 'string') return message.content;
      }
      return '';
    }
    case 'anthropic': {
      const content = json.content;
      if (Array.isArray(content)) {
        return content
          .map((block) => {
            const b = asObject(block);
            return typeof b.text === 'string' ? b.text : '';
          })
          .join('');
      }
      return '';
    }
    case 'google': {
      const candidates = json.candidates;
      if (Array.isArray(candidates) && candidates[0]) {
        const parts = asObject(asObject(candidates[0]).content).parts;
        if (Array.isArray(parts)) {
          return parts
            .map((part) => {
              const p = asObject(part);
              return typeof p.text === 'string' ? p.text : '';
            })
            .join('');
        }
      }
      return '';
    }
    case 'ollama': {
      const message = asObject(json.message);
      return typeof message.content === 'string' ? message.content : '';
    }
    default:
      return '';
  }
}
