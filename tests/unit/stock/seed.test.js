/* eslint-disable security/detect-non-literal-fs-filename -- reads the repo's own stock files */
/**
 * The fixed seed of the full staging site (owner, 2026-11-05): its re-basing to
 * a load day, and the committed seed's totals. Every count here comes from the
 * committed seed or the map gate, never a literal.
 */
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const ROOT = path.join(__dirname, '../../..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const SEED = readJson('stock/seed/seed.json');
const { nodes } = readJson('stock/nodes.json');
const EMPTY = 'mount-greenwood';

let S;
let MAP_GATE;
let chicagoDate;
let nodeAt;
let MS;
beforeAll(async () => {
  S = await import('../../../scripts/stock/seed.mjs');
  ({ MAP_GATE } = await import('../../../scripts/stock/check-full.mjs'));
  ({ chicagoDate, nodeAt } = await import('../../../scripts/stock/validate-finds.mjs'));
  MS = await import('../../../scripts/stock/make-seed.mjs');
});

const CHICAGO_TIME = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Chicago',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};
const event = (over = {}) => ({
  offsetDays: 0,
  localStart: '19:30',
  durationMinutes: null,
  venue: 'Hall',
  address: '1 Main St',
  lat: 41.72,
  lng: -87.7,
  node: 'evergreen-park',
  sector: 'private',
  event_type_id: 'etr-art-music',
  title: 'Show',
  summary: 'A show.',
  source_url: 'https://example.com/e/1',
  ...over,
});

describe('re-basing a seed event to a load day', () => {
  test('day 0 lands on the load day, at its Chicago local time', () => {
    const r = S.rebaseEvent(event(), '2026-12-01');
    expect(r.starts_at).toBe('2026-12-01T19:30:00-06:00');
    expect(chicagoDate(r.starts_at)).toBe('2026-12-01');
    expect(CHICAGO_TIME.format(new Date(r.starts_at))).toBe('19:30');
  });

  test('day 90 lands 90 days on, still inside the window', () => {
    const r = S.rebaseEvent(event({ offsetDays: 90, localStart: '09:05' }), '2026-12-01');
    expect(chicagoDate(r.starts_at)).toBe('2027-03-01');
    expect(dayNumber(chicagoDate(r.starts_at)) - dayNumber('2026-12-01')).toBe(90);
    expect(CHICAGO_TIME.format(new Date(r.starts_at))).toBe('09:05');
  });

  test('the local time holds across the spring DST change (CST to CDT)', () => {
    // 2027-03-14 is the first day of daylight time in Chicago
    const before = S.rebaseEvent(event({ offsetDays: 3 }), '2027-03-10');
    const after = S.rebaseEvent(event({ offsetDays: 4 }), '2027-03-10');
    expect(before.starts_at).toBe('2027-03-13T19:30:00-06:00');
    expect(after.starts_at).toBe('2027-03-14T19:30:00-05:00');
    for (const r of [before, after]) {
      expect(CHICAGO_TIME.format(new Date(r.starts_at))).toBe('19:30');
    }
  });

  test('the local time holds across the autumn DST change (CDT to CST)', () => {
    // 2026-11-01 is the first day of standard time in Chicago
    const before = S.rebaseEvent(event({ offsetDays: 0, localStart: '18:00' }), '2026-10-31');
    const after = S.rebaseEvent(event({ offsetDays: 1, localStart: '18:00' }), '2026-10-31');
    expect(before.starts_at).toBe('2026-10-31T18:00:00-05:00');
    expect(after.starts_at).toBe('2026-11-01T18:00:00-06:00');
  });

  test('a wall time in the spring gap or the autumn overlap resolves one fixed way', () => {
    expect(S.chicagoIso(S.chicagoInstant('2027-03-14', '02:30'))).toBe('2027-03-14T03:30:00-05:00');
    expect(S.chicagoIso(S.chicagoInstant('2026-11-01', '01:30'))).toBe('2026-11-01T01:30:00-05:00');
  });

  test('a duration becomes ends_at, elapsed from the start; none stays null', () => {
    const r = S.rebaseEvent(event({ durationMinutes: 150 }), '2026-12-01');
    expect(r.ends_at).toBe('2026-12-01T22:00:00-06:00');
    expect(S.rebaseEvent(event(), '2026-12-01').ends_at).toBeNull();
  });

  test('the row carries the build’s fields, with the res-7 cell of its point', () => {
    const e = event();
    const r = S.rebaseEvent(e, '2026-12-01');
    expect(Object.keys(r).sort()).toEqual(
      [
        'address',
        'cell',
        'ends_at',
        'event_type_id',
        'lat',
        'lng',
        'node',
        'sector',
        'source_url',
        'starts_at',
        'summary',
        'title',
        'venue',
      ].sort()
    );
    expect(r.cell).toBe(h3.latLngToCell(e.lat, e.lng, 7));
  });

  test('a malformed seed is refused', () => {
    expect(() => S.rebaseSeed({ ...SEED, seededOn: 'today' }, '2026-12-01')).toThrow(/seededOn/);
    expect(() =>
      S.rebaseSeed({ ...SEED, events: [event({ localStart: '7:30pm' })] }, '2026-12-01')
    ).toThrow(/event 0/);
    expect(() =>
      S.rebaseSeed({ ...SEED, events: [event({ offsetDays: -1 })] }, '2026-12-01')
    ).toThrow(/event 0/);
    expect(() => S.rebaseSeed(SEED, '12/01/2026')).toThrow(/loadDay/);
  });
});

describe('the committed seed', () => {
  const ids = nodes.map((n) => n.id);

  test('is well formed and was seeded on 2026-11-05', () => {
    expect(() => S.assertSeed(SEED)).not.toThrow();
    expect(SEED.seededOn).toBe(MS.SEEDED_ON);
  });

  test('every populated place reaches the map gate; Mount Greenwood is 0; Beverly is absent', () => {
    const expected = S.expectedByNode(SEED, ids);
    expect(Object.keys(expected).sort()).toEqual([...ids].sort());
    expect(ids).not.toContain('beverly');
    expect(expected[EMPTY]).toBe(0);
    for (const id of ids.filter((x) => x !== EMPTY)) {
      expect(expected[id], id).toBeGreaterThanOrEqual(MAP_GATE);
    }
    expect(SEED.events.some((e) => e.node === 'beverly')).toBe(false);
    expect(SEED.businesses.some((b) => b.node === 'beverly' || b.node === EMPTY)).toBe(false);
  });

  test('every event and business sits in the node its point falls in', () => {
    for (const e of SEED.events) expect(nodeAt(nodes, e.lat, e.lng), e.title).toBe(e.node);
    for (const b of SEED.businesses) expect(nodeAt(nodes, b.lat, b.lng), b.name).toBe(b.node);
  });

  test('every populated place has an anchor business', () => {
    for (const id of ids.filter((x) => x !== EMPTY)) {
      expect(
        SEED.businesses.some((b) => b.node === id && b.anchor),
        id
      ).toBe(true);
    }
  });

  test.each(['2026-11-05', '2027-01-20', '2027-03-12', '2027-11-06', '2028-02-29'])(
    'loaded on %s, each place’s count in the 90-day window equals the seed’s',
    (loadDay) => {
      const { accepted, businesses } = S.rebaseSeed(SEED, loadDay);
      const inWindow = {};
      for (const r of accepted) {
        const offset = dayNumber(chicagoDate(r.starts_at)) - dayNumber(loadDay);
        if (offset >= 0 && offset <= 90) inWindow[r.node] = (inWindow[r.node] || 0) + 1;
      }
      expect(S.expectedByNode({ events: accepted }, ids)).toEqual(S.expectedByNode(SEED, ids));
      expect({ ...S.expectedByNode({ events: [] }, ids), ...inWindow }).toEqual(
        S.expectedByNode(SEED, ids)
      );
      expect(businesses).toHaveLength(SEED.businesses.length);
    }
  );
});

describe('make-seed (the one-time step)', () => {
  const NODES = [
    { id: 'left', zips: ['1'], cells: [], polygon: { type: 'Polygon', coordinates: [square(0)] } },
    { id: 'right', zips: ['2'], cells: [], polygon: { type: 'Polygon', coordinates: [square(2)] } },
    { id: 'quiet', zips: ['3'], cells: [], polygon: { type: 'Polygon', coordinates: [square(4)] } },
  ];
  function square(x0) {
    return [
      [x0, 0],
      [x0 + 1, 0],
      [x0 + 1, 1],
      [x0, 1],
      [x0, 0],
    ];
  }
  const where = { left: { lat: 0.5, lng: 0.5 }, right: { lat: 0.5, lng: 2.5 } };
  const where2 = { quiet: { lat: 0.5, lng: 4.5 } };
  const geocode = async (a) => ({ ...where, ...where2 })[a.split(' ')[0]] || null;
  const find = (place, i, over = {}) => ({
    venue: `${place} venue`,
    address: `${place} ${i}`,
    sector: 'private',
    zip: place === 'left' ? '1' : '2',
    event_type_id: 'etr-art-music',
    starts_at: `2026-11-${String(6 + (i % 20)).padStart(2, '0')}T19:30:00-06:00`,
    ends_at: null,
    title: `${place} ${i}`,
    summary: 's',
    source_url: 'https://example.com/x',
    ...over,
  });
  const run = (finds, businesses = []) =>
    MS.makeSeed({
      finds,
      businesses: [
        { name: 'L', address: 'left 0', anchor: true },
        { name: 'R', address: 'right 0', anchor: true },
        ...businesses,
      ],
      eventTypeIds: new Set(['etr-art-music']),
      nodes: NODES,
      geocode,
      emptyNodes: ['quiet'],
    });
  const enough = (place) => Array.from({ length: MAP_GATE }, (_, i) => find(place, i));

  test('keeps each event’s day offset, Chicago start and duration', () => {
    const e = MS.toSeedEvent(
      {
        ...find('left', 0),
        starts_at: '2026-11-08T01:30:00Z', // 19:30 on the 7th in Chicago
        ends_at: '2026-11-08T03:00:00Z',
        node: 'left',
        lat: 0.5,
        lng: 0.5,
      },
      '2026-11-05'
    );
    expect(e).toMatchObject({ offsetDays: 2, localStart: '19:30', durationMinutes: 90 });
  });

  test('writes nothing when a populated place falls under the map gate', async () => {
    const { report } = await run([...enough('left'), ...enough('right').slice(1)]);
    expect(report.ok).toBe(false);
    expect(report.problems.join('\n')).toContain(`right has ${MAP_GATE - 1} events`);
  });

  test('refuses anything that lands in the empty place, events and businesses alike', async () => {
    const stray = find('quiet', 0, { zip: '2' });
    const { seed, report } = await run(
      [...enough('left'), ...enough('right'), stray],
      [{ name: 'Q', address: 'quiet 0', anchor: false }]
    );
    expect(report.ok).toBe(true);
    expect(report.refused.map((r) => r.reason)).toEqual(['in-empty-node']);
    expect(report.businessRefused.map((r) => r.reason)).toEqual(['in-empty-node']);
    expect(seed.events.some((e) => e.node === 'quiet')).toBe(false);
    // the polygon wins over the searched zip, and the difference is listed
    expect(report.disagreements).toEqual([
      { title: 'quiet 0', address: 'quiet 0', searched: 'right', polygon: 'quiet' },
    ]);
  });

  test('the catalog ids come from the registry inserts in the migrations', () => {
    const dir = path.join(ROOT, 'workers/oursharedevents/migrations');
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(path.join(dir, f), 'utf8'));
    const ids = MS.catalogIdsFromMigrations(sql);
    expect(ids.has('etr-art-music')).toBe(true);
    expect(ids.has('etr-soc-watchparty')).toBe(true);
    for (const e of SEED.events) expect(ids.has(e.event_type_id), e.event_type_id).toBe(true);
  });
});
