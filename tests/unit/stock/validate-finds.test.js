const { readFileSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const { nodes } = JSON.parse(
  readFileSync(path.join(__dirname, '../../../stock/nodes.json'), 'utf8')
);
let validateFinds;
let nodeAt;
beforeAll(async () => {
  ({ validateFinds, nodeAt } = await import('../../../scripts/stock/validate-finds.mjs'));
});
// A point the polygon test puts in the node: scan the outer ring's bounding box.
const insideOf = (id) => {
  const n = nodes.find((x) => x.id === id);
  const ring = (n.polygon.type === 'Polygon' ? n.polygon.coordinates : n.polygon.coordinates[0])[0];
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let i = 1; i < 40; i++) {
    for (let j = 1; j < 40; j++) {
      const lng = x0 + ((x1 - x0) * i) / 40;
      const lat = y0 + ((y1 - y0) * j) / 40;
      if (nodeAt(nodes, lat, lng) === id) return { lat, lng };
    }
  }
  throw new Error('no interior point for ' + id);
};

// A point in an overlapping border cell of some node but inside no node polygon.
const borderPoint = () => {
  for (const n of nodes) {
    for (const c of n.cells) {
      const [clat, clng] = h3.cellToLatLng(c);
      for (const [vlat, vlng] of h3.cellToBoundary(c)) {
        for (const f of [0.2, 0.5, 0.8]) {
          const lat = clat + (vlat - clat) * f;
          const lng = clng + (vlng - clng) * f;
          if (!nodeAt(nodes, lat, lng) && h3.latLngToCell(lat, lng, 7) === c) return { lat, lng };
        }
      }
    }
  }
  throw new Error('no border point found');
};

const square = (x0, y0, x1, y1) => [
  [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0],
  ],
];

const TODAY = '2026-11-04';
const eventTypeIds = new Set(['trivia', 'live-music']);
const day = (n) => new Date(Date.UTC(2026, 10, 4 + n)).toISOString().slice(0, 10);

const find = (over = {}) => ({
  venue: 'Cork & Kerry',
  address: '10614 S Western Ave, Chicago, IL',
  sector: 'private',
  node: 'beverly',
  event_type_id: 'trivia',
  starts_at: `${day(10)}T19:00:00-06:00`,
  ends_at: null,
  title: 'Trivia night',
  summary: 'Weekly trivia.',
  source_url: 'https://example.com/e/1',
  ...over,
});

// geocode stub: address text picks a node; 'nowhere' fails; 'faraway' is outside every node
const geocode = async (address) => {
  if (address.includes('nowhere')) return null;
  if (address.includes('faraway')) return { lat: 41.95, lng: -87.65 };
  if (address.includes('border')) return borderPoint();
  if (address.includes('hole')) return { lat: 0.5, lng: 0.5 };
  if (address.includes('both')) return { lat: 0.5, lng: 1.5 };
  if (address.includes('oaklawn')) return insideOf('oak-lawn');
  return insideOf('beverly');
};

const run = (finds) => validateFinds({ finds, eventTypeIds, nodes, today: TODAY, geocode });
const reason = async (row) => (await run([row])).refused[0]?.reason;

describe('validateFinds', () => {
  test('accepts a good row with node, cell, lat and lng', async () => {
    const r = await run([find()]);
    expect(r.refused).toEqual([]);
    expect(r.accepted).toHaveLength(1);
    const a = r.accepted[0];
    expect(a.node).toBe('beverly');
    expect(a.cell).toBe(h3.latLngToCell(a.lat, a.lng, 7));
  });

  test('a start the day before today is outside-window', async () => {
    expect(await reason(find({ starts_at: `${day(-1)}T19:00:00-06:00` }))).toBe('outside-window');
  });
  test('today + 91 days is outside-window', async () => {
    expect(await reason(find({ starts_at: `${day(91)}T19:00:00-06:00` }))).toBe('outside-window');
  });
  test('today + 90 days is accepted', async () => {
    const r = await run([find({ starts_at: `${day(90)}T19:00:00-06:00` })]);
    expect(r.accepted).toHaveLength(1);
  });
  test('today is accepted', async () => {
    const r = await run([find({ starts_at: `${TODAY}T19:00:00-06:00` })]);
    expect(r.accepted).toHaveLength(1);
  });
  test('empty source_url is no-source', async () => {
    expect(await reason(find({ source_url: '' }))).toBe('no-source');
  });
  test('an unknown event type is unknown-type', async () => {
    expect(await reason(find({ event_type_id: 'nope' }))).toBe('unknown-type');
  });
  test('a null geocode is geocode-failed', async () => {
    expect(await reason(find({ address: 'nowhere' }))).toBe('geocode-failed');
  });
  test('a point in no polygon is not-in-node', async () => {
    expect(await reason(find({ address: 'faraway' }))).toBe('not-in-node');
  });

  test('a point outside the boundary but inside a border cell is not-in-node', async () => {
    const p = borderPoint();
    const cells = new Set(nodes.flatMap((n) => n.cells));
    expect(cells.has(h3.latLngToCell(p.lat, p.lng, 7))).toBe(true);
    expect(await reason(find({ address: 'border' }))).toBe('not-in-node');
  });

  test('a point in a polygon hole is not-in-node', async () => {
    const holed = [
      {
        id: 'beverly',
        cells: [],
        polygon: {
          type: 'Polygon',
          coordinates: [...square(0, 0, 3, 3), ...square(0.4, 0.4, 0.6, 0.6)],
        },
      },
    ];
    const r = await validateFinds({
      finds: [find({ address: 'hole' })],
      eventTypeIds,
      nodes: holed,
      today: TODAY,
      geocode,
    });
    expect(r.refused[0].reason).toBe('not-in-node');
  });

  test('a point inside two polygons takes the first node in order', async () => {
    const overlapping = [
      { id: 'beverly', cells: [], polygon: { type: 'Polygon', coordinates: square(0, 0, 2, 2) } },
      { id: 'oak-lawn', cells: [], polygon: { type: 'Polygon', coordinates: square(1, 0, 3, 2) } },
    ];
    const r = await validateFinds({
      finds: [find({ address: 'both' })],
      eventTypeIds,
      nodes: overlapping,
      today: TODAY,
      geocode,
    });
    expect(r.accepted[0].node).toBe('beverly');
  });
  test('a malformed row is bad-shape', async () => {
    expect(await reason(find({ sector: 'other' }))).toBe('bad-shape');
    expect(await reason(find({ title: 5 }))).toBe('bad-shape');
    expect(await reason(find({ starts_at: 'soon' }))).toBe('bad-shape');
  });

  test('the polygon decides the node, not the claim', async () => {
    const r = await run([find({ address: 'oaklawn', node: 'beverly' })]);
    expect(r.accepted[0].node).toBe('oak-lawn');
  });

  test('same venue and start collapse to one; the other is duplicate', async () => {
    const r = await run([find(), find({ venue: ' cork &  kerry ' })]);
    expect(r.accepted).toHaveLength(1);
    expect(r.refused.map((x) => x.reason)).toEqual(['duplicate']);
  });

  test('title is cut to 120 and summary to 200', async () => {
    const r = await run([find({ title: 'T'.repeat(300), summary: 'S'.repeat(500) })]);
    expect(r.accepted[0].title).toHaveLength(120);
    expect(r.accepted[0].summary).toHaveLength(200);
  });

  test('acceptedPerNode counts accepted rows per node', async () => {
    const r = await run([
      find(),
      find({ venue: 'B', starts_at: `${day(11)}T19:00:00-06:00` }),
      find({ venue: 'C', address: 'oaklawn' }),
      find({ venue: 'D', source_url: '' }),
    ]);
    expect(r.acceptedPerNode).toEqual({ beverly: 2, 'oak-lawn': 1 });
  });

  test('private rows come before public rows', async () => {
    const r = await run([
      find({ venue: 'Park', sector: 'public' }),
      find({ venue: 'Pub', sector: 'private' }),
    ]);
    expect(r.accepted.map((a) => a.sector)).toEqual(['private', 'public']);
  });
});
