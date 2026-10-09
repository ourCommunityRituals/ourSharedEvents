/**
 * Event navigation + the organizer's live view (2026-10-03).
 *
 * The design critique found the event page, the list and the poster each had a
 * different header and no way between them, and no live screen for organizers.
 *
 *   - lib/event-nav.ts: one nav — All events · Event page · Poster — on the
 *     event page; the poster and the list link back the same way. The TV
 *     display is an organizer link (OSE-1684): only admin and the live view
 *     link it.
 *   - GET /api/v2/admin/events/:id/live: admin-only page whose numbers come from
 *     the governed event dashboard, never from a second query.
 *
 * @born-red every assertion fails against the pre-change code: no event-nav
 * module, no /live route (404), no poster-event-nav, no public-home-link.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { SELF, env } from 'cloudflare:test';
import { renderEventNav, eventScreenPaths } from '../src/lib/event-nav';
import LIVE_SRC from '../src/handlers/live-monitor.ts?raw';

const ORIGIN = 'https://t.test';
const BRAND = 'live-view-brand';
const OTHER_BRAND = 'live-view-other';
const ADMIN_EMAIL = 'live-view-admin@ose.test';
const HOSTILE_TITLE = 'Bocce <script>alert(1)</script> "Night"';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  ADMIN_BRAND_MEMBERSHIP?: string;
  ALLOWED_ADMIN_EMAILS?: string;
}
const tenv = env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const runs: Array<[D1Database, string[]]> = [
    [tenv.DB, JSON.parse(tenv.TEST_MIGRATION_STATEMENTS)],
    [tenv.FORMS_DB, JSON.parse(tenv.TEST_FORMS_MIGRATION_STATEMENTS)],
  ];
  for (const [db, stmts] of runs)
    for (const stmt of stmts) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (
          msg.includes('duplicate column name') ||
          msg.includes('already exists') ||
          msg.includes('no such column')
        ) {
          continue;
        }
        throw e;
      }
    }
}

async function seed(id: string, status: string, brand = BRAND, title = 'Live View Night') {
  await tenv.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, is_published, qr_verified, location,
                         start_date, timezone, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, 'Eagles Hall', '2026-12-02', 'America/Chicago',
             datetime('now'), datetime('now'))`
  )
    .bind(id, brand, title, id, status, status === 'active' ? 1 : 0)
    .run();
}

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function jwtFor(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ email, iat: now - 10, exp: now + 3600 })}.sig`;
}
const auth = { 'Cf-Access-Jwt-Assertion': jwtFor(ADMIN_EMAIL) };
const live = (id: string) => `${ORIGIN}/api/v2/admin/events/${id}/live`;

beforeAll(async () => {
  await applyMigrations();
  tenv.ADMIN_BRAND_MEMBERSHIP = JSON.stringify({ [ADMIN_EMAIL]: [BRAND] });
  tenv.ALLOWED_ADMIN_EMAILS = ADMIN_EMAIL;
});

describe('lib/event-nav | one nav for every screen of an event', () => {
  test('a live event links its page and poster; the current screen is not a link', () => {
    const nav = renderEventNav('evt_abc', 'event', { live: true });
    expect(nav).toContain('<a href="/events" data-testid="event-nav-events"');
    expect(nav).toContain('aria-current="page" data-testid="event-nav-event"');
    expect(nav).not.toContain('href="/events/evt_abc"');
    expect(nav).toContain(
      'href="/events/evt_abc/poster?kind=digital" data-testid="event-nav-poster"'
    );
    // The TV display is an organizer link (OSE-1684): never on a public page.
    expect(nav).not.toContain('event-nav-display');
    expect(nav).not.toContain('/tv"');
    // 44px targets on every link (mobile-workability).
    expect(nav.match(/min-height:44px/g)?.length).toBe(3);
  });

  test('a draft or wrapped event keeps only "All events": the poster and TV refuse it', () => {
    const nav = renderEventNav('evt_abc', 'event', {
      live: false,
      allEventsTestId: 'event-nav-events-live',
    });
    expect(nav).toContain('data-testid="event-nav-events-live"');
    expect(nav).not.toContain('event-nav-poster');
    expect(nav).not.toContain('event-nav-display');
    expect(nav).not.toContain('event-nav-event"');
  });

  test('the event id is encoded in every path and escaped in the markup', () => {
    const hostile = 'a"b<c>/d e';
    const paths = eventScreenPaths(hostile);
    for (const p of Object.values(paths)) {
      expect(p).not.toMatch(/["<> ]/);
      expect(p).toContain(encodeURIComponent(hostile));
    }
    const nav = renderEventNav(hostile, 'poster', { live: true });
    expect(nav).not.toContain('a"b<c>');
  });
});

describe('served pages | the same way between screens', () => {
  test('/poster carries an event nav that script fills with the event page, never the TV', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/poster`)).text();
    expect(html).toContain('data-testid="poster-event-nav"');
    expect(html).toContain('<a href="/events" data-testid="poster-nav-events">');
    expect(html).toContain("['poster-nav-event', '/events/' + eid, 'Event page']");
    expect(html).toContain("[['poster-nav-event', '/events/' + eid, 'Event page']].forEach");
    // The TV display is an organizer link (OSE-1684).
    expect(html).not.toContain('poster-nav-display');
    // A draft preview has no public page or TV to link to.
    expect(html).toMatch(/if \(eventNav && event && event\.id && !PREVIEW_EVENT\)/);
  });

  test('/events links its wordmark home', async () => {
    const html = await (await SELF.fetch(`${ORIGIN}/events`)).text();
    expect(html).toContain('<a href="/" data-testid="public-home-link"');
    expect(html.match(/<h1\b/g)?.length).toBe(1);
  });
});

describe('GET /api/v2/admin/events/:id/live | the organizer live view', () => {
  test('refuses an anonymous caller', async () => {
    await seed('evt_lv_auth', 'active');
    const res = await SELF.fetch(live('evt_lv_auth'));
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain('data-testid="live-main"');
  });

  test("an unknown event, or another brand's event, is a 404 and never a live page", async () => {
    expect((await SELF.fetch(live('evt_lv_missing'), { headers: auth })).status).toBe(404);
    await seed('evt_lv_other', 'active', OTHER_BRAND);
    const res = await SELF.fetch(live('evt_lv_other'), { headers: auth });
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('data-testid="live-main"');
  });

  test('a live event links its public screens; a draft says it is not live and links none', async () => {
    await seed('evt_lv_draft', 'draft');
    const draft = await (await SELF.fetch(live('evt_lv_draft'), { headers: auth })).text();
    expect(draft).toContain('This event is draft, not live.');
    expect(draft).not.toContain('live-nav-poster');
    await seed('evt_lv_live2', 'active');
    const on = await (await SELF.fetch(live('evt_lv_live2'), { headers: auth })).text();
    expect(on).toContain('href="/events/evt_lv_live2" data-testid="live-nav-event"');
    expect(on).toContain('data-testid="live-nav-poster"');
    expect(on).toContain('href="/events/evt_lv_live2/tv" data-testid="live-nav-display"');
  });

  test('the event title is escaped in the heading and the tab title', async () => {
    await seed('evt_lv_xss', 'active', BRAND, HOSTILE_TITLE);
    const html = await (await SELF.fetch(live('evt_lv_xss'), { headers: auth })).text();
    // html() gives every <script tag in the page a nonce, so an unescaped title
    // would not just render: it would run. The page has exactly one script.
    expect(html).not.toMatch(/<script[^>]*>alert\(1\)/);
    expect(html.match(/<script/g)?.length).toBe(1);
    expect(html).toContain(
      '<h1 data-testid="live-title">Bocce &lt;script&gt;alert(1)&lt;/script&gt; &quot;Night&quot;</h1>'
    );
  });

  test('serves the page for an event the admin holds: no-store, noindex, nonce on the script', async () => {
    await seed('evt_lv_live', 'active');
    const res = await SELF.fetch(live('evt_lv_live'), { headers: auth });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
    const html = await res.text();
    expect(html).toContain('data-testid="live-main" data-event-id="evt_lv_live"');
    for (const id of [
      'live-scans',
      'live-taps',
      'live-checkins',
      'live-posters',
      'live-places',
      'live-sponsors',
      'live-status',
      'live-days',
    ]) {
      expect(html, id).toContain(`data-testid="${id}"`);
    }
    expect(html).toMatch(/<script nonce="[^"]+">/);
    expect(html).toContain('<a href="/admin" data-testid="live-nav-admin">');
  });

  test('every number comes from the governed dashboard; the page runs no count query of its own', () => {
    expect(LIVE_SRC).toContain("'/api/v2/admin/events/' + encodeURIComponent(id) + '/dashboard'");
    // One SELECT, of the title and status only. No FORMS_DB, no scan tables.
    expect(LIVE_SRC.match(/\.prepare\(/g)?.length).toBe(1);
    expect(LIVE_SRC).toContain("'SELECT id, title, status FROM events WHERE id = ?'");
    expect(LIVE_SRC).not.toMatch(/env\.FORMS_DB|FROM scan|checkin_counts|form_registrations/);
  });

  test('a floored count reads "Held"; a failed refresh keeps the last totals and never shows zeros', () => {
    expect(LIVE_SRC).toContain("b.textContent = held ? 'Held'");
    expect(LIVE_SRC).toContain('v.suppressed === true');
    const failure = LIVE_SRC.slice(
      LIVE_SRC.indexOf('} catch (e) {'),
      LIVE_SRC.indexOf('refresh();\n  var timer')
    );
    expect(failure).toContain("'Could not refresh just now. Showing the totals from '");
    expect(failure).not.toContain('render(');
    expect(failure).not.toContain('show(');
  });
});

describe('admin list | a live event links its live view', () => {
  test('the Live view link is built for active events only, on its own line', async () => {
    const res = await SELF.fetch(`${ORIGIN}/admin`, { headers: auth });
    expect(res.status).toBe(200);
    const html = await res.text();
    const line = html.split('\n').find((l) => l.includes('data-testid="event-live-link"')) ?? '';
    expect(line).toMatch(/if \(e\.status === 'active'\) preview = /);
    expect(line).toContain('href="/api/v2/admin/events/\' + safeId + \'/live"');
  });
});
