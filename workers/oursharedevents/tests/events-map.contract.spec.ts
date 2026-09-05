/**
 * CONTRACT — the map endpoint, the readiness gate, and the list card agree.
 *
 * Three consumers now read the same two seams (`enrichWithPhase`,
 * `corridor-readiness`). A contract exists the moment a second consumer does,
 * and OSE-1243 already demonstrated what an untested one costs: the page
 * skipped the enrichment, every unit test passed, and the cards silently
 * offered registration for events that had already happened.
 *
 * These assert the agreements that would break quietly rather than loudly.
 */
import { describe, test, expect } from 'vitest';
import { handleEventsMap } from '../src/handlers/events-map';
import { renderEventList } from '../src/lib/event-list.js';
import {
  CORRIDOR_READY_MIN_EVENTS,
  CORRIDOR_WINDOW_DAYS,
  eventsInWindow,
} from '../src/lib/corridor-readiness.js';
import { latLngToCell } from 'h3-js';
import { CORRIDOR_RES } from '../src/lib/h3-tagging';

const CELL = latLngToCell(41.6572, -87.68, CORRIDOR_RES);
const DAY = 86_400_000;

function row(days: number, id: string) {
  const d = new Date(Date.now() + days * DAY).toISOString();
  return {
    id,
    title: `Event ${id}`,
    slug: id,
    status: 'active',
    location: 'RIPH',
    start_date: d,
    end_date: d,
    timezone: 'America/Chicago',
    lat: 41.6572,
    lon: -87.68,
    h3_res7: CELL,
  };
}

function db(rows: Record<string, unknown>[]) {
  return {
    DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) },
  } as never;
}

async function mapBody(rows: Record<string, unknown>[]) {
  const res = await handleEventsMap(
    new Request(`https://t.test/api/v2/events/map?cell=${CELL}`),
    db(rows)
  );
  return (await res.json()) as {
    ok: boolean;
    ready: boolean;
    items: Record<string, unknown>[];
    windowDays: number;
    minEvents: number;
  };
}

describe('CONTRACT | map ↔ readiness gate', () => {
  test('the endpoint reports the same window and threshold the library holds', async () => {
    const body = await mapBody([]);
    expect(body.windowDays).toBe(CORRIDOR_WINDOW_DAYS);
    expect(body.minEvents).toBe(CORRIDOR_READY_MIN_EVENTS);
  });

  test('ready always equals the gate applied to the items returned', async () => {
    // The property, not a sample: whatever the endpoint returns, its verdict
    // must be the verdict the library would give for exactly that list.
    const corpora = [
      [],
      [row(1, 'a')],
      Array.from({ length: 4 }, (_, i) => row(i + 1, `a${i}`)),
      Array.from({ length: 5 }, (_, i) => row(i + 1, `b${i}`)),
      Array.from({ length: 9 }, (_, i) => row(i + 1, `c${i}`)),
      [
        ...Array.from({ length: 8 }, (_, i) => row(CORRIDOR_WINDOW_DAYS + i + 1, `d${i}`)),
        row(2, 'in'),
      ],
      [...Array.from({ length: 8 }, (_, i) => row(-(i + 1), `e${i}`)), row(2, 'in')],
    ];
    for (const rows of corpora) {
      const body = await mapBody(rows);
      expect(body.ready).toBe(body.items.length >= CORRIDOR_READY_MIN_EVENTS);
    }
  });

  test('the items are exactly the events the gate would have counted', async () => {
    const rows = [row(1, 'a'), row(CORRIDOR_WINDOW_DAYS + 3, 'far'), row(-4, 'past'), row(20, 'b')];
    const body = await mapBody(rows);
    // Independently apply the library to the same enriched input shape.
    const expected = eventsInWindow(
      rows.map((r) => ({ startDateISO: r.start_date, phase: undefined })) as never
    );
    // Phase is undefined above, so the library filters everything — which is
    // the point: the endpoint must be enriching before it filters. If it were
    // not, items would be empty too.
    expect(expected).toEqual([]);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });
});

describe('CONTRACT | map ↔ the list card, on phase→CTA', () => {
  test('a phase the map pins is a phase the list card offers registration for', async () => {
    // The map shows only attendable events. The list card decides its CTA from
    // the same phase value. If these ever disagree, a reader taps a pin for a
    // live event and lands on a recap, or vice versa.
    const body = await mapBody([row(1, 'a'), row(30, 'b')]);
    for (const item of body.items) {
      const html = renderEventList([
        { id: String(item.id), name: String(item.name), phase: String(item.phase) },
      ]).html;
      expect(html, `map pinned ${item.phase} but the card offered a recap`).toContain(
        'data-cta="register"'
      );
      expect(html).not.toContain('data-cta="recap"');
    }
  });

  test('a phase the map excludes is exactly the phase the card sends to a recap', async () => {
    // post_event: not on the map (owner spec), recap on the list (OSE-1201).
    // The two rules are complementary, and this states that in one place.
    const past = await mapBody([row(-10, 'gone')]);
    expect(past.items).toEqual([]);
    const html = renderEventList([{ id: 'gone', name: 'Gone', phase: 'post_event' }]).html;
    expect(html).toContain('data-cta="recap"');
  });
});

describe('CONTRACT | the map emits the canonical field names', () => {
  test('items use name/startDateISO/venue, never the raw D1 column names', async () => {
    const body = await mapBody([row(3, 'a')]);
    const item = body.items[0];
    expect(item).toHaveProperty('name');
    expect(item).toHaveProperty('startDateISO');
    expect(item).toHaveProperty('venue');
    expect(item).not.toHaveProperty('title');
    expect(item).not.toHaveProperty('start_date');
    expect(item).not.toHaveProperty('location');
  });

  test('the canonical values are populated, not merely present', async () => {
    // The OSE-1243 failure in its map form: keys present, values empty.
    const item = (await mapBody([row(3, 'a')])).items[0];
    expect(String(item.name).trim()).toBeTruthy();
    expect(String(item.startDateISO).trim()).toBeTruthy();
    expect(String(item.venue).trim()).toBeTruthy();
    expect(String(item.phase).trim()).toBeTruthy();
  });
});
