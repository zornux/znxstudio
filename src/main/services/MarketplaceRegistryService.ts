/**
 * Marketplace registry client (main process). The one place IDE↔marketplace traffic
 * leaves the machine: the renderer is Node-free and CSP-blocks cross-origin fetch, so all
 * discovery + download happens here. Electron-free (like AiService) so it is unit-testable.
 *
 * Every request URL and every redirect target is revalidated through the anti-SSRF URL
 * policy; responses are size- and content-type-bounded. The download primitive is
 * byte-oriented (returns the base64 artifact payload + advertised checksum) — no decoded
 * extension text is produced here; integrity + parsing happen in ExtensionInstaller.
 */
import {
  assertSafeMarketplaceUrl,
  resolveBaseUrl,
  type UrlPolicyOptions,
} from './marketplaceUrlPolicy';
import { EXTENSION_ASSET_TYPE } from '../../shared/extensions/registry';

const MAX_RESPONSE_BYTES = 9 * 1024 * 1024; // > the 8 MB marketplace body cap, with headroom
const MAX_REDIRECTS = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

export interface MarketplaceSearchParams {
  query?: string;
  page?: number;
  perPage?: number;
  sort?: string;
}
export interface MarketplaceArtifact {
  contentBase64: string;
  checksum: string;
  mimeType: string;
  filename: string;
  version: string;
}

/** Keep renderer-provided search values small and predictable at the network boundary. */
export function normalizeMarketplaceSearchParams(params: MarketplaceSearchParams = {}): Required<MarketplaceSearchParams> {
  const query = typeof params.query === 'string' ? params.query.trim().slice(0, 200) : '';
  const page = Number.isInteger(params.page) ? Math.min(10_000, Math.max(1, params.page!)) : 1;
  const perPage = Number.isInteger(params.perPage) ? Math.min(100, Math.max(1, params.perPage!)) : 30;
  const sort = typeof params.sort === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(params.sort) ? params.sort : '';
  return { query, page, perPage, sort };
}

export class MarketplaceRegistryService {
  private readonly baseUrl: string;
  private readonly policy: UrlPolicyOptions;
  private readonly timeoutMs: number;

  constructor(opts: { configuredBaseUrl?: string; allowLocalhost: boolean; timeoutMs?: number }) {
    this.policy = { allowLocalhost: opts.allowLocalhost };
    this.baseUrl = resolveBaseUrl(opts.configuredBaseUrl, this.policy);
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Search the live catalog, scoped to the extension asset type. Returns raw cards. */
  async search(params: MarketplaceSearchParams): Promise<{ items: unknown[]; total: number }> {
    params = normalizeMarketplaceSearchParams(params);
    const qs = new URLSearchParams({ type: EXTENSION_ASSET_TYPE });
    if (params.query) qs.set('q', params.query);
    qs.set('page', String(params.page ?? 1));
    qs.set('perPage', String(params.perPage ?? 30));
    if (params.sort) qs.set('sort', params.sort);
    const data = await this.getJson(`/api/v1/marketplace/assets?${qs.toString()}`);
    const d = (data ?? {}) as { items?: unknown[]; total?: number };
    return { items: Array.isArray(d.items) ? d.items : [], total: typeof d.total === 'number' ? d.total : 0 };
  }

  /** Effective, policy-validated registry origin recorded with installed packages. */
  source(): string {
    return this.baseUrl;
  }

  /** Full asset detail (card + description + versions). */
  async detail(publisher: string, slug: string): Promise<unknown> {
    return this.getJson(`/api/v1/marketplace/assets/${enc(publisher)}/${enc(slug)}`);
  }

  /** The install descriptor (checksum, size, installation block) for a version. */
  async manifestMeta(publisher: string, slug: string, version: string): Promise<unknown> {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    return this.getJson(`/api/v1/marketplace/assets/${enc(publisher)}/${enc(slug)}/manifest${qs}`);
  }

  /** Download the artifact payload (base64) + advertised checksum. No decoding here. */
  async downloadArtifact(publisher: string, slug: string, version: string): Promise<MarketplaceArtifact> {
    const qs = version ? `?version=${encodeURIComponent(version)}` : '';
    const data = (await this.getJson(
      `/api/v1/marketplace/assets/${enc(publisher)}/${enc(slug)}/download${qs}`,
    )) as Partial<MarketplaceArtifact> | null;
    if (!data || typeof data.contentBase64 !== 'string' || typeof data.checksum !== 'string') {
      throw new Error('Malformed download response from marketplace.');
    }
    return {
      contentBase64: data.contentBase64,
      checksum: data.checksum,
      mimeType: typeof data.mimeType === 'string' ? data.mimeType : '',
      filename: typeof data.filename === 'string' ? data.filename : `${slug}.json`,
      version: typeof data.version === 'string' ? data.version : version,
    };
  }

  /** GET a path relative to the base URL and unwrap the `{success,data,error}` envelope. */
  private async getJson(path: string): Promise<unknown> {
    const text = await this.safeFetchText(`${this.baseUrl}${path}`);
    let env: unknown;
    try {
      env = JSON.parse(text);
    } catch {
      throw new Error('Marketplace returned a non-JSON response.');
    }
    const e = env as { success?: boolean; data?: unknown; error?: { message?: string; code?: string } };
    if (e && e.success === false) {
      throw new Error(e.error?.message || e.error?.code || 'Marketplace request failed.');
    }
    return e && 'data' in e ? e.data : env;
  }

  /** Fetch text with timeout, bounded + revalidated redirects, and size/content-type limits. */
  private async safeFetchText(startUrl: string): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let current = assertOrThrow(startUrl, this.policy);
      for (let hop = 0; ; hop += 1) {
        const res = await fetch(current, {
          method: 'GET',
          redirect: 'manual',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (res.status >= 300 && res.status < 400) {
          if (hop >= MAX_REDIRECTS) throw new Error('Too many redirects.');
          const location = res.headers.get('location');
          if (!location) throw new Error('Redirect without a Location.');
          current = assertOrThrow(new URL(location, current).href, this.policy); // revalidate every hop
          continue;
        }
        const contentLength = Number(res.headers.get('content-length') ?? '0');
        if (contentLength && contentLength > MAX_RESPONSE_BYTES) throw new Error('Response too large.');
        // Surface the HTTP status first — an error response with an HTML body should report
        // "HTTP 500", not a misleading "unexpected content-type".
        if (!res.ok) throw new Error(`Marketplace HTTP ${res.status}.`);
        const ctype = res.headers.get('content-type') ?? '';
        if (!/json/i.test(ctype)) throw new Error(`Unexpected content-type: ${ctype || 'none'}`);
        return readBoundedText(res, MAX_RESPONSE_BYTES);
      }
    } catch (error) {
      const err = error as Error;
      throw new Error(err.name === 'AbortError' ? 'Marketplace request timed out.' : err.message, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Stream a body through a byte counter so chunked responses cannot bypass the cap. */
async function readBoundedText(response: Response, limit: number): Promise<string> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > limit) throw new Error('Response too large.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error('Response too large.');
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Marketplace returned invalid UTF-8.', { cause: error });
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function enc(segment: string): string {
  return encodeURIComponent(segment);
}
function assertOrThrow(url: string, policy: UrlPolicyOptions): string {
  const check = assertSafeMarketplaceUrl(url, policy);
  if (!check.ok || !check.url) throw new Error(check.error ?? 'Blocked URL.');
  return check.url;
}
