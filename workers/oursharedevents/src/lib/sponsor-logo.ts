/**
 * sponsor-logo.ts — URL validation and proxy utilities for sponsor logos.
 *
 * Closes OSE-R-015 (XSS via logo_url) and OSE-R-011 (broken-img on surfaces).
 *
 * Security model:
 *   - Only http:// and https:// URLs are accepted at input. Any other scheme
 *     (javascript:, data:, ftp:, etc.) is rejected at the API layer so it
 *     never reaches the DB.
 *   - At serve time, logos are proxied through the worker. The external URL
 *     never appears as an <img src> in rendered HTML; only the internal proxy
 *     path does. This eliminates the entire class of external-URL injection.
 *   - The proxy validates Content-Type before forwarding, caps response size,
 *     and enforces a fetch timeout so a slow CDN cannot hold a request open.
 */

export const ALLOWED_LOGO_SCHEMES = new Set(['https:', 'http:']);

export const ALLOWED_LOGO_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export const LOGO_FETCH_TIMEOUT_MS = 5_000;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB

// ── Validation ────────────────────────────────────────────────────────────────

export interface LogoUrlValidation {
  valid: boolean;
  url: string | null;
  error?: 'INVALID_URL' | 'INVALID_SCHEME' | 'TOO_LONG';
}

export function validateLogoUrl(raw: unknown): LogoUrlValidation {
  if (raw === null || raw === undefined || raw === '') {
    return { valid: true, url: null };
  }
  if (typeof raw !== 'string') {
    return { valid: false, url: null, error: 'INVALID_URL' };
  }
  if (raw.length > 500) {
    return { valid: false, url: null, error: 'TOO_LONG' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { valid: false, url: null, error: 'INVALID_URL' };
  }
  if (!ALLOWED_LOGO_SCHEMES.has(parsed.protocol)) {
    return { valid: false, url: null, error: 'INVALID_SCHEME' };
  }
  return { valid: true, url: raw };
}

/**
 * https-only variant for PUBLIC OUTBOUND links (events.what_url) — a link the
 * page sends a visitor OUT to. validateLogoUrl accepts http(s) because logos are
 * proxied server-side; an outbound link is followed by the visitor's own
 * browser, so plain http:// is a mixed-content / downgrade risk and is rejected.
 * Empty/null is still valid (the field is optional). Reuses validateLogoUrl for
 * the length + parse + scheme-allowlist checks, then narrows to https.
 */
export function validateHttpsUrl(raw: unknown): LogoUrlValidation {
  const base = validateLogoUrl(raw);
  if (!base.valid || base.url === null) return base;
  if (!/^https:\/\//i.test(base.url)) {
    return { valid: false, url: null, error: 'INVALID_SCHEME' };
  }
  return base;
}

// ── Proxy path ────────────────────────────────────────────────────────────────

export function sponsorLogoPath(sponsorId: string): string {
  return `/api/v2/sponsors/${encodeURIComponent(sponsorId)}/logo`;
}

// ── Proxy fetcher ─────────────────────────────────────────────────────────────

export interface LogoProxyResult {
  ok: boolean;
  response?: Response;
  error?: string;
}

export async function fetchAndProxyLogo(externalUrl: string): Promise<LogoProxyResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);

  let upstream: Response;
  try {
    upstream = await fetch(externalUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'OSE-LogoProxy/1.0 (oursharedevents.com)' },
    });
  } catch (err) {
    clearTimeout(timer);
    return { ok: false, error: err instanceof Error ? err.message : 'FETCH_FAILED' };
  }
  clearTimeout(timer);

  if (!upstream.ok) {
    return { ok: false, error: `UPSTREAM_${upstream.status}` };
  }

  const rawCt = upstream.headers.get('content-type') ?? '';
  const ct = rawCt.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_LOGO_CONTENT_TYPES.has(ct)) {
    return { ok: false, error: 'CONTENT_TYPE_NOT_ALLOWED' };
  }

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: 'RESPONSE_TOO_LARGE' };
  }

  return {
    ok: true,
    response: new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
        'Content-Security-Policy': "default-src 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Length': String(bytes.byteLength),
      },
    }),
  };
}
