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
import { computeEventPhase } from '../domain/event-phase';
import { DEFAULT_POSTER_CODE, posterProductForPath } from '../lib/poster-products';

// Page shells extracted to template files (Wrangler [[rules]] type="Text").
import PUBLIC_HTML from '../templates/public.html';
import ADMIN_HTML from '../templates/admin.html';
import LANDING_HTML from '../templates/landing.html';
import ADMIN_SIGNIN_HTML from '../templates/admin-signin.html';
import DISPLAY_HTML from '../templates/display.html';
import POSTER_HTML from '../templates/poster.html';
import SHARED_REPORT_HTML from '../templates/shared-report.html';

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
    'Content-Type': 'text/html; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self'`,
  };
}

/**
 * Serve an HTML page with nonce-based CSP.
 * Replaces `<script` with `<script nonce="..."` so inline scripts are allowed
 * only for this specific response.
 */
function html(content: string, status = 200): Response {
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
function renderErrorPage(
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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} – OurSharedEvents</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f8f9fa; color: #212529; min-height: 100vh; display: flex; flex-direction: column; }
    header { background: #1a1a2e; color: #fff; padding: 1.25rem 2rem; }
    /* OSE-308: both anchors are primary action targets on the
       error-page recovery flow. Per WCAG 2.5.5 Level AAA + invariant 14
       refined contract, they must meet the 44x44 floor. Using
       inline-flex + align-items: center vertically centers the text
       inside the 44px box without misaligning the visual baseline. */
    header a { color: #fff; text-decoration: none; font-size: 1.1rem; font-weight: 600; display: inline-flex; align-items: center; min-height: 44px; padding: 0 .5rem; }
    main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem 1.5rem; text-align: center; }
    .error-status { font-size: .8rem; color: #6c757d; text-transform: uppercase; letter-spacing: .12em; margin-bottom: .75rem; }
    .error-title { font-size: 1.75rem; font-weight: 700; color: #1a1a2e; margin-bottom: 1rem; max-width: 520px; }
    .error-body { font-size: 1rem; color: #495057; max-width: 520px; line-height: 1.5; margin-bottom: 1.75rem; }
    .error-cta { display: inline-flex; align-items: center; min-height: 44px; line-height: 1.5; padding: .65rem 1.25rem; background: #1a1a2e; color: #fff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: .95rem; }
    .error-cta:hover { background: #0f0f1a; }
    .error-cta:focus-visible { outline: 2px solid #4361ee; outline-offset: 2px; }
    footer { padding: 1rem 2rem; text-align: center; font-size: .8rem; color: #6c757d; }
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

export function handlePublicPage(_env: PagesEnv): Response {
  return html(PUBLIC_HTML);
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
}

interface PublicEventRow {
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
  lat: number | null;
  lon: number | null;
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
function renderPreEventHtml(row: PublicEventRow, shareUrl: string): string {
  const title = esc(row.title);
  const whatShort = esc(row.what_short);
  const whoHost = esc(row.who_host);
  const whyPurpose = esc(row.why_purpose);
  const howDetails = esc(row.how_details);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location);
  const startHuman = formatHumanDate(row.start_date);
  const venueParam = encodeURIComponent(row.location || row.where_address || '');
  const mapImg = venueParam
    ? `<img src="/api/v2/maps/venue-image?venue=${venueParam}" alt="Map of ${esc(row.location || row.where_address)}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="venue-map" />`
    : '';
  const gmapsLink = venueParam
    ? `<a class="ose-gmaps-link" data-testid="gmaps-link" href="https://www.google.com/maps/search/?api=1&query=${venueParam}" target="_blank" rel="noopener noreferrer">See on Google Maps</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${whatShort}" />
  <meta property="og:url" content="${esc(shareUrl)}" />
  <meta property="og:type" content="event" />
  <meta name="twitter:card" content="summary_large_image" />
  <style>
    :root { --ose-bg: #faf7f2; --ose-text: #2a2a2a; --ose-muted: #5a5a5a; --ose-accent: #4361ee; --ose-card: #fff; }
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
    .ose-skip:focus { left: 1rem; top: 1rem; background: var(--ose-accent); color: #fff; padding: 0.5rem 1rem; border-radius: 4px; }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-meta { color: var(--ose-muted); font-size: 0.95rem; margin-bottom: 1.5rem; }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-gmaps-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; }
    .ose-gmaps-link:hover { text-decoration: underline; }
    .ose-rsvp-btn { display: inline-block; background: var(--ose-accent); color: #fff; padding: 0.75rem 1.5rem; border-radius: 6px; text-decoration: none; font-weight: 600; margin: 1.25rem 0; min-height: 44px; line-height: 1.5; }
    .ose-rsvp-btn:focus { outline: 3px solid #ffb800; outline-offset: 2px; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: rgba(67, 97, 238, 0.06); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
    .ose-section p { margin: 0; }
  </style>
</head>
<body>
  <a href="#main" class="ose-skip">Skip to event content</a>
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main">
    <header data-testid="event-header">
      <h1 id="event-title" data-testid="event-title">${title}</h1>
      ${startHuman ? `<p class="ose-meta" data-testid="event-when">${esc(startHuman)}${row.timezone ? ` &middot; ${esc(row.timezone)}` : ''}</p>` : ''}
    </header>

    ${
      whatShort
        ? `<section class="ose-card ose-section" data-testid="event-what" aria-labelledby="what-heading">
           <h2 id="what-heading">What</h2>
           <p>${whatShort}</p>
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
           ${gmapsLink}
         </section>`
        : ''
    }

    ${
      whoHost
        ? `<section class="ose-card ose-section" data-testid="event-who" aria-labelledby="who-heading">
           <h2 id="who-heading">Who</h2>
           <p>${whoHost}</p>
         </section>`
        : ''
    }

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

    <a class="ose-rsvp-btn" data-testid="event-rsvp" href="/forms/${esc(row.id)}?type=register">RSVP for this event</a>

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
function renderEventLiveHtml(row: PublicEventRow, shareUrl: string): string {
  const title = esc(row.title);
  const whatShort = esc(row.what_short);
  const whoHost = esc(row.who_host);
  const whyPurpose = esc(row.why_purpose);
  const howDetails = esc(row.how_details);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location);
  const venueParam = encodeURIComponent(row.location || row.where_address || '');
  const mapImg = venueParam
    ? `<img src="/api/v2/maps/venue-image?venue=${venueParam}" alt="Map of ${esc(row.location || row.where_address)}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="venue-map-live" />`
    : '';
  const gmapsLink = venueParam
    ? `<a class="ose-gmaps-link" data-testid="gmaps-link-live" href="https://www.google.com/maps/dir/?api=1&destination=${venueParam}" target="_blank" rel="noopener noreferrer">Navigate now</a>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${whatShort}" />
  <meta property="og:url" content="${esc(shareUrl)}" />
  <meta property="og:type" content="event" />
  <style>
    :root { --ose-bg: #faf7f2; --ose-text: #2a2a2a; --ose-muted: #5a5a5a; --ose-accent: #4361ee; --ose-card: #fff; --ose-live: #d63b3b; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
    /* OSE-298 DRAIN 5/7: defensive horizontal-scroll guard for the
       public event page (live phase mirror of renderPreEventHtml). */
    html, body { overflow-x: hidden; }
    body { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; overflow-wrap: anywhere; word-break: break-word; }
    .ose-skip { position: absolute; left: -9999px; }
    .ose-skip:focus { left: 1rem; top: 1rem; background: var(--ose-accent); color: #fff; padding: 0.5rem 1rem; border-radius: 4px; }
    .ose-live-badge { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--ose-live); color: #fff; padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; }
    .ose-live-dot { width: 0.6rem; height: 0.6rem; background: #fff; border-radius: 50%; animation: ose-pulse 1.5s ease-in-out infinite; }
    @keyframes ose-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-gmaps-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; }
    .ose-gmaps-link:hover { text-decoration: underline; }
    .ose-checkin-btn { display: inline-block; background: var(--ose-accent); color: #fff; padding: 0.875rem 1.75rem; border-radius: 6px; text-decoration: none; font-weight: 700; margin: 1.25rem 0; font-size: 1.05rem; min-height: 44px; line-height: 1.5; }
    .ose-checkin-btn:focus { outline: 3px solid #ffb800; outline-offset: 2px; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: rgba(67, 97, 238, 0.06); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
    .ose-section p { margin: 0; }
  </style>
</head>
<body>
  <a href="#main" class="ose-skip">Skip to event content</a>
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main-live">
    <header data-testid="event-header-live">
      <span class="ose-live-badge" data-testid="event-live-badge" aria-label="Event is live now">
        <span class="ose-live-dot" aria-hidden="true"></span>Live now
      </span>
      <h1 id="event-title" data-testid="event-title-live">${title}</h1>
    </header>

    <a class="ose-checkin-btn" data-testid="event-checkin" href="/forms/${esc(row.id)}?type=checkin">Check in at this event</a>

    ${
      whatShort
        ? `<section class="ose-card ose-section" data-testid="event-what-live" aria-labelledby="what-heading-live">
           <h2 id="what-heading-live">What</h2>
           <p>${whatShort}</p>
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
           ${gmapsLink}
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
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 600px; margin: 3rem auto; padding: 1rem; line-height: 1.5; color: #2a2a2a; background: #faf7f2; }
    h1 { font-size: 1.5rem; margin: 0 0 0.5rem; }
    .msg { color: #5a5a5a; font-size: 1.05rem; margin: 0.5rem 0 1.5rem; }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: rgba(67, 97, 238, 0.06); border-left: 3px solid #4361ee; border-radius: 4px; font-size: 0.9rem; color: #5a5a5a; }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: #2a2a2a; }
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
function renderPostEventHtml(
  row: PublicEventRow,
  shareUrl: string,
  nextEvent: NextEventRow | null
): string {
  const title = esc(row.title);
  const whatShort = esc(row.what_short);
  const whoHost = esc(row.who_host);
  const whyPurpose = esc(row.why_purpose);
  const venueDisplay = esc(row.location) || esc(row.where_address);
  const whenHuman = formatHumanDate(row.start_date);

  const nextCard = nextEvent
    ? `<section class="ose-card ose-next" data-testid="next-event-card" aria-labelledby="next-heading">
        <h2 id="next-heading">Next at ${venueDisplay || 'this venue'}</h2>
        <p class="ose-next-title" data-testid="next-event-title">${esc(nextEvent.title)}</p>
        <p class="ose-next-when" data-testid="next-event-when">${formatHumanDate(nextEvent.start_date)}</p>
        <a class="ose-cta" data-testid="next-event-link" href="/events/${esc(nextEvent.id)}">See details</a>
      </section>`
    : `<section class="ose-card ose-next" data-testid="next-event-fallback" aria-labelledby="next-heading">
        <h2 id="next-heading">The corridor keeps going</h2>
        <p>More gatherings are always coming together nearby.</p>
        <a class="ose-cta" data-testid="browse-events-link" href="/public">See what's coming up</a>
      </section>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — recap</title>
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${whatShort}" />
  <meta property="og:url" content="${esc(shareUrl)}" />
  <meta property="og:type" content="event" />
  <meta name="twitter:card" content="summary" />
  <style>
    :root { --ose-bg: #faf7f2; --ose-text: #2a2a2a; --ose-muted: #5a5a5a; --ose-accent: #4361ee; --ose-card: #fff; }
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
    .ose-cta { display: inline-block; min-height: 44px; line-height: 44px; padding: 0 20px; background: var(--ose-accent); color: #fff; border-radius: 6px; text-decoration: none; font-weight: 600; }
    .ose-cta.ose-cta-secondary { background: transparent; color: var(--ose-accent); border: 1px solid var(--ose-accent); }
    .ose-anonymity { margin-top: 2rem; padding: 1rem 1.25rem; background: rgba(67, 97, 238, 0.06); border-left: 3px solid var(--ose-accent); border-radius: 4px; font-size: 0.9rem; color: var(--ose-muted); }
    .ose-anonymity h2 { margin-top: 0; font-size: 1rem; color: var(--ose-text); }
    .ose-anonymity p { margin: 0; }
  </style>
</head>
<body>
  <main role="main" aria-labelledby="event-title-post" data-testid="event-main-post">
    <span class="ose-phase-chip" data-testid="event-phase-chip">This one's a wrap</span>
    <h1 id="event-title-post" data-testid="event-title-post">${title}</h1>
    <p class="ose-when" data-testid="event-when-post">${whenHuman ? `Happened ${whenHuman}` : 'This event has ended.'}${venueDisplay ? ` &middot; ${venueDisplay}` : ''}</p>

    <section class="ose-card" data-testid="event-recap-card" aria-labelledby="recap-heading">
      <h2 id="recap-heading">What this was</h2>
      ${whatShort ? `<p class="ose-recap-row" data-testid="recap-what">${whatShort}</p>` : ''}
      ${whoHost ? `<p class="ose-recap-row" data-testid="recap-who"><span class="ose-recap-label">Hosted by</span>${whoHost}</p>` : ''}
      ${whyPurpose ? `<p class="ose-recap-row" data-testid="recap-why"><span class="ose-recap-label">Why it exists</span>${whyPurpose}</p>` : ''}
    </section>

    ${nextCard}

    <section class="ose-card" data-testid="stay-connected-card" aria-labelledby="connect-heading">
      <h2 id="connect-heading">Hear about the next one</h2>
      <p>One email when something's coming up. Nothing else.</p>
      <a class="ose-cta ose-cta-secondary" data-testid="email-signup-link" href="/forms/${esc(row.id)}?type=email">Keep me posted</a>
    </section>

    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
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
              lat, lon
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
  const url = new URL(request.url);
  const shareUrl = `${url.origin}/events/${row.id}`;

  let body: string;
  if (phase === 'pre_event') {
    body = renderPreEventHtml(row, shareUrl);
  } else if (phase === 'event') {
    body = renderEventLiveHtml(row, shareUrl);
  } else {
    // post_event: real recap + return loop (OSE-245 ose-client-ready package).
    // renderMinimalPhaseHtml is kept as the defensive fallback for phase==='event'
    // only — do NOT delete (Invariant #10 deprecation_lock).
    let nextEvent: NextEventRow | null = null;
    try {
      if (row.location) {
        nextEvent = await env.DB.prepare(
          `SELECT id, title, start_date, location FROM events
           WHERE status = 'active' AND location = ?1 AND id != ?2
             AND start_date IS NOT NULL AND datetime(start_date) > datetime('now')
           ORDER BY datetime(start_date) ASC LIMIT 1`
        )
          .bind(row.location, row.id)
          .first<NextEventRow>();
      }
    } catch {
      nextEvent = null; // recap must render even if the lookup fails
    }
    body = renderPostEventHtml(row, shareUrl, nextEvent ?? null);
  }

  return new Response(body, {
    status: 200,
    headers: securityHeaders(nonce),
  });
}

export function handleAdminPage(_env: PagesEnv): Response {
  return html(ADMIN_HTML);
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
  return html(ADMIN_SIGNIN_HTML, 401);
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
    // OSE-207: ip_hash replaces the raw ip_address column (migration 0028).
    //   - hashIpForSubscribe returns null if env.IP_HASH_PEPPER is unset;
    //     null is stored as NULL — never the raw IP.
    //   - A structured warning is emitted when the pepper is missing so
    //     ops can detect the misconfiguration.
    let persisted = false;
    if (env.DB) {
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
        await env.DB.prepare(
          'INSERT INTO subscribers (email, ip_hash, source) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING'
        )
          .bind(email, ipHash, 'landing')
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

export function handleLandingPage(_env: PagesEnv): Response {
  return html(LANDING_HTML);
}

// ─── Display page (TV / kiosk) ──────────────────────────────────────────────────

// ─── Poster page (printable) ────────────────────────────────────────────────────

// ─── Shared report page ─────────────────────────────────────────────────────────

export function handleDisplayPage(_env: PagesEnv): Response {
  return html(DISPLAY_HTML);
}

export function handlePosterPage(_env: PagesEnv, request?: Request): Response {
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
  return html(content);
}

export function handleSharedReportPage(env: PagesEnv): Response {
  // Inject data-maps-configured so client-side JS knows whether to render
  // map thumbnails via the /api/v2/maps/venue-image proxy endpoint.
  const mapsAttr = isGoogleMapsConfigured(env) ? ' data-maps-configured="1"' : '';
  const content = SHARED_REPORT_HTML.replace('<body>', `<body${mapsAttr}>`);
  return html(content);
}
