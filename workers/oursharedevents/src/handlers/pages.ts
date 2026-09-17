/**
 * HTML page handler.
 *
 * Serves the public listing page and admin dashboard.
 * HTML is embedded as template strings so the Worker is fully self-contained.
 *
 * Firebase Hosting migration (Phase 3, Track B):
 *   Replace the embedded strings with a fetch() call to Firebase Hosting URL.
 */

import { isGoogleMapsConfigured } from '../lib/maps';
import { HARDENING_HEADERS } from '../lib/security-headers';
import { computeEventPhase } from '../domain/event-phase';
import { publicEventCacheControl } from '../lib/phase-cache';
import { renderGeoLink } from '../lib/geo-link';
import { formatEventPrice } from '../lib/event-price';
import { validateLogoUrl } from '../lib/sponsor-logo';
import { DEFAULT_POSTER_CODE, posterProductForPath } from '../lib/poster-products';
import { hashEmail, encryptText } from '../lib/pii';

// Page shells extracted to template files (Wrangler [[rules]] type="Text").
import PUBLIC_HTML from '../templates/public.html';
import ADMIN_HTML from '../templates/admin.html';
import LANDING_HTML from '../templates/landing.html';
import ADMIN_SIGNIN_HTML from '../templates/admin-signin.html';
import DISPLAY_HTML from '../templates/display.html';
import POSTER_HTML from '../templates/poster.html';
import SHARED_REPORT_HTML from '../templates/shared-report.html';
import {
  withProvenanceBanner,
  injectProvenanceBanner,
  resolveAndSignalProvenance,
} from '../lib/demo-banner.js';
import { injectLegalFooter } from '../lib/legal-footer';
import {
  parseDiscoveryFilters,
  applyDiscoveryFilters,
  renderDiscoveryFilters,
  injectDiscoveryFilters,
  discoveryEmptyCopy,
} from '../lib/event-discovery';
import {
  renderEventList,
  renderEventListError,
  injectEventList,
  type EventListItem,
  type RenderedEventList,
} from '../lib/event-list.js';
import {
  renderLandingArea,
  renderEmptyLandingArea,
  injectLandingArea,
  type LandingAreaItem,
} from '../lib/landing-area.js';
import {
  getDataProvider,
  type DataProviderEnv,
  type DataProviderCtx,
} from '../lib/data-provider.js';
import { enrichWithPhase } from '../lib/event-enrich.js';
import { applyCountFloor } from '../lib/count-floor.js';

export interface PagesEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
  GOOGLE_MAPS_API_KEY?: string;
  /**
   * OSE-207 — per-environment pepper for peppered SHA-256 IP hashing in
   * handleSubscribe. Set via `wrangler secret put IP_HASH_PEPPER --env <env>`.
   * Rotate to invalidate all historical reverse-lookup utility.
   *
   * If unset, handleSubscribe falls back to storing NULL ip_hash and logs a
   * structured warning. Subscribe still succeeds; the abuse signal is just
   * disabled. This is fail-safe — never store a raw IP as a fallback.
   */
  IP_HASH_PEPPER?: string;
  /**
   * Data-at-rest doctrine (A-5) — AES-GCM key for encrypting subscribers.email
   * at rest so the admin subscribers list can read it back. Same secret used by
   * the forms email-signup path. When unset, handleSubscribe returns 503 rather
   * than storing a plaintext email (mirrors handleFormEmailSignup).
   */
  FORMS_ENCRYPTION_KEY?: string;
  /**
   * Data-at-rest doctrine (A-5) — peppered HMAC-SHA256 pepper for the
   * subscribers.email_hash dedup/erasure key. Must match the value used by the
   * data-subject erasure path so hashes line up.
   */
  FORMS_HASH_PEPPER?: string;
  /**
   * OSE-207 — subscribers TTL retention window in days. Optional.
   *
   * Read by the scheduled `runSubscribersRetentionLifecycle` job in
   * `src/index.ts`. When set to a positive integer N, the daily cron
   * deletes subscribers whose created_at is older than N days. When
   * unset, retention is uncapped (the cron logs a no-op).
   *
   * Independent of the data-subject right-to-erase Phase C handler in
   * `src/handlers/data-subject.ts`, which deletes by email on demand.
   */
  SUBSCRIBERS_RETENTION_DAYS?: string;
  /**
   * Stale-draft expiry window in days (see `src/lib/draft-expiry.ts`). Read by
   * the scheduled `runDraftExpiry` job. Unset → 30. `0` → the sweep is off.
   * Archives (never deletes) drafts untouched for longer than the window.
   */
  DRAFT_EXPIRY_DAYS?: string;
}

/**
 * OSE-207 — peppered SHA-256 hash of a client IP, truncated to 32 hex chars.
 *
 * Returns null if no pepper is configured. Callers MUST treat null as
 * "no abuse signal available" and store NULL — never the raw IP.
 *
 * Truncation: 32 hex chars = 128 bits of collision resistance, ample for
 * "did this same IP submit twice" abuse detection without any reversibility
 * benefit from a longer hash.
 */
export async function hashIpForSubscribe(
  ip: string,
  pepper: string | undefined
): Promise<string | null> {
  if (!pepper) return null;
  const buf = new TextEncoder().encode(`${ip}|${pepper}`);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

// ─── Public page ────────────────────────────────────────────────────────────────

// ─── Admin page ─────────────────────────────────────────────────────────────────

// ─── Landing page ───────────────────────────────────────────────────────────────

// ─── Handlers ───────────────────────────────────────────────────────────────────

/** Generate a cryptographic nonce for CSP script-src. */
function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Base64-encode using btoa on a binary string
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Build security headers with a per-request nonce. */
function securityHeaders(nonce: string): Record<string, string> {
  return {
    ...HARDENING_HEADERS,
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    // OSE-1199: `img-src 'self' data:` is load-bearing — the poster's QR codes
    // and the UEC resolver both hand the page data: PNGs, and without an explicit
    // img-src they fall to default-src 'self' and the browser refuses them (the
    // poster printed alt text on staging). Same directive form-pages.ts and
    // demo.ts already carry. Guarded by tests/poster-page-csp.spec.ts.
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'`,
  };
}

/**
 * Serve an HTML page with nonce-based CSP.
 * Replaces `<script` with `<script nonce="..."` so inline scripts are allowed
 * only for this specific response.
 */
export function html(content: string, status = 200): Response {
  const nonce = generateNonce();
  // Inject nonce into all <script> tags (handles <script>, <script type="module">, etc.)
  const nonced = content.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
  return new Response(nonced, {
    status,
    headers: securityHeaders(nonce),
  });
}

/**
 * OSE-R-004 — branded 4xx/5xx HTML helper.
 *
 * Before this helper landed, the public-event handler emitted bare 1996-style
 * HTML for 404 and 503 responses (audit REFINEMENT-BACKLOG-2026-05-15.md
 * OSE-R-004 + OSE-R-022). A bar customer following a shared event link that
 * was archived or hit during an outage saw an unstyled "Event not found" h1
 * with no brand, no nav, no CTA, no wayfinding.
 *
 * Every 4xx/5xx HTML path in pages.ts now routes through this helper so the
 * brand header, friendly copy, and CTA back to /events ship consistently.
 *
 * Inputs are validated and rendered safely:
 *   - status: number (used in title + h1)
 *   - title:  short heading (5–7 words max). User-visible.
 *   - body:   single sentence of friendly copy. User-visible.
 *   - ctaHref / ctaLabel: optional CTA. Default targets /events.
 *
 * Outputs the standard branded shell with CSP-friendly inline styles.
 * data-testids drive the OSE-R-004 test pyramid.
 */
export function renderErrorPage(
  status: number,
  title: string,
  body: string,
  ctaHref: string = '/events',
  ctaLabel: string = 'Browse upcoming events'
): Response {
  const esc = (s: string) =>
    s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  const safeTitle = esc(title);
  const safeBody = esc(body);
  const safeCtaHref = esc(ctaHref);
  const safeCtaLabel = esc(ctaLabel);
  const content = `<!DOCTYPE html>
<html lang="en" data-surface="ose-error">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} – OurSharedEvents</title>
  <style>
    [data-surface="ose-error"] { --err-bg: #f8f9fa; --err-text: #212529; --err-surface: #1a1a2e; --err-muted: #6c757d; --err-body: #495057; --err-surface-hover: #0f0f1a; --err-focus: #4361ee; }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--err-bg); color: var(--err-text); min-height: 100vh; display: flex; flex-direction: column; }
    header { background: var(--err-surface); color: #fff; padding: 1.25rem 2rem; }
    /* OSE-308: both anchors are primary action targets on the
       error-page recovery flow. Per WCAG 2.5.5 Level AAA + invariant 14
       refined contract, they must meet the 44x44 floor. Using
       inline-flex + align-items: center vertically centers the text
       inside the 44px box without misaligning the visual baseline. */
    header a { color: #fff; text-decoration: none; font-size: 1.1rem; font-weight: 600; display: inline-flex; align-items: center; min-height: 44px; padding: 0 .5rem; }
    main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem 1.5rem; text-align: center; }
    .error-status { font-size: .8rem; color: var(--err-muted); text-transform: uppercase; letter-spacing: .12em; margin-bottom: .75rem; }
    .error-title { font-size: 1.75rem; font-weight: 700; color: var(--err-surface); margin-bottom: 1rem; max-width: 520px; }
    .error-body { font-size: 1rem; color: var(--err-body); max-width: 520px; line-height: 1.5; margin-bottom: 1.75rem; }
    .error-cta { display: inline-flex; align-items: center; min-height: 44px; line-height: 1.5; padding: .65rem 1.25rem; background: var(--err-surface); color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: .95rem; }
    .error-cta:hover { background: var(--err-surface-hover); }
    .error-cta:focus-visible { outline: 2px solid var(--err-focus); outline-offset: 2px; }
    footer { padding: 1rem 2rem; text-align: center; font-size: .8rem; color: var(--err-muted); }
  </style>
</head>
<body>
  <header data-testid="error-header"><a href="/" data-testid="error-brand">OurSharedEvents</a></header>
  <main data-testid="error-main">
    <p class="error-status" data-testid="error-status">Error ${status}</p>
    <h1 class="error-title" data-testid="error-title">${safeTitle}</h1>
    <p class="error-body" data-testid="error-body">${safeBody}</p>
    <a class="error-cta" data-testid="error-cta" href="${safeCtaHref}">${safeCtaLabel}</a>
  </main>
  <footer data-testid="error-footer">OurSharedEvents — community gatherings</footer>
</body>
</html>`;
  return html(content, status);
}

// ─── Public list page — OSE-1243 ──────────────────────────────────────────────
//
// Server-rendered. The Worker reads the events and puts them in the HTML it
// serves, rather than serving a "Loading events…" paragraph and letting the
// browser go get them (frontend remediation plan §3.1, step 5).
//
// It reads through the SAME DataProvider seam as `GET /api/v2/events`, so the
// page and the JSON API cannot disagree about which events exist. Brand is
// 'root', matching what the client script requested when it passed no `brand`
// param — the public list has never been brand-parameterised and this change
// does not make it so.
//
// FAILURE IS RENDERED, NOT DEFERRED. If the read throws, the page is served
// with the error state already in it. The old shape could not do this: a
// Worker that could not reach D1 still returned 200 with a loading paragraph,
// and the reader only learned otherwise once their own fetch failed too.
type PublicListEnv = PagesEnv & DataProviderEnv;

export async function handlePublicPage(
  env: PagesEnv,
  ctx?: DataProviderCtx | null,
  request?: Request
): Promise<Response> {
  // Attendee discovery (lib/event-discovery): `?when=` (allowlisted) and `?q=`
  // (capped, escaped once) are parsed from the request and applied over the
  // already brand-scoped / active / published projection — never in SQL. The
  // filter bar is server-rendered like the list, so a filtered URL is a link.
  const filters = parseDiscoveryFilters(
    request ? new URL(request.url) : new URL('https://x/events')
  );
  let list: RenderedEventList;
  let shown = 0;
  try {
    const dp = getDataProvider(env as PublicListEnv, ctx ?? null);
    const result = await dp.listEvents('root');
    // enrichWithPhase is NOT optional here. `listEvents` returns raw D1 rows
    // (`title` / `start_date` / `location`); every surface reads the canonical
    // `name` / `startDateISO` / `venue`, and `phase` — which decides whether a
    // card offers a registration form or a recap — is computed nowhere else.
    // Reading the rows without it renders nameless, dateless cards that invite
    // registration for events that already happened. Same seam the JSON API
    // uses, so the two cannot disagree.
    const items = (result.data as unknown as Record<string, unknown>[]).map(enrichWithPhase);
    const filtered = applyDiscoveryFilters(items as EventListItem[], filters);
    shown = filtered.length;
    list =
      filtered.length === 0 && items.length > 0
        ? {
            html: `<p class="empty" data-testid="public-events-empty">${discoveryEmptyCopy(filters)}</p>`,
            countText: '0 events',
            upcoming: 0,
          }
        : renderEventList(filtered);
  } catch {
    list = renderEventListError();
  }
  const shell = injectLegalFooter(await withProvenanceBanner(PUBLIC_HTML, env, 'public'), 'public');
  return html(
    injectEventList(injectDiscoveryFilters(shell, renderDiscoveryFilters(filters, shown)), list)
  );
}

// ─── Public event page — OSE-243a / BE-27 ─────────────────────────────────────
//
// Renders /events/:id as a phase-aware HTML page. Recipients land here from
// `/s/:code` shortlinks (OSE-240) — they should see event content, not JSON.
//
// Phase dispatch:
//   pre_event  → full 5W content + venue map + anonymity affordance + RSVP CTA
//   event      → minimal "Live now" stub (full design in OSE-244)
//   post_event → minimal "This event has ended" stub (full design in OSE-245)
//
// State gating:
//   - draft/ready events return 404 (not renderable to public per OSE-199 state machine)
//   - archived events return 200 with a minimal "ended" message
//
// Anonymity affordance (user-reinforced 2026-05-14):
//   The page MUST surface, in plain language, the user-facing privacy story.
//   Every recipient sees this BEFORE deciding to RSVP / share email / check in.
//   Architectural truth (DB↔FORMS_DB split, anon_id, 15-min tranches) becomes
//   user-readable here; the rest of the platform's protections are what make
//   the claim true.
//
// CSP: the page has zero inline scripts; only an `<img>` to the venue map
// proxy + simple anchors. The `html()` helper still attaches the nonce
// header for defense-in-depth.

interface PublicEventEnv extends PagesEnv {
  DB?: D1Database;
  FORMS_DB?: D1Database;
}

export interface PublicEventRow {
  id: string;
  brand_id: string;
  title: string;
  slug: string;
  status: string;
  description: string | null;
  location: string | null;
  start_date: string | null;
  end_date: string | null;
  timezone: string | null;
  what_short: string | null;
  who_host: string | null;
  why_purpose: string | null;
  how_details: string | null;
  where_address: string | null;
  // OSE-664: rich WHO / WHAT supply for the pre-event funnel.
  who_story: string | null;
  who_image_url: string | null;
  what_video_url: string | null;
  // WHAT card's optional external link — the event's "go here" destination
  // (fundraiser donation site, tickets, tournament/season signup, a client's own
  // Google Doc). Clients run their own admin off-platform; OSE just displays it.
  what_url: string | null;
  what_url_enabled: number | null;
  what_url_type: string | null;
  lat: number | null;
  lon: number | null;
  price_cents: number | null;
  price_model: string | null;
  price_note: string | null;
}

function esc(s: string | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * D1 (CCR 2026-09-14) — the public post-event recap is the LEAST-trusted surface
 * (unauthenticated) and must not become a side-channel that leaks an exact small
 * count the admin tile + SharedReport hide. Every attendee-derived stat here
 * routes through the SAME uniform floor the admin tile and corridor map use
 * (applyCountFloor, K=5): a sub-K cohort renders "Fewer than 5", never the exact
 * number. A 3-of-5 or "50% of 2" line back-derives an individual — the exact
 * never-who break OSE-665 exists to close. Server-side, so the raw value never
 * reaches the client.
 */
function statLine(raw: number, label: string, testid: string): string {
  const f = applyCountFloor(raw);
  const inner = f.suppressed
    ? `Fewer than ${f.floor} ${label}`
    : `<strong>${f.count}</strong> ${label}`;
  return `<p data-testid="${testid}">${inner}</p>`;
}

/** True when a count clears the uniform floor (safe to publish exactly / use in a ratio). */
function clearsFloor(raw: number): boolean {
  return !applyCountFloor(raw).suppressed;
}

/**
 * The WHAT card's optional external link, rendered on every phase (pre / live /
 * post) so a patron who cannot attend can still act on the event before, during
 * AND after. It is GENERIC by design — a fundraiser's donation site, a ticketing
 * page, a tournament/season signup, a client's own Google Doc — because the
 * client runs their own admin off-platform and OSE just displays the outbound
 * link. Returns '' when no URL is set (the field is optional; only renders when
 * active). http(s)-only via validateLogoUrl (defense-in-depth XSS wall), and the
 * URL is attribute-escaped on output. Not donation-named anywhere: neutral label.
 */
// R3 — type-driven CTA labels for the WHAT external link. Neutral, action-first.
// Same destination vocabulary the poster's typed QR slots use.
// Exported so the what-url-types drift guard can assert this map stays a
// superset of the canonical WHAT_URL_TYPES allowlist (strict-in / lenient-out).
export const WHAT_LINK_LABELS: Record<string, { en: string; es: string }> = {
  donation: { en: 'Donate →', es: 'Donar →' },
  league: { en: 'View the league →', es: 'Ver la liga →' },
  workshop: { en: 'Register →', es: 'Inscribirse →' },
  substack: { en: 'Subscribe →', es: 'Suscribirse →' },
  tickets: { en: 'Get tickets →', es: 'Comprar entradas →' },
  menu: { en: 'Menu & reservations →', es: 'Menú y reservas →' },
  website: { en: 'Visit the site →', es: 'Visitar el sitio →' },
};

function renderWhatLink(
  rawUrl: string | null,
  enabled: boolean | number | null,
  type: string | null,
  lang: string,
  testid: string
): string {
  // R3 explicit ENABLE gate: the link renders only when the organizer turned it
  // ON — not merely because a URL is present. A staged-but-off URL stays dark.
  if (!enabled) return '';
  const url = validateLogoUrl(rawUrl).url;
  if (!url) return '';
  const key = typeof type === 'string' && type in WHAT_LINK_LABELS ? type : 'website';
  const label = WHAT_LINK_LABELS[key][lang === 'es' ? 'es' : 'en'];
  return `<p><a class="ose-what-link" data-testid="${testid}" href="${esc(url)}" target="_blank" rel="noopener noreferrer nofollow">${label}</a></p>`;
}

/** Escape a string for embedding inside a JS single-quoted string literal in a <script> block. */
function jsStr(s: string | null | undefined): string {
  if (s == null) return '';
  // U+2028 LINE SEPARATOR and U+2029 PARAGRAPH SEPARATOR must not appear
  // inside regex literals (OXC parser rejects them). Use split/join instead.
  const LS = '\u2028';
  const PS = '\u2029';
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .split(LS)
    .join('\\u2028')
    .split(PS)
    .join('\\u2029')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E');
}

/**
 * OSE-637 (MKTB-1) — Build complete OpenGraph + Twitter Card meta block.
 *
 * Call once per page render; drop the output into <head> after <title>.
 * Consistent across pre_event / event / post_event phases so all three
 * share the same social-preview surface area.
 */
function buildOgMeta(opts: {
  title: string;
  description: string;
  url: string;
  type?: string;
  twitterCard?: 'summary' | 'summary_large_image';
  imageUrl?: string | null;
  startTime?: string | null;
  endTime?: string | null;
}): string {
  const type = opts.type ?? 'event';
  const image = opts.imageUrl ? esc(opts.imageUrl) : '';
  // A `summary_large_image` card with no image is an invalid declaration:
  // X/Twitter drops the preview or silently degrades it, and Slack renders a
  // thin text-only unfurl. The card size is therefore DERIVED from whether an
  // image actually exists — a caller may ask for the small card, but may not
  // promise a large one we cannot fill. (OSE-1213: nothing currently supplies
  // an image, because cover_image_url is not on PublicEventRow, so today this
  // always resolves to `summary` — which is the honest card for what we emit.)
  const twitterCard = image ? (opts.twitterCard ?? 'summary_large_image') : 'summary';
  const lines: string[] = [
    `  <meta property="og:title" content="${opts.title}" />`,
    `  <meta property="og:description" content="${opts.description}" />`,
    `  <meta property="og:url" content="${opts.url}" />`,
    `  <meta property="og:type" content="${type}" />`,
    `  <meta property="og:site_name" content="OurSharedEvents" />`,
    `  <meta property="og:locale" content="en_US" />`,
    `  <meta name="twitter:card" content="${twitterCard}" />`,
    `  <meta name="twitter:title" content="${opts.title}" />`,
    `  <meta name="twitter:description" content="${opts.description}" />`,
  ];
  if (image) {
    lines.push(`  <meta property="og:image" content="${image}" />`);
    lines.push(`  <meta name="twitter:image" content="${image}" />`);
  }
  if (opts.startTime)
    lines.push(`  <meta property="og:event:start_time" content="${esc(opts.startTime)}" />`);
  if (opts.endTime)
    lines.push(`  <meta property="og:event:end_time" content="${esc(opts.endTime)}" />`);
  return lines.join('\n');
}

/** Detect preferred language from Accept-Language header. Returns 'es' when Spanish is first preference, 'en' otherwise. */
function preferredLang(request: Request): 'en' | 'es' {
  const al = request.headers.get('Accept-Language') ?? '';
  return /^es\b/i.test(al.split(',')[0].trim()) ? 'es' : 'en';
}

/**
 * OSE-655 A2: dark/light theming now comes from the @ocr/ui role tokens
 * (/ui.css) that the public surface consumes (--bg/--surface/--accent/--text/…),
 * which carry their own prefers-color-scheme handling. The former manual
 * --ose-* dark override (raw hex) is removed so the palette stays swappable in
 * BOTH modes and a [data-brand] reaches it. Kept as an empty string so the
 * `${DARK_MODE_CSS}` interpolations in each render remain valid.
 */
const DARK_MODE_CSS = '';

// renderGeoLink extracted to src/lib/geo-link.ts (OSE-660) — pure, unit-tested,
// maps!=H3 wall-guarded. Imported above.

/**
 * Share button — Web Share API with copy-link fallback.
 * URL and title are passed via HTML data attributes (XSS-safe).
 * Script tag requires a CSP nonce (passed from the request handler).
 * Bilingual: Spanish labels when lang='es'.
 */
function renderShareBlock(
  shareUrl: string,
  title: string,
  nonce: string,
  lang: 'en' | 'es'
): string {
  const shareLabel = lang === 'es' ? 'Compartir este evento' : 'Share this event';
  const copiedLabel = lang === 'es' ? 'Enlace copiado' : 'Link copied!';
  return `<button class="ose-share-btn" data-testid="share-btn" type="button" data-share-url="${esc(shareUrl)}" data-share-title="${esc(title)}">${shareLabel}</button>
<script nonce="${nonce}">(function(){var btn=document.querySelector('.ose-share-btn');if(!btn)return;var orig=btn.textContent;btn.addEventListener('click',function(){var u=btn.dataset.shareUrl,t=btn.dataset.shareTitle;if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){btn.textContent='${jsStr(copiedLabel)}';setTimeout(function(){btn.textContent=orig;},2000);}).catch(function(){});}});})();</script>`;
}

interface SponsorBasicRow {
  id: string;
  name: string;
  website_url: string | null;
}

interface EventPageSocialData {
  sponsors: SponsorBasicRow[];
  regCount: number;
  checkinCount: number;
  surveyCount: number;
  emailCount: number;
}

function renderSponsorItem(s: SponsorBasicRow): string {
  const name = esc(s.name);
  const url = s.website_url ?? '';
  if (url.startsWith('https://')) {
    return `<a href="${esc(url)}" class="ose-sponsor-link" rel="noopener noreferrer nofollow">${name}</a>`;
  }
  return `<span class="ose-sponsor-name">${name}</span>`;
}

function renderSponsorStrip(testid: string, sponsors: SponsorBasicRow[], heading: string): string {
  if (!sponsors.length) return '';
  const items = sponsors.map(renderSponsorItem).join('');
  return `<section class="ose-sponsor-strip" data-testid="${testid}" aria-label="Event sponsors">
    <p class="ose-sponsor-label">${heading}</p>
    <div class="ose-sponsor-list">${items}</div>
  </section>`;
}

function formatHumanDate(iso: string | null): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

/**
 * Anonymity affordance — the user-facing version of the architectural
 * separation principle. The platform's DB↔FORMS_DB split + anon_id + 15-min
 * tranches make this claim physically true; this paragraph makes it
 * user-readable. Lives at the bottom of every public event page so recipients
 * read it before any sign-up action they might take.
 */
const ANONYMITY_AFFORDANCE = `
  <section class="ose-anonymity" data-testid="anonymity-affordance" aria-labelledby="anon-heading">
    <h2 id="anon-heading">How this works</h2>
    <p>
      You're part of the group, anonymously. OurSharedEvents tracks when
      groups gather &mdash; never who you are. Event hosts and sponsors see
      corridors and venues, not people. The link you followed counted as a
      single click; nothing about your device, location, or identity was
      collected to display this page.
    </p>
  </section>
`;

// NOTE on CSP + the nonce parameter (added 2026-05-14 after code review):
// The current CSP policy (see `securityHeaders` below) allows
// `style-src 'self' 'unsafe-inline'`. With `'unsafe-inline'` present,
// every browser IGNORES nonces on <style> tags — putting `nonce="..."`
// on the <style> tag was decoration, not defense. The honest fix is
// to NOT pretend to nonce the style. A follow-on story (CSP tightening
// across ALL pages.ts handlers — every existing handler ships inline
// <style>) needs to happen before <style nonce> means anything. Until
// then the nonce parameter remains on the function signature because
// it IS real for inline <script> (which this page does not have, but
// might later).
export function renderPreEventHtml(
  row: PublicEventRow,
  shareUrl: string,
  social?: EventPageSocialData,
  opts?: { nonce?: string; lang?: 'en' | 'es' }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? 'en';
  const title = esc(row.title);
  // OSE: the What card leads with the host-authored short blurb (`what_short`),
  // falling back to the general `description` so the card is never empty when a
  // real description exists. og:description inherits the same fallback below.
  const whatShort = esc(row.what_short) || esc(row.description);
  const whoHost = esc(row.who_host);
  const whoStory = esc(row.who_story);
  // OSE-655: rich media for the funnel (OSE-664 supplied the columns + authoring
  // wall). Re-guard at render (defense-in-depth): http(s)-only, so a scheme that
  // ever slipped past authoring (javascript:, data:) can never reach an
  // src/href here. URL is attribute-escaped on output.
  const whoImage = validateLogoUrl(row.who_image_url).url;
  const whatVideo = validateLogoUrl(row.what_video_url).url;
  const whatLink = renderWhatLink(
    row.what_url,
    row.what_url_enabled,
    row.what_url_type,
    lang,
    'event-what-link'
  );
  const whyPurpose = esc(row.why_purpose);
  const howDetails = esc(row.how_details);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location);
  const startHuman = formatHumanDate(row.start_date);
  const venueParam = encodeURIComponent(row.location || row.where_address || '');
  const mapImg = venueParam
    ? `<img src="/api/v2/maps/venue-image?venue=${venueParam}" alt="Map of ${esc(row.location || row.where_address)}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="venue-map" />`
    : '';
  const geoLink = renderGeoLink(
    row.lat,
    row.lon,
    row.location,
    row.where_address,
    lang === 'es' ? 'Cómo llegar' : 'Get directions'
  );

  return `<!DOCTYPE html>
<html lang="${lang}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
${buildOgMeta({ title, description: whatShort, url: esc(shareUrl), twitterCard: 'summary_large_image', startTime: row.start_date, endTime: row.end_date })}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette driven by @ocr/ui role tokens (from /ui.css), so a
       [data-brand] on <html> swaps the whole surface. No raw hex here. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
    /* OSE-298 DRAIN 5/7: defensive horizontal-scroll guard for the
       public event page. overflow-x:hidden prevents any descendant
       (long URLs in the 5W fields, sponsor links, future embeds)
       from pushing the body wide at 375px. overflow-wrap:anywhere
       breaks long unbreakable strings so they wrap inside the
       max-width:720px column instead of forcing a scrollbar. */
    html, body { overflow-x: hidden; }
    body { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; overflow-wrap: anywhere; word-break: break-word; }
    .ose-skip { position: absolute; left: -9999px; }
    .ose-skip:focus { left: 1rem; top: 1rem; background: var(--ose-accent); color: var(--on-accent); padding: 0.5rem 1rem; border-radius: 4px; }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-meta { color: var(--ose-muted); font-size: 0.95rem; margin-bottom: 1.5rem; }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-geo-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; }
    .ose-geo-link:hover { text-decoration: underline; }
    .ose-rsvp-btn { display: inline-block; background: var(--ose-accent); color: var(--on-accent); padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 1.25rem 0; min-height: 44px; line-height: 1.5; }
    .ose-rsvp-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-share-btn { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--ose-accent); border: 1.5px solid var(--ose-accent); padding: 0.65rem 1.25rem; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; min-height: 44px; min-width: 180px; margin: 1rem 0 0.5rem; width: 100%; }
    .ose-share-btn:hover { background: var(--ose-accent-tint); }
    .ose-share-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: var(--ose-accent-tint); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
    .ose-section p { margin: 0; }
    /* OSE-655: WHO host photo (the conversion engine gets a face) + WHAT video
       link-out. Circular avatar; tasteful, mobile-first, 44px tap target on the link. */
    .ose-who-image { width: 120px; height: 120px; object-fit: cover; border-radius: 50%; display: block; margin-bottom: 0.75rem; background: var(--ose-accent-tint); }
    .ose-what-video { color: var(--ose-accent); text-decoration: none; font-weight: 600; display: inline-block; min-height: 44px; line-height: 44px; }
    .ose-what-video:hover { text-decoration: underline; }
    .ose-what-video:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }${DARK_MODE_CSS}
  </style>
</head>
<body>
  <a href="#main" class="ose-skip">Skip to event content</a>
  <nav aria-label="Site" style="margin:0 0 0.5rem"><a href="/events" data-testid="event-nav-events" style="color:var(--ose-accent);text-decoration:none;font-weight:600">&larr; All events</a></nav>
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main">
    ${social ? renderSponsorStrip('pre-sponsor-strip', social.sponsors, 'Supported by') : ''}
    <header data-testid="event-header">
      <h1 id="event-title" data-testid="event-title">${title}</h1>
      ${startHuman ? `<p class="ose-meta" data-testid="event-when">${esc(startHuman)}${row.timezone ? ` &middot; ${esc(row.timezone)}` : ''}</p>` : ''}
    </header>

    ${
      whatShort || whatVideo || whatLink
        ? `<section class="ose-card ose-section" data-testid="event-what" aria-labelledby="what-heading">
           <h2 id="what-heading">What</h2>
           ${whatShort ? `<p>${whatShort}</p>` : ''}
           ${whatVideo ? `<p><a class="ose-what-video" data-testid="event-what-video" href="${esc(whatVideo)}" target="_blank" rel="noopener noreferrer nofollow">${lang === 'es' ? '▶ Ver el video' : '▶ Watch the video'}</a></p>` : ''}
           ${whatLink}
         </section>`
        : ''
    }

    ${
      venueDisplay || whereAddress
        ? `<section class="ose-card ose-section" data-testid="event-where" aria-labelledby="where-heading">
           <h2 id="where-heading">Where</h2>
           ${mapImg}
           ${venueDisplay ? `<p><strong>${venueDisplay}</strong></p>` : ''}
           ${whereAddress && whereAddress !== venueDisplay ? `<p>${whereAddress}</p>` : ''}
           ${geoLink}
         </section>`
        : ''
    }

    ${
      whoHost || whoStory || whoImage
        ? `<section class="ose-card ose-section" data-testid="event-who" aria-labelledby="who-heading">
           <h2 id="who-heading">Who</h2>
           ${whoImage ? `<img class="ose-who-image" data-testid="event-who-image" src="${esc(whoImage)}" alt="${whoHost ? `Photo of ${whoHost}` : 'Host'}" loading="lazy" width="120" height="120" />` : ''}
           ${whoHost ? `<p data-testid="event-who-host">${whoHost}</p>` : ''}
           ${whoStory ? `<p class="ose-who-story" data-testid="event-who-story">${whoStory}</p>` : ''}
         </section>`
        : ''
    }

    ${(() => {
      // HOW MUCH — the event's own price (display only; #6 inert_monetization
      // holds — no charge logic). Sits right before the CTA: cost is the last
      // fact a recipient weighs before the ask (order: What → Where → Who → How much → CTA).
      const howMuch = formatEventPrice(row);
      return howMuch === null
        ? ''
        : `<section class="ose-card ose-section" data-testid="event-how-much" aria-labelledby="how-much-heading">
           <h2 id="how-much-heading">How much</h2>
           <p>${esc(howMuch)}</p>
         </section>`;
    })()}

    <!-- Counts are POST-EVENT only (founder decision 2026-09-04). An attendee
       deciding whether to come is not shown how many others already did:
       live tallies are social proof, a growth tactic, and the platform counts
       the room for the host, sponsor and report — never to persuade the room.
       The post-event recap card keeps its counts (OSE-657 keepsake). -->

    ${renderShareBlock(shareUrl, row.title, nonce, lang)}

    <a class="ose-rsvp-btn" data-testid="event-rsvp" href="/forms/${esc(row.id)}?type=register">RSVP for this event</a>

    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why" aria-labelledby="why-heading">
           <h2 id="why-heading">Why</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${
      howDetails
        ? `<section class="ose-card ose-section" data-testid="event-how" aria-labelledby="how-heading">
           <h2 id="how-heading">How</h2>
           <p>${howDetails}</p>
         </section>`
        : ''
    }

    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
}

/**
 * Renders the event-live phase (OSE-244a). Same 5W content surface as
 * pre-event, but the hero shows a "LIVE NOW" indicator and the primary
 * CTA flips from RSVP to Check-in (wired to the existing scan/checkin
 * form route).
 *
 * What's NOT in this render (scoped to follow-on stories):
 *   - Sponsor rotation (OSE-244b) — uses the existing EPIC-02 rotation lib
 *   - Live scan counter + auto-refresh (OSE-244c) — polls the form
 *     checkin-count endpoint; degrades gracefully when no QR deployment
 *
 * The "share still available" requirement from the AC is satisfied
 * implicitly: the page URL is the share artifact. Anyone hitting
 * /events/:id during live phase gets this render and can forward the
 * link.
 */
export function renderEventLiveHtml(
  row: PublicEventRow,
  shareUrl: string,
  social?: EventPageSocialData,
  opts?: { nonce?: string; lang?: 'en' | 'es' }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? 'en';
  const title = esc(row.title);
  // Same What fallback as the pre-event render: host blurb, else description.
  const whatShort = esc(row.what_short) || esc(row.description);
  const whatLink = renderWhatLink(
    row.what_url,
    row.what_url_enabled,
    row.what_url_type,
    lang,
    'event-what-link-live'
  );
  const whoHost = esc(row.who_host);
  const whyPurpose = esc(row.why_purpose);
  const howDetails = esc(row.how_details);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location);
  const venueParam = encodeURIComponent(row.location || row.where_address || '');
  const mapImg = venueParam
    ? `<img src="/api/v2/maps/venue-image?venue=${venueParam}" alt="Map of ${esc(row.location || row.where_address)}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="venue-map-live" />`
    : '';
  const geoLink = renderGeoLink(
    row.lat,
    row.lon,
    row.location,
    row.where_address,
    lang === 'es' ? 'Cómo llegar' : 'Navigate now',
    'geo-link-live'
  );

  return `<!DOCTYPE html>
<html lang="${lang}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
${buildOgMeta({ title, description: whatShort, url: esc(shareUrl), twitterCard: 'summary_large_image', startTime: row.start_date, endTime: row.end_date })}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette from @ocr/ui role tokens (from /ui.css); [data-brand]
       swaps the surface. --ose-live -> teal --live (colorblind-safe). No hex. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
    /* OSE-298 DRAIN 5/7: defensive horizontal-scroll guard for the
       public event page (live phase mirror of renderPreEventHtml). */
    html, body { overflow-x: hidden; }
    body { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; overflow-wrap: anywhere; word-break: break-word; }
    .ose-skip { position: absolute; left: -9999px; }
    .ose-skip:focus { left: 1rem; top: 1rem; background: var(--ose-accent); color: var(--on-accent); padding: 0.5rem 1rem; border-radius: 4px; }
    .ose-live-badge { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--ose-live); color: #fff; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; }
    .ose-live-dot { width: 0.6rem; height: 0.6rem; background: #fff; border-radius: 50%; animation: ose-pulse 1.5s ease-in-out infinite; }
    @keyframes ose-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-geo-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; }
    .ose-geo-link:hover { text-decoration: underline; }
    .ose-checkin-btn { display: inline-block; background: var(--ose-accent); color: var(--on-accent); padding: 0.875rem 1.75rem; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 1.25rem 0; font-size: 1.05rem; min-height: 44px; line-height: 1.5; }
    .ose-checkin-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-share-btn { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--ose-accent); border: 1.5px solid var(--ose-accent); padding: 0.65rem 1.25rem; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; min-height: 44px; min-width: 180px; margin: 1rem 0 0.5rem; width: 100%; }
    .ose-share-btn:hover { background: var(--ose-accent-tint); }
    .ose-share-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: var(--ose-accent-tint); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
    .ose-section p { margin: 0; }
    /* OSE-655: WHO host photo (the conversion engine gets a face) + WHAT video
       link-out. Circular avatar; tasteful, mobile-first, 44px tap target on the link. */
    .ose-who-image { width: 120px; height: 120px; object-fit: cover; border-radius: 50%; display: block; margin-bottom: 0.75rem; background: var(--ose-accent-tint); }
    .ose-what-video { color: var(--ose-accent); text-decoration: none; font-weight: 600; display: inline-block; min-height: 44px; line-height: 44px; }
    .ose-what-video:hover { text-decoration: underline; }
    .ose-what-video:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }${DARK_MODE_CSS}
  </style>
</head>
<body>
  <a href="#main" class="ose-skip">Skip to event content</a>
  <nav aria-label="Site" style="margin:0 0 0.5rem"><a href="/events" data-testid="event-nav-events-live" style="color:var(--ose-accent);text-decoration:none;font-weight:600">&larr; All events</a></nav>
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main-live">
    ${social ? renderSponsorStrip('live-sponsor-strip', social.sponsors, 'Supported by') : ''}
    <header data-testid="event-header-live">
      <span class="ose-live-badge" data-testid="event-live-badge" aria-label="Event is live now">
        <span class="ose-live-dot" aria-hidden="true"></span>Live now
      </span>
      <h1 id="event-title" data-testid="event-title-live">${title}</h1>
    </header>

    ${
      whatShort || whatLink
        ? `<section class="ose-card ose-section" data-testid="event-what-live" aria-labelledby="what-heading-live">
           <h2 id="what-heading-live">What</h2>
           ${whatShort ? `<p>${whatShort}</p>` : ''}
           ${whatLink}
         </section>`
        : ''
    }

    ${
      venueDisplay || whereAddress
        ? `<section class="ose-card ose-section" data-testid="event-where-live" aria-labelledby="where-heading-live">
           <h2 id="where-heading-live">Where</h2>
           ${mapImg}
           ${venueDisplay ? `<p><strong>${venueDisplay}</strong></p>` : ''}
           ${whereAddress && whereAddress !== venueDisplay ? `<p>${whereAddress}</p>` : ''}
           ${geoLink}
         </section>`
        : ''
    }

    ${
      whoHost
        ? `<section class="ose-card ose-section" data-testid="event-who-live" aria-labelledby="who-heading-live">
           <h2 id="who-heading-live">Who</h2>
           <p>${whoHost}</p>
         </section>`
        : ''
    }

    ${(() => {
      // HOW MUCH — mirrors the pre-event render so the order is identical across
      // phases (What → Where → Who → How much → CTA). Display only; #6
      // inert_monetization holds — no charge logic.
      const howMuch = formatEventPrice(row);
      return howMuch === null
        ? ''
        : `<section class="ose-card ose-section" data-testid="event-how-much-live" aria-labelledby="how-much-heading-live">
           <h2 id="how-much-heading-live">How much</h2>
           <p>${esc(howMuch)}</p>
         </section>`;
    })()}

    ${renderShareBlock(shareUrl, row.title, nonce, lang)}

    <a class="ose-checkin-btn" data-testid="event-checkin" href="/forms/${esc(row.id)}?type=checkin">Check in at this event</a>

    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why-live" aria-labelledby="why-heading-live">
           <h2 id="why-heading-live">Why</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${
      howDetails
        ? `<section class="ose-card ose-section" data-testid="event-how-live" aria-labelledby="how-heading-live">
           <h2 id="how-heading-live">How</h2>
           <p>${howDetails}</p>
         </section>`
        : ''
    }

    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
}

/**
 * Minimal phase stub. After OSE-244a (event-live got full rendering), this
 * function is only called for `post_event`. OSE-245 will replace this with
 * a full post-event recap render.
 */
function renderMinimalPhaseHtml(row: PublicEventRow, phase: 'event' | 'post_event'): string {
  const title = esc(row.title);
  const message = phase === 'event' ? 'This event is happening now.' : 'This event has ended.';
  return `<!DOCTYPE html>
<html lang="en" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette from @ocr/ui role tokens (from /ui.css); [data-brand]
       swaps the surface. No raw hex here. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 3rem auto; padding: 1rem; line-height: 1.5; color: var(--ose-text); background: var(--ose-bg); }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    .msg { color: var(--ose-muted); font-size: 1.05rem; margin: 0.5rem 0 1.5rem; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: var(--ose-accent-tint); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
  </style>
</head>
<body>
  <main role="main" aria-labelledby="event-title-minimal" data-testid="event-main-minimal">
    <h1 id="event-title-minimal" data-testid="event-title-minimal">${title}</h1>
    <p class="msg" data-testid="event-phase-msg">${message}</p>
    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
}

/** Minimal shape for the "next at this venue" card. */
interface NextEventRow {
  id: string;
  title: string;
  start_date: string | null;
  location: string | null;
}

/**
 * OSE-657 recap-first invariant: post-event suggestions are a CURATED few at the
 * margin, never an exhaustive listing. This bound is what makes "tasteful, not
 * bombardment" structural rather than a preference — the render slices to it and
 * the layout-invariant test asserts the rendered count never exceeds it.
 */
const MAX_POST_EVENT_SUGGESTIONS = 3;

/**
 * Post-event recap render (OSE-245 / ose-client-ready package).
 *
 * Replaces the "This event has ended." stub with a real recap + return loop.
 * Design intent: closes the ritual loop at exactly the moment it matters.
 *   • Recap frame: same 5W surface, shifted to past tense.
 *   • Return loop: next upcoming event at the same venue, else public listing.
 *   • Opt-in email CTA: routes to existing /forms/:id?type=email (FORMS_DB).
 *   • Anonymity affordance retained (Invariant #1 surface language).
 *   • No sponsor logos v1 — display priority is tier-governed (Invariant #5).
 */
export function renderPostEventHtml(
  row: PublicEventRow,
  shareUrl: string,
  nextEvents: NextEventRow[],
  social?: EventPageSocialData,
  opts?: { nonce?: string; lang?: 'en' | 'es' }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? 'en';
  const title = esc(row.title);
  // OSE-1136: the recap is the THIRD phase of the canonical 5W table, past-tense —
  // same fields + fallbacks as the pre-event render. WHAT falls back to description
  // so the lead card is never empty when a real description exists.
  const whatShort = esc(row.what_short) || esc(row.description);
  // The WHAT external link persists into the recap: a fundraiser's donation
  // window (and a client's own signup/doc) outlasts the gathering, so a patron
  // who missed it can still act after.
  const whatLink = renderWhatLink(
    row.what_url,
    row.what_url_enabled,
    row.what_url_type,
    lang,
    'event-what-link-post'
  );
  // OG/Twitter card computed up front (needs only title + whatShort + shareUrl):
  // keeps buildOgMeta near the top now that the recap has a fuller 5W setup below.
  const ogMeta = buildOgMeta({
    title,
    description: whatShort,
    url: esc(shareUrl),
    twitterCard: 'summary',
    startTime: row.start_date,
    endTime: row.end_date,
  });
  const whoHost = esc(row.who_host);
  const whoStory = esc(row.who_story);
  const whoImage = validateLogoUrl(row.who_image_url).url;
  const whyPurpose = esc(row.why_purpose);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location) || esc(row.where_address);
  const whenHuman = formatHumanDate(row.start_date);
  // HOW MUCH — the event's own price, display-only (#6 inert_monetization holds:
  // it is a label, never a payment primitive). Same source the pre/live renders use.
  const howMuch = formatEventPrice(row);
  const venueParam = encodeURIComponent(row.location || row.where_address || '');
  const mapImg = venueParam
    ? `<img src="/api/v2/maps/venue-image?venue=${venueParam}" alt="Map of ${esc(row.location || row.where_address)}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="venue-map-post" />`
    : '';

  // OSE-657: curated, bounded suggestions — the subtle margin. Sliced defensively
  // to MAX_POST_EVENT_SUGGESTIONS so this can never become an exhaustive listing.
  // The first item keeps the OSE-454 next-event-card testids for continuity; any
  // further items are indexed. When none exist, the corridor fallback stands in.
  const curated = nextEvents.slice(0, MAX_POST_EVENT_SUGGESTIONS);
  const suggestionItems = curated
    .map((ev, i) => {
      const testid = i === 0 ? 'next-event-card' : `next-event-suggestion-${i}`;
      const linkTestid = i === 0 ? 'next-event-link' : `next-event-suggestion-link-${i}`;
      return `<li class="ose-suggestion" data-testid="${testid}">
          <a class="ose-suggestion-link" data-testid="${linkTestid}" href="/events/${esc(ev.id)}">
            <span class="ose-suggestion-title">${esc(ev.title)}</span>
            <span class="ose-suggestion-when">${formatHumanDate(ev.start_date)}</span>
          </a>
        </li>`;
    })
    .join('');
  const suggestionsInner = curated.length
    ? `<h2 id="next-heading" class="ose-suggestions-heading">Next at ${venueDisplay || 'this venue'}</h2>
        <ul class="ose-suggestion-list">${suggestionItems}</ul>`
    : `<h2 id="next-heading" class="ose-suggestions-heading" data-testid="next-event-fallback">The corridor keeps going</h2>
        <p class="ose-suggestions-note">More gatherings are always coming together nearby.</p>
        <a class="ose-cta ose-cta-secondary" data-testid="browse-events-link" href="/public">See what's coming up</a>`;

  return `<!DOCTYPE html>
<html lang="${lang}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — recap</title>
${ogMeta}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette driven by @ocr/ui role tokens (from /ui.css), so a
       [data-brand] on <html> swaps the whole surface. No raw hex here. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
    main { max-width: 640px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    .ose-phase-chip { display: inline-block; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ose-muted); background: rgba(42,42,42,0.06); border-radius: 999px; padding: 4px 12px; margin-bottom: 0.75rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
    .ose-when { color: var(--ose-muted); margin: 0 0 1.25rem; }
    .ose-card { background: var(--ose-card); border: 1px solid rgba(42,42,42,0.08); border-radius: 8px; padding: 1rem 1.25rem; margin: 0 0 1rem; }
    .ose-card h2 { font-size: 1rem; margin: 0 0 0.5rem; }
    .ose-card p { margin: 0 0 0.5rem; }
    .ose-recap-row { margin: 0 0 0.6rem; }
    .ose-recap-label { display: block; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ose-muted); }
    /* OSE-657 recap-first: the recap is the hero; suggestions are demoted to a
       quiet margin — smaller type, muted, set off by a divider, never a card
       loud enough to compete with the keepsake above it. Palette-agnostic. */
    .ose-recap-primary { margin: 0 0 1.5rem; }
    .ose-suggestions { margin: 1.5rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--ose-muted); opacity: 0.92; }
    .ose-suggestions-heading { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.03em; color: var(--ose-muted); margin: 0 0 0.5rem; }
    .ose-suggestions-note { font-size: 0.85rem; color: var(--ose-muted); margin: 0 0 0.5rem; }
    .ose-suggestion-list { list-style: none; margin: 0 0 0.75rem; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .ose-suggestion-link { display: flex; justify-content: space-between; gap: 0.75rem; align-items: baseline; min-height: 44px; padding: 0.4rem 0; text-decoration: none; color: var(--ose-text); }
    .ose-suggestion-title { font-size: 0.95rem; }
    .ose-suggestion-when { font-size: 0.8rem; color: var(--ose-muted); white-space: nowrap; }
    .ose-suggestions-connect { margin-top: 0.75rem; }
    .ose-cta { display: inline-block; min-height: 44px; line-height: 44px; padding: 0 20px; background: var(--ose-accent); color: var(--on-accent); border-radius: 6px; text-decoration: none; font-weight: 600; }
    .ose-cta.ose-cta-secondary { background: transparent; color: var(--ose-accent); border: 1px solid var(--ose-accent); }
    .ose-share-btn { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--ose-accent); border: 1.5px solid var(--ose-accent); padding: 0.65rem 1.25rem; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; min-height: 44px; min-width: 180px; margin: 1rem 0 0.5rem; width: 100%; }
    .ose-share-btn:hover { background: var(--ose-accent-tint); }
    .ose-share-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: var(--ose-accent-tint); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
    /* OSE-1136: the recap's WHERE/WHO cards reuse the pre-event 5W styling. */
    .ose-section p { margin: 0 0 0.5rem; }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-who-image { width: 120px; height: 120px; object-fit: cover; border-radius: 50%; display: block; margin-bottom: 0.75rem; background: var(--ose-accent-tint); }${DARK_MODE_CSS}
  </style>
</head>
<body>
  <main role="main" aria-labelledby="event-title-post" data-testid="event-main-post">
    <span class="ose-phase-chip" data-testid="event-phase-chip">This one's a wrap</span>
    <h1 id="event-title-post" data-testid="event-title-post">${title}</h1>
    <p class="ose-when" data-testid="event-when-post">${whenHuman ? `Happened ${whenHuman}` : 'This event has ended.'}${venueDisplay ? ` &middot; ${venueDisplay}` : ''}</p>

    <!-- OSE-1136 / OSE-657: the recap is the canonical 5W table in PAST TENSE and
       the keepsake hero. Card order is the same facts-first sequence the pre/live
       renders use — WHAT → WHERE → WHO → HOW MUCH — then the by-the-numbers
       keepsake + sponsor thanks. HOW is intentionally dropped (nothing to "join"
       once it is over); WHY moves below the ask. This region is a HARD layout
       invariant: it MUST precede the suggestions margin below, or
       post-event-recap-first.spec.ts fails. -->
    <div class="ose-recap-primary" data-testid="recap-primary" data-region="recap">
      <!-- WHAT — keeps the event-recap-card testid the recap-first invariant asserts. -->
      <section class="ose-card ose-section" data-testid="event-recap-card" aria-labelledby="recap-heading">
        <h2 id="recap-heading">What this was</h2>
        ${whatShort ? `<p data-testid="recap-what">${whatShort}</p>` : ''}
        ${!whatShort && !whoHost && !whyPurpose ? `<p data-testid="recap-empty">The host hasn't written this one up yet. The numbers below are the story.</p>` : ''}
        ${whatLink}
      </section>

      ${
        venueDisplay || whereAddress
          ? `<section class="ose-card ose-section" data-testid="event-where-post" aria-labelledby="where-heading-post">
             <h2 id="where-heading-post">Where</h2>
             ${mapImg}
             ${venueDisplay ? `<p><strong>${venueDisplay}</strong></p>` : ''}
             ${whereAddress && whereAddress !== venueDisplay ? `<p>${whereAddress}</p>` : ''}
           </section>`
          : ''
      }

      ${
        whoHost || whoStory || whoImage
          ? `<section class="ose-card ose-section" data-testid="event-who-post" aria-labelledby="who-heading-post">
             <h2 id="who-heading-post">Who</h2>
             ${whoImage ? `<img class="ose-who-image" data-testid="event-who-image-post" src="${esc(whoImage)}" alt="${whoHost ? `Photo of ${whoHost}` : 'Host'}" loading="lazy" width="120" height="120" />` : ''}
             ${whoHost ? `<p data-testid="event-who-host-post">${whoHost}</p>` : ''}
             ${whoStory ? `<p class="ose-who-story" data-testid="event-who-story-post">${whoStory}</p>` : ''}
           </section>`
          : ''
      }

      ${
        // HOW MUCH — past-tense price label ("Was free" reads as the plain price
        // string; #6 inert_monetization holds — display only, no charge logic).
        howMuch === null
          ? ''
          : `<section class="ose-card ose-section" data-testid="event-how-much-post" aria-labelledby="how-much-heading-post">
             <h2 id="how-much-heading-post">How much</h2>
             <p>${esc(howMuch)}</p>
           </section>`
      }

      ${(() => {
        if (!social) return '';
        // OSE-1201: "attendance" is a banned lexicon word (it claims people; the
        // platform counts signals). The ratio is labelled by what was measured —
        // check-ins over registrations — never by a word that implies bodies.
        const { checkinCount, regCount, surveyCount, emailCount, sponsors } = social;
        const hasStats = checkinCount > 0 || regCount > 0 || surveyCount > 0 || emailCount > 0;
        const statsCard = hasStats
          ? `<section class="ose-card ose-stats-card" data-testid="event-stats-card" aria-labelledby="stats-heading">
              <h2 id="stats-heading">By the numbers</h2>
              ${checkinCount > 0 ? statLine(checkinCount, 'Checked in', 'stat-checkins') : ''}
              ${regCount > 0 ? statLine(regCount, 'Registered', 'stat-registrations') : ''}
              ${
                // Ratio only when BOTH operands clear the floor — a "% showed up"
                // over a sub-K denominator (e.g. 50% of 2) back-derives a person.
                clearsFloor(checkinCount) && clearsFloor(regCount)
                  ? `<p data-testid="stat-showed-up-share">${Math.round((checkinCount / regCount) * 100)}% of those registered showed up</p>`
                  : ''
              }
              ${surveyCount > 0 ? statLine(surveyCount, 'Surveys submitted', 'stat-surveys') : ''}
              ${emailCount > 0 ? statLine(emailCount, 'Email signups', 'stat-email-signups') : ''}
            </section>`
          : '';
        // Sponsor rotation stays ambient + spend-blind here (names/links only,
        // no tier/spend) — a warm, receptive-attention placement, not a wall.
        const sponsorThanks = sponsors.length
          ? `<section class="ose-card ose-sponsor-thanks" data-testid="post-sponsor-thanks" aria-labelledby="thanks-heading">
              <h2 id="thanks-heading">Thanks to our sponsors</h2>
              <div class="ose-sponsor-list">${sponsors.map(renderSponsorItem).join('')}</div>
            </section>`
          : '';
        return statsCard + sponsorThanks;
      })()}
    </div>

    <!-- OSE-657 SUBORDINATE margin: the ask + return loop. Share sits here with
       the return loop (share the recap, find the next one) — curated, bounded (an
       <aside>, visually demoted, always after the recap), never a full listing. -->
    <aside class="ose-suggestions" data-testid="suggestions-margin" data-region="suggestions" aria-labelledby="next-heading">
      ${renderShareBlock(shareUrl, row.title, nonce, lang)}
      ${suggestionsInner}
      <section class="ose-suggestions-connect" data-testid="stay-connected-card" aria-labelledby="connect-heading">
        <h2 id="connect-heading" class="ose-suggestions-heading">Hear about the next one</h2>
        <p class="ose-suggestions-note">One email when something's coming up. Nothing else.</p>
        <a class="ose-cta ose-cta-secondary" data-testid="email-signup-link" href="/forms/${esc(row.id)}?type=email">Keep me posted</a>
      </section>
    </aside>

    <!-- WHY — deeper detail, below the ask (mirrors pre/live: facts → ask → detail). -->
    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why-post" aria-labelledby="why-heading-post">
           <h2 id="why-heading-post">Why</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
}

async function fetchEventPageSocialData(
  env: PublicEventEnv,
  eventId: string
): Promise<EventPageSocialData> {
  const empty: EventPageSocialData = {
    sponsors: [],
    regCount: 0,
    checkinCount: 0,
    surveyCount: 0,
    emailCount: 0,
  };

  const [sponsorsResult, regResult, checkinResult, surveyResult, emailResult] =
    await Promise.allSettled([
      env.DB
        ? env.DB.prepare(
            // OSE-799 A2: reconstruct the public sponsor list from the split model —
            // active placements on this event, joined to their business identity.
            `SELECT sb.id AS id, sb.name AS name, sb.website_url AS website_url
               FROM sponsor_placement sp
               JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
              WHERE sp.event_id = ? AND sp.is_active = 1
                AND sb.is_active = 1
                AND COALESCE(sp.organizer_accepted, 1) = 1
                AND sp.sponsor_accepted = 1
              ORDER BY sb.id ASC`
          )
            .bind(eventId)
            .all<SponsorBasicRow>()
        : Promise.resolve({ results: [] as SponsorBasicRow[] }),

      env.FORMS_DB
        ? env.FORMS_DB.prepare(
            `SELECT COUNT(*) as cnt FROM form_registrations WHERE event_id = ? AND status = 'confirmed' AND (expires_at IS NULL OR expires_at > datetime('now'))`
          )
            .bind(eventId)
            .first<{ cnt: number }>()
        : Promise.resolve(null),

      env.FORMS_DB
        ? env.FORMS_DB.prepare(`SELECT total_count FROM checkin_counts WHERE event_id = ? LIMIT 1`)
            .bind(eventId)
            .first<{ total_count: number }>()
        : Promise.resolve(null),

      env.FORMS_DB
        ? env.FORMS_DB.prepare(`SELECT COUNT(*) as cnt FROM form_surveys WHERE event_id = ?`)
            .bind(eventId)
            .first<{ cnt: number }>()
        : Promise.resolve(null),

      env.FORMS_DB
        ? env.FORMS_DB.prepare(`SELECT COUNT(*) as cnt FROM email_signups WHERE event_id = ?`)
            .bind(eventId)
            .first<{ cnt: number }>()
        : Promise.resolve(null),
    ]);

  return {
    sponsors:
      sponsorsResult.status === 'fulfilled'
        ? (sponsorsResult.value?.results ?? [])
        : empty.sponsors,
    regCount: regResult.status === 'fulfilled' ? (regResult.value?.cnt ?? 0) : 0,
    checkinCount:
      checkinResult.status === 'fulfilled' ? (checkinResult.value?.total_count ?? 0) : 0,
    surveyCount: surveyResult.status === 'fulfilled' ? (surveyResult.value?.cnt ?? 0) : 0,
    emailCount: emailResult.status === 'fulfilled' ? (emailResult.value?.cnt ?? 0) : 0,
  };
}

/**
 * GET /events/:id — public event landing page. Phase-aware.
 *
 * Recipients land here from `/s/:code` shortlinks. The page renders the
 * event's 5W content + venue map when in pre_event phase, or a minimal
 * phase-appropriate stub otherwise.
 *
 * Anonymity: NO IP / Cookie / anon_id reads in this handler. The only
 * inputs are the eventId from the URL and the event row from D1. The
 * anonymity affordance section explains this to the recipient in plain
 * language.
 */
export async function handlePublicEventPage(
  request: Request,
  env: PublicEventEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) {
    return renderErrorPage(
      503,
      "We're having trouble loading this event",
      'Our event service is briefly unavailable. Try again in a minute, or browse what else is coming up.',
      '/events',
      'Browse upcoming events'
    );
  }

  // Cheap input validation. Event IDs are URL-safe alnum/_-, max 128 chars
  // (same shape as the form-validation lib enforces).
  if (!eventId || eventId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(eventId)) {
    return renderErrorPage(
      404,
      "We couldn't find that event",
      "This event link doesn't work anymore — it may have been archived. See what's coming up next.",
      '/events',
      'Browse upcoming events'
    );
  }

  let row: PublicEventRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT id, brand_id, title, slug, status, description, location,
              start_date, end_date, timezone,
              what_short, who_host, why_purpose, how_details, where_address,
              who_story, who_image_url, what_video_url, what_url,
              what_url_enabled, what_url_type,
              lat, lon, price_cents, price_model, price_note
       FROM events WHERE id = ?`
    )
      .bind(eventId)
      .first<PublicEventRow>();
  } catch {
    return renderErrorPage(
      503,
      "We're having trouble loading this event",
      'Our event service is briefly unavailable. Try again in a minute, or browse what else is coming up.',
      '/events',
      'Browse upcoming events'
    );
  }

  if (!row) {
    return renderErrorPage(
      404,
      "We couldn't find that event",
      "This event link doesn't work anymore — it may have been archived. See what's coming up next.",
      '/events',
      'Browse upcoming events'
    );
  }

  // State-machine gate: draft/ready events are NOT renderable to public.
  // 404 (not 403) so an attacker can't probe to discover unpublished events.
  // The friendly copy MUST be byte-identical to the not-found case above so
  // a probe attacker can't differentiate a missing row from a draft row.
  const status = (row.status || '').toLowerCase();
  if (status === 'draft' || status === 'ready') {
    return renderErrorPage(
      404,
      "We couldn't find that event",
      "This event link doesn't work anymore — it may have been archived. See what's coming up next.",
      '/events',
      'Browse upcoming events'
    );
  }

  // Phase-aware dispatch via the OSE-242 canonical resolver.
  const phase = computeEventPhase({
    status: row.status,
    start_date: row.start_date,
    end_date: row.end_date,
  });

  // CSP nonce — generated for the response headers regardless of whether
  // the body uses it. `securityHeaders(nonce)` writes the nonce into the
  // CSP header so any future inline <script> on this page is enforceable
  // immediately. The render functions don't take the nonce because the
  // current CSP allows `style-src 'unsafe-inline'` (see CSP-tightening
  // follow-on story) — nonce on <style> would be theater today.
  const nonce = generateNonce();
  const lang = preferredLang(request);
  const url = new URL(request.url);
  const shareUrl = `${url.origin}/events/${row.id}`;

  // Fetch social data (sponsors + counts) in parallel; fail-open on any error.
  const social = await fetchEventPageSocialData(env, row.id);

  let body: string;
  if (phase === 'pre_event') {
    body = renderPreEventHtml(row, shareUrl, social, { nonce, lang });
  } else if (phase === 'event') {
    body = renderEventLiveHtml(row, shareUrl, social, { nonce, lang });
  } else {
    // post_event: real recap + return loop (OSE-245 ose-client-ready package).
    // renderMinimalPhaseHtml is kept as the defensive fallback for phase==='event'
    // only — do NOT delete (Invariant #10 deprecation_lock).
    // OSE-657: a curated few upcoming events at the same venue — the subtle
    // margin, bounded by MAX_POST_EVENT_SUGGESTIONS (never an exhaustive list).
    let nextEvents: NextEventRow[] = [];
    try {
      if (row.location) {
        // OSE-1242 / CCR H1: brand-scoped. This is a PUBLIC surface listing
        // other events at the same venue, and it had no brand filter — so a
        // venue hosting two white-label instances would advertise each brand's
        // events on the other's recap page. Invariant #9 applies to every
        // public list, not only the one at /events. Found by the rewritten
        // OSE-INV9 gate, which scans handlers instead of naming one.
        const rs = await env.DB.prepare(
          `SELECT id, title, start_date, location FROM events
           WHERE brand_id = ?1 AND status = 'active' AND location = ?2 AND id != ?3
             AND start_date IS NOT NULL AND datetime(start_date) > datetime('now')
           ORDER BY datetime(start_date) ASC LIMIT ?4`
        )
          .bind(row.brand_id, row.location, row.id, MAX_POST_EVENT_SUGGESTIONS)
          .all<NextEventRow>();
        nextEvents = rs.results ?? [];
      }
    } catch {
      nextEvents = []; // recap must render even if the lookup fails
    }
    body = renderPostEventHtml(row, shareUrl, nextEvents, social, { nonce, lang });
  }

  // OSE-1012/1013: the /events/:id page is where the demo event actually renders
  // (poster QR encodes the mock event). Declare provenance for the served data —
  // 'demo' showcase banner, 'degraded' fallback indicator, or nothing when live.
  body = injectProvenanceBanner(body, await resolveAndSignalProvenance(env, 'public-event'));

  // OSE-658 cache-coherence: private (never shared-edge — the body may carry a
  // sub-floor count, #7) and hard-expiring by the next phase pivot so no stale
  // pre/in/post state is ever served past the start/end boundary.
  return new Response(body, {
    status: 200,
    headers: {
      ...securityHeaders(nonce),
      'Cache-Control': publicEventCacheControl(
        { status: row.status, start_date: row.start_date, end_date: row.end_date },
        phase
      ),
    },
  });
}

export function handleAdminPage(_env: PagesEnv): Response {
  return html(injectLegalFooter(ADMIN_HTML, 'admin'));
}

/**
 * R-001 fix — HTML sign-in landing for unauthenticated GET /admin.
 *
 * Before this handler existed, hitting GET /admin without credentials
 * fell through to `requireAdmin`, which returned a raw JSON 401 dump
 * (`{"ok":false,"code":"UNAUTH",...}`). For an HTML GET that's the
 * literal first-touch experience: a JSON error rendered as page text.
 *
 * This page replaces the JSON for HTML GETs only. The JSON 401 still
 * returns for API calls (POST /api/v2/admin/* etc.) — those are
 * machine consumers that expect a structured response.
 *
 * Auth model (per src/auth/admin.ts):
 *   - Production: Cloudflare Access JWT (preferred). Sign-in flow is
 *     handled by CF Access itself; this page tells the user what to
 *     expect and provides the entry-point link.
 *   - Staging/CI: X-OCR-Internal header or Bearer ADMIN_KEY. Not a
 *     human-facing path; we don't surface either on this page.
 *
 * No JS, no external dependencies. Renders fully under strict CSP.
 */

/**
 * Render the admin sign-in page (HTML 401). Used by the router when an
 * HTML GET to /admin fails authentication — returns a styled page
 * instead of the JSON 401 from requireAdmin.
 *
 * Status code is 401 so monitoring + bots see the correct semantics,
 * but the body is a real page a human can read.
 */
export function handleAdminSignInPage(_env: PagesEnv): Response {
  return html(injectLegalFooter(ADMIN_SIGNIN_HTML, 'admin-signin'), 401);
}

// ─── Rate limiter (per-isolate, in-memory sliding window) ────────────────────
// Cloudflare Workers share isolates across requests. This provides basic burst
// protection within a single isolate. For cross-isolate enforcement, upgrade
// to KV or Durable Objects in Phase 2.

const RATE_WINDOW_MS = 60_000; // 1 minute
const RATE_MAX_REQUESTS = 10; // max 10 subscribe attempts per IP per minute
const RATE_MAX_BUCKETS = 10_000;
const RATE_EVICT_BATCH = 200; // evict up to 200 stale entries per request
const rateBuckets = new Map<string, number[]>();
let evictCursor: string | undefined;

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateBuckets.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < RATE_WINDOW_MS);

  if (recent.length >= RATE_MAX_REQUESTS) {
    rateBuckets.set(ip, recent);
    return true;
  }

  recent.push(now);
  rateBuckets.set(ip, recent);

  // Incremental eviction: scan a small batch per request to avoid blocking
  if (rateBuckets.size > RATE_MAX_BUCKETS) {
    let evicted = 0;
    let started = false;
    for (const [key, ts] of rateBuckets) {
      if (evictCursor && !started) {
        if (key === evictCursor) started = true;
        else continue;
      }
      const active = ts.filter((t) => now - t < RATE_WINDOW_MS);
      if (active.length === 0) {
        rateBuckets.delete(key);
      } else {
        rateBuckets.set(key, active); // compact timestamps
      }
      evicted++;
      if (evicted >= RATE_EVICT_BATCH) {
        evictCursor = key;
        return false;
      }
    }
    evictCursor = undefined; // wrapped around
  }

  return false;
}

/** Max request body size for subscribe endpoint (2 KB). */
const SUBSCRIBE_MAX_BODY = 2048;

export async function handleSubscribe(request: Request, env: PagesEnv): Promise<Response> {
  // Rate limit by Cloudflare's trusted client IP header only
  const clientIp = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (isRateLimited(clientIp)) {
    return Response.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  // Reject requests without Content-Length to prevent chunked transfer abuse
  const contentLength = request.headers.get('Content-Length');
  if (!contentLength) {
    return Response.json({ success: false, error: 'Content-Length required.' }, { status: 411 });
  }
  if (parseInt(contentLength, 10) > SUBSCRIBE_MAX_BODY) {
    return Response.json({ success: false, error: 'Payload too large.' }, { status: 413 });
  }

  try {
    const rawText = await request.text();
    if (rawText.length > SUBSCRIBE_MAX_BODY) {
      return Response.json({ success: false, error: 'Payload too large.' }, { status: 413 });
    }

    const body = JSON.parse(rawText) as { email?: string };
    const email = typeof body?.email === 'string' ? body.email.trim() : '';

    if (!email) {
      return Response.json({ success: false, error: 'Email is required.' }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
      return Response.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }
    if (email.length > 254) {
      return Response.json(
        { success: false, error: 'Email address is too long.' },
        { status: 400 }
      );
    }

    // Persist to D1 if available (graceful fallback if DB not provisioned).
    // Data-at-rest doctrine (A-5): subscribers.email is NEVER stored plaintext
    // (migration 0071). We store two derived columns, mirroring email_signups:
    //   - email_hash: peppered HMAC-SHA256 (dedup UNIQUE + erasure lookup key)
    //   - email_encrypted: AES-GCM ciphertext so admin can read it back
    // OSE-207: ip_hash replaces the raw ip_address column (migration 0028).
    //   - hashIpForSubscribe returns null if env.IP_HASH_PEPPER is unset;
    //     null is stored as NULL — never the raw IP.
    //   - A structured warning is emitted when the pepper is missing so
    //     ops can detect the misconfiguration.
    let persisted = false;
    if (env.DB) {
      // A-5: never fall back to plaintext. Without the encryption key we cannot
      // store the email at rest safely — refuse (mirror the email-signup 503).
      if (!env.FORMS_ENCRYPTION_KEY) {
        return Response.json(
          { success: false, error: 'Subscriptions are temporarily unavailable.' },
          { status: 503 }
        );
      }
      try {
        const ipHash = await hashIpForSubscribe(clientIp, env.IP_HASH_PEPPER);
        if (!env.IP_HASH_PEPPER) {
          console.warn(
            JSON.stringify({
              type: 'SUBSCRIBE_IP_HASH_PEPPER_MISSING',
              note: 'IP abuse signal disabled. Set wrangler secret IP_HASH_PEPPER.',
            })
          );
        }
        // WRITE path — never silently degrade to bare SHA-256 for the dedup key
        // (requirePepper throws if FORMS_HASH_PEPPER is unset; caught below).
        const emailHash = await hashEmail(email, env.FORMS_HASH_PEPPER, { requirePepper: true });
        const emailEncrypted = await encryptText(email, env.FORMS_ENCRYPTION_KEY);
        await env.DB.prepare(
          'INSERT INTO subscribers (email_hash, email_encrypted, ip_hash, source) VALUES (?, ?, ?, ?) ON CONFLICT (email_hash) DO NOTHING'
        )
          .bind(emailHash, emailEncrypted, ipHash, 'landing')
          .run();
        persisted = true;
      } catch (dbErr) {
        // Log but don't fail the request — email capture is best-effort in Phase 1
        console.error(
          JSON.stringify({
            type: 'SUBSCRIBE_DB_ERROR',
            error: dbErr instanceof Error ? dbErr.message : String(dbErr),
          })
        );
      }
    }

    return Response.json({ success: true, persisted });
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }
}

// ─── Landing page (supply side) — OSE-1312 ────────────────────────────────────
//
// The landing page is the SUPPLY side: two doors + an area view of what's coming
// together nearby + a never-who panel that is TRUE of this page (no cookies, no
// analytics, no geolocation). The area view is server-rendered and filtered with
// CSS-only radios (renderLandingArea), so nothing about the viewer is stored or
// sent — the page keeps the promise it prints.
//
// Data-driven as of slice 2: reads events through the SAME DataProvider seam +
// enrichWithPhase as `GET /api/v2/events` and handlePublicPage, so the landing
// area and the JSON API cannot describe different events. A read failure renders
// the empty area (facilitation surface: nothing to show is a normal state, not a
// 500), never a broken page.
type LandingEnv = PagesEnv & DataProviderEnv;

export async function handleLandingPage(
  env: PagesEnv,
  ctx?: DataProviderCtx | null
): Promise<Response> {
  let area;
  try {
    const dp = getDataProvider(env as LandingEnv, ctx ?? null);
    const result = await dp.listEvents('root');
    const items = (result.data as unknown as Record<string, unknown>[]).map(enrichWithPhase);
    area = renderLandingArea(items as LandingAreaItem[]);
  } catch {
    area = renderEmptyLandingArea();
  }
  return html(injectLandingArea(injectLegalFooter(LANDING_HTML, 'landing'), area));
}

// ─── Display page (TV / kiosk) ──────────────────────────────────────────────────

// ─── Poster page (printable) ────────────────────────────────────────────────────

// ─── Shared report page ─────────────────────────────────────────────────────────

export async function handleDisplayPage(env: PagesEnv): Promise<Response> {
  return html(await withProvenanceBanner(DISPLAY_HTML, env, 'display'));
}

export async function handlePosterPage(env: PagesEnv, request?: Request): Promise<Response> {
  // OSE-310 Phase 1: format-aware rendering for the Poster Family.
  // Look up the format from the request pathname (path-aliased
  // registry) and attach data-poster-format to the body so future
  // format-specific CSS can target via [data-poster-format=...].
  // Backwards-compatible: /poster + /posters render the letter
  // format with no visible change vs the pre-OSE-310 output.
  let posterCode = DEFAULT_POSTER_CODE;
  if (request) {
    try {
      const { pathname } = new URL(request.url);
      posterCode = posterProductForPath(pathname).code;
    } catch {
      // Malformed URL — fall through to default letter.
    }
  }
  const content = POSTER_HTML.replace('<body>', `<body data-poster-format="${posterCode}">`);
  return html(injectProvenanceBanner(content, await resolveAndSignalProvenance(env, 'poster')));
}

export async function handleSharedReportPage(env: PagesEnv): Promise<Response> {
  // Inject data-maps-configured so client-side JS knows whether to render
  // map thumbnails via the /api/v2/maps/venue-image proxy endpoint.
  const mapsAttr = isGoogleMapsConfigured(env) ? ' data-maps-configured="1"' : '';
  const content = injectLegalFooter(
    SHARED_REPORT_HTML.replace('<body>', `<body${mapsAttr}>`),
    'shared-report'
  );
  return html(
    injectProvenanceBanner(content, await resolveAndSignalProvenance(env, 'sharedReport'))
  );
}

// ─── /ui-preview — component showcase for Claude Design ───────────────────────

import { styleTag, formInput, textarea, formSelect, checkbox, radioGroup } from '@ocr/ui';

/**
 * Self-contained component showcase. Renders every @ocr/ui class in both
 * light and dark themes with explicit [data-theme] selectors, so Claude Design
 * can inspect actual rendering, token application, and interactive states.
 *
 * No auth required — design tokens are not sensitive. No D1 queries.
 */
const TOKEN_SWATCHES = [
  ['--bg', 'var(--bg)'],
  ['--surface', 'var(--surface)'],
  ['--border', 'var(--border)'],
  ['--text', 'var(--text)'],
  ['--text-muted', 'var(--text-muted)'],
  ['--accent', 'var(--accent)'],
  ['--accent-hover', 'var(--accent-hover)'],
  ['--live', 'var(--live)'],
  ['--danger', 'var(--danger)'],
  ['--error', 'var(--error)'],
  ['--surface-hover', 'var(--surface-hover)'],
]
  .map(
    ([name, color]) =>
      `<div class="token-swatch"><div class="token-color" style="background:${color}"></div><div class="token-name">${name}</div></div>`
  )
  .join('\n        ');

export function handleUiPreview(): Response {
  const css = styleTag();

  const FORM_PARTIALS_HTML = [
    formInput({ id: 'pv-name', label: 'Full name', placeholder: 'Jane Smith', required: true }),
    formInput({
      id: 'pv-email',
      label: 'Email',
      type: 'email',
      hint: 'We will never share your email.',
    }),
    formInput({
      id: 'pv-err',
      label: 'Email (error state)',
      type: 'email',
      value: 'bad@@email',
      error: 'Enter a valid email address.',
    }),
    textarea({ id: 'pv-bio', label: 'Bio', placeholder: 'Tell us about yourself…', rows: 3 }),
    formSelect({
      id: 'pv-tier',
      label: 'Tier',
      options: [
        { value: '', label: 'Select a tier' },
        { value: 'free', label: 'Free' },
        { value: 'pro', label: 'Pro', selected: true },
        { value: 'enterprise', label: 'Enterprise' },
      ],
    }),
    checkbox({ id: 'pv-agree', label: 'I agree to the terms and conditions' }),
    radioGroup({
      name: 'pv-size',
      legend: 'Event size',
      options: [
        { value: 'small', label: 'Under 50 attendees' },
        { value: 'medium', label: '50 – 200 attendees', checked: true },
        { value: 'large', label: 'Over 200 attendees' },
      ],
    }),
  ].join('\n');

  const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>@ocr/ui — Component Preview</title>
  ${css}
  <style>
    .preview-root { max-width: 960px; margin: 0 auto; padding: 2rem 1rem 6rem; }
    /* Renamed from .preview-section (OSE-1236).
       @ocr/ui's stylesheet hides .preview-section, .progress-section and
       .result-section by default as part of its FILE-UPLOAD family: a CSV
       import preview revealed by adding .visible. This page reused the name
       for "component preview section" and never adds .visible, so every
       section on the showcase was display:none. The page served 40KB of
       markup and rendered an h1 and nothing else.

       The showcase is the newcomer, so the showcase renames. Caught by the
       mobile-workability audit's above-the-fold contract once it ran against
       PR code: btn-primary-demo had no bounding box. */
    .ui-preview-section { margin-bottom: 3rem; }
    .ui-preview-section h2 { font-size: .7rem; text-transform: uppercase; letter-spacing: .12em; color: var(--text-muted); margin-bottom: 1rem; padding-bottom: .5rem; border-bottom: 1px solid var(--border); }
    .preview-row { display: flex; flex-wrap: wrap; gap: .75rem; align-items: flex-start; margin-bottom: .75rem; }
    .preview-label { font-size: .65rem; color: var(--text-muted); margin-bottom: .25rem; }
    .theme-bar { position: sticky; top: 0; z-index: 100; background: var(--surface); border-bottom: 1px solid var(--border); padding: .75rem 1rem; display: flex; gap: .5rem; align-items: center; }
    .theme-bar span { font-size: .75rem; color: var(--text-muted); margin-right: .5rem; }
    .token-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: .5rem; }
    .token-swatch { border-radius: var(--radius-sm); overflow: hidden; border: 1px solid var(--border); }
    .token-color { height: 40px; }
    .token-name { font-size: .6rem; padding: .25rem .5rem; color: var(--text-muted); font-family: monospace; background: var(--surface); }
  </style>
</head>
<body>
  <div class="theme-bar" data-testid="theme-bar">
    <span>Theme:</span>
    <button class="btn btn-secondary" onclick="document.documentElement.removeAttribute('data-theme')" data-testid="theme-auto">Auto</button>
    <button class="btn btn-secondary" onclick="document.documentElement.setAttribute('data-theme','light')" data-testid="theme-light">Light</button>
    <button class="btn btn-secondary" onclick="document.documentElement.setAttribute('data-theme','dark')" data-testid="theme-dark">Dark</button>
  </div>
  <div class="preview-root">
    <h1 style="margin-bottom:2rem">@ocr/ui Component Preview</h1>

    <div class="ui-preview-section" data-testid="preview-section-buttons">
      <h2>Buttons</h2>
      <div class="preview-row">
        <div><div class="preview-label">.btn-primary</div><button class="btn btn-primary" data-testid="btn-primary-demo">Save</button></div>
        <div><div class="preview-label">.btn-secondary</div><button class="btn btn-secondary" data-testid="btn-secondary-demo">Cancel</button></div>
        <div><div class="preview-label">.btn-danger</div><button class="btn btn-danger" data-testid="btn-danger-demo">Delete</button></div>
        <div><div class="preview-label">.btn-link</div><button class="btn btn-link" data-testid="btn-link-demo">More info</button></div>
        <div><div class="preview-label">.attr-btn</div><button class="attr-btn" data-testid="attr-btn-demo">Attribution</button></div>
        <div><div class="preview-label">disabled</div><button class="btn btn-primary" disabled data-testid="btn-disabled-demo">Disabled</button></div>
      </div>
      <div class="preview-row">
        <div style="width:100%"><div class="preview-label">.btn-block</div><button class="btn btn-primary btn-block" data-testid="btn-block-demo">Full width</button></div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-cards">
      <h2>Cards</h2>
      <div class="preview-row">
        <div style="width:220px"><div class="preview-label">.card</div>
          <div class="card" data-testid="card-demo"><div class="item-name">Eagles Hall</div><div class="item-sub">Chicago, IL</div></div>
        </div>
        <div><div class="preview-label">.stat-card</div>
          <div class="stat-card" data-testid="stat-card-demo"><div class="stat-value">142</div><div class="stat-label">Attendees</div></div>
        </div>
        <div style="width:220px"><div class="preview-label">.track-card</div>
          <div class="track-card" data-testid="track-card-demo">
            <div class="track-art" style="width:48px;height:48px;background:var(--accent);border-radius:var(--radius-sm);flex-shrink:0"></div>
            <div class="item-info"><div class="item-name">Song Title</div><div class="item-sub">Artist Name</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-inputs">
      <h2>Inputs</h2>
      <div class="preview-row">
        <div style="width:240px"><div class="preview-label">.input</div><input class="input" placeholder="Enter value…" data-testid="input-demo" /></div>
        <div style="width:240px"><div class="preview-label">.search-bar</div><input class="search-bar" placeholder="Search…" data-testid="search-bar-demo" /></div>
        <div style="width:200px"><div class="preview-label">.sort-select</div>
          <select class="sort-select" data-testid="sort-select-demo"><option>Most recent</option><option>Oldest first</option></select>
        </div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-navigation">
      <h2>Navigation</h2>
      <div class="preview-label">.bottom-nav (simulated — fixed in real use)</div>
      <nav style="position:relative;border-radius:var(--radius)" data-testid="nav-demo">
        <div style="display:flex;gap:0;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden">
          <a class="nav-item active" href="#" style="position:relative;flex:1" onclick="return false">🏠<span>Home</span></a>
          <a class="nav-item" href="#" style="flex:1" onclick="return false">📊<span>Stats</span></a>
          <a class="nav-item" href="#" style="flex:1" onclick="return false">🎵<span>Music</span></a>
          <a class="nav-item" href="#" style="flex:1" onclick="return false">👤<span>Profile</span></a>
        </div>
      </nav>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-feedback">
      <h2>Status / Feedback</h2>
      <div class="preview-row">
        <div><div class="preview-label">.live-indicator.on</div><span class="live-indicator on" data-testid="live-indicator-on">Live</span></div>
        <div><div class="preview-label">.live-indicator.off</div><span class="live-indicator off" data-testid="live-indicator-off">Offline</span></div>
        <div><div class="preview-label">.live-badge</div><span class="live-badge" data-testid="live-badge-demo">● LIVE</span></div>
        <div><div class="preview-label">.spinner</div><div class="spinner" data-testid="spinner-demo"></div></div>
        <div><div class="preview-label">.error-banner.visible</div><div class="error-banner visible" data-testid="error-banner-demo">Something went wrong. Please try again.</div></div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-lists">
      <h2>Lists</h2>
      <div style="max-width:360px" data-testid="list-demo">
        <div class="preview-label">.list-item</div>
        <div class="list-item"><div class="list-name">Eagles Hall Opener</div><div class="list-sub">Chicago · Fri 7pm</div><div class="list-count">142</div></div>
        <div class="list-item"><div class="list-name">Sunday Session</div><div class="list-sub">Detroit · Sun 4pm</div><div class="list-count">87</div></div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-chips">
      <h2>Chips / Tags</h2>
      <div class="preview-row">
        <div><div class="preview-label">.filter-chip</div><button class="filter-chip" data-testid="filter-chip-demo">All</button></div>
        <div><div class="preview-label">.filter-chip.active</div><button class="filter-chip active" data-testid="filter-chip-active-demo">Jazz</button></div>
        <div><div class="preview-label">.genre-tag</div><span class="genre-tag" data-testid="genre-tag-demo">House</span></div>
        <div><div class="preview-label">.meta-badge</div><span class="meta-badge" data-testid="meta-badge-demo">New</span></div>
        <div><div class="preview-label">.meta-badge.high</div><span class="meta-badge high" data-testid="meta-badge-high-demo">Featured</span></div>
        <div><div class="preview-label">.user-badge</div><span class="user-badge" data-testid="user-badge-demo">DJ Kai</span></div>
        <div><div class="preview-label">.source-badge</div><span class="source-badge" data-testid="source-badge-demo">Spotify</span></div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-empty-state">
      <h2>Empty State</h2>
      <div class="empty-state" data-testid="empty-state-demo">
        <div class="es-icon">📭</div>
        <h3>No events yet</h3>
        <p>Events you create will appear here.</p>
        <a class="btn btn-primary" href="#" onclick="return false">Create event</a>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-form-controls">
      <h2>Form controls</h2>
      <div class="preview-row" style="align-items:center">
        <div><div class="preview-label">.toggle-row</div>
          <div class="toggle-row" data-testid="toggle-row-demo">
            <span>Enable feature</span>
            <label class="toggle"><input type="checkbox" checked /><span class="toggle-track"></span></label>
          </div>
        </div>
        <div style="width:240px"><div class="preview-label">.progress-bar</div>
          <div class="progress-bar" style="--pct:65%" data-testid="progress-bar-demo"><div class="bar-fill" style="width:65%"></div></div>
        </div>
      </div>
      <div class="preview-row">
        <div style="width:300px"><div class="preview-label">.result-success</div>
          <div class="result-success" data-testid="result-success-demo">Registration confirmed! See you there.</div>
        </div>
        <div style="width:300px"><div class="preview-label">.result-error</div>
          <div class="result-error" data-testid="result-error-demo">That email is already registered.</div>
        </div>
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-form-partials">
      <h2>Form partials — @ocr/ui</h2>
      <div style="max-width:480px">
        ${FORM_PARTIALS_HTML}
      </div>
    </div>

    <div class="ui-preview-section" data-testid="preview-section-tokens">
      <h2>Design tokens — Tier 2 semantic</h2>
      <div class="token-grid">
        ${TOKEN_SWATCHES}
      </div>
    </div>
  </div>
</body>
</html>`;
  return html(content);
}
