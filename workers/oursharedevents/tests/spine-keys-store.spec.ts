/**
 * Spine keys on the event row (OSE-1615): `events.venue_canonical_id` and
 * `events.event_correlation_id`, computed by the server on every save.
 *
 * The rule (what each key is a hash of) is tested in `spine-keys.spec.ts`
 * against published fixtures. This file tests the row: that create, update,
 * both place lookups and the nightly job leave the keys right, that a key is
 * never left describing a venue the row no longer has, that a client cannot
 * set one, and that neither reaches a public answer.
 *
 * Expected ids are computed here with `crypto.subtle` from names normalised by
 * hand, not with the library under test.
 *
 * Google is never called: tests that need a place stub `fetch`.
 *
 * @born-red spine keys on the row | method: the tests of create, update, the
 *   refusal and the other ways a row gets a cell were run before migration 0104
 *   and the handler changes existed, and failed. The nightly check, its limits
 *   and its log line were rewritten twice after review, with their tests; those
 *   tests, like every other in this file, were seen red on a planted fault. The
 *   faults, one place each, and the tests each turned red are in
 *   `.claude/outputs/CCR-SPINE-KEYS-2026-10-12.md`, section D | date: 2026-10-12
 */
import { env, SELF } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { handleAdminRepeatEvent } from '../src/handlers/event-repeat';
import {
  handleBackfillH3Cells,
  handleCreateEvent,
  handleUpdateEvent,
  type EventsEnv,
} from '../src/handlers/events';
import { runEventPlaceBackfill } from '../src/lib/event-place';
import { PUBLIC_EVENT_FIELDS, toPublicEvent } from '../src/lib/public-event-projection';
import { computeSpineKeys } from '../src/lib/spine-keys';
import {
  afterAllSettle,
  errorLabel,
  REFRESH_ATTEMPTS,
  refreshSpineKeys,
  runSpineKeyCheck,
  spineKeyCheckStart,
  suppliedSpineKeyField,
  touchesSpineKeyInputs,
} from '../src/lib/spine-keys-store';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const E = env as unknown as TestEnv & EventsEnv;
const KEYED = { ...(env as unknown as EventsEnv), GOOGLE_MAPS_API_KEY: 'test-maps-key' };
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};

// Rock Island Public House, Blue Island IL: res-7 cell 872664544ffffff.
const RIPH = { lat: 41.6565, lon: -87.681 };
const RIPH_CELL = '872664544ffffff';
// Sawyer, Michigan: another res-7 cell.
const SAWYER = { lat: 41.8853, lon: -86.5903 };

const BOCCE = 'etr-rec-bocce';
const WATCH_PARTY = 'etr-soc-watchparty';
const uec: Record<string, string> = {};

async function sha32(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
const venueId = (normalised: string, cell: string) => sha32(`v1|${normalised}|${cell}`);
const eventId = (venue: string, type: string, night: string) =>
  sha32(`v1|${venue}|${uec[type]}|${night}`);

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations(E.DB, E.TEST_MIGRATION_STATEMENTS);
  // The poster and TV reads resolve feature flags, which live in FORMS_DB.
  await applyMigrations(E.FORMS_DB, E.TEST_FORMS_MIGRATION_STATEMENTS);
  for (const id of [BOCCE, WATCH_PARTY]) {
    const r = await E.DB.prepare('SELECT uec_code FROM event_type_registry WHERE id = ?')
      .bind(id)
      .first<{ uec_code: string }>();
    expect(r?.uec_code, id).toMatch(/^[A-Z]+-[A-Z0-9]+-\d+$/);
    uec[id] = r!.uec_code;
  }
  expect(uec[BOCCE]).not.toBe(uec[WATCH_PARTY]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface Keys {
  venue_canonical_id: string | null;
  event_correlation_id: string | null;
  h3_res7: string | null;
  updated_at: string;
}
const row = (id: string) =>
  E.DB.prepare(
    'SELECT venue_canonical_id, event_correlation_id, h3_res7, updated_at FROM events WHERE id = ?'
  )
    .bind(id)
    .first<Keys>() as Promise<Keys>;

/** Stub Google's geocoder with one spot. */
function stubSpot(at: { lat: number; lon: number }): void {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          status: 'OK',
          results: [
            {
              geometry: { location: { lat: at.lat, lng: at.lon } },
              formatted_address: 'a spot',
              types: ['establishment'],
            },
          ],
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
  );
}

const BASE = {
  title: 'Spine key night',
  location: 'Rock Island Public House',
  ...RIPH,
  event_type_id: BOCCE,
  start_date: '2026-12-05',
  start_time: '18:30',
  timezone: 'America/Chicago',
};

async function createRaw(e: EventsEnv, body: Record<string, unknown>): Promise<Response> {
  return handleCreateEvent(
    new Request('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    e
  );
}
async function create(body: Record<string, unknown> = {}, e: EventsEnv = E): Promise<string> {
  const res = await createRaw(e, { ...BASE, ...body });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}
async function updateRaw(
  id: string,
  body: Record<string, unknown>,
  e: EventsEnv = E
): Promise<Response> {
  return handleUpdateEvent(
    new Request(`https://t.test/api/v2/admin/events/${id}`, {
      method: 'PUT',
      headers: ADMIN,
      body: JSON.stringify(body),
    }),
    e,
    id
  );
}
async function update(id: string, body: Record<string, unknown>, e: EventsEnv = E): Promise<void> {
  const res = await updateRaw(id, body, e);
  expect(res.status).toBe(200);
}

describe('create writes both keys', () => {
  test('from the venue name, the res-7 cell, the type code and the night', async () => {
    const r = await row(await create());
    expect(r.h3_res7).toBe(RIPH_CELL);
    const venue = await venueId('rock island public house', RIPH_CELL);
    expect(r.venue_canonical_id).toBe(venue);
    expect(r.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });

  test('one venue typed two ways is one venue id', async () => {
    const a = await row(await create({ location: 'The Rock Island Public House' }));
    const b = await row(await create({ location: 'ROCK  ISLAND public-house' }));
    expect(a.venue_canonical_id).toBe(await venueId('rock island public house', RIPH_CELL));
    expect(b.venue_canonical_id).toBe(a.venue_canonical_id);
    // Same venue, same type, same night: one event id too.
    expect(b.event_correlation_id).toBe(a.event_correlation_id);
  });

  test('an apostrophe is kept in the name as typed, and ignored only when comparing venues', async () => {
    // The owner, 2026-10-12: remove it if it is technical, keep it for display. The builder
    // treated comparing venues as the technical case; the name as shown is untouched.
    const typed = ["Joe's Tavern", 'Joe’s Tavern', 'Joes Tavern'];
    const venue = await venueId('joes tavern', RIPH_CELL);
    for (const location of typed) {
      const id = await create({ location, status: 'active' });
      const stored = await E.DB.prepare(
        'SELECT location, venue_canonical_id FROM events WHERE id = ?'
      )
        .bind(id)
        .first<{ location: string; venue_canonical_id: string }>();
      expect(stored?.location, location).toBe(location);
      expect(stored?.venue_canonical_id, location).toBe(venue);
      const shown = await SELF.fetch(`https://example.com/api/v2/events/${id}`);
      expect(((await shown.json()) as { item: { location: string } }).item.location).toBe(location);
    }
  });

  test('a start before 04:00 belongs to the night before', async () => {
    const r = await row(await create({ start_date: '2026-12-06', start_time: '01:30' }));
    expect(r.event_correlation_id).toBe(
      await eventId(r.venue_canonical_id as string, BOCCE, '2026-12-05')
    );
  });

  test('a date-only event uses its date', async () => {
    const r = await row(await create({ start_time: undefined }));
    expect(r.event_correlation_id).toBe(
      await eventId(r.venue_canonical_id as string, BOCCE, '2026-12-05')
    );
  });

  test('no type: a venue key and no event key', async () => {
    const r = await row(await create({ event_type_id: undefined }));
    expect(r.venue_canonical_id).toBe(await venueId('rock island public house', RIPH_CELL));
    expect(r.event_correlation_id).toBeNull();
  });

  test('no place on the map: no key at all', async () => {
    const r = await row(await create({ lat: undefined, lon: undefined }));
    expect(r.h3_res7).toBeNull();
    expect(r.venue_canonical_id).toBeNull();
    expect(r.event_correlation_id).toBeNull();
  });

  test('a place found by the lookup gives the keys in the same save', async () => {
    stubSpot(RIPH);
    const r = await row(await create({ lat: undefined, lon: undefined }, KEYED));
    expect(r.h3_res7).toBe(RIPH_CELL);
    const venue = await venueId('rock island public house', RIPH_CELL);
    expect(r.venue_canonical_id).toBe(venue);
    expect(r.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });
});

describe('update keeps the keys true to the row', () => {
  test('a new venue name: both keys are the new venue’s', async () => {
    const id = await create();
    const before = await row(id);
    stubSpot(RIPH);
    await update(id, { location: 'Eagles Hall' }, KEYED);
    const after = await row(id);
    const venue = await venueId('eagles hall', RIPH_CELL);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.venue_canonical_id).not.toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });

  test('a new venue the map cannot place: no key, never the old venue’s key', async () => {
    const id = await create();
    expect((await row(id)).event_correlation_id).not.toBeNull();
    await update(id, { location: 'Somewhere Else Entirely' });
    const after = await row(id);
    expect(after.h3_res7).toBeNull();
    expect(after.venue_canonical_id).toBeNull();
    expect(after.event_correlation_id).toBeNull();
  });

  test('a respelling of the same venue keeps the same venue id', async () => {
    const id = await create();
    const before = await row(id);
    expect(before.event_correlation_id).not.toBeNull();
    stubSpot(RIPH);
    await update(id, { location: 'The Rock Island Public House' }, KEYED);
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(before.event_correlation_id);
  });

  test('new coordinates in another cell: a new venue id', async () => {
    const id = await create();
    const before = await row(id);
    await update(id, SAWYER);
    const after = await row(id);
    expect(after.h3_res7).not.toBe(RIPH_CELL);
    const venue = await venueId('rock island public house', after.h3_res7 as string);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.venue_canonical_id).not.toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });

  test('a new type: the venue id stays, the event id changes', async () => {
    const id = await create();
    const before = await row(id);
    await update(id, { event_type_id: WATCH_PARTY });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(
      await eventId(before.venue_canonical_id as string, WATCH_PARTY, '2026-12-05')
    );
  });

  test('the type cleared: the venue id stays, the event id goes', async () => {
    const id = await create();
    const before = await row(id);
    expect(before.event_correlation_id).not.toBeNull();
    await update(id, { event_type_id: null });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBeNull();
  });

  test('a new date, and a new time across 04:00: the event id follows the night', async () => {
    const id = await create();
    const venue = (await row(id)).venue_canonical_id as string;
    await update(id, { start_date: '2026-12-12' });
    expect((await row(id)).event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-12'));
    await update(id, { start_time: '02:15' });
    expect((await row(id)).event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-11'));
    await update(id, { start_time: null });
    expect((await row(id)).event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-12'));
  });

  test('an edit that changes no input leaves both keys as they were', async () => {
    const id = await create();
    const before = await row(id);
    await update(id, { title: 'A better title', description: 'New words' });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(before.event_correlation_id);
    expect(before.venue_canonical_id).not.toBeNull();
  });
});

describe('other saves', () => {
  test('a status change alone leaves both keys as they were', async () => {
    const id = await create();
    const before = await row(id);
    expect(before.event_correlation_id).not.toBeNull();
    await update(id, { status: 'ready' });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(before.event_correlation_id);
  });

  test('a new name and new coordinates in one save: the key of the new name in the new cell', async () => {
    const id = await create();
    await update(id, { location: 'Eagles Hall', ...SAWYER });
    const after = await row(id);
    expect(after.h3_res7).not.toBeNull();
    expect(after.h3_res7).not.toBe(RIPH_CELL);
    const venue = await venueId('eagles hall', after.h3_res7 as string);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });

  test('a new zone alone: the wall time is carried, so the night and both keys stay', async () => {
    const id = await create({ start_date: '2026-12-06', start_time: '03:30' });
    const before = await row(id);
    expect(before.event_correlation_id).toBe(
      await eventId(before.venue_canonical_id as string, BOCCE, '2026-12-05')
    );
    await update(id, { timezone: 'America/New_York' });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(after.event_correlation_id).toBe(before.event_correlation_id);
  });

  test('a copy made with "Repeat this event" gets its own night’s key, not the source’s', async () => {
    const id = await create({ status: 'active' });
    const source = await row(id);
    const res = await handleAdminRepeatEvent(
      new Request(`https://t.test/api/v2/admin/events/${id}/repeat`, {
        method: 'POST',
        headers: ADMIN,
        body: '{}',
      }),
      E,
      id
    );
    expect(res.status).toBe(201);
    const copyId = ((await res.json()) as { id: string }).id;
    expect(copyId).not.toBe(id);
    const copy = await E.DB.prepare(
      'SELECT location, h3_res7, start_date, starts_at, event_type_id, venue_canonical_id, event_correlation_id FROM events WHERE id = ?'
    )
      .bind(copyId)
      .first<Record<string, string | null>>();
    // The copy keeps the place, the cell and the type, and takes a new date at
    // the same time of day. So it is the same venue on another night.
    expect(copy?.location).toBe('Rock Island Public House');
    expect(copy?.h3_res7).toBe(RIPH_CELL);
    expect(copy?.event_type_id).toBe(BOCCE);
    expect(copy?.start_date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(copy?.venue_canonical_id).toBe(source.venue_canonical_id);
    // 18:30 local is after 04:00: the night is the copy's own date.
    expect(copy?.event_correlation_id).toBe(
      await eventId(
        source.venue_canonical_id as string,
        BOCCE,
        (copy?.start_date as string).slice(0, 10)
      )
    );
    expect(copy?.event_correlation_id).not.toBe(source.event_correlation_id);
  });
});

describe('coordinates that are not on the globe', () => {
  for (const body of [{ lat: 999 }, { lon: -181 }, { lat: 41.6, lon: 400 }, { lat: -90.01 }]) {
    test(`a PUT of ${JSON.stringify(body)} is refused before anything is written`, async () => {
      const id = await create();
      const before = await E.DB.prepare(
        'SELECT lat, lon, h3_res9, h3_res7, venue_canonical_id, event_correlation_id, title FROM events WHERE id = ?'
      )
        .bind(id)
        .first<Record<string, unknown>>();
      expect(before?.h3_res7).toBe(RIPH_CELL);
      expect(before?.venue_canonical_id).not.toBeNull();
      const res = await updateRaw(id, { title: 'must not land', ...body });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('INVALID_COORDINATES');
      const after = await E.DB.prepare(
        'SELECT lat, lon, h3_res9, h3_res7, venue_canonical_id, event_correlation_id, title FROM events WHERE id = ?'
      )
        .bind(id)
        .first<Record<string, unknown>>();
      // The cell, the keys and the title are all as they were.
      expect(after).toEqual(before);
    });
  }

  test('coordinates at the edge of the globe are accepted', async () => {
    const id = await create();
    const res = await updateRaw(id, { lat: 90, lon: -180 });
    expect(res.status).toBe(200);
  });
});

describe('after a save a key is absent or right', () => {
  const realProp = (target: D1Database, prop: string | symbol): unknown => {
    const v = Reflect.get(target, prop) as unknown;
    return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
  };

  /** An env whose database refuses every statement that matches `refused`. */
  function refusing(refused: RegExp): EventsEnv {
    const DB = new Proxy(E.DB, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            if (refused.test(sql)) throw new Error('planted: statement refused');
            return target.prepare(sql);
          };
        }
        return realProp(target, prop);
      },
    });
    return { ...(E as unknown as EventsEnv), DB } as EventsEnv;
  }
  const keysCannotBeStored = () => refusing(/UPDATE events SET venue_canonical_id = \?/);

  /**
   * A database that runs `edit` each time the read of a row's inputs has
   * answered, for the first `times` reads: another save landing in the gap.
   */
  function editAfterEachRead(edit: (read: number) => Promise<unknown>, times: number) {
    let reads = 0;
    const DB = new Proxy(E.DB, {
      get(target, prop) {
        if (prop === 'prepare') {
          return (sql: string) => {
            const stmt = target.prepare(sql);
            if (!/LEFT JOIN event_type_registry etr/.test(sql)) return stmt;
            return {
              bind: (...args: unknown[]) => {
                const bound = stmt.bind(...args);
                return {
                  first: async () => {
                    const read = await bound.first();
                    reads++;
                    if (reads <= times) await edit(reads);
                    return read;
                  },
                };
              },
            };
          };
        }
        return realProp(target, prop);
      },
    }) as D1Database;
    return { DB, reads: () => reads };
  }

  /** What a save's own statement does before the refresh runs. */
  const clearKeys = (id: string) =>
    E.DB.prepare(
      'UPDATE events SET venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
    )
      .bind(id)
      .run();

  const refreshFailures = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('SPINE_KEYS_REFRESH_FAILED'));

  test('when the keys cannot be stored, a changed type leaves no event key, the save still lands, and it is logged', async () => {
    const id = await create();
    const before = await row(id);
    expect(before.event_correlation_id).not.toBeNull();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await updateRaw(id, { event_type_id: WATCH_PARTY }, keysCannotBeStored());
    expect(res.status).toBe(200);
    const after = await row(id);
    expect(after.venue_canonical_id).toBeNull();
    expect(after.event_correlation_id).toBeNull();
    const type = await E.DB.prepare('SELECT event_type_id FROM events WHERE id = ?')
      .bind(id)
      .first<{ event_type_id: string }>();
    expect(type?.event_type_id).toBe(WATCH_PARTY);
    const logged = refreshFailures(warn);
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toMatchObject({ source: 'save', error: 'Error' });
    expect(logged[0]).not.toContain('planted');
    // The line names no event: a function that logs what it is given makes
    // every caller a log sink.
    expect(logged[0]).not.toContain(id);
  });

  test('…and the nightly check then gives the row the right keys', async () => {
    const id = await create();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await runSpineKeyCheck(E);
    expect((await row(id)).venue_canonical_id).not.toBeNull();
    await updateRaw(id, { start_date: '2026-12-19' }, keysCannotBeStored());
    expect((await row(id)).venue_canonical_id).toBeNull();
    const result = await runSpineKeyCheck(E);
    expect(result.filled).toBeGreaterThanOrEqual(1);
    const after = await row(id);
    const venue = await venueId('rock island public house', RIPH_CELL);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-19'));
  });

  test('new coordinates clear the keys even when they cannot be stored again', async () => {
    const id = await create();
    expect((await row(id)).event_correlation_id).not.toBeNull();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await updateRaw(id, SAWYER, keysCannotBeStored());
    const after = await row(id);
    expect(after.h3_res7).not.toBe(RIPH_CELL);
    expect(after.venue_canonical_id).toBeNull();
    expect(after.event_correlation_id).toBeNull();
  });

  test('new coordinates clear the keys in the statement that stores the coordinates: a failed cell statement leaves no key', async () => {
    const id = await create();
    expect((await row(id)).event_correlation_id).not.toBeNull();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await updateRaw(
      id,
      SAWYER,
      refusing(/^UPDATE events SET h3_res9 = \?, h3_res7 = \?/)
    );
    expect(res.status).toBe(503);
    const after = await E.DB.prepare(
      'SELECT lat, h3_res7, venue_canonical_id, event_correlation_id FROM events WHERE id = ?'
    )
      .bind(id)
      .first<Record<string, unknown>>();
    // The coordinates landed and the new cell did not. The old cell went with
    // the old coordinates, so no check can give the row the old cell's key back.
    expect(after?.lat).toBe(SAWYER.lat);
    expect(after?.h3_res7).toBeNull();
    expect(after?.venue_canonical_id).toBeNull();
    expect(after?.event_correlation_id).toBeNull();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runSpineKeyCheck(E);
    expect((await row(id)).venue_canonical_id).toBeNull();
  });

  test('storing the keys is not an edit: updated_at does not move', async () => {
    const id = await create();
    await E.DB.prepare(
      "UPDATE events SET updated_at = '2026-01-01T00:00:00.000Z', venue_canonical_id = NULL WHERE id = ?"
    )
      .bind(id)
      .run();
    const keys = await refreshSpineKeys(E.DB, id);
    expect(keys?.venue_canonical_id).toBe(await venueId('rock island public house', RIPH_CELL));
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(keys?.venue_canonical_id);
    expect(after.updated_at).toBe('2026-01-01T00:00:00.000Z');
  });

  test('keys that are already right are not written again', async () => {
    const id = await create();
    const before = await row(id);
    const keys = await refreshSpineKeys(keysCannotBeStored().DB as D1Database, id);
    expect(keys?.venue_canonical_id).toBe(before.venue_canonical_id);
    expect(keys?.event_correlation_id).toBe(before.event_correlation_id);
  });

  // One case per input: the write is guarded on every one of them. In each, a
  // save changes that input (and clears the keys, as every save does) after the
  // refresh has read the row. The refresh must notice (a second read) and leave
  // the keys of the row as it now is.
  const OTHER_CELL = '872664c1affffff';
  const GAP_EDITS: Array<{
    column: string;
    value: string;
    venueName: string;
    cell: string;
    type: string;
    night: string;
  }> = [
    {
      column: 'location',
      value: 'Eagles Hall',
      venueName: 'eagles hall',
      cell: RIPH_CELL,
      type: BOCCE,
      night: '2026-12-05',
    },
    {
      column: 'h3_res7',
      value: OTHER_CELL,
      venueName: 'rock island public house',
      cell: OTHER_CELL,
      type: BOCCE,
      night: '2026-12-05',
    },
    {
      column: 'event_type_id',
      value: WATCH_PARTY,
      venueName: 'rock island public house',
      cell: RIPH_CELL,
      type: WATCH_PARTY,
      night: '2026-12-05',
    },
    {
      // A timed event's night comes from starts_at, so the key is the same;
      // the guard must still see the change.
      column: 'start_date',
      value: '2026-12-20',
      venueName: 'rock island public house',
      cell: RIPH_CELL,
      type: BOCCE,
      night: '2026-12-05',
    },
    {
      // 18:30 in Chicago is 19:30 in New York: the same night.
      column: 'timezone',
      value: 'America/New_York',
      venueName: 'rock island public house',
      cell: RIPH_CELL,
      type: BOCCE,
      night: '2026-12-05',
    },
    {
      // 02:00Z on Dec 7 is 20:00 on Dec 6 in Chicago.
      column: 'starts_at',
      value: '2026-12-07T02:00:00.000Z',
      venueName: 'rock island public house',
      cell: RIPH_CELL,
      type: BOCCE,
      night: '2026-12-06',
    },
  ];

  for (const edit of GAP_EDITS) {
    test(`a save that changes ${edit.column} between the read and the write is not overwritten`, async () => {
      const id = await create();
      // The refresh runs after a save, and a save has cleared the keys.
      await clearKeys(id);
      const gap = editAfterEachRead(
        () =>
          E.DB.prepare(
            `UPDATE events SET ${edit.column} = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?`
          )
            .bind(edit.value, id)
            .run(),
        1
      );
      const keys = await refreshSpineKeys(gap.DB, id);
      expect(gap.reads(), 'the first write must miss and the row be read again').toBe(2);
      const venue = await venueId(edit.venueName, edit.cell);
      const event = await eventId(venue, edit.type, edit.night);
      expect(keys).toEqual({ venue_canonical_id: venue, event_correlation_id: event });
      const after = await row(id);
      expect(after.venue_canonical_id).toBe(venue);
      expect(after.event_correlation_id).toBe(event);
    });
  }

  test(`a row that changes on every read: ${REFRESH_ATTEMPTS} attempts, then no key and one log line`, async () => {
    const id = await create();
    await clearKeys(id);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gap = editAfterEachRead(
      (read) =>
        E.DB.prepare(
          'UPDATE events SET event_type_id = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
        )
          .bind(read % 2 ? WATCH_PARTY : BOCCE, id)
          .run(),
      99
    );
    expect(await refreshSpineKeys(gap.DB, id)).toBeNull();
    expect(REFRESH_ATTEMPTS).toBe(3);
    expect(gap.reads()).toBe(3);
    const after = await row(id);
    expect(after.venue_canonical_id).toBeNull();
    expect(after.event_correlation_id).toBeNull();
    expect(refreshFailures(warn)).toHaveLength(1);
  });

  test('an event deleted between the read and the write gets nothing, and one that never existed gets nothing', async () => {
    // A bare row: nothing else points at it, so it can be deleted.
    const id = `gone-${crypto.randomUUID().slice(0, 8)}`;
    await E.DB.prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, h3_res7, event_type_id, start_date, created_at, updated_at)
       VALUES (?, 'root', ?, ?, 'draft', 'Gone Hall', ?, ?, '2026-11-07', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    )
      .bind(id, id, id, RIPH_CELL, BOCCE)
      .run();
    const gap = editAfterEachRead(
      () => E.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run(),
      1
    );
    expect(await refreshSpineKeys(gap.DB, id)).toBeNull();
    expect(gap.reads()).toBe(2);
    expect(await refreshSpineKeys(E.DB, 'evt_not_there')).toBeNull();
  });

  test('which assignments count as changing an input', () => {
    expect(touchesSpineKeyInputs(['title = ?', 'updated_at = ?'])).toBe(false);
    expect(touchesSpineKeyInputs(['where_address = ?'])).toBe(false);
    // A name that only ends like an input is not one.
    expect(touchesSpineKeyInputs(['old_location = ?', 'event_starts_at = ?'])).toBe(false);
    for (const set of [
      'location = ?',
      'h3_res7 = NULL',
      'event_type_id = ?',
      'start_date = ?',
      'timezone = ?',
      'starts_at = ?',
      // Shapes a later edit to the handler could produce.
      'location=?',
      'LOCATION = ?',
      'title = ?, location = ?',
      'lat = NULL, lon = NULL, h3_res9 = NULL, h3_res7 = NULL',
    ]) {
      expect(touchesSpineKeyInputs(['title = ?', set]), set).toBe(true);
    }
  });
});

describe('a body that is not a JSON object', () => {
  test('names no key field', () => {
    for (const body of [5, 'x', null, true, undefined]) {
      expect(suppliedSpineKeyField(body), String(body)).toBeNull();
    }
    expect(suppliedSpineKeyField([])).toBeNull();
    expect(suppliedSpineKeyField({ venue_canonical_id: null })).toBe('venue_canonical_id');
    expect(suppliedSpineKeyField({ title: 't', event_correlation_id: 'x' })).toBe(
      'event_correlation_id'
    );
  });

  test('create still answers 400, as it did before the keys existed', async () => {
    for (const body of [5, 'x', true]) {
      const res = await handleCreateEvent(
        new Request('https://t.test/api/v2/admin/events', {
          method: 'POST',
          headers: ADMIN,
          body: JSON.stringify(body),
        }),
        E
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { code: string }).code).toBe('MISSING_FIELD');
    }
  });
});

describe('a client never supplies a key', () => {
  for (const field of ['venue_canonical_id', 'event_correlation_id']) {
    test(`create with ${field} is refused and makes no event`, async () => {
      const title = `Refused create ${field}`;
      const res = await createRaw(E, { ...BASE, title, [field]: 'a'.repeat(32) });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; code: string; error: string };
      expect(body.code).toBe('SERVER_COMPUTED_FIELD');
      expect(body.error).toContain(field);
      const made = await E.DB.prepare('SELECT COUNT(*) AS n FROM events WHERE title = ?')
        .bind(title)
        .first<{ n: number }>();
      expect(made?.n).toBe(0);
    });

    test(`update with ${field} is refused and changes nothing, null included`, async () => {
      const id = await create();
      const before = await row(id);
      for (const value of ['b'.repeat(32), null]) {
        const res = await updateRaw(id, { title: 'Should not land', [field]: value });
        expect(res.status).toBe(400);
        expect(((await res.json()) as { code: string }).code).toBe('SERVER_COMPUTED_FIELD');
      }
      const after = await row(id);
      expect(after).toEqual(before);
      const t = await E.DB.prepare('SELECT title FROM events WHERE id = ?')
        .bind(id)
        .first<{ title: string }>();
      expect(t?.title).toBe(BASE.title);
    });
  }
});

describe('the other ways a row gets a cell', () => {
  test('the nightly place lookup: a found place gives the keys', async () => {
    const id = await create({
      lat: undefined,
      lon: undefined,
      location: 'Nightly Lookup Hall',
      start_date: '2099-01-01',
    });
    expect((await row(id)).venue_canonical_id).toBeNull();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    // Only this row may be waiting, so the stubbed place lands on it alone.
    await E.DB.prepare(
      "UPDATE events SET place_checked_at = '2026-01-01T00:00:00.000Z' WHERE id != ? AND place_checked_at IS NULL"
    )
      .bind(id)
      .run();
    await runEventPlaceBackfill(KEYED, async () =>
      Response.json({
        status: 'OK',
        results: [
          {
            geometry: { location: { lat: RIPH.lat, lng: RIPH.lon } },
            formatted_address: 'a spot',
            types: ['establishment'],
          },
        ],
      })
    );
    const after = await row(id);
    expect(after.h3_res7).toBe(RIPH_CELL);
    const venue = await venueId('nightly lookup hall', RIPH_CELL);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2099-01-01'));
  });

  test('the one-shot cell backfill: a row given its cell gets its keys', async () => {
    const id = await create();
    await E.DB.prepare(
      'UPDATE events SET h3_res9 = NULL, h3_res7 = NULL, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
    )
      .bind(id)
      .run();
    const res = await handleBackfillH3Cells(
      new Request('https://t.test/api/v2/admin/events/backfill-h3-cells', {
        method: 'POST',
        headers: ADMIN,
      }),
      E
    );
    expect(res.status).toBe(200);
    const after = await row(id);
    expect(after.h3_res7).toBe(RIPH_CELL);
    const venue = await venueId('rock island public house', RIPH_CELL);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-12-05'));
  });
});

describe('the nightly check computes every row again and writes where it differs', () => {
  /** A row as one saved before the keys existed: inputs, no key. */
  async function seed(id: string, cols: Record<string, string | null> = {}): Promise<void> {
    const all: Record<string, string | null> = {
      id,
      brand_id: 'root',
      title: id,
      slug: id,
      status: 'draft',
      location: 'Old Row Tavern',
      h3_res7: RIPH_CELL,
      event_type_id: BOCCE,
      start_date: '2026-11-07',
      timezone: 'America/Chicago',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
      ...cols,
    };
    const names = Object.keys(all);
    await E.DB.prepare(
      `INSERT INTO events (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`
    )
      .bind(...names.map((n) => all[n]))
      .run();
  }
  /** Silence both levels: a run with a correction logs at warning level. */
  const quiet = () => ({
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
  });
  const checkLines = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"SPINE_KEY_CHECK"'));
  /** From the first id, so the order rows are read in is the order of their ids. */
  const fromTheTop = { start: '' };
  /** Leave no row waiting, so a test's counts are its own rows. */
  async function settle(): Promise<void> {
    const r = await runSpineKeyCheck(E, fromTheTop);
    expect(r.errors).toBe(0);
    expect(r.incomplete).toBe(false);
  }
  const eventCount = async () =>
    (
      (await E.DB.prepare('SELECT COUNT(*) AS n FROM events').first<{ n: number }>()) as {
        n: number;
      }
    ).n;
  const venueOf = (id: string) => row(id).then((r) => r.venue_canonical_id);

  test('a row with every input gets both keys; a row short of one gets only what it can', async () => {
    quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 8);
    await seed(`old-full-${tag}`);
    await seed(`old-untyped-${tag}`, { event_type_id: null });
    await seed(`old-undated-${tag}`, { start_date: null });
    await seed(`old-nocell-${tag}`, { h3_res7: null });
    await seed(`old-noname-${tag}`, { location: '   ' });
    await seed(`old-punct-${tag}`, { location: '???' });
    const before = await runSpineKeyCheck(E, { ...fromTheTop, maxWrites: 0 });

    const first = await runSpineKeyCheck(E, fromTheTop);
    // Three rows can be keyed, three cannot: exactly three writes.
    expect(first).toMatchObject({
      filled: 3,
      corrected: 0,
      errors: 0,
      incomplete: false,
      stopped: null,
      first_error: null,
    });
    expect(first.checked).toBe(await eventCount());
    // The counts of rows that can have a key are counts of rows, not of writes.
    expect(first.with_venue_key).toBe(before.with_venue_key);
    expect(first.with_event_key).toBe(before.with_event_key);
    expect(first.with_venue_key).toBeGreaterThanOrEqual(3);
    expect(first.with_event_key).toBeGreaterThanOrEqual(1);
    expect(first.with_event_key).toBeLessThan(first.with_venue_key);

    const venue = await venueId('old row tavern', RIPH_CELL);
    const full = await row(`old-full-${tag}`);
    expect(full.venue_canonical_id).toBe(venue);
    expect(full.event_correlation_id).toBe(await eventId(venue, BOCCE, '2026-11-07'));
    expect(full.updated_at).toBe('2026-01-01T00:00:00.000Z');

    for (const partial of [`old-untyped-${tag}`, `old-undated-${tag}`]) {
      const r = await row(partial);
      expect(r.venue_canonical_id, partial).toBe(venue);
      expect(r.event_correlation_id, partial).toBeNull();
    }
    for (const none of [`old-nocell-${tag}`, `old-noname-${tag}`, `old-punct-${tag}`]) {
      const r = await row(none);
      expect(r.venue_canonical_id, none).toBeNull();
      expect(r.event_correlation_id, none).toBeNull();
    }

    // The next night every row is read again and nothing is written.
    const second = await runSpineKeyCheck(E, fromTheTop);
    expect(second).toMatchObject({ filled: 0, corrected: 0, errors: 0, incomplete: false });
    expect(second.checked).toBe(first.checked);
  });

  // A writer outside the Worker (a seed file, a migration, SQL run by hand, an
  // older Worker version) changes an input and does not clear the keys. The key
  // is then wrong until the next check, which must replace it and say so.
  const OTHER_CELL = '872664c1affffff';
  const OUTSIDE_WRITES: Array<{
    column: string;
    value: string | null;
    base?: Record<string, unknown>;
    venue: [string, string] | null;
    type: string;
    night: string | null;
  }> = [
    {
      column: 'location',
      value: 'Eagles Hall',
      venue: ['eagles hall', RIPH_CELL],
      type: BOCCE,
      night: '2026-12-05',
    },
    {
      column: 'h3_res7',
      value: OTHER_CELL,
      venue: ['rock island public house', OTHER_CELL],
      type: BOCCE,
      night: '2026-12-05',
    },
    { column: 'h3_res7', value: null, venue: null, type: BOCCE, night: null },
    {
      column: 'event_type_id',
      value: WATCH_PARTY,
      venue: ['rock island public house', RIPH_CELL],
      type: WATCH_PARTY,
      night: '2026-12-05',
    },
    {
      column: 'event_type_id',
      value: null,
      venue: ['rock island public house', RIPH_CELL],
      type: BOCCE,
      night: null,
    },
    {
      column: 'start_date',
      value: '2026-12-20',
      base: { start_time: undefined },
      venue: ['rock island public house', RIPH_CELL],
      type: BOCCE,
      night: '2026-12-20',
    },
    {
      // 09:30Z on Dec 6 is 03:30 in Chicago (the night of the 5th) and 04:30 in
      // New York (the 6th).
      column: 'timezone',
      value: 'America/New_York',
      base: { start_date: '2026-12-06', start_time: '03:30' },
      venue: ['rock island public house', RIPH_CELL],
      type: BOCCE,
      night: '2026-12-06',
    },
    {
      column: 'starts_at',
      value: '2026-12-07T02:00:00.000Z',
      venue: ['rock island public house', RIPH_CELL],
      type: BOCCE,
      night: '2026-12-06',
    },
  ];

  for (const w of OUTSIDE_WRITES) {
    test(`an outside write of ${w.column} = ${w.value === null ? 'NULL' : w.value} that clears nothing is corrected by the next check, at warning level`, async () => {
      const spies = quiet();
      await settle();
      const id = await create(w.base ?? {});
      const before = await row(id);
      expect(before.venue_canonical_id).not.toBeNull();
      expect(before.event_correlation_id).not.toBeNull();

      await E.DB.prepare(`UPDATE events SET ${w.column} = ? WHERE id = ?`).bind(w.value, id).run();
      // Nothing cleared them: the keys still describe the row as it was.
      const stale = await row(id);
      expect(stale.venue_canonical_id).toBe(before.venue_canonical_id);
      expect(stale.event_correlation_id).toBe(before.event_correlation_id);

      spies.warn.mockClear();
      const result = await runSpineKeyCheck(E);
      expect(result).toMatchObject({ filled: 0, corrected: 1, errors: 0, incomplete: false });
      // A correction is something to look at: it is logged as a warning.
      expect(checkLines(spies.warn)).toHaveLength(1);

      const venue = w.venue ? await venueId(w.venue[0], w.venue[1]) : null;
      const event = venue && w.night ? await eventId(venue, w.type, w.night) : null;
      const after = await row(id);
      expect(after.venue_canonical_id).toBe(venue);
      expect(after.event_correlation_id).toBe(event);
      // At least one of the two must have changed, or the case proved nothing.
      expect(
        after.venue_canonical_id !== before.venue_canonical_id ||
          after.event_correlation_id !== before.event_correlation_id
      ).toBe(true);
    });
  }

  test('a type whose code is changed in the registry: its events get the key of the new code', async () => {
    quiet();
    await settle();
    // A type of this test's own: the seeded types' codes are held in place by
    // a foreign key from template_event_types.
    const tag = crypto.randomUUID().slice(0, 8).toUpperCase();
    const typeId = `etr-test-spine-${tag.toLowerCase()}`;
    const [codeA, codeB] = [`TST-${tag}-001`, `TST-${tag}-002`];
    await E.DB.prepare(
      "INSERT INTO event_type_registry (id, uec_code, name) VALUES (?, ?, 'Spine test type')"
    )
      .bind(typeId, codeA)
      .run();
    const id = await create({ event_type_id: typeId });
    const before = await row(id);
    const venue = before.venue_canonical_id as string;
    expect(before.event_correlation_id).toBe(await sha32(`v1|${venue}|${codeA}|2026-12-05`));

    await E.DB.prepare('UPDATE event_type_registry SET uec_code = ? WHERE id = ?')
      .bind(codeB, typeId)
      .run();
    const result = await runSpineKeyCheck(E);
    expect(result).toMatchObject({ filled: 0, corrected: 1, errors: 0, incomplete: false });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await sha32(`v1|${venue}|${codeB}|2026-12-05`));
  });

  test('"corrected" means a stored key was wrong: a row that gains a key it lacked is a fill', async () => {
    quiet();
    await settle();
    const id = `gains-${crypto.randomUUID().slice(0, 8)}`;
    await seed(id, { event_type_id: null });
    expect(await runSpineKeyCheck(E)).toMatchObject({ filled: 1, corrected: 0 });
    const venue = await venueOf(id);
    expect(venue).not.toBeNull();
    // An outside write gives the row its type. The venue key it has is still
    // right; only the event key is missing.
    await E.DB.prepare('UPDATE events SET event_type_id = ? WHERE id = ?').bind(BOCCE, id).run();
    expect(await runSpineKeyCheck(E)).toMatchObject({ filled: 1, corrected: 0, errors: 0 });
    const after = await row(id);
    expect(after.venue_canonical_id).toBe(venue);
    expect(after.event_correlation_id).toBe(await eventId(venue as string, BOCCE, '2026-11-07'));
  });

  test('rows that can never have a key cost no write and do not crowd out the rest', async () => {
    quiet();
    await settle();
    // Ids are read in order: the five rows that cannot be keyed come first.
    for (const [i, location] of ['???', '—', '📍', '❤️', '!!! ...'].entries()) {
      await seed(`0000-unkeyable-${i}-${crypto.randomUUID().slice(0, 6)}`, { location });
    }
    const last = `zzzz-keyable-${crypto.randomUUID().slice(0, 6)}`;
    await seed(last);
    const result = await runSpineKeyCheck(E, { ...fromTheTop, page: 2, maxWrites: 1 });
    expect(result).toMatchObject({ filled: 1, corrected: 0, errors: 0, incomplete: false });
    expect(await venueOf(last)).toBe(await venueId('old row tavern', RIPH_CELL));
  });

  test('the write limit: what is left waits for the next run, and the run says why it stopped', async () => {
    const spies = quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 6);
    for (const n of [1, 2, 3]) await seed(`limit-${tag}-${n}`);
    spies.warn.mockClear();
    const first = await runSpineKeyCheck(E, { ...fromTheTop, maxWrites: 2 });
    expect(first).toMatchObject({ filled: 2, errors: 0, incomplete: true, stopped: 'write_cap' });
    // An unfinished run is logged as a warning.
    expect(checkLines(spies.warn)).toHaveLength(1);
    const second = await runSpineKeyCheck(E, { ...fromTheTop, maxWrites: 2 });
    expect(second).toMatchObject({ filled: 1, errors: 0, incomplete: false, stopped: null });
    for (const n of [1, 2, 3]) {
      expect(await venueOf(`limit-${tag}-${n}`), String(n)).not.toBeNull();
    }
  });

  test('exactly as many waiting rows as the limit is a finished run, not an unfinished one', async () => {
    quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 6);
    for (const n of [1, 2]) await seed(`exact-${tag}-${n}`);
    expect(await runSpineKeyCheck(E, { ...fromTheTop, maxWrites: 2 })).toMatchObject({
      filled: 2,
      incomplete: false,
      stopped: null,
    });
  });

  test('a wrong key is written before a missing one when both wait and there is room for one', async () => {
    quiet();
    await settle();
    // The missing key sorts first by id; the wrong one must still go first.
    const missing = `0001-missing-${crypto.randomUUID().slice(0, 6)}`;
    await seed(missing);
    const wrong = await create();
    const stale = await venueOf(wrong);
    await E.DB.prepare("UPDATE events SET location = 'Eagles Hall' WHERE id = ?").bind(wrong).run();
    const result = await runSpineKeyCheck(E, { ...fromTheTop, maxWrites: 1 });
    expect(result).toMatchObject({
      filled: 0,
      corrected: 1,
      incomplete: true,
      stopped: 'write_cap',
    });
    expect(await venueOf(wrong)).toBe(await venueId('eagles hall', RIPH_CELL));
    expect(await venueOf(wrong)).not.toBe(stale);
    expect(await venueOf(missing)).toBeNull();
    await settle();
    expect(await venueOf(missing)).not.toBeNull();
  });

  test('the row limit stops the run and it says why; paging reads each row once', async () => {
    quiet();
    await settle();
    for (const n of [1, 2, 3, 4]) await seed(`paged-${crypto.randomUUID().slice(0, 6)}-${n}`);
    await settle();
    const total = await eventCount();
    expect(total).toBeGreaterThanOrEqual(4);
    const capped = await runSpineKeyCheck(E, { ...fromTheTop, page: 1, maxRows: 2 });
    expect(capped).toMatchObject({ checked: 2, incomplete: true, stopped: 'row_cap' });
    const clamped = await runSpineKeyCheck(E, { ...fromTheTop, page: 50, maxRows: 2 });
    expect(clamped).toMatchObject({ checked: 2, incomplete: true, stopped: 'row_cap' });
    const paged = await runSpineKeyCheck(E, { ...fromTheTop, page: 3 });
    expect(paged).toMatchObject({ checked: total, incomplete: false, stopped: null });
    // A limit equal to the table is a finished run.
    const exact = await runSpineKeyCheck(E, { ...fromTheTop, page: 3, maxRows: total });
    expect(exact).toMatchObject({ checked: total, incomplete: false, stopped: null });
  });

  test('the run starts at a point that moves each day and still reads every row once', async () => {
    quiet();
    await settle();
    const total = await eventCount();
    // From the middle of the ids: to the end, then from the top back to it.
    for (const start of ['evt_8', 'm', 'zzzzzz', '0']) {
      const r = await runSpineKeyCheck(E, { start, page: 3 });
      expect(r, start).toMatchObject({ checked: total, incomplete: false, stopped: null });
    }
    // The default start is today's.
    expect(await runSpineKeyCheck(E)).toMatchObject({ checked: total, incomplete: false });

    const day = (n: number) => new Date(Date.UTC(2026, 9, 12) + n * 86_400_000);
    const starts = Array.from({ length: 256 }, (_, n) => spineKeyCheckStart(day(n)));
    for (const s of starts) expect(s).toMatch(/^evt_[0-9a-f]{2}$/);
    // 256 days in a row start at 256 different points.
    expect(new Set(starts).size).toBe(256);
    expect(spineKeyCheckStart(day(256))).toBe(starts[0]);
  });

  test('where a run starts decides which waiting row it reaches first', async () => {
    quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 6);
    const early = `aaaa-${tag}`;
    const late = `zzzz-${tag}`;
    await seed(early);
    await seed(late);
    // One write only. From the top the early row gets it; from the middle the late one.
    expect(await runSpineKeyCheck(E, { start: 'm', maxWrites: 1, page: 1 })).toMatchObject({
      filled: 1,
      stopped: 'write_cap',
    });
    expect(await venueOf(late)).not.toBeNull();
    expect(await venueOf(early)).toBeNull();
    await settle();
    expect(await venueOf(early)).not.toBeNull();
  });

  test('the time budget stops the run between pages and it says why', async () => {
    quiet();
    await settle();
    expect(await eventCount()).toBeGreaterThan(2);
    // A clock that moves six seconds each time it is read.
    let t = 0;
    const now = () => (t += 6000);
    const result = await runSpineKeyCheck(E, { ...fromTheTop, page: 1, budgetMs: 10_000, now });
    expect(result).toMatchObject({ checked: 1, incomplete: true, stopped: 'time' });
  });

  /** A database whose `batch` does `before` and then fails or goes on. */
  function batchDb(before: () => Promise<unknown>, fail: Error | null): D1Database {
    return new Proxy(E.DB, {
      get(target, prop) {
        if (prop === 'batch') {
          return async (stmts: D1PreparedStatement[]) => {
            await before();
            if (fail) throw fail;
            return target.batch(stmts);
          };
        }
        const v = Reflect.get(target, prop) as unknown;
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    }) as D1Database;
  }

  test('a batch of writes that fails: every row in it counted, the run unfinished, the log free of row data', async () => {
    const spies = quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 6);
    const ids = [`batchfail-${tag}-1`, `batchfail-${tag}-2`];
    for (const id of ids) await seed(id);
    // The database client's own errors can quote what was sent or what came
    // back. This one quotes a row's id and venue, as such an error could.
    const DB = batchDb(
      async () => {},
      new Error(
        `D1_ERROR: failed for value '${ids[0]}' at "Old Row Tavern": SQLITE_CONSTRAINT (got: {"location":"Old Row Tavern"})`
      )
    );
    spies.warn.mockClear();
    const result = await runSpineKeyCheck({ DB }, fromTheTop);
    expect(result).toMatchObject({
      filled: 0,
      corrected: 0,
      errors: 2,
      incomplete: true,
      stopped: null,
      first_error: 'Error D1_ERROR SQLITE_CONSTRAINT',
    });
    // Every row was still read.
    expect(result.checked).toBe(await eventCount());
    const lines = checkLines(spies.warn);
    expect(lines).toHaveLength(1);
    for (const secret of [ids[0], 'Old Row Tavern', 'got:']) {
      expect(lines[0].includes(secret), secret).toBe(false);
    }
    for (const id of ids) expect(await venueOf(id)).toBeNull();
    await settle();
    for (const id of ids) expect(await venueOf(id)).not.toBeNull();
  });

  test('a row edited between the read and the write is left to its own save: no write, no error', async () => {
    quiet();
    await settle();
    const id = `midrun-${crypto.randomUUID().slice(0, 6)}`;
    await seed(id);
    // As the batch is about to run, a save changes the row's type and clears its keys.
    const DB = batchDb(
      () =>
        E.DB.prepare(
          'UPDATE events SET event_type_id = ?, venue_canonical_id = NULL, event_correlation_id = NULL WHERE id = ?'
        )
          .bind(WATCH_PARTY, id)
          .run(),
      null
    );
    const result = await runSpineKeyCheck({ DB }, fromTheTop);
    expect(result).toMatchObject({ filled: 0, corrected: 0, errors: 0, incomplete: false });
    // The keys computed from the row as it was did not land on the row as it is.
    const after = await row(id);
    expect(after.venue_canonical_id).toBeNull();
    expect(after.event_correlation_id).toBeNull();
    await settle();
    const venue = await venueId('old row tavern', RIPH_CELL);
    expect((await row(id)).event_correlation_id).toBe(
      await eventId(venue, WATCH_PARTY, '2026-11-07')
    );
  });

  test('one row whose keys cannot be computed is counted and the rest of the run goes on', async () => {
    const spies = quiet();
    await settle();
    const tag = crypto.randomUUID().slice(0, 6);
    const bad = `0002-cannot-${tag}`;
    const good = `zzzz-can-${tag}`;
    await seed(bad);
    await seed(good);
    spies.warn.mockClear();
    const result = await runSpineKeyCheck(E, {
      ...fromTheTop,
      compute: async (r) => {
        if ((r as unknown as { id: string }).id === bad) {
          throw new TypeError(`cannot compute ${bad} at Old Row Tavern`);
        }
        return computeSpineKeys(r);
      },
    });
    expect(result).toMatchObject({
      filled: 1,
      corrected: 0,
      errors: 1,
      incomplete: false,
      first_error: 'TypeError',
    });
    expect(result.checked).toBe(await eventCount());
    expect(await venueOf(good)).not.toBeNull();
    expect(await venueOf(bad)).toBeNull();
    const lines = checkLines(spies.warn);
    expect(lines).toHaveLength(1);
    expect(lines[0].includes(bad)).toBe(false);
    await settle();
    expect(await venueOf(bad)).not.toBeNull();
  });

  test('a database that cannot be read: counted, said, and logged as a warning with no row data', async () => {
    const spies = quiet();
    const DB = {
      prepare: () => {
        throw new Error(
          'Failed to parse body as JSON, got: {"id":"evt_secret","location":"Secret Hall"}'
        );
      },
    } as unknown as D1Database;
    const result = await runSpineKeyCheck({ DB }, fromTheTop);
    expect(result).toEqual({
      checked: 0,
      with_venue_key: 0,
      with_event_key: 0,
      filled: 0,
      corrected: 0,
      errors: 1,
      incomplete: true,
      stopped: 'db_error',
      first_error: 'Error',
    });
    const lines = checkLines(spies.warn);
    expect(lines).toHaveLength(1);
    expect(lines[0].includes('Secret Hall')).toBe(false);
    expect(lines[0].includes('evt_secret')).toBe(false);
    expect(checkLines(spies.log)).toHaveLength(0);
  });

  test('what a log line may say about an error: its class and a database code, never its message', () => {
    expect(errorLabel(new Error('D1_ERROR: no such column: x: SQLITE_ERROR'))).toBe(
      'Error D1_ERROR SQLITE_ERROR'
    );
    expect(
      errorLabel(new TypeError("D1_TYPE_ERROR: Type 'object' not supported for value 'Sam'"))
    ).toBe('TypeError D1_TYPE_ERROR');
    expect(
      errorLabel(new Error('Failed to parse body as JSON, got: {"location":"Sam’s house"}'))
    ).toBe('Error');
    expect(errorLabel('a string with Sam’s house in it')).toBe('string');
    expect(errorLabel(undefined)).toBe('undefined');
  });

  test('the check starts only when every other job has settled, the failed ones included', async () => {
    const order: string[] = [];
    let finishSlow = (): void => {};
    const slow = new Promise<void>((resolve) => {
      finishSlow = () => {
        order.push('slow settled');
        resolve();
      };
    });
    const failing = Promise.reject(new Error('planted: a job failed'));
    failing.catch(() => order.push('failing settled'));
    const last = afterAllSettle([failing, slow], async () => {
      order.push('last started');
      return 'done';
    });
    // The failed job has settled; the slow one has not. `last` must still wait.
    await new Promise((r) => setTimeout(r, 20));
    expect(order).toEqual(['failing settled']);
    finishSlow();
    expect(await last).toBe('done');
    expect(order).toEqual(['failing settled', 'slow settled', 'last started']);
  });

  test('when a job never settles the check never starts', async () => {
    let started = false;
    void afterAllSettle([new Promise(() => {})], async () => {
      started = true;
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toBe(false);
  });

  test('a quiet night logs one line of counts at the ordinary level; without a database it does nothing', async () => {
    const spies = quiet();
    await settle();
    spies.log.mockClear();
    spies.warn.mockClear();
    const result = await runSpineKeyCheck(E);
    expect(checkLines(spies.warn)).toHaveLength(0);
    const lines = checkLines(spies.log);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      type: 'SPINE_KEY_CHECK',
      checked: result.checked,
      with_venue_key: result.with_venue_key,
      with_event_key: result.with_event_key,
      filled: 0,
      corrected: 0,
      errors: 0,
      incomplete: false,
      stopped: null,
      first_error: null,
    });
    expect(await runSpineKeyCheck({})).toEqual({
      checked: 0,
      with_venue_key: 0,
      with_event_key: 0,
      filled: 0,
      corrected: 0,
      errors: 0,
      incomplete: false,
      stopped: null,
      first_error: null,
    });
  });
});

describe('neither key reaches a public answer', () => {
  test('the public projection drops both (planted fault: either key added to PUBLIC_EVENT_COLUMNS)', () => {
    expect(PUBLIC_EVENT_FIELDS.has('venue_canonical_id')).toBe(false);
    expect(PUBLIC_EVENT_FIELDS.has('event_correlation_id')).toBe(false);
    const out = toPublicEvent({
      id: 'evt_x',
      title: 'T',
      venue_canonical_id: 'a'.repeat(32),
      event_correlation_id: 'b'.repeat(32),
    });
    expect(Object.keys(out)).not.toContain('venue_canonical_id');
    expect(Object.keys(out)).not.toContain('event_correlation_id');
    expect(out.id).toBe('evt_x');
  });

  test('the public event, list, map, poster and TV answers carry neither the names nor the values (planted fault: either key added to PUBLIC_EVENT_COLUMNS)', async () => {
    const title = `Public spine night ${crypto.randomUUID().slice(0, 8)}`;
    // A week ahead of whenever this runs: an event that is over leaves the map
    // and the list, and the proofs below would then fail for the wrong reason.
    const ahead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
    const id = await create({ status: 'active', is_published: true, title, start_date: ahead });
    const keys = await row(id);
    expect(keys.venue_canonical_id).toMatch(/^[0-9a-f]{32}$/);
    expect(keys.event_correlation_id).toMatch(/^[0-9a-f]{32}$/);
    // Each path, and what proves the answer is about this event. Without that,
    // "the key is not in it" would hold for an empty answer too.
    const paths: Array<[string, string]> = [
      [`/api/v2/events/${id}`, id],
      ['/api/v2/events', id],
      [`/api/v2/events/map?cell=${RIPH_CELL}`, id],
      [`/api/v2/events/${id}/poster-bundle`, title],
      [`/api/v2/events/${id}/display-config`, id],
      [`/events/${id}`, title],
      ['/events', title],
    ];
    for (const [path, proof] of paths) {
      const res = await SELF.fetch(`https://example.com${path}`);
      const text = await res.text();
      expect(res.status, path).toBe(200);
      expect(text.includes(proof), `${path} is about this event (${proof})`).toBe(true);
      for (const needle of [
        'venue_canonical_id',
        'event_correlation_id',
        keys.venue_canonical_id as string,
        keys.event_correlation_id as string,
      ]) {
        expect(text.includes(needle), `${path} contains ${needle}`).toBe(false);
      }
    }
  });

  test('the admin list carries neither key (no admin screen reads them, and a screen that sent one back would be refused)', async () => {
    const id = await create({ title: `Admin spine night ${crypto.randomUUID().slice(0, 8)}` });
    const keys = await row(id);
    const res = await SELF.fetch('https://example.com/api/v2/admin/events', {
      headers: ADMIN,
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain(id);
    for (const needle of [
      'venue_canonical_id',
      'event_correlation_id',
      keys.venue_canonical_id as string,
      keys.event_correlation_id as string,
    ]) {
      expect(text.includes(needle), needle).toBe(false);
    }
  });
});
