/**
 * OSE-1245 — publication is an act, and the host holds it.
 *
 * `events.is_published` is the "listed" half of §6.2b's "cleared and listed".
 * Semantics are binary and were set by the owner: 0 means the event does not
 * appear on any discovery surface AT ALL — not the map, not the list, and not
 * as a coarse "somewhere in Beverly" entry. Absent.
 *
 * WHY THESE TESTS ARE WRITTEN AS ABSENCE ASSERTIONS. A filter that silently
 * stops working is the failure mode here, and it fails OPEN: the surface keeps
 * rendering, everything looks right, and somebody's home address is on a public
 * map. There is no error, no empty state, nothing a person would notice. So the
 * test has to assert the negative directly, and be verified to fail without the
 * filter — which it was.
 */
import { describe, test, expect } from 'vitest';
import { handleEventsMap } from '../src/handlers/events-map';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';

const LAT = 41.6572;
const LON = -87.68;
const CELL = latLngToCell(LAT, LON, CORRIDOR_RES);

/**
 * A D1 stub that HONOURS the query rather than ignoring it. The whole point of
 * this suite is the WHERE clause, so a stub that returns its rows regardless
 * would assert nothing — it would pass identically with the filter deleted.
 */
function db(rows: Record<string, unknown>[], captured: { sql: string[] } = { sql: [] }) {
  return {
    DB: {
      prepare(sql: string) {
        captured.sql.push(sql);
        const filtersPublished = /is_published\s*=\s*1/i.test(sql);
        return {
          bind: () => ({
            all: async () => ({
              results: filtersPublished ? rows.filter((r) => r.is_published === 1) : rows,
            }),
          }),
        };
      },
    },
  } as never;
}

function evt(id: string, published: 0 | 1, extra: Record<string, unknown> = {}) {
  const d = new Date(Date.now() + 5 * 86_400_000).toISOString();
  return {
    id,
    title: `Event ${id}`,
    slug: id,
    status: 'active',
    location: '13328 Olde Western Ave, Blue Island, IL 60406',
    start_date: d,
    end_date: d,
    timezone: 'America/Chicago',
    lat: LAT,
    lon: LON,
    h3_res7: CELL,
    is_published: published,
    ...extra,
  };
}

async function mapItems(rows: Record<string, unknown>[]) {
  const res = await handleEventsMap(
    new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
    db(rows)
  );
  return ((await res.json()) as { items: Record<string, unknown>[] }).items;
}

describe('an unpublished event does not appear on the map', () => {
  test('a single unpublished event yields an empty map', async () => {
    expect(await mapItems([evt('home', 0)])).toEqual([]);
  });

  test('unpublished events are absent while published ones remain', async () => {
    const items = await mapItems([
      evt('home-1', 0),
      evt('bar', 1),
      evt('home-2', 0),
      evt('library', 1),
    ]);
    expect(items.map((i) => i.id).sort()).toEqual(['bar', 'library']);
  });

  test('the query itself carries the filter — not just the result', async () => {
    // Asserting only on the returned items would pass if the filter moved into
    // JS, where it is one refactor from being dropped. The database must be the
    // thing that never returns the row.
    const captured = { sql: [] as string[] };
    await handleEventsMap(
      new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
      db([], captured)
    );
    expect(captured.sql[0]).toMatch(/is_published\s*=\s*1/i);
  });

  test('nothing about an unpublished event survives into the response', async () => {
    // Not merely "absent from items" — the address, the coordinates and the
    // name must not appear anywhere in the payload.
    const res = await handleEventsMap(
      new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
      db([evt('home', 0, { title: 'SENTINEL_HOUSE_CONCERT' })])
    );
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('SENTINEL_HOUSE_CONCERT');
    expect(body).not.toContain('Olde Western');
    expect(body).not.toContain('41.657');
  });
});

describe('publication is per event, not per address', () => {
  test('two events at the same address publish independently', async () => {
    // The Beverly historical home: a home 364 days a year, a venue on
    // house-walk day. Same lat/lon, same street, opposite answers. A design
    // keyed on the ADDRESS could not express this; keying on the EVENT can.
    const items = await mapItems([evt('private-dinner', 0), evt('house-walk-stop', 1)]);
    expect(items.map((i) => i.id)).toEqual(['house-walk-stop']);
  });

  test('publishing one day does not publish the address forever', async () => {
    // The same house, a later private event. Unpublished again, absent again.
    expect(await mapItems([evt('next-private-event', 0)])).toEqual([]);
  });
});

describe('the flag is not a substitute for the other guarantees', () => {
  test('a published event still obeys brand scoping', async () => {
    const captured = { sql: [] as string[] };
    await handleEventsMap(
      new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
      db([], captured)
    );
    expect(captured.sql[0]).toMatch(/brand_id\s*=\s*\?/i);
  });

  test('a published event still obeys the forward window', async () => {
    // BOTH dates in the past. An earlier version of this test moved only
    // start_date and expected the event gone — but an event that began 40 days
    // ago and ends in five is LIVE, and the code was right to keep it. The
    // fixture was wrong, which is the useful kind of test failure.
    const gone = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const past = { ...evt('gone', 1), start_date: gone, end_date: gone };
    expect(await mapItems([past])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The API contract for the flag. OSE-1245.
// ─────────────────────────────────────────────────────────────────────────────

describe('the create API honours the answer', () => {
  /** Capture what handleCreateEvent binds, without a real D1. */
  function captureDb(bound: unknown[][]) {
    // No admin actor: this drives the handler on its own, as the DEV_OPEN_ADMIN
    // local bypass does. A null actor creates nothing anywhere else (OSE-1801).
    return {
      DEV_OPEN_ADMIN: 'true',
      DB: {
        prepare: (sql: string) => ({
          bind: (...args: unknown[]) => {
            if (/INSERT INTO events/i.test(sql)) bound.push(args);
            return {
              run: async () => ({}),
              first: async () => null,
              all: async () => ({ results: [] }),
            };
          },
        }),
      },
    } as never;
  }

  async function create(body: Record<string, unknown>, bound: unknown[][]) {
    const { handleCreateEvent } = await import('../src/handlers/events');
    return handleCreateEvent(
      new Request('https://t.test/api/v2/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          attendance_mode: 'in_person',
          location: 'Test Hall',
          ...(body as object),
        }),
      }),
      captureDb(bound)
    );
  }

  test('is_published:false binds 0', async () => {
    const bound: unknown[][] = [];
    await create({ title: 'House concert', is_published: false }, bound);
    expect(bound[0]).toContain(0);
  });

  test('is_published:true binds 1', async () => {
    const bound: unknown[][] = [];
    await create({ title: 'Bar trivia', is_published: true }, bound);
    expect(bound[0]).toContain(1);
  });

  test('an absent value does NOT publish (OSE-1560: a new event is off the map)', async () => {
    // Asserted rather than assumed: nothing is listed publicly by omission. The
    // default-on map was the risk; a client that says nothing now gets an event
    // that is off the map (and a record that nobody chose, so a sponsor the
    // organizer adds later can turn it on). tests/map-default.spec.ts runs it
    // against real D1.
    const bound: unknown[][] = [];
    await create({ title: 'Legacy client event' }, bound);
    expect(bound[0]).not.toContain(1);
  });

  test('a malformed value does not publish either: it fails toward off, never on', async () => {
    // A client that sent "yes" as a string has not chosen. Listing an organizer's
    // event publicly on a guess is the worse failure.
    for (const bad of ['true', 'yes', 2, null, {}, []]) {
      const bound: unknown[][] = [];
      await create({ title: 'Odd client', is_published: bad }, bound);
      expect(bound[0], String(bad)).not.toContain(1);
    }
  });

  test('0 and 1 are accepted, so a form post and a JSON client agree', async () => {
    const zero: unknown[][] = [];
    await create({ title: 'A', is_published: 0 }, zero);
    expect(zero[0]).toContain(0);
    const one: unknown[][] = [];
    await create({ title: 'B', is_published: 1 }, one);
    expect(one[0]).toContain(1);
  });
});
