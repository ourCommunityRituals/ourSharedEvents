/**
 * Launch requirement (CCR PR #700, data-science finding F2): every event field
 * the sponsor-discovery page and the landing attendee map show goes through the
 * public event projection (lib/public-event-projection, the allowlist behind
 * GET /api/v2/events). Then a location-precision policy that narrows what the
 * public sees (OSE-1245 — e.g. hiding a private home's address) narrows these
 * surfaces too, with no second place to change.
 *
 * Method: replace the projection with a STRICTER policy (no location, address,
 * coordinates or corridor cell) and prove both surfaces follow it. If either
 * path read the raw row instead, the stripped fields would still show.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/public-event-projection', async (orig) => {
  const real = await orig<typeof import('../src/lib/public-event-projection')>();
  const HIDDEN = new Set(['location', 'where_address', 'lat', 'lon', 'h3_res7', 'corridor_id']);
  return {
    ...real,
    toPublicEvent: (row: Record<string, unknown>) => {
      const out = real.toPublicEvent(row);
      for (const k of HIDDEN) delete out[k];
      return out;
    },
  };
});

const { toDiscoverable } = await import('../src/lib/sponsor-discovery');
const { renderLandingArea } = await import('../src/lib/landing-area');

const CELL = '872664c1effffff';
const NOW = Date.parse('2026-09-13T00:00:00.000Z');
const inDays = (n: number) => new Date(NOW + n * 86_400_000).toISOString();

describe('sponsor discovery reads events through the public projection', () => {
  it('a field the projection hides never reaches the sponsor page', () => {
    const d = toDiscoverable(
      {
        id: 'e1',
        title: 'Trivia',
        start_date: '2026-10-05',
        location: '12 Private Home Lane',
        h3_res7: CELL,
        is_published: 1,
        created_by: 'someone@example.com',
      },
      CELL
    );
    expect(d.location).toBeNull();
    // "Near you" is derived from the projected cell: hidden cell → no chip.
    expect(d.near).toBe(0);
    expect(d.title).toBe('Trivia');
    expect(Object.keys(d).sort()).toEqual(['id', 'location', 'near', 'start_date', 'title']);
  });
});

describe('the landing attendee map reads events through the public projection', () => {
  it('with the corridor cell hidden, no event can be drawn as a hex', () => {
    const items = Array.from({ length: 6 }, (_, i) => ({
      id: `e${i}`,
      name: `Event ${i}`,
      startDateISO: inDays(3 + i),
      phase: 'pre_event',
      venue: 'Eagles Hall',
      h3_res7: CELL,
    }));
    const area = renderLandingArea(items, { now: NOW });
    expect(area.html).not.toContain('data-testid="amap-svg"');
    expect(area.html).not.toContain(CELL);
    expect(area.html).toContain('data-testid="area-map-thin"');
    // The card list is a different surface (not changed here) and still lists them.
    expect(area.html.split('data-testid="area-card"').length - 1).toBe(6);
  });
});
