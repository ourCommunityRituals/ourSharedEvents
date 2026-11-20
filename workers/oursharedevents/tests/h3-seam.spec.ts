/**
 * At a cell seam, the event's address decides which H3 cell it belongs to
 * (OSE-2199; owner 2026-11-19: "at those moments, fallback to the address to
 * distinguish which H3 to select").
 *
 * The res-9 cell is the place. A geocoded point near a res-9 edge, within the
 * geocoder's likely error for its precision, could land on either side on two
 * lookups of the same address. There the address picks the cell from the
 * cells in reach, so the same address keeps one cell. Away from a seam, and
 * for coordinates with no stated precision, the cell is the point's cell. The
 * res-7 cell is always the parent of the res-9 cell.
 *
 * Google is never called: the lookup tests stub `fetch`.
 *
 * @born-red OSE-2199 cell seams | method: each case was run against the fault
 *   in its title's brackets, injected into src/lib/h3-tagging.ts or
 *   src/lib/event-place.ts, and seen failing; the static pin by importing
 *   h3-tagging into a scan-path file | date: 2026-11-19
 */
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import {
  cellToBoundary,
  cellToLatLng,
  cellToParent,
  directedEdgeToBoundary,
  getDirectedEdgeDestination,
  gridDisk,
  latLngToCell,
  originToDirectedEdges,
} from 'h3-js';
import {
  POINT_PRECISIONS,
  SEAM_MARGIN_M,
  SEAM_MARGIN_MAX_M,
  cellsInReach,
  normaliseAddressKey,
  seamMarginMeters,
  tagCoordinates,
  tagPlace,
  tagsConsistent,
} from '../src/lib/h3-tagging';
import { handleCreateEvent, handleUpdateEvent, type EventsEnv } from '../src/handlers/events';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const E = env as unknown as TestEnv & EventsEnv;
const KEYED = { ...(env as unknown as EventsEnv), GOOGLE_MAPS_API_KEY: 'test-maps-key' };
const ADMIN = {
  Authorization: 'Bearer test-admin-key-e2e-2026',
  'Content-Type': 'application/json',
  'Sec-Fetch-Site': 'same-origin',
};

beforeAll(async () => {
  for (const stmt of JSON.parse(E.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column') || m.includes('already exists')) continue;
      throw e;
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Geometry helpers (test side, independent of the module) ─────────────────

const R = 6371008.8;
const RAD = Math.PI / 180;

/** A point `metres` from (lat, lon) towards (toLat, toLon). */
function toward(lat: number, lon: number, toLat: number, toLon: number, metres: number) {
  const kx = Math.cos(lat * RAD) * R * RAD;
  const ky = R * RAD;
  const dx = (toLon - lon) * kx;
  const dy = (toLat - lat) * ky;
  const len = Math.hypot(dx, dy);
  return { lat: lat + ((dy / len) * metres) / ky, lon: lon + ((dx / len) * metres) / kx };
}

/**
 * Two points `metres` either side of the middle of one edge of `cell`, across
 * the edge to its neighbour: the inside one in `cell`, the outside one in the
 * neighbour. Far from the edge's corners, so only these two cells are in reach.
 */
function straddle(cell: string, edgeIndex: number, metres: number) {
  const edge = originToDirectedEdges(cell)[edgeIndex];
  const line = directedEdgeToBoundary(edge);
  const a = line[0];
  const b = line[line.length - 1];
  const mid = { lat: (a[0] + b[0]) / 2, lon: (a[1] + b[1]) / 2 };
  const [cLat, cLon] = cellToLatLng(cell);
  const inside = toward(mid.lat, mid.lon, cLat, cLon, metres);
  const outside = toward(mid.lat, mid.lon, cLat, cLon, -metres);
  return { inside, outside, own: cell, other: getDirectedEdgeDestination(edge) };
}

// Eagles Hall, Blue Island IL: the ground-truth cell of h3-tagging.spec.ts.
const EAGLES_CELL = '89266454447ffff';
const ADDRESS = '13328 Olde Western Ave, Blue Island, IL 60406, USA';

// A synthetic point (Blue Island) whose own res-7 cell is not the parent of its
// res-9 cell: res 7 read from the point fails tagsConsistent here.
const RES7_SEAM = { lat: 41.65, lon: -87.6884 };

describe('the fixtures are what the tests assume', () => {
  test('the two straddling points fall in two cells, each 4 m from the edge', () => {
    const s = straddle(EAGLES_CELL, 0, 4);
    expect(latLngToCell(s.inside.lat, s.inside.lon, 9)).toBe(s.own);
    expect(latLngToCell(s.outside.lat, s.outside.lon, 9)).toBe(s.other);
    expect(s.own).not.toBe(s.other);
  });

  test('the res-7 seam point: its own res-7 cell is not its res-9 parent', () => {
    const c9 = latLngToCell(RES7_SEAM.lat, RES7_SEAM.lon, 9);
    expect(latLngToCell(RES7_SEAM.lat, RES7_SEAM.lon, 7)).not.toBe(cellToParent(c9, 7));
  });
});

// ─── Acceptance ──────────────────────────────────────────────────────────────

describe('at a seam, the address decides', () => {
  test('two lookups of the same address, with points on either side of a cell edge, give the same res-9 cell [the point’s own cell used]', () => {
    for (const precision of POINT_PRECISIONS) {
      for (let edge = 0; edge < 6; edge++) {
        const s = straddle(EAGLES_CELL, edge, 4);
        for (const address of [ADDRESS, '1 Main St', 'Rock Island Public House']) {
          const a = tagPlace(s.inside.lat, s.inside.lon, { precision, address });
          const b = tagPlace(s.outside.lat, s.outside.lon, { precision, address });
          expect(a.seam, `${precision} edge ${edge}`).toBe('address');
          expect(b.h3_res9, `${precision} edge ${edge} ${address}`).toBe(a.h3_res9);
          expect([s.own, s.other]).toContain(a.h3_res9);
        }
      }
    }
  });

  test('the same address typed two ways is one key, and so one cell', () => {
    const s = straddle(EAGLES_CELL, 2, 4);
    const ways = [
      '13328 Olde Western Ave., Blue Island, IL 60406',
      '  13328  OLDE WESTERN AVE  Blue Island IL 60406 ',
      '13328 Olde Western Ave — Blue Island, IL 60406',
    ];
    const keys = new Set(ways.map(normaliseAddressKey));
    expect(keys.size).toBe(1);
    expect(normaliseAddressKey('Café Olé')).toBe(normaliseAddressKey('CAFE OLE'));
    const cells = new Set(
      ways.flatMap((address) => [
        tagPlace(s.inside.lat, s.inside.lon, { precision: 'ROOFTOP', address }).h3_res9,
        tagPlace(s.outside.lat, s.outside.lon, { precision: 'ROOFTOP', address }).h3_res9,
      ])
    );
    expect(cells.size).toBe(1);
  });

  test('the address, not a fixed side, picks: across many addresses both cells are chosen [the lower cell id always]', () => {
    const s = straddle(EAGLES_CELL, 1, 4);
    const picked = { own: 0, other: 0 };
    for (let i = 0; i < 400; i++) {
      const t = tagPlace(s.inside.lat, s.inside.lon, {
        precision: 'ROOFTOP',
        address: `${i} Test Street, Blue Island, IL`,
      });
      if (t.h3_res9 === s.own) picked.own++;
      else if (t.h3_res9 === s.other) picked.other++;
    }
    expect(picked.own + picked.other).toBe(400);
    // About half each; far from all one side.
    expect(picked.own).toBeGreaterThan(120);
    expect(picked.other).toBeGreaterThan(120);
  });

  test('away from a seam the cell is the point’s cell, as today (control)', () => {
    const [cLat, cLon] = cellToLatLng(EAGLES_CELL);
    for (const precision of [...POINT_PRECISIONS, null, undefined, 'NOT_A_PRECISION']) {
      const t = tagPlace(cLat, cLon, { precision, address: ADDRESS });
      expect(t.h3_res9).toBe(EAGLES_CELL);
      expect({ h3_res9: t.h3_res9, h3_res7: t.h3_res7 }).toEqual(tagCoordinates(cLat, cLon));
      expect(t.candidates).toBe(1);
    }
    // A point with no stated precision is taken as placed, even at an edge.
    const s = straddle(EAGLES_CELL, 0, 2);
    const placed = tagPlace(s.outside.lat, s.outside.lon, { precision: null, address: ADDRESS });
    expect(placed.h3_res9).toBe(s.other);
    expect(placed.seam).toBe('no_precision');
  });

  test('the res-7 cell is always the parent of the res-9 cell [res 7 taken from the point at a seam]', () => {
    // A seam whose two cells sit in two different res-7 areas.
    const disk = gridDisk(EAGLES_CELL, 12);
    let found: ReturnType<typeof straddle> | null = null;
    for (const cell of disk) {
      for (let edge = 0; edge < 6 && !found; edge++) {
        const s = straddle(cell, edge, 4);
        if (cellToParent(s.own, 7) !== cellToParent(s.other, 7)) found = s;
      }
      if (found) break;
    }
    expect(found, 'a res-9 edge that is also a res-7 edge').not.toBeNull();
    const s = found!;
    const point7 = latLngToCell(s.inside.lat, s.inside.lon, 7);
    const target = [s.own, s.other].find((c) => cellToParent(c, 7) !== point7)!;
    let address = '';
    for (let i = 0; i < 200 && !address; i++) {
      const a = `${i} Seam Road`;
      if (
        tagPlace(s.inside.lat, s.inside.lon, { precision: 'ROOFTOP', address: a }).h3_res9 ===
        target
      )
        address = a;
    }
    expect(address, 'an address that picks the cell across the res-7 edge').not.toBe('');
    const t = tagPlace(s.inside.lat, s.inside.lon, { precision: 'ROOFTOP', address });
    expect(t.h3_res7).toBe(cellToParent(target, 7));
    expect(t.h3_res7).not.toBe(point7);
    expect(tagsConsistent(t)).toBe(true);
  });

  test('the res-7 cell is the parent off a seam too, where the point’s own res-7 cell differs [res 7 from the point]', () => {
    const t = tagCoordinates(RES7_SEAM.lat, RES7_SEAM.lon);
    expect(t.h3_res7).toBe(cellToParent(t.h3_res9, 7));
    expect(tagsConsistent(t)).toBe(true);
    for (const precision of [...POINT_PRECISIONS, null]) {
      expect(
        tagsConsistent(tagPlace(RES7_SEAM.lat, RES7_SEAM.lon, { precision, address: ADDRESS }))
      ).toBe(true);
    }
  });

  test('every cell chosen, on or off a seam, is consistent (a sweep)', () => {
    let seed = 2199;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 1500; i++) {
      const lat = 41.5 + rnd() * 0.4;
      const lon = -87.9 + rnd() * 0.4;
      const precision = POINT_PRECISIONS[i % POINT_PRECISIONS.length];
      const t = tagPlace(lat, lon, { precision, address: `${i} Sweep Ave` });
      expect(tagsConsistent(t), `${lat},${lon}`).toBe(true);
      // The cell chosen is the point's own or one across an edge within reach.
      expect(cellsInReach(lat, lon, SEAM_MARGIN_M[precision])).toContain(t.h3_res9);
    }
  });

  test('a lookup with a rooftop point and one with an approximate point get different seam margins [one margin for all]', () => {
    expect(seamMarginMeters('ROOFTOP')).toBeLessThan(seamMarginMeters('APPROXIMATE'));
    expect(seamMarginMeters('RANGE_INTERPOLATED')).toBeGreaterThan(seamMarginMeters('ROOFTOP'));
    expect(seamMarginMeters('GEOMETRIC_CENTER')).toBeGreaterThan(seamMarginMeters('ROOFTOP'));
    // 30 m from an edge: past a rooftop point's margin, inside an approximate one's.
    const s = straddle(EAGLES_CELL, 3, 30);
    const roof = tagPlace(s.inside.lat, s.inside.lon, { precision: 'ROOFTOP', address: ADDRESS });
    const approx = tagPlace(s.inside.lat, s.inside.lon, {
      precision: 'APPROXIMATE',
      address: ADDRESS,
    });
    expect(roof.seam).toBe('off_seam');
    expect(roof.h3_res9).toBe(s.own);
    expect(approx.seam).toBe('address');
    expect(approx.candidates).toBe(2);
  });

  test('no margin is wider than the cap, and the cap reaches only the cells across an edge', () => {
    for (const p of POINT_PRECISIONS)
      expect(SEAM_MARGIN_M[p]).toBeLessThanOrEqual(SEAM_MARGIN_MAX_M);
    // At the cap, from a point 1 m inside a corner, at most the three cells at that corner.
    const corner = cellToBoundary(EAGLES_CELL)[0];
    const [cLat, cLon] = cellToLatLng(EAGLES_CELL);
    const p = toward(corner[0], corner[1], cLat, cLon, 1);
    const near = cellsInReach(p.lat, p.lon, SEAM_MARGIN_MAX_M);
    expect(near[0]).toBe(EAGLES_CELL);
    expect(near.length).toBeGreaterThanOrEqual(3);
    expect(near.length).toBeLessThanOrEqual(4);
    for (const c of near) expect(gridDisk(EAGLES_CELL, 1)).toContain(c);
  });

  test('no address, or an address that cannot be normalised, falls back to the point’s cell and says so [a throw]', () => {
    const s = straddle(EAGLES_CELL, 4, 4);
    for (const address of [undefined, null, '', '   ', '!!! — ???', 42, {}, ['x']]) {
      let t: ReturnType<typeof tagPlace> | undefined;
      expect(() => {
        t = tagPlace(s.outside.lat, s.outside.lon, { precision: 'ROOFTOP', address });
      }, String(address)).not.toThrow();
      expect(t!.h3_res9).toBe(s.other);
      expect(t!.seam).toBe('no_address');
      expect(tagsConsistent(t!)).toBe(true);
    }
  });

  test('invalid coordinates still fail loudly, as tagCoordinates does', () => {
    expect(() => tagPlace(999, 0, { precision: 'ROOFTOP', address: ADDRESS })).toThrow();
    expect(() => tagPlace(Number.NaN, 0, { precision: 'ROOFTOP', address: ADDRESS })).toThrow();
  });
});

// ─── The lookup path: create, update and the stored row ──────────────────────

function googleAt(point: { lat: number; lon: number }, location_type: string, address = ADDRESS) {
  return new Response(
    JSON.stringify({
      status: 'OK',
      results: [
        {
          geometry: {
            location: { lat: point.lat, lng: point.lon },
            location_type,
            viewport: {
              northeast: { lat: point.lat + 0.001, lng: point.lon + 0.001 },
              southwest: { lat: point.lat - 0.001, lng: point.lon - 0.001 },
            },
          },
          formatted_address: address,
          types: ['street_address'],
        },
      ],
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
}

function stubGoogle(answer: () => Response) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => answer());
}

const row = (id: string) =>
  env.DB.prepare('SELECT lat, lon, h3_res9, h3_res7 FROM events WHERE id = ?')
    .bind(id)
    .first<{ lat: number; lon: number; h3_res9: string; h3_res7: string }>();

async function create(body: Record<string, unknown>) {
  const res = await handleCreateEvent(
    new Request('https://t.test/api/v2/admin/events', {
      method: 'POST',
      headers: ADMIN,
      body: JSON.stringify({ attendance_mode: 'in_person', start_date: '2026-12-05', ...body }),
    }),
    KEYED
  );
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; place: string };
}

describe('the lookup path stores the address’s cell', () => {
  test('two events at one address, geocoded either side of an edge, are stored in one res-9 cell [the point’s own cell stored]', async () => {
    const s = straddle(EAGLES_CELL, 5, 4);
    stubGoogle(() => googleAt(s.inside, 'ROOFTOP'));
    const a = await create({ title: 'Seam A', where_address: '13328 Olde Western Ave' });
    stubGoogle(() => googleAt(s.outside, 'ROOFTOP'));
    const b = await create({ title: 'Seam B', where_address: '13328 Olde Western Avenue' });
    expect([a.place, b.place]).toEqual(['on_map', 'on_map']);
    const ra = await row(a.id);
    const rb = await row(b.id);
    // The points are kept as Google gave them; only the cell is the address's.
    expect([ra!.lat, rb!.lat]).toEqual([s.inside.lat, s.outside.lat]);
    expect(rb!.h3_res9).toBe(ra!.h3_res9);
    expect(ra!.h3_res7).toBe(cellToParent(ra!.h3_res9, 7));
    expect(rb!.h3_res7).toBe(ra!.h3_res7);
  });

  test('an update that re-geocodes the address to the other side keeps the cell', async () => {
    const s = straddle(EAGLES_CELL, 0, 4);
    stubGoogle(() => googleAt(s.inside, 'RANGE_INTERPOLATED'));
    const a = await create({ title: 'Seam C', where_address: '13328 Olde Western Ave' });
    const before = await row(a.id);
    stubGoogle(() => googleAt(s.outside, 'ROOFTOP'));
    const res = await handleUpdateEvent(
      new Request(`https://t.test/api/v2/admin/events/${a.id}`, {
        method: 'PUT',
        headers: ADMIN,
        body: JSON.stringify({ where_address: '13328 Olde Western Ave.' }),
      }),
      KEYED,
      a.id
    );
    expect(res.status).toBe(200);
    const after = await row(a.id);
    expect(after!.lat).toBe(s.outside.lat);
    expect(after!.h3_res9).toBe(before!.h3_res9);
    expect(after!.h3_res7).toBe(cellToParent(after!.h3_res9, 7));
  });

  test('coordinates sent with the event are taken as placed, with res 7 as their parent', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no lookup expected'));
    const a = await create({
      title: 'Seam D',
      where_address: '1 Res Seven Rd',
      lat: RES7_SEAM.lat,
      lon: RES7_SEAM.lon,
    });
    const r = await row(a.id);
    expect(r!.h3_res9).toBe(latLngToCell(RES7_SEAM.lat, RES7_SEAM.lon, 9));
    expect(r!.h3_res7).toBe(cellToParent(r!.h3_res9, 7));
    expect(r!.h3_res7).not.toBe(latLngToCell(RES7_SEAM.lat, RES7_SEAM.lon, 7));
  });

  test('the choice is logged with no event, place, point or address [the address logged]', async () => {
    const s = straddle(EAGLES_CELL, 1, 4);
    stubGoogle(() => googleAt(s.outside, 'ROOFTOP'));
    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const a = await create({ title: 'Seam E', where_address: '13328 Olde Western Ave' });
    const lines = logs.filter((l) => l.includes('EVENT_CELL_CHOICE'));
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(Object.keys(line).sort()).toEqual([
      'candidates',
      'precision',
      'seam',
      'timestamp',
      'type',
    ]);
    expect(line).toMatchObject({ seam: 'address', precision: 'ROOFTOP', candidates: 2 });
    for (const secret of ['Olde', 'olde', a.id, String(s.outside.lat).slice(0, 7)]) {
      expect(lines[0]).not.toContain(secret);
    }
  });
});

// ─── Where the module may be used ────────────────────────────────────────────

describe('the address is used only at write time on the admin and lookup path', () => {
  const norm = (p: string) => p.replace(/\\/g, '/');
  const sources = (): [string, string][] =>
    Object.entries(JSON.parse(E.TEST_SOURCE_FILES_JSON) as Record<string, string>)
      .map(([p, c]) => [norm(p), c] as [string, string])
      .filter(([p]) => /\/workers\/oursharedevents\/src\/.+\.ts$/.test(p));

  test('only the place lookup chooses a cell by address', () => {
    const users = sources()
      .filter(([p]) => !p.endsWith('/src/lib/h3-tagging.ts'))
      .filter(([, c]) => /\b(tagPlace|normaliseAddressKey|cellsInReach)\b/.test(c))
      .map(([p]) => p.replace(/^.*\/workers\/oursharedevents\//, ''));
    expect(users).toEqual(['src/lib/event-place.ts']);
  });

  test('no scan-path file imports h3-js, the tagging module, the geocoder or the place lookup', () => {
    const SCAN_PATH = [
      'src/handlers/qr-scan.ts',
      'src/handlers/qr-verify.ts',
      'src/handlers/shortlink-resolve.ts',
      'src/handlers/uec-resolve.ts',
      'src/handlers/forms.ts',
    ];
    const all = new Map(sources());
    for (const rel of SCAN_PATH) {
      const src = [...all].find(([p]) => p.endsWith(`/${rel}`))?.[1];
      expect(src, rel).toBeDefined();
      expect(
        src!.match(/from\s+['"][^'"]*(h3-js|h3-tagging|event-place|lib\/geo)['"]/)?.[0] ?? null,
        rel
      ).toBeNull();
    }
  });
});
