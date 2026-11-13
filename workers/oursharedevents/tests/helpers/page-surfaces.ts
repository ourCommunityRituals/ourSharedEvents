/**
 * Every address the router answers outside /api/, and whether a browser gets a
 * page there (OSE-2030, OSE ADR-028).
 *
 * AGENTS.md invariant 8 says one <h1> per page. Until 2026-11-13 that rule was
 * checked on a remembered list of pages; the demo sites were not on it and all
 * four shipped with no <h1>. This list is not remembered: it is held equal to
 * the route table by `page-surfaces-route-table.spec.ts`, which reads the
 * addresses out of `src/router.ts`. A new address fails there until it is added
 * here, and adding it here is the decision "is this a page?".
 *
 *   html: true   a browser gets an HTML document at the sample addresses.
 *                `page-surfaces-one-h1.spec.ts` asks the real router for each
 *                and requires exactly one <h1>.
 *   html: false  never a document: a forward, a file, data, or a POST target.
 *                The same spec requires that it is still not HTML, so a page
 *                cannot hide under this label.
 *
 * `admin: true` asks with the pool's admin key, because without it the address
 * answers a JSON 401 and there is no page to check.
 *
 * `h1: 'in-browser'` marks a page that draws its heading with a script. The
 * workers pool sees only the served markup, so that page is checked in a
 * browser instead. It is an exception with a named list, not a way out.
 *
 * Keys are the shapes `routeShapes()` prints (tests/helpers/route-shapes.ts).
 * Samples need no seeded data: an unknown event or code answers the error page,
 * which is a page too and follows the same rule.
 */
export interface PageSurface {
  /** Addresses to request. One per alternative when the shape has several. */
  samples: string[];
  /** Does a browser get an HTML document here? */
  html: boolean;
  /** Ask with the pool's admin key. */
  admin?: boolean;
  /**
   * The page draws its heading in the browser, so the served markup has none
   * and the workers pool cannot count it. The browser layer checks it instead
   * (tests/playwright/a11y-profile.spec.ts). The only such page is the
   * briefing; `page-surfaces-one-h1.spec.ts` fails if another takes this label.
   */
  h1?: 'in-browser';
  /** What the address is, in a few words. */
  what: string;
}

const page = (what: string, ...samples: string[]): PageSurface => ({ samples, html: true, what });
const adminPage = (what: string, ...samples: string[]): PageSurface => ({
  samples,
  html: true,
  admin: true,
  what,
});
const browserDrawnAdminPage = (what: string, ...samples: string[]): PageSurface => ({
  samples,
  html: true,
  admin: true,
  h1: 'in-browser',
  what,
});
const notPage = (what: string, ...samples: string[]): PageSurface => ({
  samples,
  html: false,
  what,
});

export const PAGE_SURFACES: Readonly<Record<string, PageSurface>> = {
  // ── The landing and its aliases ──────────────────────────────────────────
  '/': page('Landing.', '/'),
  '/home': page('Landing alias.', '/home'),
  '/welcome': page('Landing alias.', '/welcome'),
  '/landing': page('Landing alias.', '/landing'),
  '/about': page('Landing alias.', '/about'),
  '/info': page('Landing alias.', '/info'),
  '/near': notPage('Landing "Use my location": a POST target; GET forwards 303 to /.', '/near'),

  // ── Events ───────────────────────────────────────────────────────────────
  '/events': page('The event list.', '/events'),
  '/events/*': page('One event page (the error page when unknown).', '/events/no-such-event'),
  '/events/:param/:param': page(
    'One event page at its named address.',
    '/events/no-such-event/some-name'
  ),
  '/events/:param/(tv|poster)': page(
    "One event's TV and poster.",
    '/events/no-such-event/tv',
    '/events/no-such-event/poster'
  ),
  '/events/:param/(register|checkin|survey|updates)': page(
    "One event's form pages.",
    '/events/no-such-event/register',
    '/events/no-such-event/checkin',
    '/events/no-such-event/survey',
    '/events/no-such-event/updates'
  ),
  '/events/:param/calendar.ics': notPage(
    'Calendar download.',
    '/events/no-such-event/calendar.ics'
  ),
  '/event': notPage('Forwards 301 to /events.', '/event'),
  '/event/*': notPage('Forwards 301 to /events/<rest>.', '/event/abc'),
  '/public': notPage('Forwards 301 to /events.', '/public'),
  '/schedule': notPage('Forwards 301 to /events.', '/schedule'),
  '/calendar': notPage('Forwards 301 to /events.', '/calendar'),
  '/agenda': notPage('Forwards 301 to /events.', '/agenda'),
  '/lineup': notPage('Forwards 301 to /events.', '/lineup'),

  // ── Printed codes ────────────────────────────────────────────────────────
  '/(e|p|tv|r|c)/:param': page(
    'Short code. A known code forwards; an unknown one answers the error page.',
    '/e/abc123',
    '/p/abc123',
    '/tv/abc123',
    '/r/abc123',
    '/c/abc123'
  ),
  '/q/*': notPage('Poster QR scan: always a forward.', '/q/abc'),
  '/s/*': notPage('Short link: a forward, or a JSON 404.', '/s/abc'),

  // ── Forms at their older address ─────────────────────────────────────────
  '/forms/:param/?': page('Form page, older address.', '/forms/no-such-event?type=register'),

  // ── Display and poster ───────────────────────────────────────────────────
  '/display': page('TV display.', '/display'),
  '/tv': page('Alias of /display.', '/tv'),
  '/kiosk': page('Alias of /display.', '/kiosk'),
  '/screen': page('Alias of /display.', '/screen'),
  '/poster': page('Printable poster.', '/poster'),
  '/posters': page('Alias of /poster.', '/posters'),
  '/flyers': page('Alias of /poster.', '/flyers'),
  '/tabletop': page('Alias of /poster.', '/tabletop'),
  '/tent': page('Alias of /poster.', '/tent'),
  '/signage': page('Alias of /poster.', '/signage'),

  // ── SharedReport ─────────────────────────────────────────────────────────
  '/sharedReport': page('SharedReport shell.', '/sharedReport'),
  '/report': page('Alias of /sharedReport.', '/report'),
  '/reports': page('Alias of /sharedReport.', '/reports'),
  '/analytics': page('Alias of /sharedReport.', '/analytics'),
  '/insights': page('Alias of /sharedReport.', '/insights'),
  '/stats': page('Alias of /sharedReport.', '/stats'),

  // ── Sponsors ─────────────────────────────────────────────────────────────
  '/sponsor': page('Sponsor home; without a token, its sign-in page.', '/sponsor'),
  '/sponsors/:param': page("A sponsor's public card.", '/sponsors/no-such-sponsor'),

  // ── Demo sites (the permanent reference installation) ────────────────────
  '/demo': page('Demo index.', '/demo'),
  '/demo/:param': page(
    'A demo site, and the unknown-site page.',
    '/demo/free',
    '/demo/mid',
    '/demo/premium',
    '/demo/no-such-site'
  ),

  // ── Site pages ───────────────────────────────────────────────────────────
  '/privacy': page('Privacy policy.', '/privacy'),
  '/privacy-policy': page('Alias of /privacy.', '/privacy-policy'),
  '/ui-preview': page('Component showcase.', '/ui-preview'),

  // ── The organizer corner (needs the admin key) ───────────────────────────
  '/admin': adminPage('Admin dashboard.', '/admin'),
  '/manage': adminPage('Alias of /admin.', '/manage'),
  '/dashboard': adminPage('Alias of /admin.', '/dashboard'),
  '/create': adminPage('Alias of /admin.', '/create'),
  '/briefing': browserDrawnAdminPage('Platform briefing.', '/briefing'),
  '/overview': browserDrawnAdminPage('Alias of /briefing.', '/overview'),
  '/summary': browserDrawnAdminPage('Alias of /briefing.', '/summary'),

  // ── Not pages: POST targets, files, data ─────────────────────────────────
  '/subscribe': notPage('Email capture: POST only.', '/subscribe'),
  '/signup': notPage('Alias of /subscribe.', '/signup'),
  '/newsletter': notPage('Alias of /subscribe.', '/newsletter'),
  '/health': notPage('Health check, JSON.', '/health'),
  '/robots.txt': notPage('Crawl policy, text.', '/robots.txt'),
  '/sitemap.xml': notPage('Sitemap, XML.', '/sitemap.xml'),
  '/ui.css': notPage('Shared stylesheet.', '/ui.css'),
  '/ui-toast.js': notPage('Shared toast script.', '/ui-toast.js'),
  '/.well-known/openid-configuration': notPage(
    'Workload identity, JSON.',
    '/.well-known/openid-configuration'
  ),
  '/.well-known/jwks.json': notPage('Workload identity, JSON.', '/.well-known/jwks.json'),
  'const:EVENT_DEFAULT_THUMB_PATH': notPage('Default event image.', '/event-default-thumb.svg'),
  'const:SPONSOR_DEFAULT_LOGO_PATH': notPage('Default sponsor image.', '/sponsor-default-logo.svg'),
};

/**
 * Pages under a language prefix. The router strips the prefix before it
 * matches, so these have no shape of their own; they are listed so the Spanish
 * documents are asked for too.
 */
export const LANGUAGE_PREFIX_SAMPLES: readonly string[] = [
  '/es/',
  '/es/events',
  '/es/events/no-such-event',
];
