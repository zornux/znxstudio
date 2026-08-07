/**
 * Marketplace URL policy — anti-SSRF gate for every request the main-process
 * marketplace service makes (and every redirect it follows). Pure + Electron-free so it
 * is unit-testable. The base URL is NEVER taken from an extension, project, workspace,
 * manifest, or renderer message: production is pinned to the canonical host; a locally
 * configured URL is honoured ONLY in an unpackaged (dev) build, and even then must pass
 * the same host checks (localhost excepted).
 */

export const DEFAULT_MARKETPLACE_BASE_URL = 'https://marketplace.zornux.com';

export interface UrlPolicyOptions {
  /** Allow http + loopback (dev only). Production passes false. */
  allowLocalhost: boolean;
}

export interface UrlCheck {
  ok: boolean;
  url?: string;
  error?: string;
}

function isLoopbackHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost');
}

/** True for RFC1918 / link-local / unique-local / loopback destinations (SSRF targets). */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (isLoopbackHost(h)) return true;
  if (h === '0.0.0.0' || h === '::') return true;
  // IPv4 literals
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  // IPv6 unique-local (fc00::/7) / link-local (fe80::/10)
  if (/^f[cd][0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h)) return true;
  return false;
}

/** Validate a fully-qualified URL against the policy. Returns the normalized href on success. */
export function assertSafeMarketplaceUrl(raw: string, opts: UrlPolicyOptions): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: `Invalid URL: ${raw}` };
  }
  if (url.username || url.password) return { ok: false, error: 'URL must not contain credentials.' };
  const isHttps = url.protocol === 'https:';
  const isHttp = url.protocol === 'http:';
  if (!isHttps && !(isHttp && opts.allowLocalhost)) {
    return { ok: false, error: `Only HTTPS is allowed (got ${url.protocol}).` };
  }
  if (isHttp && !isLoopbackHost(url.hostname)) {
    return { ok: false, error: 'Plain HTTP is only allowed for localhost in development.' };
  }
  if (isPrivateHost(url.hostname)) {
    if (!(opts.allowLocalhost && isLoopbackHost(url.hostname))) {
      return { ok: false, error: `Refusing a private/loopback destination: ${url.hostname}` };
    }
  }
  return { ok: true, url: url.href };
}

/**
 * Resolve the effective base URL. Production ignores any configured value and pins the
 * canonical host; dev may point at a validated localhost (or any policy-passing URL).
 */
export function resolveBaseUrl(configured: string | undefined, opts: UrlPolicyOptions): string {
  if (!opts.allowLocalhost) return DEFAULT_MARKETPLACE_BASE_URL; // production: pinned
  const candidate = (configured ?? '').trim();
  if (!candidate) return DEFAULT_MARKETPLACE_BASE_URL;
  const check = assertSafeMarketplaceUrl(candidate, opts);
  return check.ok ? candidate.replace(/\/+$/, '') : DEFAULT_MARKETPLACE_BASE_URL;
}
