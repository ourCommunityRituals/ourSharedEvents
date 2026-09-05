/**
 * OSE-1242 — the attendee map endpoint, GET /api/v2/events/map
 *
 * Levels covered here: unit (parameter handling, window/phase filtering) and
 * SECURITY (the coordinate refusal and the precision floor, which are the two
 * behaviours Invariant #1 rests on for this surface).
 *
 * The security cases are not decoration. §6.2b claims Invariant #1 holds "by
 * construction rather than by policy" for this surface, and that claim is only
 * true while the endpoint is INCAPABLE of receiving a position. These tests are
 * what makes it a construction rather than an intention.
 */
import { describe, test, expect } from 'vitest';
import { handleEventsMap } from '../src/handlers/events-map';
import { CORRIDOR_READY_MIN_EVENTS, CORRIDOR_WINDOW_DAYS } from '../src/lib/corridor-readiness';
import { latLngToCell } from 'h3-js';
import { NODE_RES, CORRIDOR_RES } from '../src/lib/h3-tagging';

// Blue Island / Western Ave — the founding corridor, so the fixture cells are
// real places rather than arbitrary hex strings.
const LAT = 41.6572;
const LON = -87.68;
const CORRIDOR_CELL = latLngToCell(LAT, LON, CORRIDOR_RES);
const NODE_CELL = latLngToCell(LAT, LON, NODE_RES);

const DAY = 86_400_000;

function row(daysFromNow: number, id: string, overrides: Record<string, unknown> = {}) {
  const d = new Date(Date.now() + daysFromNow * DAY);
  return {
    id,
    title: `Event ${id}`,
    slug: id,
    status: 'active',
    location: 'Rock Island Public House',
    start_date: d.toISOString(),
    end_date: d.toISOString(),
    timezone: 'America/Chicago',
    lat: LAT,
    lon: LON,
    h3_res7: CORRIDOR_CELL,
    ...overrides,
  };
}

/** Minimal D1 stub. Records the bound params so scoping can be asserted. */
function db(rows: Record<string, unknown>[], captured: unknown[][] = []) {
  return {
    DB: {
      prepare(_sql: string) {
        return {
          bind(...args: unknown[]) {
            captured.push(args);
            return { all: async () => ({ results: rows }) };
          },
        };
      },
    },
  } as never;
}

function req(query: string): Request {
  return new Request(`https://t.test/api/v2/events/map${query}`);
}

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECURITY — Invariant #1 by construction
// ─────────────────────────────────────────────────────────────────────────────

describe('SEC | the endpoint cannot receive a coordinate', () => {
  const coordParams = [
    'lat',
    'lon',
    'lng',
    'latitude',
    'longitude',
    'coords',
    'coordinates',
    'position',
    'geo',
  ];

  for (const p of coordParams) {
    test(`?${p}= is refused with 400, not ignored`, async () => {
      const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}&${p}=41.6572`), db([]));
      expect(res.status, `${p} was accepted`).toBe(400);
      expect((await json(res)).code).toBe('COORDINATES_NOT_ACCEPTED');
    });
  }

  test('refusal happens even when the coordinate is the ONLY parameter', async () => {
    const res = await handleEventsMap(req('?lat=41.6572&lon=-87.68'), db([]));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('COORDINATES_NOT_ACCEPTED');
  });

  test('refusal precedes the DB, so a position never reaches a query', async () => {
    const captured: unknown[][] = [];
    await handleEventsMap(req(`?cell=${CORRIDOR_CELL}&lat=41.6`), db([row(1, 'a')], captured));
    expect(captured).toEqual([]);
  });

  test('the refusal message does not echo the coordinate back', async () => {
    // An error that quotes the offending value writes it into logs and into
    // the reader's own history — the thing the refusal exists to prevent.
    const res = await handleEventsMap(req('?lat=41.65721234&lon=-87.6801234'), db([]));
    const body = JSON.stringify(await json(res));
    expect(body).not.toContain('41.65721234');
    expect(body).not.toContain('87.6801234');
  });
});

describe('SEC | the precision floor is the privacy floor', () => {
  test('a resolution-9 node cell is refused', async () => {
    const res = await handleEventsMap(req(`?cell=${NODE_CELL}`), db([]));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('CELL_RESOLUTION');
  });

  test('every resolution finer than the corridor is refused', async () => {
    for (const r of [8, 9, 10, 11, 12]) {
      const cell = latLngToCell(LAT, LON, r);
      const res = await handleEventsMap(req(`?cell=${cell}`), db([]));
      expect(res.status, `res ${r} was served`).toBe(400);
    }
  });

  test('a coarser cell is also refused — the resolution is pinned, not a floor', async () => {
    for (const r of [5, 6]) {
      const cell = latLngToCell(LAT, LON, r);
      expect((await handleEventsMap(req(`?cell=${cell}`), db([]))).status).toBe(400);
    }
  });

  test('a garbage cell is refused before it reaches the DB', async () => {
    const captured: unknown[][] = [];
    const res = await handleEventsMap(req('?cell=not-a-cell'), db([], captured));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('CELL_INVALID');
    expect(captured).toEqual([]);
  });

  test('an unscoped request is refused — there is no global map', async () => {
    const res = await handleEventsMap(req(''), db([]));
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('CELL_REQUIRED');
  });
});

describe('SEC | the response carries no identity and no attendee data', () => {
  test('only the declared public fields are emitted', async () => {
    const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([row(3, 'e1')]));
    const items = (await json(res)).items as Record<string, unknown>[];
    expect(Object.keys(items[0]).sort()).toEqual(
      ['id', 'lat', 'lon', 'name', 'phase', 'startDateISO', 'venue'].sort()
    );
  });

  test('no anon, scan, email or attendee field can appear in the response', async () => {
    // The row is polluted with fields the handler must not pass through.
    const polluted = row(3, 'e1', {
      anon_id_hash: 'abc123',
      email: 'someone@example.com',
      attendee_count: 42,
      scan_count: 17,
      ip_hash: 'deadbeef',
    });
    const body = JSON.stringify(
      await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([polluted])))
    );
    for (const leak of [
      'anon_id_hash',
      'abc123',
      'someone@example.com',
      'attendee_count',
      'scan_count',
      'ip_hash',
      'deadbeef',
    ]) {
      expect(body, `leaked ${leak}`).not.toContain(leak);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UNIT — the window, the phases, the verdict
// ─────────────────────────────────────────────────────────────────────────────

describe('the map shows only what a reader can still act on', () => {
  test('the query is scoped to the requested cell', async () => {
    const captured: unknown[][] = [];
    await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([row(1, 'a')], captured));
    expect(captured[0]).toEqual([CORRIDOR_CELL]);
  });

  test('an event beyond the horizon is not pinned', async () => {
    const res = await handleEventsMap(
      req(`?cell=${CORRIDOR_CELL}`),
      db([row(CORRIDOR_WINDOW_DAYS + 5, 'far')])
    );
    expect((await json(res)).items).toEqual([]);
  });

  test('a past event is not pinned', async () => {
    const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([row(-10, 'past')]));
    expect((await json(res)).items).toEqual([]);
  });

  test('a live event that started earlier IS pinned', async () => {
    const started = row(-1, 'live', { end_date: new Date(Date.now() + DAY).toISOString() });
    const items = (await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([started]))))
      .items as unknown[];
    expect(items.length).toBe(1);
  });

  test('every pinned event carries a phase the pop-out can route on', async () => {
    const rows = [row(1, 'a'), row(30, 'b'), row(-1, 'c')];
    const items = (await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db(rows))))
      .items as Record<string, unknown>[];
    for (const item of items) {
      expect(['pre_event', 'event']).toContain(item.phase);
    }
  });
});

describe('the readiness verdict cannot contradict the map beside it', () => {
  test('ready is false below the threshold', async () => {
    const rows = Array.from({ length: CORRIDOR_READY_MIN_EVENTS - 1 }, (_, i) =>
      row(i + 1, `e${i}`)
    );
    const body = await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db(rows)));
    expect(body.ready).toBe(false);
    expect((body.items as unknown[]).length).toBe(CORRIDOR_READY_MIN_EVENTS - 1);
  });

  test('ready is true at the threshold', async () => {
    const rows = Array.from({ length: CORRIDOR_READY_MIN_EVENTS }, (_, i) => row(i + 1, `e${i}`));
    expect((await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db(rows)))).ready).toBe(
      true
    );
  });

  test('ready can never be true alongside an empty map — the invariant', async () => {
    // Rows that all fall outside the window. A gate reading a different window
    // than the list would say ready here; that is the failure the instrument
    // was chosen to make impossible.
    const outside = Array.from({ length: 20 }, (_, i) =>
      row(CORRIDOR_WINDOW_DAYS + i + 1, `f${i}`)
    );
    const past = Array.from({ length: 20 }, (_, i) => row(-(i + 1), `p${i}`));
    for (const rows of [outside, past, [...outside, ...past]]) {
      const body = await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db(rows)));
      expect(body.ready).toBe(false);
      expect((body.items as unknown[]).length).toBe(0);
    }
  });

  test('the response states the window and threshold it used', async () => {
    const body = await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([])));
    expect(body.windowDays).toBe(CORRIDOR_WINDOW_DAYS);
    expect(body.minEvents).toBe(CORRIDOR_READY_MIN_EVENTS);
  });
});

describe('failure modes', () => {
  test('no DB binding returns 503, not a crash', async () => {
    const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), {} as never);
    expect(res.status).toBe(503);
  });

  test('a DB error returns 500 without leaking the error', async () => {
    const boom = {
      DB: {
        prepare() {
          return {
            bind: () => ({
              all: async () => {
                throw new Error('D1_ERROR: table events has no column named secret_col');
              },
            }),
          };
        },
      },
    } as never;
    const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), boom);
    expect(res.status).toBe(500);
    expect(JSON.stringify(await json(res))).not.toContain('secret_col');
  });

  test('an empty corridor is a 200 with an empty map, not an error', async () => {
    const res = await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db([]));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.ok).toBe(true);
    expect(body.items).toEqual([]);
    expect(body.ready).toBe(false);
  });
});

describe('tier blindness — Invariant #5', () => {
  test('a tier parameter changes nothing about the response', async () => {
    const rows = [row(1, 'a'), row(2, 'b')];
    const base = await json(await handleEventsMap(req(`?cell=${CORRIDOR_CELL}`), db(rows)));
    for (const tier of ['free', 'mid', 'enterprise', 'platinum']) {
      const withTier = await json(
        await handleEventsMap(req(`?cell=${CORRIDOR_CELL}&tier=${tier}`), db(rows))
      );
      expect(withTier).toEqual(base);
    }
  });
});
