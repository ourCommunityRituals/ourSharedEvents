const { readFileSync } = require('node:fs');
const path = require('node:path');
const h3 = require('h3-js');

const { nodes } = JSON.parse(
  readFileSync(path.join(__dirname, '../../../stock/nodes.json'), 'utf8')
);
let validateFinds;
beforeAll(async () => {
  ({ validateFinds } = await import('../../../scripts/stock/validate-finds.mjs'));
});
const centerOf = (id) => {
  const [lat, lng] = h3.cellToLatLng(nodes.find((n) => n.id === id).cells[0]);
  return { lat, lng };
};

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
  if (address.includes('oaklawn')) return centerOf('oak-lawn');
  return centerOf('beverly');
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
  test('a cell in no node is not-in-node', async () => {
    expect(await reason(find({ address: 'faraway' }))).toBe('not-in-node');
  });
  test('a malformed row is bad-shape', async () => {
    expect(await reason(find({ sector: 'other' }))).toBe('bad-shape');
    expect(await reason(find({ title: 5 }))).toBe('bad-shape');
    expect(await reason(find({ starts_at: 'soon' }))).toBe('bad-shape');
  });

  test('the cell decides the node, not the claim', async () => {
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
