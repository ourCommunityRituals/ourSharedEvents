/**
 * OSE-1354 — every public listing card is a whole-card link to /events/:id, and
 * only live, published events are listed at all.
 *
 * Listing surfaces covered: the landing "Happening near you" (list AND map
 * view), /events, GET /api/v2/events and GET /api/v2/events/map.
 *
 * Reconciled against main before any fix (2026-09-29):
 *   - ALREADY CORRECT: the list SQL (data-provider fetchEvents) and the map SQL
 *     filter `is_published = 1 AND status = 'active'`, and /events/:id 404s a
 *     draft/ready row. Those assertions are regression locks, green on main.
 *   - WAS WRONG: the landing map view (the DEFAULT once a corridor has
 *     LIST_MAX events) hid the whole card list behind a placeholder, so a
 *     listed event had no reachable link; and neither card carried an explicit
 *     44px floor.
 *
 * @born-red OSE-1354 | method: map-view + 44px-floor assertions fail against origin/main's landing.html/public.html (stash-restored originals: 2 red of 9; the 7 SQL/404 locks are green on main = already correct) | date: 2026-09-29
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';
import { renderLandingArea, LIST_MAX } from '../src/lib/landing-area';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const LAT = 41.6572;
const LON = -87.68;
const CELL = latLngToCell(LAT, LON, CORRIDOR_RES);

const LIVE = 'ose1354-live';
const DRAFT = 'ose1354-draft';
const READY = 'ose1354-ready';
const HIDDEN = 'ose1354-unpublished';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await tenv.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      )
        continue;
      throw e;
    }
  }
}

async function seed(id: string, status: string, published: 0 | 1): Promise<void> {
  const db = (env as unknown as TestEnv).DB;
  await db.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, location,
                           start_date, timezone, lat, lon, h3_res7, created_at, updated_at)
       VALUES (?, 'root', ?, ?, ?, ?, 'Eagles Hall', ?, 'America/Chicago', ?, ?, ?,
               datetime('now'), datetime('now'))`
    )
    .bind(id, `Listing ${id}`, id, status, published, inDays(5), LAT, LON, CELL)
    .run();
}

const text = async (path: string) => {
  const res = await SELF.fetch(`https://t.test${path}`);
  return { status: res.status, body: await res.text() };
};

/** The body of the first `<selector> {` rule in a served page's CSS. */
const rule = (html: string, selector: string) => {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.match(new RegExp(`\\n\\s*${esc} \\{([^}]*)\\}`))?.[1] ?? '';
};

beforeAll(async () => {
  await applyMigrations();
  await seed(LIVE, 'active', 1);
  await seed(DRAFT, 'draft', 1); // is_published defaults to 1 on create — status must still gate
  await seed(READY, 'ready', 1);
  await seed(HIDDEN, 'active', 0);
});

describe('OSE-1354 | drafts and ready events are never listed', () => {
  test('landing "Happening near you" lists the live event only', async () => {
    const { status, body } = await text('/');
    expect(status).toBe(200);
    expect(body).toContain(`data-event-id="${LIVE}"`);
    for (const id of [DRAFT, READY, HIDDEN]) expect(body).not.toContain(id);
  });

  test('/events lists the live event only', async () => {
    const { body } = await text('/events');
    expect(body).toContain(`data-event-id="${LIVE}"`);
    for (const id of [DRAFT, READY, HIDDEN]) expect(body).not.toContain(id);
  });

  test('GET /api/v2/events lists the live event only', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events');
    const ids = ((await res.json()) as { items: { id: string }[] }).items.map((e) => e.id);
    expect(ids).toContain(LIVE);
    for (const id of [DRAFT, READY, HIDDEN]) expect(ids).not.toContain(id);
  });

  test('GET /api/v2/events/map lists the live event only', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/events/map?cell=${CELL}`);
    expect(res.status).toBe(200);
    const ids = ((await res.json()) as { items: { id: string }[] }).items.map((e) => e.id);
    expect(ids).toContain(LIVE);
    for (const id of [DRAFT, READY, HIDDEN]) expect(ids).not.toContain(id);
  });

  test('a draft or ready event has no public page; the listed one does', async () => {
    expect((await text(`/events/${DRAFT}`)).status).toBe(404);
    expect((await text(`/events/${READY}`)).status).toBe(404);
    expect((await text(`/events/${LIVE}`)).status).toBe(200);
  });
});

describe('OSE-1354 | every listing card is a whole-card link to /events/:id', () => {
  test('landing: each card IS an <a href="/events/:id">', async () => {
    const { body } = await text('/');
    const cards = [
      ...body.matchAll(
        /<(\w+) class="event-card[^"]*" href="([^"]*)" data-testid="area-card" data-event-id="([^"]*)"/g
      ),
    ];
    expect(cards.length).toBeGreaterThan(0);
    for (const [, tag, href, id] of cards) {
      expect(tag).toBe('a');
      expect(href).toBe(`/events/${id}`);
    }
    // And no card-shaped element escaped the pattern above.
    expect(cards.length).toBe(body.split('data-testid="area-card"').length - 1);
  });

  test('/events: each card carries a stretched link to /events/:id', async () => {
    const { body } = await text('/events');
    const articles = body.split('data-testid="public-event-card"').slice(1);
    expect(articles.length).toBeGreaterThan(0);
    for (const a of articles) {
      const id = a.match(/data-event-id="([^"]*)"/)?.[1];
      expect(a).toMatch(
        new RegExp(
          `<a class="event-card-link" href="/events/${id}" data-testid="public-event-card-link"`
        )
      );
    }
    // The stretched link covers the whole card and sits under the CTA shortcut,
    // so the CTA does not swallow it (OSE-1354; tap-through on the text is #683).
    expect(rule(body, '.event-card-link')).toMatch(/position: absolute;[^]*inset: 0/);
  });

  test('the landing MAP view never hides the cards (it is the default at LIST_MAX)', async () => {
    const many = Array.from({ length: LIST_MAX }, (_, i) => ({
      id: `m${i}`,
      name: `Event ${i}`,
      startDateISO: inDays(3),
      phase: 'pre_event',
      venue: 'Eagles Hall',
    }));
    const area = renderLandingArea(many);
    expect(area.defaultView).toBe('map');
    // The cards are still in the markup, after the map note, not inside a hidden twin.
    expect(area.html.indexOf('data-testid="area-map"')).toBeLessThan(
      area.html.indexOf('data-testid="area-list"')
    );
    expect(area.html.split('data-testid="area-card"').length - 1).toBe(LIST_MAX);

    const { body } = await text('/');
    // No stylesheet rule hides the card list in either view.
    expect(body).not.toMatch(/\.view-list[^{}]*\{\s*display:\s*none/);
  });

  test('both card targets keep a 44px floor', async () => {
    expect(rule((await text('/')).body, '.event-card')).toMatch(/min-height: 44px/);
    expect(rule((await text('/events')).body, '.event-card')).toMatch(
      /min-height: (44px|var\(--tap-min\))/
    );
  });
});
