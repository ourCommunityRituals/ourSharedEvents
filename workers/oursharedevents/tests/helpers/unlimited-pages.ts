/**
 * Every page address the router serves WITHOUT a per-caller limit, and why
 * (OSE-1986).
 *
 * Until 2026-11-16 a limit showed only at its call site in the router, so a new
 * public page could ship with none and nobody would be asked. This list is the
 * other half of `tests/public-page-limit-gate.spec.ts`, which asks the real
 * router for every address in `tests/helpers/page-surfaces.ts` (itself held
 * equal to the route table) and requires each one to be limited or to be here.
 *
 * Adding an address here is the decision "this page needs no limit", or the
 * admission "this page should have one and has not got it yet". The second kind
 * names the ticket that owns the gap. The gate also fails when an address on
 * this list IS limited, so the list cannot go stale.
 *
 * Keys are the shapes `routeShapes()` prints (tests/helpers/route-shapes.ts).
 */
export interface Unlimited {
  why: string;
  /** The ticket that owns the gap, when this is a gap and not a decision. */
  gap?: string;
}

const fixed = (what: string): Unlimited => ({
  why: `${what}: fixed content, no database, bucket or outside read.`,
});
const forward = (): Unlimited => ({
  why: 'A 301 forward to another address, which carries its own limit. Reads nothing.',
});
const postOnly = (): Unlimited => ({
  why: 'POST only; a GET is a fixed 405. The POST has its own limit in the handler.',
});
const gap = (what: string): Unlimited => ({
  why: `${what}. Served with no per-caller limit today.`,
  gap: 'OSE-2086',
});

export const UNLIMITED_PAGES: Readonly<Record<string, Unlimited>> = {
  // ── Fixed files and pages ────────────────────────────────────────────────
  '/ui.css': fixed('The shared stylesheet'),
  '/ui-toast.js': fixed('The shared toast script'),
  'const:EVENT_DEFAULT_THUMB_PATH': fixed('The default event thumbnail'),
  'const:SPONSOR_DEFAULT_LOGO_PATH': fixed('The default sponsor logo'),
  '/.well-known/jwks.json': fixed('The public key set'),
  '/.well-known/openid-configuration': fixed('The OIDC discovery document'),
  '/privacy': fixed('The privacy page'),
  '/privacy-policy': fixed('The privacy page'),
  '/demo': fixed('The demo index'),
  '/demo/:param': fixed('A demo site, built from fixtures in the bundle'),
  '/ui-preview': fixed('The component showcase'),

  // ── Forwards and POST targets ────────────────────────────────────────────
  '/public': forward(),
  '/schedule': forward(),
  '/calendar': forward(),
  '/agenda': forward(),
  '/lineup': forward(),
  '/event': forward(),
  '/event/*': forward(),
  '/subscribe': postOnly(),
  '/signup': postOnly(),
  '/newsletter': postOnly(),

  // ── Gaps: these read data on every request and have no limit yet ─────────
  '/events/*': gap('The public event page reads the event from the database'),
  '/events/:param/:param': gap('The public event page, at its named address'),
  '/events/:param/(register|checkin|survey|updates)': gap(
    'A form page reads its event on GET (its POST is limited)'
  ),
  '/forms/:param/?': gap('A form page at its older address'),
  '/events/:param/(tv|poster)': gap("An event's TV and poster"),
  '/display': gap('The TV page'),
  '/tv': gap('The TV page'),
  '/kiosk': gap('The TV page'),
  '/screen': gap('The TV page'),
  '/poster': gap('The poster page'),
  '/posters': gap('The poster page'),
  '/flyers': gap('The poster page'),
  '/tabletop': gap('The poster page'),
  '/tent': gap('The poster page'),
  '/signage': gap('The poster page'),
  '/sharedReport': gap('The SharedReport page'),
  '/report': gap('The SharedReport page'),
  '/analytics': gap('The SharedReport page'),
  '/reports': gap('The SharedReport page'),
  '/insights': gap('The SharedReport page'),
  '/stats': gap('The SharedReport page'),
  '/health': gap('The health check pings the database'),
  '/robots.txt': gap('The crawl policy lists events from the database where a site is indexable'),
};

/**
 * The language-prefix samples (`LANGUAGE_PREFIX_SAMPLES` in page-surfaces.ts)
 * and whether each is limited. A new sample fails the gate until it is decided
 * here.
 */
export const PREFIX_SAMPLE_LIMITED: Readonly<Record<string, boolean | Unlimited>> = {
  '/es/': true,
  '/es/events': true,
  '/es/events/no-such-event': gap('The public event page under a language prefix'),
};
