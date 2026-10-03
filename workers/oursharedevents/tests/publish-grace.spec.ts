/**
 * Publish grace window (PO decision 2026-10-02) — src/lib/publish-grace.ts.
 *
 * Publish is safe to undo: for PUBLISH_GRACE_MINUTES after an event moves into
 * `active`, it is live by link (page, poster, the organizer's own TV) but off
 * every surface where strangers find events on their own: the list, the map,
 * the sitemap, sponsor discovery, and the corridor latch. Undo inside the
 * window leaves no public trace.
 *
 * The fast pool runs with the window OFF (vitest.workers.config.mts). These
 * specs turn it ON by passing the env to the handlers directly, then read the
 * real listing routes through SELF.
 */
import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { handleV2AdminVerifyQr, handleV2AdminUnverifyQr } from '../src/handlers/qr-verify';
import { handleUpdateEvent, type EventsEnv } from '../src/handlers/events';
import { handleSitemapXml } from '../src/lib/crawl-policy';
import { readDiscoverableEvents } from '../src/lib/sponsor-discovery';
import { latchReadyCorridors, LATCH_SETTLE_HOURS } from '../src/lib/corridor-latch';
import {
  DEFAULT_PUBLISH_GRACE_MINUTES,
  listedFromForPublish,
  resolvePublishGraceMinutes,
} from '../src/lib/publish-grace';

const E = env as unknown as Record<string, string> & { DB: D1Database };
const BEARER = { Authorization: 'Bearer test-admin-key-e2e-2026' };
const BRAND = 'root';
// Blue Island corridor (res 7) from the trace fixtures.
const RES7 = '872664544ffffff';

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await E.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

function inDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

async function insertEvent(id: string, status: string, opts: { h3_res7?: string } = {}) {
  await E.DB.prepare(
    `INSERT OR REPLACE INTO events (id, brand_id, title, slug, status, is_published, start_date,
            h3_res7, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))`
  )
    .bind(id, BRAND, `Grace ${id}`, id, status, inDays(3), opts.h3_res7 ?? null)
    .run();
}

async function listedFromOf(id: string): Promise<string | null> {
  const row = await E.DB.prepare('SELECT listed_from FROM events WHERE id = ?')
    .bind(id)
    .first<{ listed_from: string | null }>();
  return row?.listed_from ?? null;
}

async function inPublicList(id: string): Promise<boolean> {
  const res = await SELF.fetch(`https://localhost/api/v2/events?brand=${BRAND}`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: { id: string }[] };
  return body.items.some((e) => e.id === id);
}

const withGrace = (minutes: string) =>
  ({ ...E, PUBLISH_GRACE_MINUTES: minutes }) as unknown as EventsEnv & {
    DB: D1Database;
    PUBLISH_GRACE_MINUTES: string;
  };

function verify(id: string, minutes = '10') {
  return handleV2AdminVerifyQr(
    new Request(`https://localhost/api/v2/admin/events/${id}/verify-qr`, { method: 'POST' }),
    withGrace(minutes),
    id
  );
}

function putStatus(id: string, status: string, minutes = '10') {
  return handleUpdateEvent(
    new Request(`https://localhost/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }),
    withGrace(minutes),
    id
  );
}

describe('resolvePublishGraceMinutes', () => {
  test('unset or junk → the default; 0 or less → off; capped at 60', () => {
    expect(resolvePublishGraceMinutes(undefined)).toBe(DEFAULT_PUBLISH_GRACE_MINUTES);
    expect(resolvePublishGraceMinutes('')).toBe(DEFAULT_PUBLISH_GRACE_MINUTES);
    expect(resolvePublishGraceMinutes('soon')).toBe(DEFAULT_PUBLISH_GRACE_MINUTES);
    expect(resolvePublishGraceMinutes('0')).toBe(0);
    expect(resolvePublishGraceMinutes('-5')).toBe(0);
    expect(resolvePublishGraceMinutes('2.9')).toBe(2);
    expect(resolvePublishGraceMinutes('999')).toBe(60);
  });

  test('listedFromForPublish is now + minutes, or null when off', () => {
    const now = new Date('2026-10-02T21:00:00.000Z');
    expect(listedFromForPublish('10', now)).toBe('2026-10-02T21:10:00.000Z');
    // Off still records the listing start, so the latch can settle it.
    expect(listedFromForPublish('0', now)).toBe('2026-10-02T21:00:00.000Z');
  });
});

describe('Publish starts the window; the event is live by link but not listed', () => {
  test('verify-qr (ready → live) stores listed_from and returns it', async () => {
    const id = `grace-vq-${Date.now()}`;
    await insertEvent(id, 'ready');
    const before = Date.now();
    const res = await verify(id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { event: { listedFrom: string } };
    const stored = await listedFromOf(id);
    expect(stored).toBe(body.event.listedFrom);
    const ms = Date.parse(stored!) - before;
    expect(ms).toBeGreaterThan(9 * 60_000);
    expect(ms).toBeLessThanOrEqual(10 * 60_000 + 5_000);
  });

  test('inside the window: on its own page, NOT on the list, map or sitemap', async () => {
    const id = `grace-hidden-${Date.now()}`;
    await insertEvent(id, 'ready', { h3_res7: RES7 });
    expect((await verify(id)).status).toBe(200);

    // Live by link.
    const page = await SELF.fetch(`https://localhost/events/${id}`);
    expect(page.status).toBe(200);

    // Not found by strangers.
    expect(await inPublicList(id)).toBe(false);
    const listHtml = await (await SELF.fetch('https://localhost/events')).text();
    expect(listHtml).not.toContain(id);
    const map = await SELF.fetch(`https://localhost/api/v2/events/map?cell=${RES7}`);
    expect(map.status).toBe(200);
    expect(await map.text()).not.toContain(id);
    // The sitemap lists events only on production; read it as production would.
    const sitemap = () =>
      handleSitemapXml(new Request('https://localhost/sitemap.xml'), {
        DB: E.DB,
        WORKER_ENV: 'production',
      }).then((r) => r.text());
    expect(await sitemap()).not.toContain(id);

    // Control: the same reads DO show it once the window has passed, so the
    // "not shown" above is the window, not a read that never shows anything.
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await sitemap()).toContain(id);
    expect(await (await SELF.fetch('https://localhost/events')).text()).toContain(id);
  });

  test('when the window has passed, it lists itself (nothing has to run)', async () => {
    const id = `grace-settles-${Date.now()}`;
    await insertEvent(id, 'ready');
    expect((await verify(id)).status).toBe(200);
    expect(await inPublicList(id)).toBe(false);
    // Time passes: move the window end into the past.
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await inPublicList(id)).toBe(true);
  });

  test('PUT status into active (archived → live) starts the window and returns listedFrom', async () => {
    const id = `grace-put-${Date.now()}`;
    await insertEvent(id, 'archived');
    const res = await putStatus(id, 'active');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { listedFrom?: string };
    expect(body.listedFrom).toBeTruthy();
    expect(await listedFromOf(id)).toBe(body.listedFrom);
    expect(await inPublicList(id)).toBe(false);
  });

  test('a field-only PUT on a settled live event never re-starts the window', async () => {
    const id = `grace-fieldonly-${Date.now()}`;
    await insertEvent(id, 'active');
    const res = await handleUpdateEvent(
      new Request(`https://localhost/api/v2/admin/events/${id}`, {
        method: 'PUT',
        headers: { ...BEARER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Renamed, still listed' }),
      }),
      withGrace('10'),
      id
    );
    expect(res.status).toBe(200);
    expect(await listedFromOf(id)).toBeNull();
    expect(await inPublicList(id)).toBe(true);
  });

  test('window off ("0") → listed at once, and the listing start is still recorded', async () => {
    const id = `grace-off-${Date.now()}`;
    await insertEvent(id, 'ready');
    const before = Date.now();
    expect((await verify(id, '0')).status).toBe(200);
    const stored = await listedFromOf(id);
    expect(stored).not.toBeNull();
    expect(Math.abs(Date.parse(stored!) - before)).toBeLessThan(5_000);
    expect(await inPublicList(id)).toBe(true);
  });

  test('created live (automation) lists at once and records its listing start', async () => {
    const res = await SELF.fetch('https://localhost/api/v2/admin/events', {
      method: 'POST',
      headers: { ...BEARER, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Created live', status: 'active', start_date: inDays(3) }),
    });
    expect(res.status).toBeLessThan(300);
    const id = ((await res.json()) as { id: string }).id;
    expect(await listedFromOf(id)).not.toBeNull();
    expect(await inPublicList(id)).toBe(true);
  });
});

describe('Sponsor discovery waits for the window too', () => {
  test('a sponsor cannot find (or ask to back) an event still in its window', async () => {
    const id = `grace-disc-${Date.now()}`;
    await insertEvent(id, 'ready');
    expect((await verify(id)).status).toBe(200);
    const sponsor = { id: `sp-${id}`, brand_id: BRAND, h3_res7: null };
    const ids = async () => (await readDiscoverableEvents(E.DB, sponsor)).map((e) => e.id);
    expect(await ids()).not.toContain(id);
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 1000).toISOString(), id)
      .run();
    expect(await ids()).toContain(id);
  });
});

describe('Undo inside the window leaves no public trace', () => {
  test('publish → undo → it was never on the list, and the window is cleared', async () => {
    const id = `grace-undo-${Date.now()}`;
    await insertEvent(id, 'ready');
    expect((await verify(id)).status).toBe(200);
    expect(await inPublicList(id)).toBe(false);
    const undo = await handleV2AdminUnverifyQr(
      new Request(`https://localhost/api/v2/admin/events/${id}/unverify-qr`, { method: 'POST' }),
      withGrace('10'),
      id
    );
    expect(undo.status).toBe(200);
    expect(await listedFromOf(id)).toBeNull();
    expect(await inPublicList(id)).toBe(false);
  });

  test('PUT live → ready clears the window too; republish starts a fresh one', async () => {
    const id = `grace-loop-${Date.now()}`;
    await insertEvent(id, 'ready');
    expect((await putStatus(id, 'active')).status).toBe(200);
    const first = await listedFromOf(id);
    expect(first).not.toBeNull();
    expect((await putStatus(id, 'ready')).status).toBe(200);
    expect(await listedFromOf(id)).toBeNull();
    await new Promise((r) => setTimeout(r, 5));
    expect((await putStatus(id, 'active')).status).toBe(200);
    const second = await listedFromOf(id);
    expect(second).not.toBeNull();
    expect(Date.parse(second!)).toBeGreaterThanOrEqual(Date.parse(first!));
  });
});

describe('Recap "next at this venue" is a public list too', () => {
  test('it skips an event inside its window and an unlisted one', async () => {
    const venue = `Grace Hall ${Date.now()}`;
    const past = `grace-recap-past-${Date.now()}`;
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, end_date,
              location, created_at, updated_at)
       VALUES (?, ?, 'Last week', ?, 'active', 1, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(past, BRAND, past, inDays(-7), inDays(-7), venue)
      .run();
    const mk = async (id: string, title: string, published: number, listedFrom: string | null) =>
      E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, location,
                listed_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
        .bind(id, BRAND, title, id, published, inDays(5), venue, listedFrom)
        .run();
    const t = Date.now();
    await mk(`grace-recap-new-${t}`, 'Still in its window', 1, new Date(t + 600_000).toISOString());
    await mk(`grace-recap-unl-${t}`, 'Kept off the map', 0, null);
    await mk(`grace-recap-ok-${t}`, 'Settled and listed', 1, new Date(t - 1000).toISOString());
    const html = await (await SELF.fetch(`https://localhost/events/${past}`)).text();
    expect(html).toContain('Settled and listed'); // control: the list renders
    expect(html).not.toContain('Still in its window');
    expect(html).not.toContain('Kept off the map');
  });
});

describe('Corridor latch counts settled events only (OSE-1508)', () => {
  test('five events published today do not latch; the same five a day later do', async () => {
    const brand = `grace-latch-${Date.now()}`;
    const cell = '872664545ffffff';
    const now = new Date();
    for (let i = 0; i < 5; i++) {
      await E.DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, is_published, start_date, h3_res7,
                listed_from, created_at, updated_at)
         VALUES (?, ?, 'Latch', ?, 'active', 1, ?, ?, ?, datetime('now'), datetime('now'))`
      )
        .bind(
          `${brand}-${i}`,
          brand,
          `${brand}-${i}`,
          inDays(2),
          cell,
          new Date(now.getTime() + 10 * 60_000).toISOString()
        )
        .run();
    }
    const latched = async () =>
      (
        await E.DB.prepare(
          'SELECT COUNT(*) AS n FROM corridor_readiness_latch WHERE brand_id = ? AND h3_res7 = ?'
        )
          .bind(brand, cell)
          .first<{ n: number }>()
      )?.n ?? 0;

    await latchReadyCorridors(E.DB, now);
    expect(await latched()).toBe(0);

    // Just under a day after the window ended: still not settled.
    await latchReadyCorridors(
      E.DB,
      new Date(now.getTime() + 10 * 60_000 + (LATCH_SETTLE_HOURS - 1) * 3_600_000)
    );
    expect(await latched()).toBe(0);

    await latchReadyCorridors(
      E.DB,
      new Date(now.getTime() + 10 * 60_000 + LATCH_SETTLE_HOURS * 3_600_000 + 1000)
    );
    expect(await latched()).toBe(1);
  });

  test('events created live do not latch on the first nightly run either', async () => {
    const cell = '872664546ffffff';
    const now = new Date();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch('https://localhost/api/v2/admin/events', {
        method: 'POST',
        headers: { ...BEARER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Live ${i}`, status: 'active', start_date: inDays(2) }),
      });
      ids.push(((await res.json()) as { id: string }).id);
    }
    // Put them in one corridor of their own (the API derives cells from lat/lon).
    for (const id of ids) {
      await E.DB.prepare('UPDATE events SET h3_res7 = ? WHERE id = ?').bind(cell, id).run();
    }
    const latched = async () =>
      (
        await E.DB.prepare(
          'SELECT COUNT(*) AS n FROM corridor_readiness_latch WHERE brand_id = ? AND h3_res7 = ?'
        )
          .bind(BRAND, cell)
          .first<{ n: number }>()
      )?.n ?? 0;
    await latchReadyCorridors(E.DB, now);
    expect(await latched()).toBe(0);
    await latchReadyCorridors(
      E.DB,
      new Date(now.getTime() + LATCH_SETTLE_HOURS * 3_600_000 + 5000)
    );
    expect(await latched()).toBe(1);
  });
});

describe('A concurrent Undo is never reversed', () => {
  // Wrap D1 so another tab's Undo lands between the handler's status read and
  // its UPDATE: the exact interleaving a read-then-write can lose.
  function withUndoBeforeWrite(id: string): D1Database {
    let fired = false;
    return new Proxy(E.DB, {
      get(target, prop) {
        if (prop !== 'prepare') return Reflect.get(target, prop);
        return (sql: string) => {
          if (!fired && /^\s*UPDATE events SET/i.test(sql)) {
            fired = true;
            const realStmt = target.prepare(sql);
            return new Proxy(realStmt, {
              get(st, p2) {
                if (p2 !== 'bind') return Reflect.get(st, p2);
                return (...args: unknown[]) => {
                  const bound = st.bind(...args);
                  return new Proxy(bound, {
                    get(b, p3) {
                      if (p3 !== 'run') return Reflect.get(b, p3);
                      return async () => {
                        await target
                          .prepare(
                            "UPDATE events SET status = 'ready', listed_from = NULL WHERE id = ?"
                          )
                          .bind(id)
                          .run();
                        return b.run();
                      };
                    },
                  });
                };
              },
            });
          }
          return target.prepare(sql);
        };
      },
    });
  }

  test('PUT status active on a live event loses to an Undo that lands first: 409, still a draft-side state', async () => {
    const id = `grace-race-put-${Date.now()}`;
    await insertEvent(id, 'active');
    const res = await handleUpdateEvent(
      new Request(`https://localhost/api/v2/admin/events/${id}`, {
        method: 'PUT',
        headers: { ...BEARER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'active' }),
      }),
      { ...withGrace('10'), DB: withUndoBeforeWrite(id) } as never,
      id
    );
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STATUS_CONFLICT');
    const row = await E.DB.prepare('SELECT status FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe('ready');
    expect(await inPublicList(id)).toBe(false);
  });

  test('verify-qr loses to a concurrent move the same way', async () => {
    const id = `grace-race-vq-${Date.now()}`;
    await insertEvent(id, 'ready');
    // The "other tab" here archives it between the read and the write.
    let fired = false;
    const db = new Proxy(E.DB, {
      get(target, prop) {
        if (prop !== 'prepare') return Reflect.get(target, prop);
        return (sql: string) => {
          if (!fired && /^\s*UPDATE events SET/i.test(sql)) {
            fired = true;
            return {
              bind: (...args: unknown[]) => ({
                run: async () => {
                  await target
                    .prepare("UPDATE events SET status = 'archived' WHERE id = ?")
                    .bind(id)
                    .run();
                  return target
                    .prepare(sql)
                    .bind(...args)
                    .run();
                },
              }),
            };
          }
          return target.prepare(sql);
        };
      },
    });
    const res = await handleV2AdminVerifyQr(
      new Request(`https://localhost/api/v2/admin/events/${id}/verify-qr`, { method: 'POST' }),
      { ...withGrace('10'), DB: db } as never,
      id
    );
    expect(res.status).toBe(409);
    const row = await E.DB.prepare('SELECT status FROM events WHERE id = ?')
      .bind(id)
      .first<{ status: string }>();
    expect(row?.status).toBe('archived');
  });
});

describe('Turning listing on for a live event is a publication too', () => {
  const putListed = (id: string, on: boolean) =>
    handleUpdateEvent(
      new Request(`https://localhost/api/v2/admin/events/${id}`, {
        method: 'PUT',
        headers: { ...BEARER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_published: on }),
      }),
      withGrace('10'),
      id
    );

  test('unlisted live event, long settled → listed: a fresh window, not listed at once', async () => {
    const id = `grace-listing-on-${Date.now()}`;
    await insertEvent(id, 'active');
    await E.DB.prepare('UPDATE events SET is_published = 0, listed_from = ? WHERE id = ?')
      .bind(new Date(Date.now() - 3 * 86_400_000).toISOString(), id)
      .run();
    expect((await putListed(id, true)).status).toBe(200);
    const lf = await listedFromOf(id);
    expect(Date.parse(lf!)).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await inPublicList(id)).toBe(false);
  });

  test('re-saving listing on an event already listed keeps its settled time', async () => {
    const id = `grace-listing-same-${Date.now()}`;
    await insertEvent(id, 'active');
    const old = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await E.DB.prepare('UPDATE events SET listed_from = ? WHERE id = ?').bind(old, id).run();
    expect((await putListed(id, true)).status).toBe(200);
    expect(await listedFromOf(id)).toBe(old);
    expect(await inPublicList(id)).toBe(true);
  });
});

describe('A TV or phone that opened the draft sees it live after Publish', () => {
  test('a cached draft row does not refuse the live event', async () => {
    const id = `grace-cache-${Date.now()}`;
    await insertEvent(id, 'ready');
    const first = await SELF.fetch(`https://localhost/api/v2/events/${id}`);
    expect(first.status).toBe(403); // the draft row is now cached
    expect((await verify(id)).status).toBe(200);
    const after = await SELF.fetch(`https://localhost/api/v2/events/${id}`);
    expect(after.status).toBe(200);
  });
});
