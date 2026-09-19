import { describe, expect, test } from 'vitest';
import { renderSponsorHomePage, type PlacementRow } from '../src/lib/sponsor-home-render';

// CCR-PR567 re-run item 8 — born-red XSS lock on the /sponsor render.
//
// The sponsor NAME and the placement fields (title / location / tier) are
// attacker-influenced: an organizer types a sponsor's name, and a sponsor
// business row carries a name — both are interpolated into HTML text and into a
// quoted attribute value (the <!--OCR_SPONSOR_NAME--> marker + card fields). If
// esc() were dropped, a `<script>` or a `"`-breakout would execute. This locks
// the escaping. Verified a REAL lock by reverting esc(sponsor.name) ->
// sponsor.name in sponsor-home-render.ts and watching these go red.
const SCRIPT = '<script>alert(1)</script>';
const BREAKOUT = '"><img src=x onerror=alert(1)>';

function placement(over: Partial<PlacementRow> = {}): PlacementRow {
  return {
    placement_id: 'p1',
    event_id: 'e1',
    tier: 'gold',
    locality_band: 0,
    organizer_accepted: 1,
    sponsor_accepted: 1,
    placement_active: 1,
    title: 'Title',
    status: 'active',
    start_date: '2026-10-01',
    end_date: null,
    location: 'Town Hall',
    is_published: 1,
    ...over,
  };
}

describe('/sponsor render escapes attacker-influenced fields (item 8)', () => {
  test('sponsor name with a <script> payload is escaped, never raw', () => {
    const page = renderSponsorHomePage({
      sponsor: { id: 'sb1', name: SCRIPT },
      placements: [],
      expiresIso: '2026-10-01T12:00:00Z',
    });
    expect(page).not.toContain('<script>alert(1)</script>');
    expect(page).toContain('&lt;script&gt;');
  });

  test('sponsor name attribute-breakout payload cannot close the attribute', () => {
    const page = renderSponsorHomePage({
      sponsor: { id: 'sb1', name: BREAKOUT },
      placements: [],
      expiresIso: '2026-10-01T12:00:00Z',
    });
    expect(page).not.toContain('<img src=x onerror=alert(1)>');
    expect(page).toContain('&quot;&gt;&lt;img');
  });

  test('placement title / location / tier payloads are all escaped', () => {
    const page = renderSponsorHomePage({
      sponsor: { id: 'sb1', name: 'Acme' },
      placements: [placement({ title: SCRIPT, location: SCRIPT, tier: SCRIPT })],
      expiresIso: '2026-10-01T12:00:00Z',
    });
    expect(page).not.toContain('<script>alert(1)</script>');
    // once each in title, location, tier
    expect((page.match(/&lt;script&gt;/g) || []).length).toBeGreaterThanOrEqual(3);
  });
});
