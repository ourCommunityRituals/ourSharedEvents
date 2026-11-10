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
 *   - OSE-1433: a logo host must be a public DNS name — never localhost, an IP
 *     literal or a single-label name — on write AND at fetch time (a row stored
 *     before this rule is refused when served). Redirects are followed by hand,
 *     at most LOGO_MAX_REDIRECTS, and every hop is re-checked. The body is read
 *     as a stream and cut off at LOGO_MAX_BYTES instead of buffered first.
 *     A DNS name that resolves to a private address cannot be checked here
 *     (Workers have no resolver); Cloudflare's fetch does not route to private
 *     ranges from the edge, which is the backstop for that case.
 */

import { isUploadedArtworkPath } from './event-thumb';

export const ALLOWED_LOGO_SCHEMES = new Set(['https:', 'http:']);

/** Where an uploaded file is served (handlers/upload.ts); the rest is its R2 key. */
const UPLOADS_PREFIX = '/api/v2/uploads/';

export const ALLOWED_LOGO_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

export const LOGO_FETCH_TIMEOUT_MS = 5_000;
export const LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const LOGO_MAX_REDIRECTS = 3;

/**
 * Upstream logo fetches allowed in flight per isolate (OSE-1433). Enforced HERE,
 * in the one shared fetcher, so every route that proxies a logo (the logo proxy
 * and the asset route) shares one bound. Edge caches dedupe repeat views but
 * cannot coalesce simultaneous cold misses; this is the hard cap, independent
 * of KV. Over the cap the fetcher returns `BUSY` without any request.
 */
export const LOGO_MAX_IN_FLIGHT = 16;
let logoFetchesInFlight = 0;

// ── Validation ────────────────────────────────────────────────────────────────

export interface LogoUrlValidation {
  valid: boolean;
  url: string | null;
  error?: 'INVALID_URL' | 'INVALID_SCHEME' | 'TOO_LONG' | 'INVALID_HOST';
}

/**
 * Is this hostname one a server-side fetch must never reach? (OSE-1433)
 *
 * `hostname` is WHATWG-normalized by `new URL`, so decimal/hex/short IPv4 forms
 * ("2130706433", "0x7f.1", "127.1") already arrive as dotted quads and IPv6
 * literals arrive bracketed. Any IP literal is refused, not just private ones:
 * a sponsor's logo lives on a named host, and refusing all literals removes
 * the whole private/link-local/metadata-address class without a range table.
 */
export function isBlockedLogoHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.startsWith('[') || h.includes(':')) return true; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return true; // IPv4 literal
  if (!h.includes('.')) return true; // single-label (intranet) name
  if (h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa')) return true;
  return false;
}

/**
 * http(s) URL check: scheme allowlist, ≤500 chars, parseable. Used for URLs a
 * VISITOR'S BROWSER loads or follows (event images and video links, the WHAT
 * link), so it has no host rule: a browser fetch is not a Worker fetch.
 */
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
 * A sponsor logo URL the Worker itself will fetch through the proxy: everything
 * validateLogoUrl checks, plus a public host (OSE-1433). Used where sponsor
 * logos are written and in the proxy before every request and redirect hop.
 */
export function validateProxiedLogoUrl(raw: unknown): LogoUrlValidation {
  const base = validateLogoUrl(raw);
  if (!base.valid || base.url === null) return base;
  const parsed = new URL(base.url);
  // OSE-1955: a user or password in the URL would go to the sponsor's host as
  // Basic auth on every fetch. Refused at write; a stored one is never fetched.
  if (parsed.username || parsed.password) {
    return { valid: false, url: null, error: 'INVALID_URL' };
  }
  if (isBlockedLogoHost(parsed.hostname)) {
    return { valid: false, url: null, error: 'INVALID_HOST' };
  }
  return base;
}

/**
 * https-only variant for PUBLIC OUTBOUND links (events.what_url) — a link the
 * page sends a visitor OUT to. validateLogoUrl accepts http(s) because logos are
 * proxied server-side; an outbound link is followed by the visitor's own
 * browser, so plain http:// is a mixed-content / downgrade risk and is rejected.
 * Empty/null is still valid (the field is optional). Shares the length + parse +
 * scheme-allowlist checks, then narrows to https. No host rule: a visitor's
 * browser follows this link, not the Worker (see validateProxiedLogoUrl).
 */
export function validateHttpsUrl(raw: unknown): LogoUrlValidation {
  const base = validateLogoUrl(raw);
  if (!base.valid || base.url === null) return base;
  if (!/^https:\/\//i.test(base.url)) {
    return { valid: false, url: null, error: 'INVALID_SCHEME' };
  }
  return base;
}

/**
 * A sponsor logo as it may be stored (owner 2026-11-10): an outside address the
 * proxy fetches (validateProxiedLogoUrl), or an image already uploaded to OSE —
 * the same R2 pool as an event's poster art, `/api/v2/uploads/…`. An upload is
 * read from the bucket, never fetched, so the host rule has nothing to guard.
 * The path rule is the event-art one (lib/event-thumb.ts): no `.`/`..` segment,
 * nothing but the uploads prefix and safe characters.
 */
export function validateSponsorLogoInput(raw: unknown): LogoUrlValidation {
  if (isUploadedArtworkPath(raw)) return { valid: true, url: raw };
  return validateProxiedLogoUrl(raw);
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
  if (logoFetchesInFlight >= LOGO_MAX_IN_FLIGHT) return { ok: false, error: 'BUSY' };
  logoFetchesInFlight++;
  // One timer for the whole chain: at most 1 + LOGO_MAX_REDIRECTS sequential
  // fetches plus the body read, all inside LOGO_FETCH_TIMEOUT_MS.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    return await fetchLogo(externalUrl, controller.signal);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'FETCH_FAILED' };
  } finally {
    clearTimeout(timer);
    logoFetchesInFlight--;
  }
}

async function fetchLogo(externalUrl: string, signal: AbortSignal): Promise<LogoProxyResult> {
  // Redirects are followed by hand so every hop meets the same host rule as the
  // stored URL (OSE-1433); `redirect: 'follow'` would let a public host bounce
  // the fetch to one we refuse.
  let url = externalUrl;
  let upstream: Response | null = null;
  for (let hop = 0; hop <= LOGO_MAX_REDIRECTS; hop++) {
    const check = validateProxiedLogoUrl(url);
    if (!check.valid || !check.url) return { ok: false, error: 'BLOCKED_HOST' };
    const res = await fetch(check.url, {
      signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'OSE-LogoProxy/1.0 (oursharedevents.com)' },
    });
    if (res.status < 300 || res.status >= 400) {
      upstream = res;
      break;
    }
    const location = res.headers.get('location');
    await res.body?.cancel();
    if (!location) return { ok: false, error: `UPSTREAM_${res.status}` };
    try {
      url = new URL(location, url).toString();
    } catch {
      return { ok: false, error: 'BAD_REDIRECT' };
    }
  }
  if (!upstream) return { ok: false, error: 'TOO_MANY_REDIRECTS' };

  if (!upstream.ok) {
    await upstream.body?.cancel();
    return { ok: false, error: `UPSTREAM_${upstream.status}` };
  }

  const rawCt = upstream.headers.get('content-type') ?? '';
  const ct = rawCt.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_LOGO_CONTENT_TYPES.has(ct)) {
    await upstream.body?.cancel();
    return { ok: false, error: 'CONTENT_TYPE_NOT_ALLOWED' };
  }

  const declared = Number(upstream.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > LOGO_MAX_BYTES) {
    await upstream.body?.cancel();
    return { ok: false, error: 'RESPONSE_TOO_LARGE' };
  }

  const bytes = await readCapped(upstream, LOGO_MAX_BYTES);
  if (!bytes) return { ok: false, error: 'RESPONSE_TOO_LARGE' };

  return {
    ok: true,
    response: new Response(bytes, { status: 200, headers: logoHeaders(ct, bytes.byteLength) }),
  };
}

/** The hardened headers every served logo carries, fetched or uploaded. */
function logoHeaders(contentType: string, length: number): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=86400, stale-while-revalidate=3600',
    'Content-Security-Policy': "default-src 'none'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Length': String(length),
  };
}

/**
 * Serve a logo uploaded to OSE (validateSponsorLogoInput) from R2. The same
 * rules as a fetched logo: an image type on the allowlist, at most
 * LOGO_MAX_BYTES, the same hardened headers. The upload route takes PDFs and
 * video too, so the type is checked here, not assumed. No bucket or no object
 * is NOT_FOUND: the sponsor simply has no art to show.
 */
export async function serveUploadedLogo(
  bucket: R2Bucket | undefined,
  path: string
): Promise<LogoProxyResult> {
  if (!bucket || !isUploadedArtworkPath(path)) return { ok: false, error: 'NOT_FOUND' };
  const obj = await bucket.get(path.slice(UPLOADS_PREFIX.length));
  if (!obj) return { ok: false, error: 'NOT_FOUND' };
  const ct = (obj.httpMetadata?.contentType ?? '').split(';')[0].trim().toLowerCase();
  if (!ALLOWED_LOGO_CONTENT_TYPES.has(ct)) {
    await obj.body.cancel();
    return { ok: false, error: 'CONTENT_TYPE_NOT_ALLOWED' };
  }
  if (obj.size > LOGO_MAX_BYTES) {
    await obj.body.cancel();
    return { ok: false, error: 'RESPONSE_TOO_LARGE' };
  }
  return {
    ok: true,
    response: new Response(obj.body, { status: 200, headers: logoHeaders(ct, obj.size) }),
  };
}

/**
 * Read a body as a stream, stopping as soon as it passes `max` bytes, so an
 * oversized (or lying Content-Length) upstream is never fully buffered.
 * Returns null when the cap is exceeded.
 */
export async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}
