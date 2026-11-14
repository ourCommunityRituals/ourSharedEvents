/**
 * HTML page handler.
 *
 * Serves the public listing page and admin dashboard.
 * HTML is embedded as template strings so the Worker is fully self-contained.
 *
 * Firebase Hosting migration (Phase 3, Track B):
 *   Replace the embedded strings with a fetch() call to Firebase Hosting URL.
 */

import { fetchNextEventsAtVenue, MAX_NEXT_AT_VENUE, type NextEventRow } from '../lib/next-at-venue';
import { isGoogleMapsConfigured } from '../lib/maps';
import { HARDENING_HEADERS, LANDING_PERMISSIONS_POLICY } from '../lib/security-headers';
import { jsonForScript } from '../lib/html-escape';
import { isValidDeploymentId } from '../lib/form-validation';
import { publicEventCacheControl } from '../lib/phase-cache';
import { renderGeoLink } from '../lib/geo-link';
import { renderEventNav } from '../lib/event-nav';
import { formatEventPrice } from '../lib/event-price';
import { validateLogoUrl } from '../lib/sponsor-logo';
import { sponsorTitle, sponsorCardPath } from '../lib/sponsor-card';
import { fetchSponsorTitles } from '../lib/sponsor-titles';
import { PLACEMENT_EVENT_USES_SPONSORS_SQL } from '../lib/sponsor-card';
import { DEFAULT_POSTER_CODE, posterProductForPath } from '../lib/poster-products';
import { hashEmail, encryptText } from '../lib/pii';
import { guardTurnstile, type TurnstileEnv } from '../lib/turnstile';

// Page shells extracted to template files (Wrangler [[rules]] type="Text").
import PUBLIC_HTML from '../templates/public.html';
import ADMIN_HTML from '../templates/admin.html';
import LANDING_HTML from '../templates/landing.html';
import { readLatches } from '../lib/corridor-latch';
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
  injectNeverWho,
  renderNeverWho,
  NEVER_WHO_CSS,
  NEVER_WHO_CSS_MARKER,
  NEVER_WHO_MARKER,
} from '../lib/never-who';
import { BACK_BUTTON_CSS, renderBackButton } from '../lib/back-button';
import { DEFAULT_LANG, DIRECTION, OG_LOCALE, type Lang } from '../lib/i18n/languages';
import { fmt, msg, msgAll, WHAT_TYPES } from '../lib/i18n/catalog';
import { isolateTyped } from '../lib/i18n/bidi';
import { resolveLanguage } from '../lib/i18n/resolve-language';
import { languageAlternates, withLangPrefix } from '../lib/i18n/path-prefix';
import { LANGUAGE_SWITCH_CSS, renderLanguageSwitch } from '../lib/i18n/language-switch';
import { LANGUAGE_MENU_CSS, renderLanguageMenu } from '../lib/i18n/language-menu';
import {
  parseDiscoveryFilters,
  type DiscoveryFilters,
  applyDiscoveryFilters,
  renderDiscoveryFilters,
  injectDiscoveryFilters,
  discoveryEmptyCopy,
  injectDiscoveryHeading,
  discoverySummaryText,
} from '../lib/event-discovery';
import {
  renderEventList,
  renderEventListError,
  injectEventList,
  injectEventCardCss,
  PLACE_PANEL_CSS,
  type EventListItem,
  type RenderedEventList,
} from '../lib/event-list.js';
import {
  renderLandingArea,
  renderEmptyLandingArea,
  injectLandingArea,
  landingZoom,
  type LandingAreaItem,
} from '../lib/landing-area.js';
import { categoryByTypeId, type TypeCategory } from '../lib/event-type-catalog.js';
import { readEventTypeCatalog } from '../lib/event-type-catalog-read.js';
import { loadStreetLayer, type StreetMapEnv } from '../lib/street-map.js';
import { renderShareButton } from '../lib/share-button.js';
import { fetchPlaceLinks } from '../lib/map-place-links.js';
import {
  readWhere,
  injectWhere,
  injectNearLang,
  renderNearEmpty,
  renderPlaceEmpty,
  renderAnyPlaceEmpty,
  type WhereState,
} from '../lib/landing-where';
import { fillTemplate } from '../lib/i18n/template';
import { inZipOwnArea } from '../lib/zip-areas';
import { inPlaceMatches } from '../lib/place-search';
import {
  getDataProvider,
  type DataProviderEnv,
  type DataProviderCtx,
} from '../lib/data-provider.js';
import { enrichWithPhase, eventPhaseOf } from '../lib/event-enrich.js';
import { attendanceModeLabel, attendanceModeOf, withoutLinkOnly } from '../lib/attendance-mode';
import { archivedBeforeStart } from '../lib/archived-before-start.js';
import { flooredRatePct } from '../lib/count-floor.js';
import { clearsFloor, statLine, walkInStatLine } from '../lib/recap-stat-lines';
import {
  formatEventTime,
  formatHumanDate,
  phaseTimesFor,
  zonedDatePart,
  zoneDisplayName,
} from '../lib/event-datetime.js';
import { renderEventCountdown } from '../lib/event-countdown.js';
import { buildBrandSubscribeLinks, buildGoogleCalendarUrl } from '../lib/calendar-links.js';
import {
  CANONICAL_PATH,
  canonicalLinkTagFor,
  canonicalOrigin,
  eventPagePath,
  eventFormPath,
  injectCanonical,
} from '../lib/canonical.js';
import { errorLabel } from '../lib/error-label';

export interface PagesEnv extends TurnstileEnv {
  WORKER_ENV?: string;
  DB?: D1Database;
  /** Forms database: identified-person tables, including `subscribers` (OSE-1661). */
  FORMS_DB?: D1Database;
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
   * OSE-207 — subscribers TTL retention window in days.
   *
   * Read by phase 4 of the scheduled `runFormDataLifecycle` job in
   * `src/index.ts` (`subscriberRetentionDays`). A whole number from 1 to 90
   * shortens the window; anything else, or unset, means 90 days (owner
   * 2026-10-11). It cannot switch the sweep off.
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
  ctaLabel: string = 'Browse upcoming events',
  // OSE-1519: a page that names a real event is not an error to the reader, so
  // it drops the "Error 4xx" label and may carry a short list of what is next.
  opts: { label?: string | null; extraHtml?: string } = {}
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
  const statusText = opts.label ? esc(opts.label) : 'Error ' + status;
  const statusLine =
    opts.label === null
      ? ''
      : '<p class="error-status" data-testid="error-status">' + statusText + '</p>';
  const content = `<!DOCTYPE html>
<html lang="en" data-surface="ose-error">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeTitle} – OurSharedEvents</title>
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* Colours are @ocr/ui tokens from /ui.css — the page follows the viewer's theme. */
    body { display: flex; flex-direction: column; }
    header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; }
    /* OSE-308: both anchors are primary actions on the error page, so they
       meet the 44x44 floor (WCAG 2.5.5, invariant 14); inline-flex centers. */
    header a { color: var(--text); text-decoration: none; font-size: 1.1rem; font-weight: 600; display: inline-flex; align-items: center; min-height: 44px; padding: 0 .5rem; }
    main { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem 1.5rem; text-align: center; }
    .error-status { font-size: .8rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .12em; margin-bottom: .75rem; }
    .error-title { font-size: 1.75rem; font-weight: 700; color: var(--text); margin-bottom: 1rem; max-width: 520px; }
    .error-body { font-size: 1rem; color: var(--text); max-width: 520px; line-height: 1.5; margin-bottom: 1.75rem; }
    .error-cta { display: inline-flex; align-items: center; min-height: 44px; line-height: 1.5; padding: .65rem 1.25rem; background: var(--accent); color: var(--on-accent); text-decoration: none; border-radius: 6px; font-weight: 600; font-size: .95rem; }
    .error-cta:hover { background: var(--accent-hover); }
    header a:focus-visible, .error-cta:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  </style>
</head>
<body>
  <header data-testid="error-header"><a href="/" data-testid="error-brand">OurSharedEvents</a></header>
  <main data-testid="error-main">
    ${statusLine}
    <h1 class="error-title" data-testid="error-title">${safeTitle}</h1>
    <p class="error-body" data-testid="error-body">${safeBody}</p>
    <a class="error-cta" data-testid="error-cta" href="${safeCtaHref}">${safeCtaLabel}</a>
    ${opts.extraHtml ?? ''}
  </main>
  <!--OCR_LEGAL_FOOTER-->
</body>
</html>`;
  // OSE-1519: the shared footer (© + Browse Events + Privacy), the same partial
  // every other public page uses, instead of a line of its own.
  return html(injectLegalFooter(content, 'error'), status);
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
  request?: Request,
  /** OSE-1762: the language in the address (`/es/events`); it beats the header. */
  pathLang?: Lang
): Promise<Response> {
  const lang = pathLang ?? (request ? preferredLang(request) : DEFAULT_LANG);
  // Attendee discovery (lib/event-discovery): `?when=` (allowlisted) and `?q=`
  // (capped, escaped once) are parsed from the request and applied over the
  // already brand-scoped / active / published projection — never in SQL. The
  // filter bar is server-rendered like the list, so a filtered URL is a link.
  const filters = parseDiscoveryFilters(
    request ? new URL(request.url) : new URL('https://x/events')
  );
  let list: RenderedEventList;
  let shown = 0;
  let wrappedShown = 0;
  let counted = false;
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
    // OSE-2012: an online event is link only, so it is not listed here.
    const items = withoutLinkOnly(result.data as unknown as Record<string, unknown>[]).map(
      enrichWithPhase
    );
    const filtered = applyDiscoveryFilters(items as EventListItem[], filters, undefined, lang);
    shown = filtered.length;
    wrappedShown = filtered.filter((e) => e.phase === 'post_event').length;
    counted = true;
    list =
      filtered.length === 0 && items.length > 0
        ? {
            html: `<p class="empty" data-testid="public-events-empty">${discoveryEmptyCopy(filters, lang)}</p>`,
            countText: '',
            upcoming: 0,
          }
        : renderEventList(filtered, await fetchSponsorTitles((env as PublicListEnv).DB, 'root'), {
            // On the wrapped filter the page heading already says so.
            wrappedHeading: filters.when !== 'past',
            lang,
          });
  } catch {
    list = renderEventListError(lang);
  }
  // OSE-1520: the visible line and the screen-reader count are one sentence.
  // (Left alone for the error and no-events-at-all states: nothing was counted.)
  if (counted) {
    list = { ...list, countText: discoverySummaryText(filters, shown, wrappedShown, lang) };
  }
  // OSE-1762: the shell's words are filled in the page's language first, before
  // anything a visitor typed or an organizer wrote goes into it.
  const shell = injectEventCardCss(
    injectDiscoveryHeading(
      injectNeverWho(
        withLanguageSwitch(
          injectLegalFooter(
            await withProvenanceBanner(fillTemplate(PUBLIC_HTML, lang), env, 'public'),
            'public',
            undefined,
            lang
          ),
          lang,
          CANONICAL_PATH.events,
          discoveryQuery(filters)
        ),
        'events',
        lang
      ),
      filters,
      lang
    )
  );
  // One address per list: ?q= / ?when= variants all point search engines here.
  const withCanonical = injectLanguageHead(
    injectLanguageAlternates(
      injectCanonical(shell, request, env, withLangPrefix(lang, CANONICAL_PATH.events)),
      request,
      env,
      CANONICAL_PATH.events
    ),
    lang
  );
  return languageVaried(
    html(
      injectEventList(
        injectDiscoveryFilters(
          withCanonical,
          renderDiscoveryFilters(filters, shown, wrappedShown, lang)
        ),
        list
      )
    ),
    pathLang
  );
}

/**
 * OSE-1762: the language switch on a shell page, above the never-who disclosure
 * (on the event page it sits above Back, which these pages do not have). Its
 * stylesheet goes in with the disclosure's. `query` is already vetted.
 *
 * The header's Language menu (owner 2026-11-10) goes in at the template's
 * `LANGUAGE_MENU_MARKER`, on the left of the header bar.
 */
function withLanguageSwitch(page: string, lang: Lang, path: string, query: string): string {
  const nav = renderLanguageSwitch({ lang, path, query });
  const menu = renderLanguageMenu({ lang, path, query });
  return page
    .replace(LANGUAGE_MENU_MARKER, () => menu)
    .replace(
      NEVER_WHO_CSS_MARKER,
      () => `${LANGUAGE_SWITCH_CSS}${LANGUAGE_MENU_CSS}\n      ${NEVER_WHO_CSS_MARKER}`
    )
    .replace(NEVER_WHO_MARKER, () => `${nav}\n      ${NEVER_WHO_MARKER}`);
}

/** Where a shell template's header takes the Language menu. */
const LANGUAGE_MENU_MARKER = '<!--OCR_LANGUAGE_MENU-->';

/**
 * The filters a switch carries to the same list in another language: only the
 * window and the search, both already parsed and bounded. `?when=all` is the
 * default and is left out.
 */
function discoveryQuery(f: DiscoveryFilters): string {
  const params = new URLSearchParams();
  if (f.when !== 'all') params.set('when', f.when);
  if (f.q) params.set('q', f.q);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * OSE-1762: the same page in every language, for search engines and link
 * previews, after the canonical link. The bare address is `x-default`.
 */
function injectLanguageAlternates(
  page: string,
  request: Request | undefined,
  env: PagesEnv,
  path: string
): string {
  const origin = canonicalOrigin(request, env);
  const at = page.search(/<\/head>/i);
  if (!origin || at < 0) return page;
  const links = languageAlternates(origin, path)
    .map((alt) => `  <link rel="alternate" hreflang="${alt.hreflang}" href="${esc(alt.href)}" />\n`)
    .join('');
  return page.slice(0, at) + links + page.slice(at);
}

/**
 * OSE-1762: a page in a language other than the default says so to link
 * previews. Open Graph reads a page with no `og:locale` as `en_US`, so the
 * English page, which has never carried one, is left as it is.
 */
function injectLanguageHead(page: string, lang: Lang): string {
  if (lang === DEFAULT_LANG) return page;
  const at = page.search(/<\/head>/i);
  if (at < 0) return page;
  return `${page.slice(0, at)}  <meta property="og:locale" content="${OG_LOCALE[lang]}" />\n${page.slice(at)}`;
}

/**
 * On a bare address the page's language comes from the Accept-Language header,
 * so a cache keeps one copy per language. Under a language prefix the address
 * alone decides it.
 */
function languageVaried(res: Response, pathLang: Lang | undefined): Response {
  if (!pathLang) res.headers.set('Vary', 'Accept-Language');
  return res;
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
  /** OSE-1684: the event's short code; the Share button hands out /e/<code>. */
  share_code?: string | null;
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
  /** OSE-1313 — canonical UTC start instant; null for date-only events. */
  starts_at?: string | null;
  /** 0093 — when the event first went on the list; null = never listed. */
  listed_from?: string | null;
  what_short: string | null;
  who_host: string | null;
  why_purpose: string | null;
  how_details: string | null;
  where_address: string | null;
  /** 0108 (OSE-2012): 'in_person', 'online' or 'both'. */
  attendance_mode?: string | null;
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
  is_published: number | null;
  event_type_id: string | null;
  event_type_name: string | null;
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

function renderEventTypeMeta(
  row: PublicEventRow,
  testId = 'event-type',
  lang: Lang = DEFAULT_LANG
): string {
  // The type's own name is catalog data; its labels per language are OSE-1764.
  const label = esc(row.event_type_name) || esc(row.event_type_id);
  if (!label) return '';
  return `<p class="ose-meta" data-testid="${testId}">${fmt(lang, 'event.type', { type: label })}</p>`;
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
// OSE-1760: the text itself lives in the language catalog (lib/i18n/catalog.ts);
// this map is derived from it so the drift guard keeps its export.
export const WHAT_LINK_LABELS: Record<string, Record<Lang, string>> = Object.fromEntries(
  WHAT_TYPES.map((type) => [type, msgAll(`what.${type}`)])
);

function renderWhatLink(
  rawUrl: string | null,
  enabled: boolean | number | null,
  type: string | null,
  lang: Lang,
  testid: string
): string {
  // R3 explicit ENABLE gate: the link renders only when the organizer turned it
  // ON — not merely because a URL is present. A staged-but-off URL stays dark.
  if (!enabled) return '';
  const url = validateLogoUrl(rawUrl).url;
  if (!url) return '';
  const key = WHAT_TYPES.find((t) => t === type) ?? 'website';
  const label = msg(lang, `what.${key}`);
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
 * A stored event time as an ISO 8601 value fit for `og:event:*_time`, or '' when
 * it is not one. A row written outside the API can hold "2026-08-25 02:25:18";
 * that is published as its calendar date. Anything else is left out: metadata
 * never carries a stored string as is.
 */
function ogEventTime(value: string | null | undefined): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/.test(value))
    return value;
  return /^\d{4}-\d{2}-\d{2}(?= )/.exec(value)?.[0] ?? '';
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
  /** The page language, for `og:locale`. */
  lang?: Lang;
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
    `  <meta property="og:locale" content="${OG_LOCALE[opts.lang ?? DEFAULT_LANG]}" />`,
    `  <meta name="twitter:card" content="${twitterCard}" />`,
    `  <meta name="twitter:title" content="${opts.title}" />`,
    `  <meta name="twitter:description" content="${opts.description}" />`,
  ];
  if (image) {
    lines.push(`  <meta property="og:image" content="${image}" />`);
    lines.push(`  <meta name="twitter:image" content="${image}" />`);
  }
  const startTime = ogEventTime(opts.startTime);
  const endTime = ogEventTime(opts.endTime);
  if (startTime)
    lines.push(`  <meta property="og:event:start_time" content="${esc(startTime)}" />`);
  if (endTime) lines.push(`  <meta property="og:event:end_time" content="${esc(endTime)}" />`);
  return lines.join('\n');
}

/**
 * Search-engine head for a public event page: the one canonical URL, a meta
 * description and schema.org/Event JSON-LD. The JSON-LD carries only the facts
 * the page already shows (name, when, where, blurb) — never anything about who
 * attends. It is left out when there is no start date, which Event requires.
 * Admin previews skip all of it: they are noindex and have no public address.
 */
function buildSearchMeta(row: PublicEventRow, shareUrl: string): string {
  const description = row.what_short || row.description || '';
  const lines = [`  ${canonicalLinkTagFor(shareUrl)}`];
  // OSE-1761: each language page names its siblings, and the unprefixed address
  // is the default, so a search engine and a shared card show the right one.
  for (const alt of languageAlternates(new URL(shareUrl).origin, eventPagePath(row.id, row.slug))) {
    lines.push(`  <link rel="alternate" hreflang="${alt.hreflang}" href="${esc(alt.href)}" />`);
  }
  if (description) lines.push(`  <meta name="description" content="${esc(description)}" />`);
  const startDate = ogEventTime(row.starts_at ?? row.start_date);
  if (startDate) {
    const endDate = ogEventTime(phaseTimesFor(row).end_date);
    const place = row.location || row.where_address;
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'Event',
      name: row.title,
      url: shareUrl,
      startDate,
      ...(endDate ? { endDate } : {}),
      eventStatus: 'https://schema.org/EventScheduled',
      ...(place
        ? {
            location: {
              '@type': 'Place',
              name: place,
              ...(row.where_address ? { address: row.where_address } : {}),
            },
          }
        : {}),
      ...(description ? { description } : {}),
    };
    lines.push(`  <script type="application/ld+json">${jsonForScript(ld)}</script>`);
  }
  return lines.join('\n');
}

/** OSE-1760: the page language, from the Accept-Language header by quality value (lib/i18n). */
function preferredLang(request: Request): Lang {
  return resolveLanguage(request.headers.get('Accept-Language'));
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
  lang: Lang,
  inert = false
): string {
  const copiedLabel = msg(lang, 'share.copied');
  // OSE-1355: in an admin draft preview the button is shown (it is what the
  // public will see) but switched off — no URL, no script. A draft's link is
  // not public yet, so there is nothing to share. The button is the one the
  // map's place panel shows too (lib/share-button.ts, owner 2026-11-09).
  const button = renderShareButton(shareUrl, title, lang, { inert });
  if (inert) return button;
  return `${button}
<script nonce="${nonce}">(function(){var btn=document.querySelector('.ose-share-btn');if(!btn)return;var orig=btn.textContent;btn.addEventListener('click',function(){var u=btn.dataset.shareUrl,t=btn.dataset.shareTitle;if(navigator.share){navigator.share({title:t,url:u}).catch(function(){});}else if(navigator.clipboard){navigator.clipboard.writeText(u).then(function(){btn.textContent='${jsStr(copiedLabel)}';setTimeout(function(){btn.textContent=orig;},2000);}).catch(function(){});}});})();</script>`;
}

/**
 * OSE-2045 — subscribe to every public event of this event's brand (the feed at
 * /brands/<brand>/calendar.ics, OSE-2013). Owner, 2026-11-14: the online
 * calendars come first, then the .ics address. Same CSP-safe <details> menu and
 * classes as "Add to calendar"; no script, no new style.
 *
 * Shown only when this event is itself in the feed (published, active and past
 * the publish grace). An event that opens by link only is not in its brand's
 * feed, and its brand may have no feed at all, so it does not offer one.
 */
export function renderSubscribeMenu(
  row: PublicEventRow,
  origin: string,
  lang: Lang,
  now: Date = new Date()
): string {
  if (row.is_published !== 1 || (row.status || '').toLowerCase() !== 'active') return '';
  if (row.listed_from) {
    const listedFrom = new Date(row.listed_from).getTime();
    if (Number.isNaN(listedFrom) || listedFrom > now.getTime()) return '';
  }
  const links = buildBrandSubscribeLinks(origin, row.brand_id);
  if (!links) return '';
  const label = msg(lang, 'calendar.subscribe');
  const external = 'target="_blank" rel="noopener noreferrer"';
  return `<details class="ose-calendar-menu" data-testid="subscribe-calendar">
    <summary class="ose-calendar-link ose-calendar-summary" data-testid="subscribe-calendar-summary">${label}</summary>
    <div class="ose-calendar-options" role="group" aria-label="${label}">
      <a class="ose-calendar-option" data-testid="subscribe-calendar-google" href="${esc(links.google)}" ${external}>Google Calendar</a>
      <a class="ose-calendar-option" data-testid="subscribe-calendar-outlook" href="${esc(links.outlook)}" ${external}>Outlook.com</a>
      <a class="ose-calendar-option" data-testid="subscribe-calendar-apple" href="${esc(links.webcal)}">${msg(lang, 'calendar.subscribe.apple')}</a>
      <a class="ose-calendar-option" data-testid="subscribe-calendar-ics" href="${esc(links.ics)}">${msg(lang, 'calendar.subscribe.ics')}</a>
    </div>
  </details>`;
}

function renderEventActions(
  row: PublicEventRow,
  shareUrl: string,
  nonce: string,
  lang: Lang,
  opts: { calendar?: boolean; inert?: boolean } = {}
): string {
  const calendarLabel = msg(lang, 'calendar.label');
  const icsLabel = msg(lang, 'calendar.ics');
  const calendarHref = `/events/${esc(row.id)}/calendar.ics`;
  // OSE-1358: one "Add to calendar" control offering the standard targets. A
  // CSP-safe <details> disclosure (no JS) — Google Calendar (Android + web) via a
  // server-built deep link, and a plain .ics download that lands Apple Calendar,
  // the iOS native picker and Outlook desktop.
  const googleUrl = row.start_date ? buildGoogleCalendarUrl(row, shareUrl) : null;
  // OSE-1373: a wrapped event has no future to add — the recap passes
  // `calendar: false`, so only Share remains in its actions row.
  const menu =
    opts.calendar !== false && row.start_date
      ? `<details class="ose-calendar-menu" data-testid="add-to-calendar">
    <summary class="ose-calendar-link ose-calendar-summary" data-testid="add-to-calendar-summary">${calendarLabel}</summary>
    <div class="ose-calendar-options" role="group" aria-label="${calendarLabel}">${
      googleUrl
        ? `
      <a class="ose-calendar-option" data-testid="add-to-calendar-google" href="${esc(googleUrl)}" target="_blank" rel="noopener noreferrer">Google Calendar</a>`
        : ''
    }
      <a class="ose-calendar-option" data-testid="add-to-calendar-ics" href="${calendarHref}" download>${icsLabel}</a>
    </div>
  </details>`
      : '';
  // OSE-1684: Share hands out the short /e/<code> link, so each open counts as
  // a share of the event (owner 2026-10-09). The canonical address, og:url and
  // the calendar entry keep the readable /events/<id>/<name>. No code yet
  // (an older event admin has not opened): the readable address is shared.
  // OSE-1761: the link keeps the page's language prefix, so it opens in the
  // sender's language (/es/e/<code>; English stays /e/<code>).
  const shareLink = row.share_code
    ? `${new URL(shareUrl).origin}${withLangPrefix(lang, `/e/${encodeURIComponent(row.share_code)}`)}`
    : shareUrl;
  // An admin draft preview shows what the public will see with its controls
  // switched off; a draft is in no feed, so the menu is not drawn there at all.
  // When there is no menu the row is byte for byte what it was before OSE-2045.
  const subscribe =
    opts.inert === true ? '' : renderSubscribeMenu(row, new URL(shareUrl).origin, lang);
  return `<div class="ose-event-actions" data-testid="event-actions">
  ${renderShareBlock(shareLink, row.title, nonce, lang, opts.inert === true)}
  ${menu}${subscribe ? `\n  ${subscribe}` : ''}
</div>`;
}

type EventFormType = 'register' | 'checkin' | 'survey' | 'email-signup';

interface EventFormContext {
  type: EventFormType;
  deploymentId?: string | null;
}

const EVENT_FORM_TYPES = new Set<EventFormType>(['register', 'checkin', 'survey', 'email-signup']);

function eventFormContextFromRequest(request: Request, fallback: EventFormType): EventFormContext {
  const url = new URL(request.url);
  const rawType = url.searchParams.get('type');
  const type = EVENT_FORM_TYPES.has(rawType as EventFormType)
    ? (rawType as EventFormType)
    : fallback;
  const rawDeployment = url.searchParams.get('deployment');
  const deploymentId = isValidDeploymentId(rawDeployment) ? rawDeployment : null;
  return { type, deploymentId };
}

/**
 * OSE-1761: the query the language switch carries to the other language's page,
 * and nothing else. These two are the only parameters the page reads (they pick
 * its form link and its poster deployment), so a switch does not drop them and
 * never reflects anything else the request carried.
 */
function carriedQuery(url: URL): string {
  const carried = new URLSearchParams();
  const type = url.searchParams.get('type');
  if (EVENT_FORM_TYPES.has(type as EventFormType)) carried.set('type', type as string);
  const deployment = url.searchParams.get('deployment');
  if (isValidDeploymentId(deployment)) carried.set('deployment', deployment as string);
  const text = carried.toString();
  return text ? `?${text}` : '';
}

function eventFormHref(eventId: string, ctx: EventFormContext): string {
  return eventFormPath(eventId, ctx.type, ctx.deploymentId);
}

function eventFormCtaLabel(type: EventFormType, lang: Lang = DEFAULT_LANG): string {
  switch (type) {
    case 'checkin':
      return msg(lang, 'cta.checkin');
    case 'survey':
      return msg(lang, 'cta.survey');
    case 'email-signup':
      return msg(lang, 'cta.emailSignup');
    case 'register':
    default:
      return msg(lang, 'cta.register');
  }
}

interface SponsorBasicRow {
  id: string;
  name: string;
  website_url: string | null;
  /** 0083: optional public title and location (sponsor-entered, public). */
  display_name?: string | null;
  address_line?: string | null;
  /** 1 when the sponsor has a compact or header logo on file (sponsor_asset). */
  has_logo?: number | null;
}

interface EventPageSocialData {
  sponsors: SponsorBasicRow[];
  regCount: number;
  checkinCount: number;
  /** OSE-1373: check-ins through the walk-in path — a per-path count, never a match. */
  walkInCount?: number;
  surveyCount: number;
  emailCount: number;
}

function renderSponsorItem(s: SponsorBasicRow): string {
  const name = esc(sponsorTitle(s));
  // Stryker disable next-line StringLiteral: equivalent (OSE-1952). `url` is read
  // only by startsWith('https://') and, past it, in the https branch; '' and any
  // non-https stand-in both fail that test, so a null website renders the same
  // card link. The `??` operator mutant on this line stays live and is killed.
  const url = s.website_url ?? '';
  // A website when there is one; otherwise a tap opens the sponsor's own card
  // (title, location, contact).
  // Each anchor stays one complete <a …> literal: the click-out invariant
  // (sponsor-signal-never-who) reads these tags from source to prove rel=noreferrer.
  const anchor = (inner: string, extra = ''): string =>
    url.startsWith('https://')
      ? `<a href="${esc(url)}" class="ose-sponsor-link" rel="noopener noreferrer nofollow"${extra}>${inner}</a>`
      : `<a href="${esc(sponsorCardPath(s.id))}" class="ose-sponsor-link" data-testid="sponsor-card-link"${extra}>${inner}</a>`;
  // Owner 2026-11-09: a sponsor with a logo shows as thumbnail art only — the
  // compact logo (falling back to the header logo) through the same-origin,
  // consent-gated proxy. The name stays the image's alt text, so it is still
  // read out; the location stays on the sponsor's card. No logo → the name.
  if (s.has_logo) {
    const src = `/api/v2/sponsors/${encodeURIComponent(s.id)}/logo?slot=sidebar`;
    return anchor(
      `<img class="ose-sponsor-thumb" data-testid="sponsor-thumb" src="${esc(src)}" alt="${name}" loading="lazy" decoding="async">`,
      ' data-thumb="1"'
    );
  }
  const link = anchor(name);
  if (!s.address_line) return link;
  // 0083 / OSE-1435: the location the sponsor chose to show, as its own muted
  // line under the name. The list item is a flex row, so name and location sit
  // in one block: .sub-line (@ocr/ui) is display:block and takes the next line.
  return `<div>${link}<small class="sub-line" data-testid="sponsor-item-address">${esc(s.address_line)}</small></div>`;
}

/**
 * OSE-1373: sponsors render as a real list, one per line. They were inline
 * <a>/<span> siblings in a bare <div> with no styling, so the names ran into one
 * another ("Covenant Local BronzeCovenant Local Platinum…") on every phase.
 */
function renderSponsorList(sponsors: SponsorBasicRow[]): string {
  const items = sponsors
    .map(
      (s) => `<li class="ose-sponsor-item" data-testid="sponsor-item">${renderSponsorItem(s)}</li>`
    )
    .join('');
  return `<ul class="ose-sponsor-list" data-testid="sponsor-list">${items}</ul>`;
}

const SPONSOR_LIST_CSS = `
    .ose-sponsor-label { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--text-muted); margin: 0 0 0.25rem; }
    .ose-sponsor-list { list-style: none; margin: 0; padding: 0; }
    .ose-sponsor-item { display: flex; align-items: center; min-height: 44px; border-bottom: 1px solid var(--border); }
    .ose-sponsor-item:last-child { border-bottom: none; }
    .ose-sponsor-link { color: var(--accent); font-weight: 600; display: inline-flex; align-items: center; min-height: 44px; }
    .ose-sponsor-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .ose-sponsor-link[data-thumb] { display: inline-flex; align-items: center; min-height: 44px; padding: 0.25rem 0; }
    .ose-sponsor-thumb { display: block; height: 64px; width: auto; max-width: 160px; object-fit: contain; }
    .ose-sponsor-name { color: var(--text); font-weight: 600; }`;

/**
 * The bar at the top of an event page: the Language menu on the left, then the
 * site links (owner 2026-11-10). It wraps on a narrow phone.
 *
 * A bar that holds only the menu (the page after the event) floats into the
 * empty left margin on a wide screen, so it does not push the page down. The
 * page column is 640 px wide; at 1024 px the margin beside it is 192 px, room
 * for the button. Narrower screens keep the bar above the page.
 */
const EVENT_TOPBAR_CSS = `
    .ose-topbar { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 1rem; margin: 0 0 0.75rem; }
    @media (min-width: 1024px) { .ose-topbar-solo { position: absolute; top: 1rem; inset-inline-start: 1rem; margin: 0; } }`;

/**
 * The top bar of a public event page, the Language menu first. A draft preview
 * has no public address, so it keeps the bare nav it always had. With no site
 * links the bar is the menu alone (`ose-topbar-solo`).
 */
function renderEventTopbar(
  nav: string,
  lang: Lang,
  path: string,
  query: string | undefined,
  nonce: string
): string {
  return `<div class="ose-topbar${nav ? '' : ' ose-topbar-solo'}" data-testid="event-topbar">
    ${renderLanguageMenu({ lang, path, query, nonce })}
    ${nav}
  </div>`;
}

/**
 * Share + Add to calendar: one pair on a row. At phone width each takes half
 * (flex-basis 120px, so two fit even at 320px); a single control takes the row.
 */
const EVENT_ACTIONS_CSS =
  `
    .ose-event-actions { display: flex; gap: 0.75rem; flex-wrap: wrap; align-items: flex-start; margin: 1rem 0 0.5rem; }
    .ose-share-btn, .ose-calendar-link { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--ose-accent); border: 1.5px solid var(--ose-accent); padding: 0.65rem 0.75rem; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; min-height: 44px; margin: 0; text-decoration: none; flex: 1 1 120px; }
    .ose-share-btn:hover, .ose-calendar-link:hover, .ose-calendar-option:hover { background: var(--ose-accent-tint); }
    .ose-share-btn:focus, .ose-calendar-link:focus, .ose-calendar-option:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-calendar-menu { flex: 1 1 120px; }
    .ose-calendar-summary { width: 100%; list-style: none; cursor: pointer; }
    .ose-calendar-summary::-webkit-details-marker { display: none; }
    .ose-calendar-options { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 0.5rem; }
    .ose-calendar-option { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0.65rem 1rem; border: 1.5px solid var(--ose-accent); border-radius: 6px; color: var(--ose-accent); text-decoration: none; font-weight: 600; font-size: 1rem; }` +
  BACK_BUTTON_CSS +
  LANGUAGE_SWITCH_CSS +
  LANGUAGE_MENU_CSS +
  EVENT_TOPBAR_CSS;

/**
 * OSE-1518: the plain choices. Register (or check-in while the event is on)
 * is the one filled, full-width button; the other is outlined and full width
 * as well. Back, at the foot of the page, uses the same outlined button.
 */
const EVENT_CHOICES_CSS = `
    .ose-choices { display: flex; flex-direction: column; gap: 0.75rem; margin: 1.25rem 0 0.5rem; }
    .ose-choice { display: flex; flex-direction: column; gap: 0.25rem; }
    .ose-choice-btn { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 44px; padding: 0.75rem 1.5rem; border: 1.5px solid var(--ose-accent); border-radius: 6px; background: transparent; color: var(--ose-accent); font-size: 1.05rem; font-weight: 600; line-height: 1.5; text-decoration: none; }
    .ose-choice-primary { background: var(--ose-accent); color: var(--on-accent); font-weight: 700; }
    .ose-choice-btn:focus { outline: 3px solid var(--ose-focus); outline-offset: 2px; }
    .ose-choice-note { margin: 0; font-size: 0.85rem; color: var(--ose-muted); }`;

/** The "Next at this venue" list, shared by the event page and the recap. */
const NEXT_AT_VENUE_CSS = `
    .ose-suggestions-heading { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.03em; color: var(--ose-muted); margin: 0 0 0.5rem; }
    .ose-suggestion-list { list-style: none; margin: 0 0 0.75rem; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
    .ose-suggestion-link { display: flex; justify-content: space-between; gap: 0.75rem; align-items: baseline; min-height: 44px; padding: 0.4rem 0; text-decoration: none; color: var(--ose-text); }
    .ose-suggestion-title { font-size: 0.95rem; }
    .ose-suggestion-when { font-size: 0.8rem; color: var(--ose-muted); white-space: nowrap; }
    .ose-venue-next { margin: 1.5rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--ose-muted); }`;

/** One row of a "next at this venue" list. */
function renderSuggestionItems(
  events: NextEventRow[],
  ids: (i: number) => { item: string; link: string },
  lang: Lang = DEFAULT_LANG
): string {
  return events
    .map((ev, i) => {
      const t = ids(i);
      return `<li class="ose-suggestion" data-testid="${t.item}">
          <a class="ose-suggestion-link" data-testid="${t.link}" href="${withLangPrefix(lang, `/events/${esc(ev.id)}`)}">
            <span class="ose-suggestion-title">${esc(ev.title)}</span>
            <span class="ose-suggestion-when">${formatHumanDate(ev.start_date, lang)}</span>
          </a>
        </li>`;
    })
    .join('');
}

/**
 * OSE-1518: a curated few other events at this venue, as a quiet aside below
 * the deeper detail (the recap has had the same since OSE-657). Nothing renders
 * when there are none: no empty heading.
 */
function renderNextAtVenue(
  events: NextEventRow[] | undefined,
  venue: string,
  lang: Lang = DEFAULT_LANG
): string {
  const curated = (events ?? []).slice(0, MAX_POST_EVENT_SUGGESTIONS);
  if (!curated.length) return '';
  return `<aside class="ose-venue-next" data-testid="venue-next-events" aria-labelledby="venue-next-heading">
      <h2 id="venue-next-heading" class="ose-suggestions-heading">${fmt(lang, 'next.atVenue', { venue: venue || msg(lang, 'next.thisVenue') })}</h2>
      <ul class="ose-suggestion-list">${renderSuggestionItems(curated, (i) => ({ item: `venue-next-event-${i}`, link: `venue-next-event-link-${i}` }), lang)}</ul>
    </aside>`;
}

// Less text (owner 2026-10-11): a note says only what the choice asks of you.
// Register names what it collects. Check-in keeps its promise only where its
// label ("Check in at this event") does not already say "anon". Short labels
// (owner 2026-10-11): "Register" and "Count me in, anon".
// OSE-1760: the copy itself is in the language catalog (lib/i18n/catalog.ts,
// keys `choices.*`); the notes and labels above describe what each says.

/**
 * OSE-1518: plain choices under the facts: register, or count me in
 * anonymously (the check-in form). The first button, filled and full width, is
 * the one the page is for: Register before the event, Check in while it is on,
 * or the form a poster scan asked for (?type=). Whichever of register /
 * check-in is not first follows it, so both are always on offer. The third
 * choice, "Just looking", became the Back button at the foot of the page
 * (owner 2026-10-11, lib/back-button.ts). Links only: no field of ours, and "plant my flag"
 * stays a link out to ourWKRP, never a profile flow here. In an admin draft
 * preview every choice is shown but switched off (no href).
 */
function renderEventChoices(
  row: PublicEventRow,
  ctx: EventFormContext,
  phase: 'pre' | 'live',
  lang: Lang,
  inert: boolean
): string {
  const t = {
    registerNote: msg(lang, 'choices.registerNote'),
    checkinLabel: msg(lang, 'choices.checkinLabel'),
    checkinNote: msg(lang, 'choices.checkinNote'),
    heading: msg(lang, 'choices.heading'),
  };
  const first = phase === 'pre' ? 'event-rsvp' : 'event-checkin';
  const href = (type: EventFormType) =>
    inert
      ? ''
      : ` href="${esc(withLangPrefix(lang, eventFormHref(row.id, { type, deploymentId: ctx.deploymentId })))}"`;
  const off = inert ? ' data-preview-inert="true" aria-disabled="true"' : '';
  const choice = (
    testid: string,
    cls: string,
    link: string,
    label: string,
    note: string | null,
    noteId: string
  ) => `<div class="ose-choice">
      <a class="ose-choice-btn${cls}" data-testid="${testid}"${link}${off}${note ? ` aria-describedby="${noteId}"` : ''}>${label}</a>${note ? `\n      <p class="ose-choice-note" id="${noteId}">${note}</p>` : ''}
    </div>`;
  const items: string[] = [
    choice(
      first,
      ' ose-choice-primary',
      href(ctx.type),
      eventFormCtaLabel(ctx.type, lang),
      ctx.type === 'register' ? t.registerNote : t.checkinNote,
      'choice-note-first'
    ),
  ];
  if (ctx.type !== 'register') {
    items.push(
      choice(
        'event-choice-register',
        '',
        href('register'),
        eventFormCtaLabel('register', lang),
        t.registerNote,
        'choice-note-register'
      )
    );
  }
  if (ctx.type !== 'checkin') {
    items.push(
      choice(
        'event-choice-checkin',
        '',
        href('checkin'),
        t.checkinLabel,
        null,
        'choice-note-checkin'
      )
    );
  }
  return `<section class="ose-choices" data-testid="event-choices" aria-label="${esc(t.heading)}">
    ${items.join('\n    ')}
  </section>`;
}

function renderSponsorStrip(
  testid: string,
  sponsors: SponsorBasicRow[],
  heading: string,
  lang: Lang = DEFAULT_LANG
): string {
  if (!sponsors.length) return '';
  return `<section class="ose-sponsor-strip" data-testid="${testid}" aria-label="${msg(lang, 'sponsors.label')}">
    <p class="ose-sponsor-label">${heading}</p>
    ${renderSponsorList(sponsors)}
  </section>`;
}

/**
 * OSE-1313 — the "when" line, rendered in the EVENT's zone, never the viewer's.
 * A timed event (starts_at set) reads "Saturday, October 24, 2026 · 6:00 PM CDT";
 * a date-only event keeps its prior shape (date · zone name). Pure Intl — no zone
 * string is interpolated into markup except through esc() at the call site.
 */
function formatEventWhen(
  row: {
    start_date: string | null;
    starts_at?: string | null;
    timezone: string | null;
  },
  lang: Lang = DEFAULT_LANG
): string {
  if (row.starts_at) {
    const time = formatEventTime(row.starts_at, row.timezone, lang);
    const date = formatHumanDate(zonedDatePart(row.starts_at, row.timezone), lang);
    if (time && date) return `${date} · ${time}`;
  }
  const date = formatHumanDate(row.start_date, lang);
  if (!date) return '';
  // OSE-1518: the zone by its everyday name ("Central Time"), not the IANA id.
  const zone = zoneDisplayName(row.timezone, undefined, lang);
  return zone ? `${date} · ${zone}` : date;
}

/**
 * Anonymity affordance — the user-facing version of the architectural
 * separation principle. The platform's DB↔FORMS_DB split + anon_id + 15-min
 * tranches make this claim physically true; this paragraph makes it
 * user-readable. Lives at the bottom of every public event page so recipients
 * read it before any sign-up action they might take. OSE-1372: one line
 * visible, the paragraph behind a native disclosure (lib/never-who.ts).
 */
const ANONYMITY_AFFORDANCE = renderNeverWho('event');

/**
 * The venue map image, or nothing when the event has no venue. Requested by
 * event id: the image route (handlers/venue-image.ts) serves public events
 * only, so the admin preview of a draft passes over it rather than show a
 * broken image.
 */
/**
 * "In person", "Online" or "Online and in person" (OSE-2012), the first line of
 * the Where card in every phase. It shares its line with the place name, so a
 * page with a place is no taller than it was and the main action stays above
 * the fold. Plain text in the card's own type: no colour of its own.
 */
function attendanceModeLine(
  row: PublicEventRow,
  lang: Lang = DEFAULT_LANG,
  venueHtml: string = ''
): string {
  const mode = attendanceModeOf(row.attendance_mode);
  const label = `<span data-testid="event-mode" data-mode="${mode}">${attendanceModeLabel(mode, lang)}</span>`;
  return venueHtml
    ? `<p>${label} · <strong>${isolateTyped(lang, venueHtml)}</strong></p>`
    : `<p>${label}</p>`;
}

function venueMapImg(row: PublicEventRow, testId: string, lang: Lang = DEFAULT_LANG): string {
  const venue = row.location || row.where_address;
  if (!venue) return '';
  return `<img src="/api/v2/maps/venue-image?event=${encodeURIComponent(row.id)}" alt="${fmt(lang, 'map.alt', { venue: esc(venue) })}" class="ose-venue-map" loading="lazy" width="600" height="240" data-testid="${testId}" />`;
}

// NOTE on CSP + the nonce parameter (added 2026-05-14 after code review):
// The current CSP policy (see `securityHeaders` below) allows
// `style-src 'self' 'unsafe-inline'`. With `'unsafe-inline'` present,
// every browser IGNORES nonces on style elements — putting `nonce="..."`
// on the style element was decoration, not defense. The honest fix is
// to NOT pretend to nonce the style. A follow-on story (CSP tightening
// across ALL pages.ts handlers — every existing handler ships inline
// style element) needs to happen before a style nonce means anything. Until
// then the nonce parameter remains on the function signature because
// it IS real for inline <script> (which this page does not have, but
// might later).
export function renderPreEventHtml(
  row: PublicEventRow,
  shareUrl: string,
  social?: EventPageSocialData,
  opts?: {
    nonce?: string;
    lang?: Lang;
    formContext?: EventFormContext;
    /** OSE-1355 admin draft preview: noindex, and the RSVP + share are inert. */
    preview?: boolean;
    /** OSE-1518: other events at this venue, listed below the deeper detail. */
    nextEvents?: NextEventRow[];
    /** OSE-1761: the query the language switch carries over (`carriedQuery`). */
    pageQuery?: string;
  }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? DEFAULT_LANG;
  const formContext = opts?.formContext ?? { type: 'register' };
  const preview = opts?.preview === true;
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
  const startHuman = formatEventWhen(row, lang);
  // OSE-474: "Starts in 5 hours" under the labelled when line, pre-event only.
  const countdown = renderEventCountdown(row, nonce, undefined, lang);
  const mapImg = preview ? '' : venueMapImg(row, 'venue-map', lang);
  const geoLink = renderGeoLink(
    row.lat,
    row.lon,
    row.location,
    row.where_address,
    msg(lang, 'directions.pre')
  );

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${DIRECTION[lang]}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>${preview ? '<meta name="robots" content="noindex, nofollow" />' : ''}
${buildOgMeta({ lang, title, description: whatShort, url: esc(shareUrl), twitterCard: 'summary_large_image', startTime: row.starts_at ?? row.start_date, endTime: phaseTimesFor(row).end_date })}${preview ? '' : '\n' + buildSearchMeta(row, shareUrl)}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette driven by @ocr/ui role tokens (from /ui.css), so a
       [data-brand] on <html> swaps the whole surface. No raw hex here. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    /* OSE-298: no sideways scroll at 375px; long strings (URLs in the 5W
       fields, sponsor links) wrap inside the 720px column. */
    html, body { background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; overflow-x: hidden; }
    body { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; overflow-wrap: anywhere; word-break: break-word; }
    .ose-skip { position: absolute; inset-inline-start: -9999px; }
    .ose-skip:focus { inset-inline-start: 1rem; top: 1rem; background: var(--ose-accent); color: var(--on-accent); padding: 0.5rem 1rem; border-radius: 4px; }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-meta { color: var(--ose-muted); font-size: 0.95rem; margin-bottom: 1.5rem; }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-geo-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; display: inline-flex; align-items: center; min-height: 44px; }
    .ose-geo-link:hover { text-decoration: underline; }
${EVENT_CHOICES_CSS}
${EVENT_ACTIONS_CSS}
${NEXT_AT_VENUE_CSS}
${NEVER_WHO_CSS}
${SPONSOR_LIST_CSS}
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
  <a href="#main" class="ose-skip">${msg(lang, 'page.skip')}</a>
  ${(() => {
    const nav = renderEventNav(row.id, 'event', {
      live: (row.status || '').toLowerCase() === 'active',
      allEventsTestId: 'event-nav-events',
      lang,
      inBar: !preview,
    });
    return preview
      ? nav
      : renderEventTopbar(nav, lang, eventPagePath(row.id, row.slug), opts?.pageQuery, nonce);
  })()}
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main">
    <header data-testid="event-header">
      <h1 id="event-title" data-testid="event-title">${isolateTyped(lang, title)}</h1>
      ${renderEventTypeMeta(row, 'event-type', lang)}
      ${startHuman ? `<p class="ose-meta" data-testid="event-when">${esc(startHuman)}${countdown.html}</p>${countdown.script}` : ''}
      ${renderTrustLine(row, 'event-trust', lang)}
    </header>
    ${social ? renderSponsorStrip('pre-sponsor-strip', social.sponsors, msg(lang, 'sponsors.supportedBy'), lang) : ''}

    ${
      whatShort || whatVideo || whatLink
        ? `<section class="ose-card ose-section" data-testid="event-what" aria-labelledby="what-heading">
           <h2 id="what-heading">${msg(lang, 'section.what')}</h2>
           ${whatShort ? `<p>${isolateTyped(lang, whatShort)}</p>` : ''}
           ${whatVideo ? `<p><a class="ose-what-video" data-testid="event-what-video" href="${esc(whatVideo)}" target="_blank" rel="noopener noreferrer nofollow">${msg(lang, 'video.watch')}</a></p>` : ''}
           ${whatLink}
         </section>`
        : ''
    }

    ${
      // OSE-2012: every event says how people take part, so the card always shows.
      `<section class="ose-card ose-section" data-testid="event-where" aria-labelledby="where-heading">
           <h2 id="where-heading">${msg(lang, 'section.where')}</h2>
           ${mapImg}
           ${attendanceModeLine(row, lang, venueDisplay)}
           ${whereAddress && whereAddress !== venueDisplay ? `<p>${isolateTyped(lang, whereAddress)}</p>` : ''}
           ${geoLink}
         </section>`
    }

    ${
      whoHost || whoStory || whoImage
        ? `<section class="ose-card ose-section" data-testid="event-who" aria-labelledby="who-heading">
           <h2 id="who-heading">${msg(lang, 'section.who')}</h2>
           ${whoImage ? `<img class="ose-who-image" data-testid="event-who-image" src="${esc(whoImage)}" alt="${whoHost ? fmt(lang, 'who.photoOf', { host: whoHost }) : msg(lang, 'who.host')}" loading="lazy" width="120" height="120" />` : ''}
           ${whoHost ? `<p data-testid="event-who-host">${isolateTyped(lang, whoHost)}</p>` : ''}
           ${whoStory ? `<p class="ose-who-story" data-testid="event-who-story">${isolateTyped(lang, whoStory)}</p>` : ''}
         </section>`
        : ''
    }

    ${(() => {
      // HOW MUCH — the event's own price (display only; #6 inert_monetization
      // holds — no charge logic). Sits right before the CTA: cost is the last
      // fact a recipient weighs before the ask (order: What → Where → Who → How much → CTA).
      const howMuch = formatEventPrice(row, lang);
      return howMuch === null
        ? ''
        : `<section class="ose-card ose-section" data-testid="event-how-much" aria-labelledby="how-much-heading">
           <h2 id="how-much-heading">${msg(lang, 'section.howMuch')}</h2>
           <p>${esc(howMuch)}</p>
         </section>`;
    })()}

    <!-- Counts are POST-EVENT only (founder decision 2026-09-04). An attendee
       deciding whether to come is not shown how many others already did:
       live tallies are social proof, a growth tactic, and the platform counts
       the room for the host, sponsor and report — never to persuade the room.
       The post-event recap card keeps its counts (OSE-657 keepsake). -->

    ${renderEventChoices(row, formContext, 'pre', lang, preview)}

    ${renderEventActions(row, shareUrl, nonce, lang, { inert: preview })}

    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why" aria-labelledby="why-heading">
           <h2 id="why-heading">${msg(lang, 'section.why')}</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${
      howDetails
        ? `<section class="ose-card ose-section" data-testid="event-how" aria-labelledby="how-heading">
           <h2 id="how-heading">${msg(lang, 'section.how')}</h2>
           <p>${howDetails}</p>
         </section>`
        : ''
    }

    ${preview ? '' : renderNextAtVenue(opts?.nextEvents, venueDisplay, lang)}

    ${preview ? '' : renderLanguageSwitch({ lang, path: eventPagePath(row.id, row.slug), query: opts?.pageQuery })}

    ${renderBackButton({ fallbackHref: withLangPrefix(lang, '/events'), nonce, lang, inert: preview, testid: 'event-back' })}

    ${renderNeverWho('event', lang)}
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
  opts?: {
    nonce?: string;
    lang?: Lang;
    formContext?: EventFormContext;
    /** OSE-1518: other events at this venue, listed below the deeper detail. */
    nextEvents?: NextEventRow[];
    /** OSE-1761: the query the language switch carries over (`carriedQuery`). */
    pageQuery?: string;
  }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? DEFAULT_LANG;
  const formContext = opts?.formContext ?? { type: 'checkin' };
  const title = esc(row.title);
  // OSE-1313 — keep the scheduled time visible once the page flips to live.
  const liveWhen = formatEventWhen(row, lang);
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
  const mapImg = venueMapImg(row, 'venue-map-live', lang);
  const geoLink = renderGeoLink(
    row.lat,
    row.lon,
    row.location,
    row.where_address,
    msg(lang, 'directions.live'),
    'geo-link-live'
  );

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${DIRECTION[lang]}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
${buildOgMeta({ lang, title, description: whatShort, url: esc(shareUrl), twitterCard: 'summary_large_image', startTime: row.starts_at ?? row.start_date, endTime: phaseTimesFor(row).end_date })}
${buildSearchMeta(row, shareUrl)}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette from @ocr/ui role tokens (from /ui.css); [data-brand]
       swaps the surface. --ose-live -> teal --live (colorblind-safe). No hex. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    /* OSE-298 DRAIN 5/7: defensive horizontal-scroll guard for the
       public event page (live phase mirror of renderPreEventHtml). */
    html, body { background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; overflow-x: hidden; }
    body { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; overflow-wrap: anywhere; word-break: break-word; }
    .ose-skip { position: absolute; inset-inline-start: -9999px; }
    .ose-skip:focus { inset-inline-start: 1rem; top: 1rem; background: var(--ose-accent); color: var(--on-accent); padding: 0.5rem 1rem; border-radius: 4px; }
    .ose-live-badge { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--ose-live); color: var(--ose-bg); padding: 0.25rem 0.75rem; border-radius: 999px; font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.75rem; }
    .ose-live-dot { width: 0.6rem; height: 0.6rem; background: #fff; border-radius: 50%; animation: ose-pulse 1.5s ease-in-out infinite; }
    @keyframes ose-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
    h1 { font-size: 1.875rem; margin: 0 0 0.5rem; line-height: 1.2; }
    h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; color: var(--ose-text); }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-geo-link { color: var(--ose-accent); text-decoration: none; font-weight: 500; display: inline-flex; align-items: center; min-height: 44px; }
    .ose-geo-link:hover { text-decoration: underline; }
${EVENT_CHOICES_CSS}
${EVENT_ACTIONS_CSS}
${NEXT_AT_VENUE_CSS}
${NEVER_WHO_CSS}
${SPONSOR_LIST_CSS}
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
  <a href="#main" class="ose-skip">${msg(lang, 'page.skip')}</a>
  ${renderEventTopbar(
    renderEventNav(row.id, 'event', {
      live: (row.status || '').toLowerCase() === 'active',
      allEventsTestId: 'event-nav-events-live',
      lang,
      inBar: true,
    }),
    lang,
    eventPagePath(row.id, row.slug),
    opts?.pageQuery,
    nonce
  )}
  <main id="main" role="main" aria-labelledby="event-title" data-testid="event-main-live">
    <header data-testid="event-header-live">
      <span class="ose-live-badge" data-testid="event-live-badge" aria-label="${msg(lang, 'live.badgeLabel')}">
        <span class="ose-live-dot" aria-hidden="true"></span>${msg(lang, 'live.badge')}
      </span>
      <h1 id="event-title" data-testid="event-title-live">${isolateTyped(lang, title)}</h1>
      ${renderEventTypeMeta(row, 'event-type-live', lang)}
      ${liveWhen ? `<p class="ose-meta" data-testid="event-when-live">${esc(liveWhen)}</p>` : ''}
      ${renderTrustLine(row, 'event-trust-live', lang)}
    </header>
    ${social ? renderSponsorStrip('live-sponsor-strip', social.sponsors, msg(lang, 'sponsors.supportedBy'), lang) : ''}

    ${
      whatShort || whatLink
        ? `<section class="ose-card ose-section" data-testid="event-what-live" aria-labelledby="what-heading-live">
           <h2 id="what-heading-live">${msg(lang, 'section.what')}</h2>
           ${whatShort ? `<p>${isolateTyped(lang, whatShort)}</p>` : ''}
           ${whatLink}
         </section>`
        : ''
    }

    ${
      // OSE-2012: every event says how people take part, so the card always shows.
      `<section class="ose-card ose-section" data-testid="event-where-live" aria-labelledby="where-heading-live">
           <h2 id="where-heading-live">${msg(lang, 'section.where')}</h2>
           ${mapImg}
           ${attendanceModeLine(row, lang, venueDisplay)}
           ${whereAddress && whereAddress !== venueDisplay ? `<p>${isolateTyped(lang, whereAddress)}</p>` : ''}
           ${geoLink}
         </section>`
    }

    ${
      whoHost
        ? `<section class="ose-card ose-section" data-testid="event-who-live" aria-labelledby="who-heading-live">
           <h2 id="who-heading-live">${msg(lang, 'section.who')}</h2>
           <p>${isolateTyped(lang, whoHost)}</p>
         </section>`
        : ''
    }

    ${(() => {
      // HOW MUCH — mirrors the pre-event render so the order is identical across
      // phases (What → Where → Who → How much → CTA). Display only; #6
      // inert_monetization holds — no charge logic.
      const howMuch = formatEventPrice(row, lang);
      return howMuch === null
        ? ''
        : `<section class="ose-card ose-section" data-testid="event-how-much-live" aria-labelledby="how-much-heading-live">
           <h2 id="how-much-heading-live">${msg(lang, 'section.howMuch')}</h2>
           <p>${esc(howMuch)}</p>
         </section>`;
    })()}

    ${renderEventChoices(row, formContext, 'live', lang, false)}

    ${renderEventActions(row, shareUrl, nonce, lang)}

    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why-live" aria-labelledby="why-heading-live">
           <h2 id="why-heading-live">${msg(lang, 'section.why')}</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${
      howDetails
        ? `<section class="ose-card ose-section" data-testid="event-how-live" aria-labelledby="how-heading-live">
           <h2 id="how-heading-live">${msg(lang, 'section.how')}</h2>
           <p>${howDetails}</p>
         </section>`
        : ''
    }

    ${renderNextAtVenue(opts?.nextEvents, venueDisplay, lang)}

    ${renderLanguageSwitch({ lang, path: eventPagePath(row.id, row.slug), query: opts?.pageQuery })}

    ${renderBackButton({ fallbackHref: withLangPrefix(lang, '/events'), nonce, lang, testid: 'event-back' })}

    ${renderNeverWho('event', lang)}
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
${NEVER_WHO_CSS}
  </style>
</head>
<body>
  <main role="main" aria-labelledby="event-title-minimal" data-testid="event-main-minimal">
    <h1 id="event-title-minimal" data-testid="event-title-minimal">${title}</h1>
    ${renderEventTypeMeta(row, 'event-type-minimal')}
    <p class="msg" data-testid="event-phase-msg">${message}</p>
    ${ANONYMITY_AFFORDANCE}
  </main>
</body>
</html>`;
}

/** Minimal shape for the "next at this venue" card. */
/**
 * OSE-1518: the trust line under the title of a live event page. Every claim is
 * true by construction: the page is public (no account, no sign-in), and a page
 * only renders for an event the organizer took live, which is what "verified
 * event link" means here (the QR check that moves it to active).
 */
// Less text (owner 2026-10-11): the header names the host and nothing more.
function renderTrustLine(row: PublicEventRow, testid: string, lang: Lang = DEFAULT_LANG): string {
  const host = esc(row.who_host);
  return host
    ? `<p class="ose-meta" data-testid="${testid}">${fmt(lang, 'event.hostedBy', { host: isolateTyped(lang, host) })}</p>`
    : '';
}

/**
 * OSE-657 recap-first invariant: post-event suggestions are a CURATED few at the
 * margin, never an exhaustive listing. This bound is what makes "tasteful, not
 * bombardment" structural rather than a preference — the render slices to it and
 * the layout-invariant test asserts the rendered count never exceeds it.
 */
const MAX_POST_EVENT_SUGGESTIONS = MAX_NEXT_AT_VENUE;

/**
 * Post-event recap render (OSE-245 / ose-client-ready package).
 *
 * Replaces the "This event has ended." stub with a real recap + return loop.
 * Design intent: closes the ritual loop at exactly the moment it matters.
 *   • Recap frame: same 5W surface, shifted to past tense.
 *   • Return loop: next upcoming event at the same venue, else public listing.
 *   • Opt-in email CTA: routes to /events/:id/updates, the email signup (FORMS_DB).
 *   • Anonymity affordance retained (Invariant #1 surface language).
 *   • No sponsor logos v1 — display priority is tier-governed (Invariant #5).
 */
export function renderPostEventHtml(
  row: PublicEventRow,
  shareUrl: string,
  nextEvents: NextEventRow[],
  social?: EventPageSocialData,
  opts?: { nonce?: string; lang?: Lang; pageQuery?: string }
): string {
  const nonce = opts?.nonce ?? '';
  const lang = opts?.lang ?? DEFAULT_LANG;
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
    lang,
    title,
    description: whatShort,
    url: esc(shareUrl),
    twitterCard: 'summary',
    startTime: row.starts_at ?? row.start_date,
    // OSE-1313 — same normalized end as phase resolution, so a timed start
    // never pairs with a date-only end read as an earlier UTC midnight.
    endTime: phaseTimesFor(row).end_date,
  });
  const whoHost = esc(row.who_host);
  const whoStory = esc(row.who_story);
  const whoImage = validateLogoUrl(row.who_image_url).url;
  const whyPurpose = esc(row.why_purpose);
  const whereAddress = esc(row.where_address) || esc(row.location);
  const venueDisplay = esc(row.location) || esc(row.where_address);
  // OSE-1313 — a timed event's recap keeps its entered time, in the event zone.
  const whenHuman = row.starts_at
    ? formatEventWhen(row, lang)
    : formatHumanDate(row.start_date, lang);
  // HOW MUCH — the event's own price, display-only (#6 inert_monetization holds:
  // it is a label, never a payment primitive). Same source the pre/live renders use.
  const howMuch = formatEventPrice(row, lang);
  const mapImg = venueMapImg(row, 'venue-map-post', lang);
  // Archived before its day: it never happened. Same page shape (nothing to
  // join), but no "Happened", no "wrap" and no numbers that say it took place.
  const calledOff = archivedBeforeStart(row);
  const whenLine = calledOff
    ? whenHuman
      ? fmt(lang, 'recap.calledOffWhen', { when: whenHuman })
      : msg(lang, 'recap.calledOff')
    : whenHuman
      ? fmt(lang, 'recap.happened', { when: whenHuman })
      : msg(lang, 'recap.ended');

  // OSE-657: curated, bounded suggestions — the subtle margin. Sliced defensively
  // to MAX_POST_EVENT_SUGGESTIONS so this can never become an exhaustive listing.
  // The first item keeps the OSE-454 next-event-card testids for continuity; any
  // further items are indexed. When none exist, the corridor fallback stands in.
  const curated = nextEvents.slice(0, MAX_POST_EVENT_SUGGESTIONS);
  const suggestionItems = renderSuggestionItems(
    curated,
    (i) => ({
      item: i === 0 ? 'next-event-card' : `next-event-suggestion-${i}`,
      link: i === 0 ? 'next-event-link' : `next-event-suggestion-link-${i}`,
    }),
    lang
  );
  const suggestionsInner = curated.length
    ? `<h2 id="next-heading" class="ose-suggestions-heading">${fmt(lang, 'next.atVenue', { venue: venueDisplay || msg(lang, 'next.thisVenue') })}</h2>
        <ul class="ose-suggestion-list">${suggestionItems}</ul>`
    : `<h2 id="next-heading" class="ose-suggestions-heading" data-testid="next-event-fallback">${msg(lang, 'next.fallbackHeading')}</h2>
        <p class="ose-suggestions-note">${msg(lang, 'next.fallbackNote')}</p>
        <a class="ose-cta ose-cta-secondary" data-testid="browse-events-link" href="${withLangPrefix(lang, '/events')}">${msg(lang, 'next.browse')}</a>`;

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${DIRECTION[lang]}" data-surface="ose-public">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title} — ${msg(lang, calledOff ? 'recap.titleCalledOff' : 'recap.title')}</title>
${ogMeta}
${buildSearchMeta(row, shareUrl)}
  <link rel="stylesheet" href="/ui.css" />
  <style>
    /* OSE-655 A2: palette driven by @ocr/ui role tokens (from /ui.css), so a
       [data-brand] on <html> swaps the whole surface. No raw hex here. */
    [data-surface="ose-public"] { --ose-bg: var(--bg); --ose-card: var(--surface); --ose-text: var(--text); --ose-muted: var(--text-muted); --ose-accent: var(--accent); --ose-live: var(--live); --ose-focus: var(--accent); --ose-accent-tint: color-mix(in srgb, var(--accent) 8%, transparent); }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--ose-bg); color: var(--ose-text); font-family: system-ui, -apple-system, "Segoe UI", sans-serif; line-height: 1.5; }
    main { max-width: 640px; margin: 0 auto; padding: 1.25rem 1rem 3rem; }
    .ose-phase-chip { display: inline-block; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--ose-muted); background: var(--ose-card); border-radius: 999px; padding: 4px 12px; margin-bottom: 0.75rem; }
    h1 { font-size: 1.6rem; margin: 0 0 0.25rem; }
    .ose-when { color: var(--ose-muted); margin: 0 0 1.25rem; }
    .ose-card { background: var(--ose-card); border-radius: 8px; padding: 1rem 1.25rem; margin: 0 0 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
    .ose-card h2 { font-size: 1rem; margin: 0 0 0.5rem; }
    .ose-card p { margin: 0 0 0.5rem; }
    .ose-recap-row { margin: 0 0 0.6rem; }
    .ose-recap-label { display: block; font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--ose-muted); }
    /* OSE-657 recap-first: the recap is the hero; suggestions are demoted to a
       quiet margin — smaller type, muted, set off by a divider, never a card
       loud enough to compete with the keepsake above it. Palette-agnostic. */
    .ose-recap-primary { margin: 0 0 1.5rem; }
    .ose-suggestions { margin: 1.5rem 0 0; padding: 1rem 0 0; border-top: 1px solid var(--ose-muted); }
${NEXT_AT_VENUE_CSS}
    .ose-suggestions-note { font-size: 0.85rem; color: var(--ose-muted); margin: 0 0 0.5rem; }
    .ose-suggestions-connect { margin-top: 0.75rem; }
    .ose-cta { display: inline-block; min-height: 44px; line-height: 44px; padding: 0 20px; background: var(--ose-accent); color: var(--on-accent); border-radius: 6px; text-decoration: none; font-weight: 600; }
    .ose-cta.ose-cta-secondary { background: transparent; color: var(--ose-accent); border: 1px solid var(--ose-accent); }
${EVENT_ACTIONS_CSS}
${NEVER_WHO_CSS}
${SPONSOR_LIST_CSS}
    /* OSE-1136: the recap's WHERE/WHO cards reuse the pre-event 5W styling. */
    .ose-section p { margin: 0 0 0.5rem; }
    .ose-venue-map { width: 100%; max-width: 100%; height: auto; border-radius: 6px; display: block; margin-bottom: 0.75rem; }
    .ose-who-image { width: 120px; height: 120px; object-fit: cover; border-radius: 50%; display: block; margin-bottom: 0.75rem; background: var(--ose-accent-tint); }${DARK_MODE_CSS}
  </style>
</head>
<body>
  ${renderEventTopbar('', lang, eventPagePath(row.id, row.slug), opts?.pageQuery, nonce)}
  <main role="main" aria-labelledby="event-title-post" data-testid="event-main-post">
    <span class="ose-phase-chip" data-testid="event-phase-chip">${msg(lang, calledOff ? 'recap.chipCalledOff' : 'recap.chip')}</span>
    <h1 id="event-title-post" data-testid="event-title-post">${isolateTyped(lang, title)}</h1>
    ${renderEventTypeMeta(row, 'event-type-post', lang)}
    <p class="ose-when" data-testid="event-when-post">${whenLine}${venueDisplay ? ` &middot; ${venueDisplay}` : ''}</p>
    ${
      // OSE-1513: sponsors sit by the title on every phase. Still spend-blind
      // here (names/links only, no tier/spend).
      social && social.sponsors.length
        ? `<section class="ose-card ose-sponsor-thanks" data-testid="post-sponsor-thanks" aria-labelledby="thanks-heading">
            <h2 id="thanks-heading">${msg(lang, 'sponsors.thanks')}</h2>
            ${renderSponsorList(social.sponsors)}
          </section>`
        : ''
    }

    <!-- OSE-1136 / OSE-657: the recap is the canonical 5W table in PAST TENSE and
       the keepsake hero. Card order is the same facts-first sequence the pre/live
       renders use — WHAT → WHERE → WHO → HOW MUCH — then the by-the-numbers
       keepsake. Sponsor thanks sits above, by the title (OSE-1513). HOW is intentionally dropped (nothing to "join"
       once it is over); WHY moves below the ask. This region is a HARD layout
       invariant: it MUST precede the suggestions margin below, or
       post-event-recap-first.spec.ts fails. -->
    <div class="ose-recap-primary" data-testid="recap-primary" data-region="recap">
      <!-- WHAT — keeps the event-recap-card testid the recap-first invariant asserts. -->
      <section class="ose-card ose-section" data-testid="event-recap-card" aria-labelledby="recap-heading">
        <h2 id="recap-heading">${msg(lang, 'recap.whatHeading')}</h2>
        ${whatShort ? `<p data-testid="recap-what">${isolateTyped(lang, whatShort)}</p>` : ''}
        ${!whatShort && !whoHost && !whyPurpose ? `<p data-testid="recap-empty">${msg(lang, calledOff ? 'recap.emptyCalledOff' : 'recap.empty')}</p>` : ''}
        ${whatLink}
      </section>

      ${
        // OSE-2012: every event says how people take part, so the card always shows.
        `<section class="ose-card ose-section" data-testid="event-where-post" aria-labelledby="where-heading-post">
             <h2 id="where-heading-post">${msg(lang, 'section.where')}</h2>
             ${mapImg}
             ${attendanceModeLine(row, lang, venueDisplay)}
             ${whereAddress && whereAddress !== venueDisplay ? `<p>${isolateTyped(lang, whereAddress)}</p>` : ''}
           </section>`
      }

      ${
        whoHost || whoStory || whoImage
          ? `<section class="ose-card ose-section" data-testid="event-who-post" aria-labelledby="who-heading-post">
             <h2 id="who-heading-post">${msg(lang, 'section.who')}</h2>
             ${whoImage ? `<img class="ose-who-image" data-testid="event-who-image-post" src="${esc(whoImage)}" alt="${whoHost ? fmt(lang, 'who.photoOf', { host: whoHost }) : msg(lang, 'who.host')}" loading="lazy" width="120" height="120" />` : ''}
             ${whoHost ? `<p data-testid="event-who-host-post">${isolateTyped(lang, whoHost)}</p>` : ''}
             ${whoStory ? `<p class="ose-who-story" data-testid="event-who-story-post">${isolateTyped(lang, whoStory)}</p>` : ''}
           </section>`
          : ''
      }

      ${
        // HOW MUCH — past-tense price label ("Was free" reads as the plain price
        // string; #6 inert_monetization holds — display only, no charge logic).
        howMuch === null
          ? ''
          : `<section class="ose-card ose-section" data-testid="event-how-much-post" aria-labelledby="how-much-heading-post">
             <h2 id="how-much-heading-post">${msg(lang, 'section.howMuch')}</h2>
             <p>${esc(howMuch)}</p>
           </section>`
      }

      ${(() => {
        // Called off: no "By the numbers". Counts would read as a turnout for
        // an event that did not take place.
        if (!social || calledOff) return '';
        // OSE-1201: "attendance" is a banned lexicon word (it claims people; the
        // platform counts signals). The ratio is labelled by what was measured —
        // check-ins over registrations — never by a word that implies bodies.
        const { checkinCount, regCount, surveyCount, emailCount } = social;
        const walkInCount = social.walkInCount ?? 0;
        // OSE-1657: nothing a reader sees may tell 0 from 1 to 4. So the card
        // shows only when some count clears the floor (an event with 3
        // check-ins and one with none both show no card), and when it shows,
        // every line is drawn: a small count reads "Fewer than 5", whether it
        // is 0 or 4.
        const hasStats = [regCount, checkinCount, surveyCount, emailCount].some(clearsFloor);
        const walkInLine = walkInStatLine(checkinCount, walkInCount, lang);
        const walkInPct = flooredRatePct(walkInCount, checkinCount);
        const statsCard = hasStats
          ? `<section class="ose-card ose-stats-card" data-testid="event-stats-card" aria-labelledby="stats-heading">
              <h2 id="stats-heading">${msg(lang, 'stats.heading')}</h2>
              ${
                // OSE-1373: the promise first (how many said they'd come), then
                // the turnout, then how many walked in, then the ratio — the
                // order a reader asks in.
                statLine(regCount, msg(lang, 'stats.registered'), 'stat-registrations', lang)
              }
              ${statLine(checkinCount, msg(lang, 'stats.checkedIn'), 'stat-checkins', lang)}
              ${walkInLine}
              ${
                // The walk-in share uses the same nested rule as the walk-in line.
                walkInPct !== null
                  ? `<p data-testid="stat-walk-in-share">${fmt(lang, 'stats.walkInShare', { pct: Math.round(walkInPct) })}</p>`
                  : ''
              }
              ${
                // Ratio only when BOTH operands clear the floor — a "% showed up"
                // over a sub-K denominator (e.g. 50% of 2) back-derives a person.
                clearsFloor(checkinCount) && clearsFloor(regCount)
                  ? `<p data-testid="stat-showed-up-share">${fmt(lang, 'stats.showedUpShare', { pct: Math.round((checkinCount / regCount) * 100) })}</p>`
                  : ''
              }
              ${statLine(surveyCount, msg(lang, 'stats.surveys'), 'stat-surveys', lang)}
              ${statLine(emailCount, msg(lang, 'stats.emailSignups'), 'stat-email-signups', lang)}
            </section>`
          : '';
        return statsCard;
      })()}
    </div>

    <!-- OSE-657 SUBORDINATE margin: the ask + return loop. Share sits here with
       the return loop (share the recap, find the next one) — curated, bounded (an
       <aside>, visually demoted, always after the recap), never a full listing. -->
    <aside class="ose-suggestions" data-testid="suggestions-margin" data-region="suggestions" aria-labelledby="next-heading">
      ${renderEventActions(row, shareUrl, nonce, lang, { calendar: false })}
      ${suggestionsInner}
      <section class="ose-suggestions-connect" data-testid="stay-connected-card" aria-labelledby="connect-heading">
        <h2 id="connect-heading" class="ose-suggestions-heading">${msg(lang, 'connect.heading')}</h2>
        <p class="ose-suggestions-note">${msg(lang, 'connect.note')}</p>
        <a class="ose-cta ose-cta-secondary" data-testid="email-signup-link" href="${esc(withLangPrefix(lang, eventFormPath(row.id, 'email-signup')))}">${msg(lang, 'connect.cta')}</a>
      </section>
    </aside>

    <!-- WHY — deeper detail, below the ask (mirrors pre/live: facts → ask → detail). -->
    ${
      whyPurpose
        ? `<section class="ose-card ose-section" data-testid="event-why-post" aria-labelledby="why-heading-post">
           <h2 id="why-heading-post">${msg(lang, 'section.why')}</h2>
           <p>${whyPurpose}</p>
         </section>`
        : ''
    }

    ${renderLanguageSwitch({ lang, path: eventPagePath(row.id, row.slug), query: opts?.pageQuery })}

    ${renderBackButton({ fallbackHref: withLangPrefix(lang, '/events'), nonce, lang, testid: 'event-back' })}

    ${renderNeverWho('event', lang)}
  </main>
</body>
</html>`;
}

// Exported for tests/sponsor-thumb-sql.spec.ts (OSE-1955): the sponsor query runs there
// against node:sqlite, so Stryker can mutate the code around it.
export async function fetchEventPageSocialData(
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

  const [sponsorsResult, regResult, checkinResult, surveyResult, emailResult, walkInResult] =
    await Promise.allSettled([
      env.DB
        ? env.DB.prepare(
            // OSE-799 A2: reconstruct the public sponsor list from the split model —
            // active placements on this event, joined to their business identity.
            `SELECT sb.id AS id, sb.name AS name, sb.website_url AS website_url,
                    sb.display_name AS display_name, sb.address_line AS address_line,
                    -- The same pick as the logo proxy's ?slot=sidebar (compact,
                    -- else header), so the page asks only for art it will get.
                    COALESCE((SELECT a.url FROM sponsor_asset a
                               WHERE a.sponsor_business_id = sb.id AND a.format = 'logo_compact'),
                             (SELECT a.url FROM sponsor_asset a
                               WHERE a.sponsor_business_id = sb.id AND a.format = 'logo'),
                             '') <> '' AS has_logo
               FROM sponsor_placement sp
               JOIN sponsor_business sb ON sb.id = sp.sponsor_business_id
              WHERE sp.event_id = ? AND sp.is_active = 1
                AND sb.is_active = 1
                AND COALESCE(sp.organizer_accepted, CASE WHEN sp.source = 'sponsor_request' THEN 0 ELSE 1 END) = 1
                AND sp.sponsor_accepted = 1
                AND ${PLACEMENT_EVENT_USES_SPONSORS_SQL}
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

      // OSE-1373: the walk-in path's own running count, recorded at check-in.
      // Its own query so a FORMS_DB behind migration 0015 loses only this line.
      env.FORMS_DB
        ? env.FORMS_DB.prepare(
            `SELECT walk_in_count FROM checkin_counts WHERE event_id = ? LIMIT 1`
          )
            .bind(eventId)
            .first<{ walk_in_count: number }>()
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
    walkInCount: walkInResult.status === 'fulfilled' ? (walkInResult.value?.walk_in_count ?? 0) : 0,
    surveyCount: surveyResult.status === 'fulfilled' ? (surveyResult.value?.cnt ?? 0) : 0,
    emailCount: emailResult.status === 'fulfilled' ? (emailResult.value?.cnt ?? 0) : 0,
  };
}

/**
 * A curated few upcoming events at the same venue (lib/next-at-venue.ts: the
 * one query, shared with the email-signup confirmation). Fails to [].
 */
function nextEventsAtVenue(env: PublicEventEnv, row: PublicEventRow): Promise<NextEventRow[]> {
  return fetchNextEventsAtVenue(env.DB, row);
}

/** OSE-1519: the named page for an event that was live and has been archived. */
async function renderEndedEventPage(env: PublicEventEnv, row: PublicEventRow): Promise<Response> {
  const next = await nextEventsAtVenue(env, row);
  const list = next.length
    ? `<ul class="ose-suggestions" data-testid="ended-next-events">${next
        .map(
          (ev) =>
            `<li><a href="/events/${esc(ev.id)}" data-testid="ended-next-event-link">${esc(ev.title)}</a></li>`
        )
        .join('')}</ul>`
    : '';
  const res = renderErrorPage(
    410,
    `${row.title} has ended`,
    next.length ? 'Here is what is on next at this venue.' : 'See what is coming up next.',
    '/events',
    'Browse upcoming events',
    { label: null, extraHtml: list }
  );
  res.headers.set('Cache-Control', 'public, max-age=60');
  return res;
}

/**
 * The one message a closed event page shows: no such event, a draft, a ready
 * event, or one taken down. It must stay the same for all of them, so a probe
 * cannot tell a missing id from an unpublished one. It names "not published
 * yet" because an organizer opening their own draft's link lands here; the old
 * wording ("may have been archived") told them something untrue.
 */
export const EVENT_NOT_OPEN_COPY =
  "This event isn't open to the public. It may not be published yet, or it may have been taken down. See what's coming up next.";

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
  eventId: string,
  /** The name after the id in /events/<id>/<name> (OSE-1684); absent on /events/<id>. */
  requestedSlug?: string,
  /** OSE-1761: the language the visitor chose in the path (/es/...). It beats the header. */
  pathLang?: Lang
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
      EVENT_NOT_OPEN_COPY,
      '/events',
      'Browse upcoming events'
    );
  }

  let row: PublicEventRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT e.id, e.brand_id, e.title, e.slug, e.status, e.description, e.location,
              start_date, end_date, timezone, starts_at,
              what_short, who_host, why_purpose, how_details, where_address,
              who_story, who_image_url, what_video_url, what_url,
              what_url_enabled, what_url_type,
              lat, lon, price_cents, price_model, price_note, is_published,
              e.attendance_mode,
              e.event_type_id, etr.name AS event_type_name, e.listed_from,
              ec.code AS share_code
       FROM events e
       LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
       LEFT JOIN event_codes ec ON ec.event_id = e.id
       WHERE e.id = ?`
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
      EVENT_NOT_OPEN_COPY,
      '/events',
      'Browse upcoming events'
    );
  }

  // State-machine gate: a draft or ready event is NOT renderable to public.
  // 404 (not 403) so an attacker can't probe to discover unpublished events.
  // The friendly copy MUST be byte-identical to the not-found case above so
  // a probe attacker can't differentiate a missing row from a draft row.
  //
  // PO decision 2026-10-07: "off the map" (`is_published = 0`) means not
  // listed. It does not mean hidden. A LIVE event's page opens for anyone who
  // holds its link, QR code or short link, the same as during the publish
  // grace window; the list, map, sitemap and sponsor discovery still leave it
  // out. So `is_published` closes the page only for an event that is not live.
  const status = (row.status || '').toLowerCase();
  // OSE-1519: an event that was live and is now archived is named, as ended. The
  // "was live" test is `listed_from`: an event archived straight from draft was
  // never public, so naming it would leak a draft's title; it stays the generic
  // 404 below. (A published archived event still renders its recap, below.)
  if (status === 'archived' && row.is_published !== 1 && row.listed_from) {
    return renderEndedEventPage(env, row);
  }
  const offMap = row.is_published !== 1;
  if (status === 'draft' || status === 'ready' || (offMap && status !== 'active')) {
    return renderErrorPage(
      404,
      "We couldn't find that event",
      EVENT_NOT_OPEN_COPY,
      '/events',
      'Browse upcoming events'
    );
  }

  // /events/<id>/<name>: the id has decided the event; a name that is not this
  // event's own forwards to the right one. Checked only after the gate above,
  // so a draft answers the same 404 whatever name is asked and never reveals
  // its real one.
  if (requestedSlug !== undefined) {
    // OSE-1761: a name forwarded under a language prefix keeps the prefix.
    const own = withLangPrefix(
      pathLang ?? DEFAULT_LANG,
      eventPagePath(encodeURIComponent(row.id), row.slug)
    );
    const asked = new URL(request.url);
    if (asked.pathname !== own) {
      return new Response(null, { status: 301, headers: { Location: own + asked.search } });
    }
  }

  // Phase-aware dispatch via the OSE-242 canonical resolver.
  // OSE-1313 — a timed event's phase pivots at its canonical start instant
  // (starts_at) and its date-only end closes at the end of that local day.
  // OSE-475: the same call the TV's display-config makes (eventPhaseOf).
  const phaseTimes = phaseTimesFor(row);
  const phase = eventPhaseOf(row);

  // CSP nonce — generated for the response headers regardless of whether
  // the body uses it. `securityHeaders(nonce)` writes the nonce into the
  // CSP header so any future inline <script> on this page is enforceable
  // immediately. The render functions don't take the nonce because the
  // current CSP allows `style-src 'unsafe-inline'` (see CSP-tightening
  // follow-on story) — a style nonce would be theater today.
  const nonce = generateNonce();
  // OSE-1761: an explicit prefix wins; a bare address still negotiates by header.
  const lang = pathLang ?? preferredLang(request);
  const url = new URL(request.url);
  const pageQuery = carriedQuery(url);
  // Production names one host (the zone also routes www.), so the share link,
  // og:url and the canonical (buildSearchMeta) always agree. The address names
  // the language the body is in, so a Spanish body reached on a bare address
  // still has its /es/ page as the canonical.
  const shareUrl = `${canonicalOrigin(request, env) ?? url.origin}${withLangPrefix(lang, eventPagePath(row.id, row.slug))}`;
  const preEventFormContext = eventFormContextFromRequest(request, 'register');
  const liveEventFormContext = eventFormContextFromRequest(request, 'checkin');

  // Fetch social data (sponsors + counts) and the other events at this venue
  // (OSE-1518) in parallel; both fail open, so the page always renders.
  const [social, nextEvents] = await Promise.all([
    fetchEventPageSocialData(env, row.id),
    nextEventsAtVenue(env, row),
  ]);

  let body: string;
  if (phase === 'pre_event') {
    body = renderPreEventHtml(row, shareUrl, social, {
      nonce,
      lang,
      formContext: preEventFormContext,
      nextEvents,
      pageQuery,
    });
  } else if (phase === 'event') {
    body = renderEventLiveHtml(row, shareUrl, social, {
      nonce,
      lang,
      formContext: liveEventFormContext,
      nextEvents,
      pageQuery,
    });
  } else {
    // post_event: real recap + return loop (OSE-245 ose-client-ready package).
    // renderMinimalPhaseHtml is kept as the defensive fallback for phase==='event'
    // only — do NOT delete (Invariant #10 deprecation_lock).
    // OSE-657: a curated few upcoming events at the same venue — the subtle
    // margin, bounded by MAX_POST_EVENT_SUGGESTIONS (never an exhaustive list).
    // Read above, in parallel with the social data.
    body = renderPostEventHtml(row, shareUrl, nextEvents, social, { nonce, lang, pageQuery });
  }

  // OSE-1012/1013: the /events/:id page is where the demo event actually renders
  // (poster QR encodes the mock event). Declare provenance for the served data —
  // 'demo' showcase banner, 'degraded' fallback indicator, or nothing when live.
  body = injectProvenanceBanner(body, await resolveAndSignalProvenance(env, 'public-event'));

  // Off the map: open to whoever holds the link, never announced. Ask search
  // engines not to index it (header and meta, as the admin previews do).
  if (offMap) body = body.replace('</head>', '<meta name="robots" content="noindex" />\n</head>');

  // OSE-658 cache-coherence: private (never shared-edge — the body may carry a
  // sub-floor count, #7) and hard-expiring by the next phase pivot so no stale
  // pre/in/post state is ever served past the start/end boundary.
  return new Response(body, {
    status: 200,
    headers: {
      ...securityHeaders(nonce),
      'Cache-Control': publicEventCacheControl({ status: row.status, ...phaseTimes }, phase),
      // OSE-1760: on a bare address the body depends on the Accept-Language
      // header, so a cache must keep one copy per language. (The page is already
      // private; this keeps a browser from replaying one language after the
      // visitor changes theirs.) OSE-1761: under a language prefix the address
      // alone decides the language and the header is not read.
      ...(pathLang ? {} : { Vary: 'Accept-Language' }),
      ...(offMap ? { 'X-Robots-Tag': 'noindex' } : {}),
    },
  });
}

const ADMIN_PREVIEW_CSS = `<style>
.admin-preview-toolbar{position:sticky;top:0;z-index:1000;margin:-1.5rem -1.25rem 1.25rem;padding:.75rem 1.25rem;background:var(--surface);border-bottom:2px solid var(--accent);display:flex;gap:.75rem;flex-wrap:wrap;align-items:center}
.admin-preview-toolbar p{flex-basis:100%;margin:0}
.draft-mark{display:none}
@media print{.admin-preview-toolbar{display:none}.draft-mark{display:block;position:fixed;top:0;left:0;right:0;z-index:9;text-align:center;font-weight:700;border:2px solid;background:Canvas;color:CanvasText}}
</style>`;

/**
 * OSE-1355 — the "Preview — not live" banner an admin sees on top of the REAL
 * pre-event render (renderPreEventHtml with `preview: true`; no second
 * template). Its Go live walks the same state-machine doors the admin cockpit
 * uses (transition()/goLiveFromDraft in admin.html): draft -> ready through
 * PUT /api/v2/admin/events/:id {status}, then ready -> active through POST
 * /verify-qr. It deliberately does NOT touch is_published — listing is the
 * host's publication act (migration 0070), and a preview must never flip it.
 * A live event's page opens by link whether or not it is on the map (PO
 * 2026-10-07), so Publish always has a public page to land on.
 */
function injectAdminPreviewToolbar(
  body: string,
  row: { id: string; status: string },
  nonce: string,
  // liveUrl: where Publish lands (the poster preview goes to the live poster).
  // Without it, Publish opens the public event page.
  opts: { liveUrl?: string; note?: string } = {}
): string {
  const safeId = esc(row.id);
  const liveAttr = opts.liveUrl ? ` data-live-url="${esc(opts.liveUrl)}"` : '';
  const note =
    opts.note ??
    'This is what people will see once it is live. Buttons below are switched off here, and nothing is counted.';
  const status = row.status === 'ready' ? 'ready' : 'draft';
  const publishBtn = `<button id="adminPreviewGoLive" class="btn btn-primary" data-testid="admin-preview-go-live" type="button" data-event-id="${safeId}" data-status="${status}"${liveAttr}>Publish</button>`;
  const toolbar = `<aside class="admin-preview-toolbar" aria-label="Preview" data-testid="admin-draft-preview-toolbar">
  <strong data-testid="admin-preview-banner">Preview — not live</strong>
  <span data-testid="admin-draft-preview-status">${status === 'ready' ? 'Ready' : 'Draft'}</span>
  <a class="btn btn-secondary" data-testid="admin-preview-back" href="/admin">Back to admin</a>
  ${publishBtn}
  <p data-testid="admin-preview-note">${esc(note)}</p>
  <p id="adminPreviewMsg" data-testid="admin-preview-msg" role="status" aria-live="polite"></p>
</aside>
<script nonce="${nonce}">(function(){var b=document.getElementById('adminPreviewGoLive'),m=document.getElementById('adminPreviewMsg');if(!b)return;function say(t){if(m)m.textContent=t;}function call(u,meth,body){return fetch(u,{method:meth,credentials:'same-origin',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}).then(function(r){return r.json().catch(function(){return {};}).then(function(d){if(!r.ok||d.ok===false)throw new Error((d&&(d.error||d.code))||('HTTP '+r.status));return d;});});}b.addEventListener('click',function(){var id=b.dataset.eventId,base='/api/v2/admin/events/'+encodeURIComponent(id);b.disabled=true;say('Publishing…');(b.dataset.status==='draft'?call(base,'PUT',{status:'ready'}):Promise.resolve()).then(function(){b.dataset.status='ready';return call(base+'/verify-qr','POST');}).then(function(){if(b.dataset.liveUrl){say('Published. Opening it…');window.location.href=b.dataset.liveUrl;}else{say('Published. Opening the public page…');window.location.href='/events/'+encodeURIComponent(id);}}).catch(function(e){b.disabled=false;say('Could not publish: '+(e&&e.message?e.message:'try again'));});});})();</script>`;
  return body
    .replace('</head>', `${ADMIN_PREVIEW_CSS}\n</head>`)
    .replace('<body>', `<body>\n${toolbar}`);
}

/** Headers every admin preview response carries: never cached, never indexed. */
const PREVIEW_HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };

function previewError(status: number, title: string, body: string): Response {
  const res = renderErrorPage(status, title, body, '/admin', 'Back to admin');
  for (const [k, v] of Object.entries(PREVIEW_HEADERS)) res.headers.set(k, v);
  return res;
}

/**
 * GET /api/v2/admin/events/:id/preview — OSE-1355 draft preview.
 *
 * Admin-only by construction: the router runs requireAdmin, the path sits under
 * /api/v2/admin/* (Cloudflare Access at the edge on staging/prod), and
 * guardAdminObjectScope 404s an id outside the caller's brands before this runs.
 *
 * - draft / ready  → the real pre-event page + preview banner (200).
 * - active         → 303 to /events/:id: it is public, so the public page IS
 *                    the preview (no second, admin-only copy of a live page).
 * - archived       → 404: there is nothing to preview until it is reopened.
 *
 * Read-only: SELECTs only. No scan, click, impression, shortlink or audit row
 * is written, and the rendered RSVP/share controls are inert (never-who: a
 * preview is not a visit).
 */
export async function handleAdminEventPreviewPage(
  request: Request,
  env: PublicEventEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) {
    return previewError(
      503,
      "We're having trouble loading this event",
      'The admin event preview is briefly unavailable. Try again in a minute.'
    );
  }

  if (!eventId || eventId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(eventId)) {
    return previewError(404, "We couldn't find that event", 'This admin preview link is invalid.');
  }

  let row: PublicEventRow | null;
  try {
    row = await env.DB.prepare(
      `SELECT e.id, e.brand_id, e.title, e.slug, e.status, e.description, e.location,
              start_date, end_date, timezone, starts_at,
              what_short, who_host, why_purpose, how_details, where_address,
              who_story, who_image_url, what_video_url, what_url,
              what_url_enabled, what_url_type,
              lat, lon, price_cents, price_model, price_note, is_published,
              e.attendance_mode,
              e.event_type_id, etr.name AS event_type_name
       FROM events e
       LEFT JOIN event_type_registry etr ON etr.id = e.event_type_id
       WHERE e.id = ?`
    )
      .bind(eventId)
      .first<PublicEventRow>();
  } catch {
    return previewError(
      503,
      "We're having trouble loading this event",
      'The admin event preview is briefly unavailable. Try again in a minute.'
    );
  }

  if (!row) {
    return previewError(
      404,
      "We couldn't find that event",
      'This admin preview link no longer points to an event.'
    );
  }

  const status = (row.status || 'draft').toLowerCase();
  // Live: the public page IS the preview, on the map or off it (a live event's
  // page opens by link while it is off the map, PO 2026-10-07).
  if (status === 'active') {
    return new Response(null, {
      status: 303,
      headers: { Location: `/events/${encodeURIComponent(row.id)}`, ...PREVIEW_HEADERS },
    });
  }
  if (status !== 'draft' && status !== 'ready') {
    return previewError(
      404,
      'Nothing to preview',
      'This event is archived. Reopen it as a draft in admin to preview it again.'
    );
  }

  const nonce = generateNonce();
  const lang = preferredLang(request);
  const url = new URL(request.url);
  const shareUrl = `${url.origin}/events/${row.id}`;
  const social = await fetchEventPageSocialData(env, row.id);
  const body = injectAdminPreviewToolbar(
    renderPreEventHtml(row, shareUrl, social, { nonce, lang, preview: true }),
    { id: row.id, status },
    nonce
  );

  return new Response(body, {
    status: 200,
    headers: { ...securityHeaders(nonce), ...PREVIEW_HEADERS },
  });
}

/**
 * GET /api/v2/admin/events/:id/poster-preview — the real poster for a draft.
 *
 * Same gating and states as the event preview above: requireAdmin in the
 * router, guardAdminObjectScope for the brand, no-store + noindex. draft/ready
 * render poster.html in preview mode (data-preview-event on <body>, so its one
 * data call goes to the admin poster-bundle instead of the public one); active
 * redirects to the real /events/<id>/poster; archived or missing is a 404. The
 * toolbar is hidden when printing, so a test print looks like the real one.
 */
export async function handleAdminPosterPreviewPage(
  env: PublicEventEnv,
  eventId: string
): Promise<Response> {
  if (!env.DB) {
    return previewError(
      503,
      "We're having trouble loading this event",
      'The poster preview is briefly unavailable. Try again in a minute.'
    );
  }
  if (!eventId || eventId.length > 128 || !/^[a-zA-Z0-9_\-]+$/.test(eventId)) {
    return previewError(404, "We couldn't find that event", 'This poster preview link is invalid.');
  }
  let row: { id: string; status: string; is_published: number | null } | null;
  try {
    row = await env.DB.prepare('SELECT id, status, is_published FROM events WHERE id = ?')
      .bind(eventId)
      .first<{ id: string; status: string; is_published: number | null }>();
  } catch {
    return previewError(
      503,
      "We're having trouble loading this event",
      'The poster preview is briefly unavailable. Try again in a minute.'
    );
  }
  if (!row) {
    return previewError(
      404,
      "We couldn't find that event",
      'This poster preview link no longer points to an event.'
    );
  }
  const status = (row.status || 'draft').toLowerCase();
  const posterUrl = `/events/${encodeURIComponent(row.id)}/poster`;
  if (status === 'active') {
    return new Response(null, {
      status: 303,
      headers: { Location: posterUrl, ...PREVIEW_HEADERS },
    });
  }
  if (status !== 'draft' && status !== 'ready') {
    return previewError(
      404,
      'Nothing to preview',
      'This event is archived. Reopen it as a draft in admin to preview it again.'
    );
  }
  const nonce = generateNonce();
  // Nonce the poster's own scripts first; the toolbar brings its own nonce.
  const page = POSTER_HTML.replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`); // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag
  const body = injectAdminPreviewToolbar(page, { ...row, status }, nonce, {
    liveUrl: posterUrl,
    note: 'This is the poster people will see once it is live. Print a test copy if you like: this bar does not print, and a test print is marked DRAFT.',
  }).replace(
    '<body>',
    // Print-only DRAFT mark (OSE-1508, PO 2026-10-02): a test print hung by
    // mistake is obvious, and its QR codes carry no placement. Fixed in print,
    // so it overlays the poster's top margin on every sheet and takes no room
    // in the flow: it can never push the one-page poster onto a second sheet.
    `<body data-poster-format="${DEFAULT_POSTER_CODE}" data-preview-event="${esc(row.id)}">` +
      '<p class="draft-mark" data-testid="poster-draft-mark">DRAFT \u2014 not live yet. Test print only.</p>'
  );
  return new Response(body, {
    status: 200,
    headers: { ...securityHeaders(nonce), ...PREVIEW_HEADERS },
  });
}

export function handleAdminPage(_env: PagesEnv): Response {
  const res = html(injectLegalFooter(ADMIN_HTML, 'admin'));
  // Not kept in a browser or shared-device cache, so it is not shown again after sign-out.
  res.headers.set('Cache-Control', 'no-store');
  return res;
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

    // L4 (OSE-1378): dark by default — no-op unless TURNSTILE_ENABLED === 'true'.
    const turnstileDeny = await guardTurnstile(
      request,
      env,
      'subscribe',
      (body as { 'cf-turnstile-response'?: unknown })['cf-turnstile-response']
    );
    if (turnstileDeny) return turnstileDeny;

    // Persist to D1 if available (graceful fallback if FORMS_DB not provisioned).
    // The list lives in FORMS_DB, with the other identified-person tables, not
    // in the anonymous DB (OSE-1661, owner 2026-10-11; forms migration 0017).
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
    if (env.FORMS_DB) {
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
        await env.FORMS_DB.prepare(
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
            error: errorLabel(dbErr),
          })
        );
      }
    }

    return Response.json({ success: true, persisted });
  } catch {
    return Response.json({ success: false, error: 'Invalid request body.' }, { status: 400 });
  }
}

// ─── Landing page — OSE-1312, "where are you?" (owner 2026-10-10) ──────────────
//
// One question first: your town, or your zip (owner 2026-11-06: a town name
// first, then a zip; or the nearest zip to a phone's rough box,
// lib/landing-where.ts). With a zip, the area lists the events in the zip's own
// area (lib/zip-areas.ts inZipOwnArea: the zip in the event's address, else the
// nearest zip center, within 8 rings); with a town, its zips' own areas; with a
// name that is many towns, every match to choose from and the events of all of
// them (lib/place-search.ts); without any, every listed event. No cookies, no analytics; list/map and window toggles stay CSS-only
// (renderLandingArea).
//
// Reads events through the SAME DataProvider seam + enrichWithPhase as
// `GET /api/v2/events`, so the page and the JSON API cannot describe different
// events. A read failure renders the empty area, never a broken page.
type LandingEnv = PagesEnv & DataProviderEnv & StreetMapEnv;

/**
 * What the landing's language switch carries to the same page in another
 * language: the zip or the town the page found, or the name that is many places.
 * An unknown place or zip, and anything else, does not carry.
 */
function switchQuery(where: WhereState): string {
  if (where.kind === 'zip') return `?zip=${encodeURIComponent(where.area.zip)}`;
  if (where.kind === 'place') return `?where=${encodeURIComponent(where.place.label)}`;
  if (where.kind === 'choose') return `?where=${encodeURIComponent(where.typed)}`;
  return '';
}

export async function handleLandingPage(
  env: PagesEnv,
  ctx?: DataProviderCtx | null,
  request?: Request,
  /** OSE-1762: the language in the address (`/es/`); it beats the header. */
  pathLang?: Lang
): Promise<Response> {
  const lang = pathLang ?? (request ? preferredLang(request) : DEFAULT_LANG);
  let where: WhereState;
  try {
    where = readWhere(request ? new URL(request.url) : null);
  } catch {
    where = { kind: 'none' };
  }
  // A zip, one place, or the places a name means: results come first.
  const searched = where.kind === 'zip' || where.kind === 'place' || where.kind === 'choose';
  // A tapped hexagon: `?area=<res-7 cell>` opens that area zoomed in (owner,
  // 2026-11-09). The links keep the visitor's search; anything but a res-7 cell
  // is ignored.
  let zoom: ReturnType<typeof landingZoom>;
  try {
    zoom = landingZoom(request ? new URL(request.url) : null, withLangPrefix(lang, '/'));
  } catch {
    zoom = landingZoom(null, withLangPrefix(lang, '/'));
  }
  let area;
  try {
    const dp = getDataProvider(env as LandingEnv, ctx ?? null);
    const result = await dp.listEvents('root');
    // OSE-2012: an online event is link only. It has no cell, so it could never
    // be on the map; this keeps it out of the landing's list and counts too.
    let items = withoutLinkOnly(result.data as unknown as Record<string, unknown>[]).map(
      enrichWithPhase
    );
    if (where.kind === 'zip') {
      // Owner 2026-11-05: the zip's own area, not the towns around it.
      items = items.filter(inZipOwnArea(where.area));
    } else if (where.kind === 'place') {
      // Owner 2026-11-06: a town name first; its zips' own areas.
      items = items.filter(inPlaceMatches([where.place]));
    } else if (where.kind === 'choose') {
      // One name, many places: the events of every match, while the person picks.
      items = items.filter(inPlaceMatches(where.matches));
    }
    // §6.2b latch: corridors that have ever reached the threshold stay on the
    // map. Brand-bound read; a missing table (pre-0084) just means none yet.
    // The landing's own latch rides in the same table: once the area has held
    // LIST_MAX events it keeps leading with the map.
    let latched = new Set<string>();
    let areaLatched = false;
    if ((env as LandingEnv).DB) {
      try {
        const l = await readLatches((env as LandingEnv).DB as D1Database, 'root');
        latched = l.corridors;
        areaLatched = l.landingArea;
      } catch {
        latched = new Set();
      }
    }
    // OSE-1522: the consented sponsor by the title on each card, as on /events.
    const sponsorTitles = await fetchSponsorTitles((env as LandingEnv).DB, 'root');
    // Owner 2026-11-09: the Type row is the categories of the event-type
    // catalog, read through the same query as the Create Event picker.
    let typeCategories: Map<string, TypeCategory> | undefined;
    try {
      typeCategories = categoryByTypeId(await readEventTypeCatalog((env as LandingEnv).DB));
    } catch {
      // A failed read only folds every event into "Other" (one choice, so no
      // row); the cards still show. tests/landing-category-scenarios.spec.ts.
    }
    // Zoomed in: each event's own links and share code, for its panel card.
    // Direct destinations only; a map tap is never counted (OSE-1897).
    const zoomCell = zoom.cell;
    const placeLinks = zoomCell
      ? await fetchPlaceLinks(
          (env as LandingEnv).DB,
          items.filter((e) => e.h3_res7 === zoomCell).map((e) => String(e.id))
        )
      : undefined;
    const origin = canonicalOrigin(request, env);
    const areaOpts = {
      placeLinks,
      origin,
      latched,
      areaLatched: searched ? false : areaLatched,
      sponsorTitles,
      lang,
      zoomHref: (cell: string) => zoom.href(cell),
      zoom: zoom.cell ? { cell: zoom.cell, backHref: zoom.href() } : undefined,
      typeCategories,
    };
    area = renderLandingArea(items as LandingAreaItem[], areaOpts);
    // The street map under the hexagons (lib/street-map.ts): drawn for exactly
    // the cells the first pass drew, then the area is drawn again with it. No
    // binding, or any failure, leaves the hexagons-only map from the first pass.
    if (area.mapCells?.length) {
      const streets = await loadStreetLayer(env as LandingEnv, area.mapCells);
      if (streets) area = renderLandingArea(items as LandingAreaItem[], { ...areaOpts, streets });
    }
  } catch {
    area = renderEmptyLandingArea(lang);
  }
  if (searched && !zoom.cell && area.windowCount === 0 && area.categories.length === 0) {
    const empty =
      where.kind === 'zip'
        ? renderNearEmpty(where.area.zip, lang)
        : where.kind === 'place'
          ? renderPlaceEmpty(where.place.label, lang)
          : where.kind === 'choose'
            ? renderAnyPlaceEmpty(where.typed, lang)
            : '';
    area = { ...area, html: empty };
  }
  // /home, /welcome, /landing, /about and /info serve this page too; they all
  // name `/` as the canonical.
  // OSE-1762: the shell's words are filled in the page's language first.
  const shell = injectNeverWho(
    injectEventCardCss(
      withLanguageSwitch(
        injectLegalFooter(
          injectNearLang(fillTemplate(LANDING_HTML, lang), lang),
          'landing',
          undefined,
          lang
        ),
        lang,
        CANONICAL_PATH.landing,
        switchQuery(where)
      ),
      PLACE_PANEL_CSS
    ),
    'landing',
    lang
  );
  const res = html(
    injectLanguageHead(
      injectLanguageAlternates(
        injectCanonical(
          injectWhere(
            injectLandingArea(shell, area, { areaFirst: searched || zoom.cell !== null }),
            where,
            lang
          ),
          request,
          env,
          withLangPrefix(lang, CANONICAL_PATH.landing)
        ),
        request,
        env,
        CANONICAL_PATH.landing
      ),
      lang
    )
  );
  languageVaried(res, pathLang);
  // The one surface allowed to ask for location, for itself only.
  res.headers.set('Permissions-Policy', LANDING_PERMISSIONS_POLICY);
  return res;
}

// ─── Display page (TV / kiosk) ──────────────────────────────────────────────────

// ─── Poster page (printable) ────────────────────────────────────────────────────

// ─── Shared report page ─────────────────────────────────────────────────────────

export async function handleDisplayPage(env: PagesEnv): Promise<Response> {
  const res = html(await withProvenanceBanner(DISPLAY_HTML, env, 'display'));
  // A screen for the venue, not a page to find: it repeats the event page, and
  // opening it logs sponsor showings (OSE-1684). Its links may still be followed.
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
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
  const res = html(
    injectProvenanceBanner(content, await resolveAndSignalProvenance(env, 'poster'))
  );
  // The poster repeats the event page; the event page is the one to find
  // (OSE-1684). Its links may still be followed.
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}

export async function handleSharedReportPage(env: PagesEnv): Promise<Response> {
  // Inject data-maps-configured so client-side JS knows whether to render
  // map thumbnails via the /api/v2/maps/venue-image proxy endpoint.
  const mapsAttr = isGoogleMapsConfigured(env) ? ' data-maps-configured="1"' : '';
  const content = injectLegalFooter(
    SHARED_REPORT_HTML.replace('<body>', `<body${mapsAttr}>`),
    'shared-report'
  );
  const res = html(
    injectProvenanceBanner(content, await resolveAndSignalProvenance(env, 'sharedReport'))
  );
  // Opened by a signed link (?token=). Not kept in a cache, and the address is
  // never sent on in a Referer header, whatever is in it at that moment.
  res.headers.set('Cache-Control', 'no-store');
  res.headers.set('Referrer-Policy', 'no-referrer');
  return res;
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
          <select class="sort-select" data-testid="sort-select-demo" aria-label="Sort order"><option>Most recent</option><option>Oldest first</option></select>
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
            <span id="toggle-row-demo-label">Enable feature</span>
            <label class="toggle"><input type="checkbox" checked aria-labelledby="toggle-row-demo-label" /><span class="toggle-track"></span></label>
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
