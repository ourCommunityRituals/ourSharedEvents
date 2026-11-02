/**
 * OSE-1373 — the post-event recap's Walk-in line.
 *
 * "By the numbers" reads Registered → Checked in → Walked in (+ its share of
 * check-ins) → the showed-up ratio. A walk-in is a check-in that arrived through
 * the WALK-IN path (the door page's walk-in button), recorded at check-in time as
 * a categorical per-path counter on checkin_counts (FORMS_DB migration 0015).
 *
 * PRIVACY (hard): the split is a count PER ARRIVAL PATH, never a per-person
 * match — nothing joins a registration to a check-in, and no identity is read to
 * decide the path. Structural assertions below pin that on the source.
 * K-anonymity: every line under 5 reads "Fewer than 5"; the walk-in share and
 * the showed-up ratio are suppressed when either of their inputs is under 5.
 * OSE-1657: the card shows only when some count is 5 or more, so an event whose
 * counts are all under 5 looks like one with none; once it shows, 0 and 1 to 4
 * read the same; and walk-ins are floored as a subset of check-ins.
 *
 * @born-red OSE-1373 | method: spec written before the change and run against
 *   origin/main (no walk-in path at check-in, no walk_in_count column, no
 *   stat-walk-ins line) — red; green after | date: 2026-09-29
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { handleFormCheckin, type FormsEnv } from '../src/handlers/forms';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const tenv = () => env as unknown as TestEnv;
const BRAND = 'recap-walk-in-1373';

async function applyAll(): Promise<void> {
  for (const [db, key] of [
    [tenv().DB, 'TEST_MIGRATION_STATEMENTS'],
    [tenv().FORMS_DB, 'TEST_FORMS_MIGRATION_STATEMENTS'],
  ] as const) {
    for (const stmt of JSON.parse(tenv()[key]) as string[]) {
      try {
        await db.prepare(stmt).run();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/duplicate column name|already exists|no such column/.test(msg)) continue;
        throw e;
      }
    }
  }
}

/** A finished event, so /events/:id renders the post-event recap. */
async function seedPastEvent(id: string): Promise<void> {
  const start = new Date(Date.now() - 7 * 86400000).toISOString();
  const end = new Date(Date.now() - 6 * 86400000).toISOString();
  await tenv().DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
  await tenv()
    .DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, end_date, what_short, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', 'Harbor Country Park', ?, ?, 'Bocce night.', datetime('now'), datetime('now'))`
    )
    .bind(id, BRAND, `Recap ${id}`, id, start, end)
    .run();
}

async function seedRegistrations(eventId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    await tenv()
      .FORMS_DB.prepare(
        `INSERT OR REPLACE INTO form_registrations (id, event_id, registration_bucket, status, created_at, expires_at)
         VALUES (?, ?, '15min', 'confirmed', datetime('now'), NULL)`
      )
      .bind(`reg_${eventId}_${i}`, eventId)
      .run();
  }
}

/** A check-in through the real handler; `path` is what the door page sends. */
async function checkIn(eventId: string, path?: unknown): Promise<Response> {
  const req = new Request(`https://t.test/api/v2/events/${eventId}/forms/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: path === undefined ? undefined : JSON.stringify({ arrival_path: path }),
  });
  return handleFormCheckin(req, env as unknown as FormsEnv, eventId);
}

async function seed(eventId: string, n: number, m: number, w: number): Promise<void> {
  await seedPastEvent(eventId);
  await tenv()
    .FORMS_DB.prepare('DELETE FROM checkin_counts WHERE event_id = ?')
    .bind(eventId)
    .run();
  await seedRegistrations(eventId, n);
  for (let i = 0; i < m; i++) expect((await checkIn(eventId, 'registered')).status).toBe(200);
  for (let i = 0; i < w; i++) expect((await checkIn(eventId, 'walk_in')).status).toBe(200);
}

async function recap(eventId: string): Promise<string> {
  const res = await SELF.fetch(`https://t.test/events/${eventId}`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain('data-testid="event-main-post"');
  return html;
}

function statsCard(html: string): string {
  const m = html.match(/<section[^>]*data-testid="event-stats-card"[\s\S]*?<\/section>/);
  expect(m, 'the recap renders its By the numbers card').not.toBeNull();
  return m![0];
}

function sourceOf(rel: string): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const hit = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(rel));
  expect(hit, `${rel} in TEST_SOURCE_FILES_JSON`).toBeDefined();
  return hit![1].replace(/\r\n/g, '\n');
}

/** The body of a top-level `function name(` … up to the next top-level declaration. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`(async )?function ${name}\\(`));
  expect(start, `${name} in source`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(export )?(async )?function |\n\/\/ ─── /);
  return src.slice(start, next === -1 ? undefined : start + 1 + next);
}

beforeAll(async () => {
  await applyAll();
  await tenv().DB.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
});

describe('OSE-1373 | acceptance: N registrations, M registered-path + W walk-in check-ins', () => {
  test('the four numbers, in order: Registered, Checked in, Walk-in, then the ratio', async () => {
    const id = 'evt_walkin_accept';
    await seed(id, 20, 8, 6); // N=20, M=8, W=6
    const card = statsCard(await recap(id));

    expect(card).toContain('<strong>20</strong> Registered');
    expect(card).toContain('<strong>14</strong> Checked in'); // M + W
    expect(card).toContain('<strong>6</strong> Walked in');
    expect(card).toContain('43% of check-ins were walk-ins'); // 6 / 14
    expect(card).toContain('70% of those registered showed up'); // 14 / 20

    const order = [
      'stat-registrations',
      'stat-checkins',
      'stat-walk-ins',
      'stat-walk-in-share',
      'stat-showed-up-share',
    ].map((t) => card.indexOf(`data-testid="${t}"`));
    for (const i of order) expect(i).toBeGreaterThan(-1);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test('<5 everywhere: no card at all, the same as an event where nobody came (OSE-1657)', async () => {
    const id = 'evt_walkin_subk';
    await seed(id, 3, 1, 2);
    const html = await recap(id);
    expect(html).not.toContain('data-testid="event-stats-card"');
    expect(html).not.toMatch(/<strong>[1-4]<\/strong>/);
  });

  test('<5 on one line while another prints: that line floors, the share and the ratio are suppressed', async () => {
    const id = 'evt_walkin_subk_one';
    await seed(id, 12, 1, 2);
    const card = statsCard(await recap(id));
    expect(card).toContain('<strong>12</strong> Registered');
    expect(card).toContain('Fewer than 5 Checked in');
    expect(card).not.toMatch(/<strong>[1-4]<\/strong>/);
    expect(card).not.toContain('data-testid="stat-walk-in-share"');
    expect(card).not.toContain('data-testid="stat-showed-up-share"');
  });

  test('walk-ins under 5 floor + drop the share, while the ratio (both >=5) stays', async () => {
    const id = 'evt_walkin_few';
    await seed(id, 20, 12, 3);
    const card = statsCard(await recap(id));
    expect(card).toContain('<strong>15</strong> Checked in');
    expect(card).toContain('Fewer than 5 Walked in');
    expect(card).not.toContain('<strong>3</strong> Walked in');
    expect(card).not.toContain('data-testid="stat-walk-in-share"');
    expect(card).toContain('75% of those registered showed up');
  });

  test('OSE-1752: 18 walk-ins of 20 check-ins and 3 of 20 draw the very same card', async () => {
    // Both walk-in counts are withheld, for different reasons: 18 clears 5 but would
    // leave 2 who registered and came; 3 is under 5. The card must not say which.
    await seed('evt_walkin_held', 25, 2, 18); // 20 check-ins, 18 walked in
    await seed('evt_walkin_small', 25, 17, 3); // 20 check-ins, 3 walked in
    const held = statsCard(await recap('evt_walkin_held'));
    const small = statsCard(await recap('evt_walkin_small'));
    expect(held).toContain('<strong>20</strong> Checked in');
    expect(held).toContain('Fewer than 5 Walked in');
    expect(held).not.toMatch(/: held|cannot be worked out/i);
    expect(held).toBe(small);
  });

  test('no walk-ins recorded reads like 1 to 4: "Fewer than 5 Walked in" (OSE-1657)', async () => {
    const id = 'evt_walkin_none';
    await seed(id, 10, 6, 0);
    const card = statsCard(await recap(id));
    expect(card).toContain('Fewer than 5 Walked in');
    expect(card).not.toContain('data-testid="stat-walk-in-share"');
  });
});

describe('OSE-1373 | the path is recorded at check-in, as a category', () => {
  test('the public route records a walk-in; unknown values and bodyless taps do not', async () => {
    const id = 'evt_walkin_route';
    await seedPastEvent(id);
    await tenv().FORMS_DB.prepare('DELETE FROM checkin_counts WHERE event_id = ?').bind(id).run();
    // The route's lifecycle guard wants a live event; make this one active + current.
    await tenv()
      .DB.prepare(
        "UPDATE events SET start_date = datetime('now','-1 hour'), end_date = datetime('now','+3 hours') WHERE id = ?"
      )
      .bind(id)
      .run();
    const post = (body?: string) =>
      SELF.fetch(`https://t.test/api/v2/events/${id}/forms/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    expect((await post(JSON.stringify({ arrival_path: 'walk_in' }))).status).toBe(200);
    expect((await post(JSON.stringify({ arrival_path: 'vip' }))).status).toBe(200);
    expect((await post(JSON.stringify({ arrival_path: { walk_in: true } }))).status).toBe(200);
    expect((await post()).status).toBe(200); // the pre-existing bodyless tap still works
    expect((await post('not json')).status).toBe(200); // a malformed body never blocks a check-in
    const row = await tenv()
      .FORMS_DB.prepare('SELECT total_count, walk_in_count FROM checkin_counts WHERE event_id = ?')
      .bind(id)
      .first<{ total_count: number; walk_in_count: number }>();
    expect(row).toEqual({ total_count: 5, walk_in_count: 1 });
  });

  test('checkin_counts gains only the per-path counter — no identity column', async () => {
    const info = await tenv().FORMS_DB.prepare('PRAGMA table_info(checkin_counts)').all<{
      name: string;
    }>();
    expect((info.results ?? []).map((r) => r.name).sort()).toEqual(
      ['event_id', 'id', 'last_anonymous_id', 'total_count', 'updated_at', 'walk_in_count'].sort()
    );
  });

  test('the door page offers a walk-in check-in that sends the path, nothing else', async () => {
    const id = 'evt_walkin_route';
    const html = await (await SELF.fetch(`https://t.test/forms/${id}?type=checkin`)).text();
    expect(html).toContain('data-testid="checkin-submit"');
    expect(html).toMatch(/<button[^>]*data-testid="checkin-walk-in-submit"[^>]*>/);
    expect(html).toContain("arrival_path: 'walk_in'");
  });
});

describe('OSE-1373 | privacy: a count per arrival path, never a per-person match', () => {
  test('the recap query set never joins registrations to check-ins', () => {
    const body = functionBody(sourceOf('src/handlers/pages.ts'), 'fetchEventPageSocialData');
    expect(body).toContain('checkin_counts');
    expect(body).toContain('walk_in_count');
    const sqls = body.match(/`[^`]*`/g) ?? [];
    expect(sqls.length).toBeGreaterThan(0);
    for (const sql of sqls) {
      const touchesReg = /form_registrations/.test(sql);
      const touchesCheckin = /checkin_counts/.test(sql);
      expect(touchesReg && touchesCheckin, `one query reads both tables: ${sql}`).toBe(false);
      if (touchesReg || touchesCheckin) {
        expect(sql).not.toMatch(/\bJOIN\b/i);
        expect(sql).not.toMatch(/anonymous_id/);
      }
    }
  });

  test('the check-in writer decides the path from the request alone', () => {
    const src = sourceOf('src/handlers/forms.ts');
    const body = functionBody(src, 'handleFormCheckin');
    expect(body).toContain('walk_in_count');
    expect(body).not.toMatch(/form_registrations/);
    expect(body).not.toMatch(/\bJOIN\b/i);
    // The walk-in increment is keyed on the request's declared arrival path…
    expect(body).toMatch(/readArrivalPath\(request\)\)\s*===\s*'walk_in'/);
    // …which reads the request body alone — no identity, no registration lookup.
    const reader = functionBody(src, 'readArrivalPath');
    expect(reader).toMatch(/arrival_path/);
    expect(reader).not.toMatch(/anon|cookie|FORMS_DB|form_registrations|prepare\(/i);
  });
});
