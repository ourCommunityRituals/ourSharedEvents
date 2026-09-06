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
    items: Record<string, unknown>[];
    windowDays: number;
    minEvents: number;
  };
}

describe('CONTRACT | map ↔ readiness gate', () => {
  test('the endpoint publishes the same window and threshold the library holds', async () => {
    const body = await mapBody([]);
    expect(body.windowDays).toBe(CORRIDOR_WINDOW_DAYS);
    expect(body.minEvents).toBe(CORRIDOR_READY_MIN_EVENTS);
  });

  test('the endpoint does not publish a verdict — only the rule (CCR H4)', async () => {
    // `ready` was cut until the latch exists. The contract that remains is
    // that the endpoint publishes the RULE, so a client applying it to `items`
    // gets the same answer the library would — which is what makes the field's
    // later addition a pure addition rather than a change.
    const rows = Array.from({ length: CORRIDOR_READY_MIN_EVENTS + 2 }, (_, i) =>
      row(i + 1, `r${i}`)
    );
    const body = await mapBody(rows);
    expect(body).not.toHaveProperty('ready');
    const clientVerdict = body.items.length >= body.minEvents;
    expect(clientVerdict).toBe(body.items.length >= CORRIDOR_READY_MIN_EVENTS);
  });

  test('items are never more than the window would admit', async () => {
    const rows = [
      row(1, 'a'),
      row(CORRIDOR_WINDOW_DAYS + 3, 'far'),
      row(-40, 'past'),
      row(20, 'b'),
    ];
    const body = await mapBody(rows);
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
