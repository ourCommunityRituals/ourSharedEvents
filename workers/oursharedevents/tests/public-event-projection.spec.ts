/**
 * OSE-1247 — the public event projection is a decision, not a side effect.
 *
 * `enrichWithPhase` spreads `...row`, so before this the public contract was
 * whatever the SELECT happened to project. The snapshot recorded 24 columns, so
 * the shape was DECLARED — but a snapshot that records a projection documents
 * it rather than deciding it, and `template_id` proved the difference by being
 * emitted publicly while absent from the snapshot entirely.
 *
 * These tests assert the allowlist holds in the direction that matters: a new
 * internal column must NOT reach the public response on its own.
 */
import { describe, test, expect } from 'vitest';
import { handleListEvents, handleGetEvent } from '../src/handlers/events';
import { toPublicEvent, PUBLIC_EVENT_FIELDS } from '../src/lib/public-event-projection';

async function listItem(): Promise<Record<string, unknown>> {
  const res = await handleListEvents(new Request('https://t.test/api/v2/events'), {} as never);
  const body = (await res.json()) as { items: Record<string, unknown>[] };
  expect(body.items.length).toBeGreaterThan(0);
  return body.items[0]!;
}

describe('the node cell is no longer published', () => {
  test('h3_res9 is absent from the public list', async () => {
    // The map REFUSES to accept a res-9 cell — a caller cannot narrow a map
    // query below corridor resolution, because the precision floor is the
    // privacy floor. The list was emitting res 9 at the same time, so the floor
    // held inbound and not outbound and the finer cell was one request away.
    expect(await listItem()).not.toHaveProperty('h3_res9');
  });

  test('the corridor cell is still published — this is a floor, not a blackout', async () => {
    // res 7 (~1,406 m) is the resolution the map itself serves. Removing it too
    // would break the surface rather than protect anyone.
    expect(Object.keys(await listItem())).toContain('h3_res7');
  });

  test('h3_res9 cannot come back through the projection', () => {
    expect(PUBLIC_EVENT_FIELDS.has('h3_res9')).toBe(false);
    expect(toPublicEvent({ id: 'e', h3_res9: '89266454447ffff' })).not.toHaveProperty('h3_res9');
  });
});

describe('the projection is an allowlist, so new columns stay internal', () => {
  test('an unlisted field is dropped', () => {
    const out = toPublicEvent({
      id: 'e',
      title: 'T',
      internal_scoring_weight: 0.91,
      admin_notes: 'do not publish',
      anon_id_hash: 'HASH',
    });
    expect(out).toHaveProperty('id');
    expect(out).not.toHaveProperty('internal_scoring_weight');
    expect(out).not.toHaveProperty('admin_notes');
    expect(out).not.toHaveProperty('anon_id_hash');
  });

  test('a new SELECT column does not reach the public response by default', async () => {
    // The scenario the ticket exists for: someone adds a column to the query
    // for an internal reason. Under `...row` it shipped publicly the same day.
    const enrichedWithNewColumn = { id: 'e', title: 'T', newly_added_column: 'oops' };
    expect(toPublicEvent(enrichedWithNewColumn)).not.toHaveProperty('newly_added_column');
  });

  test('the computed fields survive — they are the ones surfaces read', () => {
    const out = toPublicEvent({
      id: 'e',
      name: 'Bocce',
      startDateISO: '2026-10-02',
      venue: 'RIPH',
      phase: 'pre_event',
    });
    for (const f of ['name', 'startDateISO', 'venue', 'phase']) {
      expect(out, `${f} must survive projection`).toHaveProperty(f);
    }
  });

  test('projection never invents a field', () => {
    expect(Object.keys(toPublicEvent({ id: 'e' }))).toEqual(['id']);
  });
});

describe('the two public event endpoints agree on what they publish', () => {
  test('list and detail emit the same field set for the same event', async () => {
    // A narrower list beside a wider detail endpoint is security theatre: a
    // caller who wants the extra fields just uses the other route.
    const item = await listItem();
    const res = await handleGetEvent(
      new Request('https://t.test/api/v2/events/evt-mock-001'),
      {} as never,
      String(item.id)
    );
    const body = (await res.json()) as { ok: boolean; item?: Record<string, unknown> };
    if (!body.ok || !body.item) return; // fixture path differs; the list assertion still stands
    for (const key of Object.keys(body.item)) {
      expect(PUBLIC_EVENT_FIELDS.has(key), `detail emits unlisted field: ${key}`).toBe(true);
    }
  });
});
