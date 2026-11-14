/**
 * One event, one folder: the route table keeps every event screen under
 * /events/<id>/… (OSE-1684, the story's last rule).
 *
 * "One test reads the route table, so a new screen for an event cannot land
 * outside /events/<id>/… without a decision."
 *
 * This gate keeps no list of event screens. It reads every address the router
 * answers out of `src/router.ts` (`pathname === '…'`, `pathname.startsWith('…')`,
 * and every `/^\/…$/` path pattern), leaves out /api/ (data, not a page) and
 * sorts the rest:
 *
 *   - under /events/… : the event folder. Nothing to decide.
 *   - in OUTSIDE_THE_FOLDER below : a decision already taken, with its reason.
 *   - anything else : fails, and the message says what to do.
 *
 * So a new address for one event (say /checkin/<id>) fails here until it moves
 * under /events/<id>/ or someone adds it to the list with a reason a reviewer
 * accepts. A list entry the router no longer answers also fails, and a printed
 * address (/s/, /q/, the event codes) can never be dropped: printed codes do not
 * change.
 *
 * Shape (tests/e2e/0-architecture/README.md): property-asserting. The negative
 * controls run the same sorter on a router with a planted address, so the gate
 * is shown to see a new route at all.
 *
 * Placement: node project (reads the source file, no runtime).
 *
 * Seen red (2026-10-11): adding `pathname.match(/^\/checkin\/([^/]+)$/)` to the
 * router fails "every address is in the event folder or decided"; removing the
 * /s/ resolver fails "printed addresses are still answered".
 */
import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { routeShapes, isApi } from './helpers/route-shapes';

const ROUTER = readFileSync(join(__dirname, '..', 'src', 'router.ts'), 'utf8');

type Why = 'site' | 'signed-link' | 'old-address' | 'printed-code';

/**
 * Addresses outside /events/… that the router answers, each a decision.
 *   site         : not about one event.
 *   signed-link  : a private key; the token stays out of the visible path.
 *   old-address  : kept for printed and saved links; the platform no longer writes it.
 *   printed-code : on paper. Never changes, never leaves the router.
 */
const OUTSIDE_THE_FOLDER: Readonly<Record<string, { why: Why; reason: string }>> = {
  // ── Printed codes: never change ──────────────────────────────────────────
  '/q/*': { why: 'printed-code', reason: 'QR scan token, printed on posters.' },
  '/s/*': { why: 'printed-code', reason: 'Short link, printed and shared.' },
  '/(e|p|tv|r|c)/:param': {
    why: 'printed-code',
    reason: "One short code per event (owner 2026-10-09); each forwards into the event's folder.",
  },

  // ── Signed links ─────────────────────────────────────────────────────────
  '/sponsor': {
    why: 'signed-link',
    reason: "The sponsor's own page; the token is dropped from the address bar.",
  },
  '/sharedReport': {
    why: 'signed-link',
    reason: 'The report link is a private key, kept long (owner 2026-10-09).',
  },
  '/report': { why: 'signed-link', reason: 'Alias of /sharedReport.' },
  '/reports': { why: 'signed-link', reason: 'Alias of /sharedReport.' },
  '/analytics': { why: 'signed-link', reason: 'Alias of /sharedReport.' },
  '/insights': { why: 'signed-link', reason: 'Alias of /sharedReport.' },
  '/stats': { why: 'signed-link', reason: 'Alias of /sharedReport.' },

  // ── Old addresses, kept for printed and saved links ──────────────────────
  // The trailing slash is optional (OSE-1754): it is a fat finger, not another page.
  '/forms/:param/?': {
    why: 'old-address',
    reason: 'Printed form codes; the platform now writes /events/<id>/register etc.',
  },
  '/display': {
    why: 'old-address',
    reason: 'Saved kiosks (?event=); the platform now writes /events/<id>/tv.',
  },
  '/tv': { why: 'old-address', reason: 'Alias of /display.' },
  '/kiosk': { why: 'old-address', reason: 'Alias of /display.' },
  '/screen': { why: 'old-address', reason: 'Alias of /display.' },
  '/poster': {
    why: 'old-address',
    reason: 'Saved links (?event=); the platform now writes /events/<id>/poster.',
  },
  '/posters': { why: 'old-address', reason: 'Alias of /poster (format by path).' },
  '/flyers': { why: 'old-address', reason: 'Alias of /poster (format by path).' },
  '/tabletop': { why: 'old-address', reason: 'Alias of /poster (format by path).' },
  '/tent': { why: 'old-address', reason: 'Alias of /poster (format by path).' },
  '/signage': { why: 'old-address', reason: 'Alias of /poster (format by path).' },
  '/event': { why: 'old-address', reason: 'Forwards 301 to /events.' },
  '/event/*': { why: 'old-address', reason: 'Forwards 301 to /events/<rest>.' },
  '/public': { why: 'old-address', reason: 'Forwards 301 to /events.' },
  '/schedule': { why: 'old-address', reason: 'Forwards 301 to /events.' },
  '/calendar': { why: 'old-address', reason: 'Forwards 301 to /events.' },
  '/agenda': { why: 'old-address', reason: 'Forwards 301 to /events.' },
  '/lineup': { why: 'old-address', reason: 'Forwards 301 to /events.' },

  // ── The site: not about one event ────────────────────────────────────────
  '/': { why: 'site', reason: 'Landing.' },
  '/home': { why: 'site', reason: 'Landing alias.' },
  '/welcome': { why: 'site', reason: 'Landing alias.' },
  '/landing': { why: 'site', reason: 'Landing alias.' },
  '/about': { why: 'site', reason: 'Landing alias.' },
  '/info': { why: 'site', reason: 'Landing alias.' },
  '/near': { why: 'site', reason: 'Landing "Use my location".' },
  '/subscribe': { why: 'site', reason: 'Site email capture.' },
  '/brands/:param/calendar.ics': {
    why: 'site',
    reason: "A brand's calendar feed (OSE-2013): about a brand's events, not one event.",
  },
  '/signup': { why: 'site', reason: 'Alias of /subscribe.' },
  '/newsletter': { why: 'site', reason: 'Alias of /subscribe.' },
  '/privacy': { why: 'site', reason: 'Privacy policy.' },
  '/privacy-policy': { why: 'site', reason: 'Alias of /privacy.' },
  '/health': { why: 'site', reason: 'Health check.' },
  '/robots.txt': { why: 'site', reason: 'Crawl policy.' },
  '/sitemap.xml': { why: 'site', reason: 'Sitemap.' },
  '/ui.css': { why: 'site', reason: 'Shared stylesheet.' },
  '/ui-toast.js': { why: 'site', reason: 'Shared toast script.' },
  '/ui-preview': { why: 'site', reason: 'Component showcase.' },
  '/demo': { why: 'site', reason: 'Demo index.' },
  '/demo/:param': { why: 'site', reason: 'A demo site, not an event.' },
  '/.well-known/openid-configuration': { why: 'site', reason: 'Workload identity.' },
  '/.well-known/jwks.json': { why: 'site', reason: 'Workload identity.' },
  'const:EVENT_DEFAULT_THUMB_PATH': {
    why: 'site',
    reason: 'Default event card image, the same for every event.',
  },
  'const:SPONSOR_DEFAULT_LOGO_PATH': { why: 'site', reason: 'Default sponsor image.' },
  '/sponsors/:param': {
    why: 'site',
    reason: "A sponsor's public card: the sponsor corner, not one event.",
  },
  '/admin': { why: 'site', reason: 'The organizer corner (manage).' },
  '/manage': { why: 'site', reason: 'Alias of /admin.' },
  '/dashboard': { why: 'site', reason: 'Alias of /admin.' },
  '/create': { why: 'site', reason: 'Alias of /admin.' },
  '/briefing': { why: 'site', reason: 'Platform briefing (admin only).' },
  '/overview': { why: 'site', reason: 'Alias of /briefing.' },
  '/summary': { why: 'site', reason: 'Alias of /briefing.' },
};

const inTheFolder = (s: string) => s === '/events' || s.startsWith('/events/');

/** The addresses that are neither in the folder nor decided. */
function undecided(shapes: Set<string>): string[] {
  return [...shapes]
    .filter((s) => !isApi(s) && !inTheFolder(s) && !(s in OUTSIDE_THE_FOLDER))
    .sort();
}

const SHAPES = routeShapes(ROUTER);

describe('the route table, read from src/router.ts', () => {
  test('the reader sees the routes (negative control)', () => {
    // Known routes of each kind, so a broken reader cannot pass by seeing nothing.
    for (const s of [
      '/events',
      '/events/*',
      '/events/:param/(tv|poster)',
      '/events/:param/(register|checkin|survey|updates)',
      '/events/:param/calendar.ics',
      '/events/:param/:param',
      '/forms/:param/?',
      '/(e|p|tv|r|c)/:param',
      '/s/*',
      '/display',
      'const:EVENT_DEFAULT_THUMB_PATH',
      '/api/v2/events/:param',
    ]) {
      expect(SHAPES.has(s), `reader finds ${s}`).toBe(true);
    }
    expect(SHAPES.size).toBeGreaterThan(80);
  });

  test('every address is in the event folder or decided', () => {
    const open = undecided(SHAPES);
    expect(
      open,
      'These addresses are outside /events/<id>/… and nobody decided that. ' +
        'If one is a screen for one event, put it under /events/<id>/. If it is not, add it to OUTSIDE_THE_FOLDER with its reason.'
    ).toEqual([]);
  });

  test('every event screen in the folder names the event first', () => {
    const folder = [...SHAPES].filter((s) => s.startsWith('/events/'));
    for (const s of folder) {
      expect(s, `${s}: the segment after /events/ is the event id`).toMatch(
        /^\/events\/(:param|\*)(\/|$)/
      );
    }
  });

  test('no decision is left for an address the router no longer answers', () => {
    const stale = Object.keys(OUTSIDE_THE_FOLDER).filter((k) => !SHAPES.has(k));
    expect(stale, 'Remove these from OUTSIDE_THE_FOLDER (or restore the route).').toEqual([]);
  });

  test('printed addresses are still answered', () => {
    const printed = Object.entries(OUTSIDE_THE_FOLDER)
      .filter(([, d]) => d.why === 'printed-code')
      .map(([k]) => k);
    expect(printed.length).toBe(3);
    for (const k of printed)
      expect(SHAPES.has(k), `${k} is printed and must keep answering`).toBe(true);
  });

  test('every decision carries a reason', () => {
    for (const [k, d] of Object.entries(OUTSIDE_THE_FOLDER)) {
      expect(d.reason.trim().length, `${k} has a reason`).toBeGreaterThan(3);
    }
  });
});

describe('the gate fails on a new event address outside the folder (negative control)', () => {
  // Each case plants one line in today's router and reads only what that line
  // added, so these check the sorter and stay green when the router drifts.
  const before = new Set(undecided(SHAPES));
  const added = (line: string) =>
    undecided(routeShapes(ROUTER.replace('// ── 404', `${line}\n  // ── 404`))).filter(
      (s) => !before.has(s)
    );

  test('a regex route for one event outside /events/ is caught', () => {
    expect(added('  const m = pathname.match(/^\\/checkin\\/([^/]+)$/);')).toEqual([
      '/checkin/:param',
    ]);
  });

  test('a literal route outside /events/ is caught', () => {
    expect(added("  if (pathname === '/tv-remote') return new Response('');")).toEqual([
      '/tv-remote',
    ]);
  });

  test('the same screen under /events/<id>/ needs no decision', () => {
    expect(
      added('  const m = pathname.match(/^\\/events\\/([A-Za-z0-9_-]{1,128})\\/(walkin)$/);')
    ).toEqual([]);
  });

  test('a commented-out route is not a route', () => {
    expect(added("  // if (pathname === '/old-thing') {}")).toEqual([]);
  });
});
