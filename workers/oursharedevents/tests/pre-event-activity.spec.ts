/**
 * Pre-event window — the poster/pre-event activity showcase for the organizer
 * and the sponsor corners of the triangle (the attendee gets the event, not
 * the numbers).
 *
 * NEVER WHO, ONLY HOW MANY:
 *   - every number is a count of anonymous events (scan_placement_events, the
 *     shortlinks.clicks counter, organizer-declared poster cells);
 *   - the organizer sees exact counts (same rule as /stats: anonymous scans have
 *     no one to re-identify, and a first real scan shows as 1);
 *   - the SPONSOR (an outside party) only ever sees floored counts (K=5), per
 *     day and in total — a raw sub-5 number never reaches their page;
 *   - the module never reads the WHO side (scan_node_returns), IPs, request.cf,
 *     or FORMS_DB.
 *
 * @born-red pre-event window | method: the route, module and render did not
 * exist; every endpoint/render test 404s or fails to import on main
 * | date: 2026-09-29
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  bucketScansByDay,
  floorPreEventActivity,
  readPreEventActivity,
  localDay,
  PRE_EVENT_DAYS,
} from '../src/lib/pre-event-activity';
import { daysToGo } from '../src/handlers/pre-event-activity';
import { renderPreEventReach } from '../src/lib/sponsor-home-render';
import { mintSponsorHomeToken } from '../src/lib/sponsor-home-auth';
import ADMIN_HTML from '../src/templates/admin.html';

const BRAND = 'ose-pre-event';
const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  SHARED_REPORT_SIGNING_SECRET: string;
}
const tenv = env as unknown as TestEnv;

/** UTC hour bucket "YYYY-MM-DDTHH:00", `hoursAgo` before now. */
function bucket(hoursAgo: number): string {
  return new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString().slice(0, 13) + ':00';
}

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

async function seedEvent(id: string, status = 'active', start = '2099-06-01'): Promise<void> {
  await tenv.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, start_date, timezone, location)
     VALUES (?, ?, ?, ?, ?, ?, 'America/Chicago', 'Eagles Hall')`
  )
    .bind(id, BRAND, `PE ${id}`, `slug-${id}`, status, start)
    .run();
}
async function seedPoster(id: string, eventId: string, res7: string | null, active = 1) {
  await tenv.DB.prepare(
    `INSERT INTO poster_deployments (id, event_id, qr_token, is_active, h3_res7) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(id, eventId, `qrt_${id}`, active, res7)
    .run();
}
async function seedScans(eventId: string, posterId: string, n: number, hoursAgo: number) {
  for (let i = 0; i < n; i++) {
    await tenv.DB.prepare(
      `INSERT INTO scan_placement_events (id, event_id, poster_deployment_id, scan_bucket) VALUES (?, ?, ?, ?)`
    )
      .bind(`spe-${eventId}-${posterId}-${hoursAgo}-${i}`, eventId, posterId, bucket(hoursAgo))
      .run();
  }
}
async function seedShortlink(code: string, eventId: string, clicks: number, kind = 'public') {
  await tenv.DB.prepare(
    `INSERT INTO shortlinks (code, event_id, created_at, clicks, kind) VALUES (?, ?, datetime('now'), ?, ?)`
  )
    .bind(code, eventId, clicks, kind)
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await tenv.DB.prepare(
    `DELETE FROM scan_placement_events WHERE event_id IN (SELECT id FROM events WHERE brand_id = ?)`
  )
    .bind(BRAND)
    .run();
  await tenv.DB.prepare(
    `DELETE FROM poster_deployments WHERE event_id IN (SELECT id FROM events WHERE brand_id = ?)`
  )
    .bind(BRAND)
    .run();
  await tenv.DB.prepare(
    `DELETE FROM shortlinks WHERE event_id IN (SELECT id FROM events WHERE brand_id = ?)`
  )
    .bind(BRAND)
    .run();
  await tenv.DB.prepare('DELETE FROM sponsor_placement WHERE id LIKE ?').bind('pep-%').run();
  await tenv.DB.prepare('DELETE FROM sponsor_business WHERE id LIKE ?').bind('pes-%').run();
  await tenv.DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();

  // A busy pre-event: 2 active posters in 1 place + 1 in another, 1 retired.
  await seedEvent('pe-busy');
  await seedPoster('pe-p1', 'pe-busy', '872664c1effffff');
  await seedPoster('pe-p2', 'pe-busy', '872664c1effffff');
  await seedPoster('pe-p3', 'pe-busy', '872664c13ffffff');
  await seedPoster('pe-p4', 'pe-busy', '872664c17ffffff', 0); // retired — not counted
  await seedScans('pe-busy', 'pe-p1', 7, 1);
  await seedScans('pe-busy', 'pe-p2', 2, 30);
  await seedScans('pe-busy', 'pe-p3', 3, 24 * 20); // outside the 14-day chart, inside the total
  await seedShortlink('peBUS1', 'pe-busy', 9, 'public');
  await seedShortlink('peBUS2', 'pe-busy', 2, 'donation');

  // A quiet pre-event: 1 poster, 3 scans, 2 taps — every count under the floor.
  await seedEvent('pe-quiet');
  await seedPoster('pe-q1', 'pe-quiet', '872664c1effffff');
  await seedScans('pe-quiet', 'pe-q1', 3, 2);
  await seedShortlink('peQUI1', 'pe-quiet', 2, 'public');

  // A draft: no link yet.
  await seedEvent('pe-draft', 'draft');
});

describe('bucketScansByDay — the event’s own days, zero-filled', () => {
  const now = new Date('2026-09-29T15:00:00Z'); // 10:00 in Chicago

  test('a late-night UTC hour lands on the previous Chicago day', () => {
    // 2026-09-29T03:00Z is 22:00 on Sep 28 in Chicago.
    const days = bucketScansByDay([{ bucket: '2026-09-29T03:00', cnt: 4 }], 'America/Chicago', now);
    expect(days.find((d) => d.day === '2026-09-28')?.count).toBe(4);
    expect(days.find((d) => d.day === '2026-09-29')?.count).toBe(0);
  });

  test('always PRE_EVENT_DAYS days, oldest first, ending today', () => {
    const days = bucketScansByDay([], 'America/Chicago', now);
    expect(days).toHaveLength(PRE_EVENT_DAYS);
    expect(days[days.length - 1].day).toBe('2026-09-29');
    expect(days[0].day).toBe('2026-09-16');
    expect(days.every((d) => d.count === 0)).toBe(true);
  });

  test('hours outside the window and junk buckets are dropped', () => {
    const days = bucketScansByDay(
      [
        { bucket: '2026-08-01T12:00', cnt: 50 },
        { bucket: 'not-a-bucket', cnt: 9 },
      ],
      'America/Chicago',
      now
    );
    expect(days.reduce((t, d) => t + d.count, 0)).toBe(0);
  });

  test('an unknown zone falls back to the home corridor, never throws', () => {
    expect(localDay(now, 'Not/AZone')).toBe('2026-09-29');
  });
});

describe('floorPreEventActivity — the sponsor never sees a sub-5 number', () => {
  test('totals and every day under 5 are suppressed; posters/places stay exact', () => {
    const f = floorPreEventActivity({
      posters: 1,
      places: 1,
      scans: 3,
      clicks: 12,
      scansByDay: [
        { day: '2026-09-28', count: 2 },
        { day: '2026-09-29', count: 6 },
      ],
    });
    expect(f.posters).toBe(1);
    expect(f.places).toBe(1);
    expect(f.scans).toEqual({ count: null, suppressed: true, floor: 5 });
    expect(f.clicks).toEqual({ count: 12, suppressed: false, floor: 5 });
    expect(f.scansByDay[0].count.suppressed).toBe(true);
    expect(f.scansByDay[0].count.count).toBeNull();
    expect(f.scansByDay[1].count.count).toBe(6);
  });
});

describe('readPreEventActivity — counts from D1', () => {
  test('posters/places count ACTIVE posters; scans + taps are totals; chart covers 14 days', async () => {
    const a = await readPreEventActivity(tenv.DB, 'pe-busy', 'America/Chicago');
    expect(a.posters).toBe(3);
    expect(a.places).toBe(2);
    expect(a.scans).toBe(12);
    expect(a.clicks).toBe(11);
    // The 20-day-old scans are in the total but not in the 14-day chart.
    expect(a.scansByDay.reduce((t, d) => t + d.count, 0)).toBe(9);
  });

  test('an event with nothing yet reads as zeros, not an error', async () => {
    const a = await readPreEventActivity(tenv.DB, 'pe-draft', 'America/Chicago');
    expect(a).toMatchObject({ posters: 0, places: 0, scans: 0, clicks: 0 });
  });
});

describe('GET /api/v2/admin/events/:id/pre-event-activity (organizer)', () => {
  test('requires admin', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/pe-busy/pre-event-activity');
    expect(res.status).toBe(401);
  });

  test('exact counts, the public short link first, its QR as a picture', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/pe-busy/pre-event-activity', {
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      event: { status: string; days_to_go: number | null };
      activity: { posters: number; places: number; scans: number; clicks: number };
      link: { url: string; code: string; qr: string } | null;
      poster_url: string;
    };
    expect(body.ok).toBe(true);
    expect(body.activity).toMatchObject({ posters: 3, places: 2, scans: 12, clicks: 11 });
    expect(body.link?.url).toBe('https://t.test/s/peBUS1'); // public before donation
    expect(body.link?.qr.startsWith('data:image/')).toBe(true);
    expect(body.poster_url).toBe('/poster?event=pe-busy');
    expect(body.event.days_to_go).toBeGreaterThan(0);
  });

  test('never who: the payload carries counts and a link, nothing about a person', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/pe-busy/pre-event-activity', {
      headers: ADMIN,
    });
    const raw = await res.text();
    for (const banned of [
      'anonymous_id',
      'ua_hash',
      'ip',
      'country',
      'user_agent',
      'email',
      'lat',
      'lon',
    ]) {
      expect(raw).not.toMatch(new RegExp(`"${banned}"`));
    }
  });

  test('read-only: it never mints a short link', async () => {
    const before = await tenv.DB.prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?')
      .bind('pe-draft')
      .first<{ n: number }>();
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/pe-draft/pre-event-activity', {
      headers: ADMIN,
    });
    const body = (await res.json()) as { link: unknown };
    expect(body.link).toBeNull();
    const after = await tenv.DB.prepare('SELECT COUNT(*) AS n FROM shortlinks WHERE event_id = ?')
      .bind('pe-draft')
      .first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
  });

  test('unknown event → 404', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/events/pe-nope/pre-event-activity', {
      headers: ADMIN,
    });
    expect(res.status).toBe(404);
  });
});

describe('daysToGo — counted in the event’s zone', () => {
  const now = new Date('2026-09-29T15:00:00Z');
  const row = (o: Partial<Parameters<typeof daysToGo>[0]>) => ({
    id: 'x',
    status: 'active',
    start_date: null,
    starts_at: null,
    timezone: 'America/Chicago',
    ...o,
  });
  test('date-only and timed events', () => {
    expect(daysToGo(row({ start_date: '2026-10-24' }), now)).toBe(25);
    expect(daysToGo(row({ start_date: '2026-09-29' }), now)).toBe(0);
    // 2026-09-30T02:00Z is still Sep 29 in Chicago → today.
    expect(daysToGo(row({ starts_at: '2026-09-30T02:00:00Z' }), now)).toBe(0);
    expect(daysToGo(row({}), now)).toBeNull();
  });
});

describe('/sponsor — pre-event reach, floored', () => {
  test('the reach line renders floored counts as words, never a raw sub-5 number', () => {
    const html = renderPreEventReach(
      floorPreEventActivity({ posters: 1, places: 1, scans: 3, clicks: 2, scansByDay: [] })
    );
    expect(html).toContain('Your name is on 1 poster in 1 place');
    expect(html).toContain('fewer than 5 poster scans');
    expect(html).toContain('fewer than 5 link taps');
    expect(html).not.toMatch(/\b3 poster scans|\b2 link taps/);
  });

  test('no poster yet → link taps still count as reach; says no posters honestly', () => {
    const html = renderPreEventReach(
      floorPreEventActivity({ posters: 0, places: 0, scans: 0, clicks: 30, scansByDay: [] })
    );
    expect(html).toContain('30 link taps');
    expect(html).toContain('No posters up yet.');
  });

  test('link taps lead, poster scans follow (the shared link is the big driver)', () => {
    const html = renderPreEventReach(
      floorPreEventActivity({ posters: 2, places: 1, scans: 9, clicks: 40, scansByDay: [] })
    );
    expect(html.indexOf('40 link taps')).toBeLessThan(html.indexOf('9 poster scans'));
  });

  test('the served page shows reach only on ACCEPTED pre-event placements, floored', async () => {
    await tenv.DB.prepare(
      `INSERT INTO sponsor_business (id, brand_id, name, is_active) VALUES ('pes-cafe', ?, 'Corner Cafe', 1)`
    )
      .bind(BRAND)
      .run();
    await tenv.DB.prepare(
      `INSERT INTO sponsor_placement (id, sponsor_business_id, event_id, tier, source, is_active, sponsor_accepted)
       VALUES ('pep-busy', 'pes-cafe', 'pe-busy', 'standard', 'organizer', 1, 1),
              ('pep-quiet', 'pes-cafe', 'pe-quiet', 'standard', 'organizer', 1, NULL)`
    ).run();
    const minted = await mintSponsorHomeToken(tenv, 'pes-cafe', BRAND);
    expect(minted).not.toBeNull();
    const res = await SELF.fetch(`https://t.test/sponsor?t=${encodeURIComponent(minted!.token)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    const cards = html.split('data-testid="placement-card"');
    const busy = cards.find((c) => c.includes('data-event-id="pe-busy"')) ?? '';
    const quiet = cards.find((c) => c.includes('data-event-id="pe-quiet"')) ?? '';
    // Accepted: reach with floored words (12 and 11 clear the floor).
    expect(busy).toContain('data-testid="placement-reach"');
    expect(busy).toContain('Your name is on 3 posters in 2 places');
    expect(busy).toContain('12 poster scans');
    expect(busy).toContain('11 link taps');
    // Not yet accepted: their name isn't on the poster, so no reach claim.
    expect(quiet).not.toContain('data-testid="placement-reach"');
  });
});

describe('never who — structural', () => {
  test('the activity module never touches the WHO side, the request, or FORMS_DB', () => {
    const files = JSON.parse(
      (env as unknown as Record<string, string>).TEST_SOURCE_FILES_JSON
    ) as Record<string, string>;
    const entry = Object.entries(files).find(([k]) =>
      k.split('\\').join('/').endsWith('/src/lib/pre-event-activity.ts')
    );
    expect(entry, 'pre-event-activity.ts must be in the source bundle').toBeDefined();
    const code = entry![1].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of [
      'scan_node_returns',
      'anonymous_id',
      'request.cf',
      'CF-Connecting-IP',
      'FORMS_DB',
    ]) {
      expect(code, banned).not.toContain(banned);
    }
  });

  test('the organizer card builds DOM with textContent — server data never hits innerHTML', () => {
    const start = ADMIN_HTML.indexOf('window.renderPreEventWindow = async function');
    expect(start).toBeGreaterThan(-1);
    // The function body only: up to its own closing `      };` line.
    const fn = ADMIN_HTML.slice(start, ADMIN_HTML.indexOf('\n      };\n', start));
    expect(fn).toContain('card.hidden = false;');
    expect(fn).not.toContain('innerHTML');
    // The QR is only ever a data:image URI.
    expect(fn).toContain("d.link.qr.indexOf('data:image/') === 0");
    // Draft → one Go live button, no hunting for the status panel.
    expect(fn).toContain("btn.setAttribute('data-to', 'active')");
    // Link first: live → "Copy link" is the primary action, the poster second;
    // the Link taps tile comes before Poster scans.
    expect(fn.indexOf("copyBtn.textContent = 'Copy link'")).toBeLessThan(
      fn.indexOf("btn.setAttribute('data-testid', 'pre-event-poster')")
    );
    expect(fn).toContain("copyBtn.className = 'btn btn-primary'");
    expect(ADMIN_HTML.indexOf('data-testid="pre-event-clicks"')).toBeLessThan(
      ADMIN_HTML.indexOf('data-testid="pre-event-scans"')
    );
    // It re-renders on selection and after a status change.
    expect(ADMIN_HTML).toContain('window.renderPreEventWindow(d.id);');
    expect(ADMIN_HTML).toContain(
      'if (window.renderPreEventWindow) window.renderPreEventWindow(id);'
    );
  });
});
