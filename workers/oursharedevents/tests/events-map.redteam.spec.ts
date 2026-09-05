/**
 * RED TEAM (endpoint tier) — attacking the attendee map's privacy floor.
 *
 * THREAT MODEL. The map's promise (OCR_VISION.md §6.2b) is that the platform
 * learns WHICH TILE a reader is in, never where they are. The attacker here is
 * not injecting script — there is no HTML in this response. They are trying to
 * turn a ~5 km² answer into a smaller one, or to get the server to accept a
 * position at all:
 *
 *   RT-MAP-001  smuggle a coordinate past the refusal (casing, arrays,
 *               duplicates, encoding, fragment, body)
 *   RT-MAP-002  narrow the query below corridor resolution
 *   RT-MAP-003  learn about a corridor the request did not name
 *   RT-MAP-004  extract attendee-derived data through the map
 *   RT-MAP-005  make the endpoint leak internals through an error
 *
 * These run in CI, unlike tests/red-team/ (OSE-1244), because the endpoint is
 * callable in-process and needs no deployment.
 */
import { describe, test, expect } from 'vitest';
import { handleEventsMap } from '../src/handlers/events-map';
import { latLngToCell, cellToParent } from 'h3-js';
import { CORRIDOR_RES, NODE_RES } from '../src/lib/h3-tagging';

const LAT = 41.6572;
const LON = -87.68;
const CELL = latLngToCell(LAT, LON, CORRIDOR_RES);
const OTHER_CELL = latLngToCell(34.0522, -118.2437, CORRIDOR_RES); // Los Angeles

function db(rows: Record<string, unknown>[], captured: unknown[][] = []) {
  return {
    DB: {
      prepare: () => ({
        bind: (...a: unknown[]) => {
          captured.push(a);
          return { all: async () => ({ results: rows }) };
        },
      }),
    },
  } as never;
}

const evt = (id: string, cell: string) => {
  const d = new Date(Date.now() + 5 * 86_400_000).toISOString();
  return {
    id,
    title: `Event ${id}`,
    slug: id,
    status: 'active',
    location: 'RIPH',
    start_date: d,
    end_date: d,
    timezone: 'America/Chicago',
    lat: LAT,
    lon: LON,
    h3_res7: cell,
  };
};

async function call(
  query: string,
  rows: Record<string, unknown>[] = [],
  captured: unknown[][] = []
) {
  return handleEventsMap(
    new Request(`https://t.test/api/v2/events/map${query}`),
    db(rows, captured)
  );
}

describe('RT-MAP-001 | a coordinate cannot be smuggled past the refusal', () => {
  test('a duplicated coordinate param is still refused', async () => {
    expect((await call(`?cell=${CELL}&lat=1&lat=2`)).status).toBe(400);
  });

  test('an empty-valued coordinate param is still refused', async () => {
    // `?lat=` is present-but-empty. `has()` is the right check; `get()` truthiness
    // would let this through, and a client sending it is already sending
    // positions.
    expect((await call(`?cell=${CELL}&lat=`)).status).toBe(400);
  });

  test('a percent-encoded parameter name is normalised before the check', async () => {
    // %6Cat === "lat". URLSearchParams decodes names, so the refusal sees it.
    expect((await call(`?cell=${CELL}&%6Cat=41.65`)).status).toBe(400);
  });

  test('a coordinate in the fragment never reaches the server at all', async () => {
    // Fragments are not sent by browsers. Asserted so nobody "fixes" the
    // refusal by parsing one and thereby invites clients to put positions there.
    const res = await call(`?cell=${CELL}#lat=41.65`);
    expect(res.status).toBe(200);
    expect(new URL(`https://t.test/x?cell=${CELL}#lat=41.65`).searchParams.has('lat')).toBe(false);
  });

  test('an uppercase coordinate param is refused too', () => {
    // Found by this suite: query parameter names are case-sensitive, so a
    // literal has('lat') let ?LAT= through. The exposure was small — the server
    // never read the key — but "small" was a property of the logging config,
    // not of the design. The check is now case-insensitive.
    return Promise.all(
      ['LAT', 'Lat', 'LON', 'Longitude', 'GEO', 'Position'].map(async (p) => {
        expect((await call(`?cell=${CELL}&${p}=41.65`)).status, p).toBe(400);
      })
    );
  });

  test('a mixed-case coordinate is refused before the DB', async () => {
    const captured: unknown[][] = [];
    await call(`?cell=${CELL}&LaT=41.65`, [evt('a', CELL)], captured);
    expect(captured).toEqual([]);
  });
});

describe('RT-MAP-002 | the query cannot be narrowed below the corridor', () => {
  test('a res-9 node cell is refused even though it is a valid child', async () => {
    const node = latLngToCell(LAT, LON, NODE_RES);
    expect(cellToParent(node, CORRIDOR_RES)).toBe(CELL); // it IS inside
    expect((await call(`?cell=${node}`)).status).toBe(400); // and still refused
  });

  test('no resolution other than the corridor is served', async () => {
    for (let r = 0; r <= 12; r++) {
      const cell = latLngToCell(LAT, LON, r);
      const res = await call(`?cell=${cell}`);
      if (r === CORRIDOR_RES) expect(res.status).toBe(200);
      else expect(res.status, `res ${r} was served`).toBe(400);
    }
  });

  test('a refused cell never reaches a query, so no timing signal is created', async () => {
    const captured: unknown[][] = [];
    await call(`?cell=${latLngToCell(LAT, LON, NODE_RES)}`, [evt('a', CELL)], captured);
    expect(captured).toEqual([]);
  });
});

describe('RT-MAP-003 | a request learns only about the corridor it named', () => {
  test('the bound parameter is exactly the requested cell', async () => {
    const captured: unknown[][] = [];
    await call(`?cell=${CELL}`, [], captured);
    expect(captured[0]).toEqual([CELL]);
  });

  test('a second cell parameter does not widen the query', async () => {
    const captured: unknown[][] = [];
    await call(`?cell=${CELL}&cell=${OTHER_CELL}`, [], captured);
    expect(captured[0]).toEqual([CELL]); // first wins; one cell is bound
    expect(captured[0]).not.toContain(OTHER_CELL);
  });

  test('the response echoes the cell it served, so a client can detect a mismatch', async () => {
    const body = (await (await call(`?cell=${CELL}`)).json()) as Record<string, unknown>;
    expect(body.cell).toBe(CELL);
  });

  test('SQL metacharacters in the cell are refused as invalid, not bound', async () => {
    const captured: unknown[][] = [];
    for (const payload of [
      "' OR 1=1 --",
      `${CELL}' OR '1'='1`,
      `${CELL}; DROP TABLE events`,
      `${CELL} UNION SELECT * FROM events`,
    ]) {
      const res = await call(`?cell=${encodeURIComponent(payload)}`, [], captured);
      expect(res.status, payload).toBe(400);
    }
    expect(captured).toEqual([]);
  });
});

describe('RT-MAP-004 | attendee-derived data cannot be pulled through the map', () => {
  test('a row carrying attendee fields emits none of them', async () => {
    const polluted = {
      ...evt('a', CELL),
      anon_id_hash: 'HASH_SENTINEL',
      distinct_anons: 91,
      email: 'leak@example.com',
      ip_hash: 'IP_SENTINEL',
      scan_count: 55,
      window_30d_count: 12,
    };
    const body = JSON.stringify(await (await call(`?cell=${CELL}`, [polluted])).json());
    for (const s of [
      'HASH_SENTINEL',
      'IP_SENTINEL',
      'leak@example.com',
      'distinct_anons',
      'scan_count',
      'window_30d_count',
    ]) {
      expect(body, `leaked ${s}`).not.toContain(s);
    }
  });

  test('the item shape is a fixed allowlist, not a passthrough', async () => {
    const items = (
      (await (await call(`?cell=${CELL}`, [{ ...evt('a', CELL), surprise: 'x' }])).json()) as {
        items: Record<string, unknown>[];
      }
    ).items;
    expect(Object.keys(items[0]).sort()).toEqual(
      ['id', 'lat', 'lon', 'name', 'phase', 'startDateISO', 'venue'].sort()
    );
  });
});

describe('RT-MAP-005 | errors reveal nothing about internals', () => {
  test('a DB failure does not leak the query, schema or driver message', async () => {
    const boom = {
      DB: {
        prepare: () => ({
          bind: () => ({
            all: async () => {
              throw new Error(
                'D1_ERROR near "SELECT id, title, h3_res7 FROM events": no such column secret'
              );
            },
          }),
        }),
      },
    } as never;
    const res = await handleEventsMap(
      new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
      boom
    );
    expect(res.status).toBe(500);
    const body = JSON.stringify(await res.json());
    for (const s of ['D1_ERROR', 'SELECT', 'h3_res7', 'secret', 'no such column']) {
      expect(body, `leaked ${s}`).not.toContain(s);
    }
  });

  test('a validation error does not echo the rejected value', async () => {
    const probe = 'PROBE_VALUE_41_6572';
    const body = JSON.stringify(await (await call(`?cell=${probe}`)).json());
    expect(body).not.toContain(probe);
  });
});
