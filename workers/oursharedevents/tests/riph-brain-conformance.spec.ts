/**
 * riph-brain-conformance.spec.ts — OSE-995 (born-red brain↔code conformance).
 *
 * THE RECONCILIATION LOOP, made a standing test:
 *   brain (OCR-docs corridor-definitions.yaml) → THIS red test → conformance.json
 *   → brain-contract-check reads the result → the brain learns / flags drift.
 *
 * The brain (`ocr-docs-brain/corridor-definitions.yaml`, founding_corridors →
 * blue_island) declares:
 *   - venue `riph` name = "Rock Island Public House (RIPH)"
 *   - community = Blue Island (Southwest Chicago / Chicagoland south corridor)
 * The code (`src/lib/mock-data.ts`) currently DIVERGES: it calls RIPH
 * "Ridge-Irish-Prairie Hills — Beverly" and stamps an H3 cell that resolves to
 * the San Juan Mountains, Colorado (a stale placeholder from where the plan was
 * authored). This test asserts the code matches the brain, so it is BORN RED
 * against the current code and goes green only once mock-data is reconciled.
 *
 * @born-red OSE-995 | method: brain-conformance + geo-realizability | date: 2026-08-24
 */

import { describe, it, expect } from 'vitest';
import { cellToLatLng } from 'h3-js';
import {
  RIPH_VENUE_NAME,
  RIPH_BRAND_ID,
  MOCK_BRAND_ID,
  getRiphSeasonEvents,
  getEventFixture,
} from '../src/lib/mock-data';

// ── Brain-declared truth (pulled from ocr-docs-brain/corridor-definitions.yaml) ──
const BRAIN_VENUE_NAME = 'Rock Island Public House';
const BRAIN_FORBIDDEN_NAME = 'Ridge-Irish-Prairie Hills';
// Blue Island / Southwest-Chicago south corridor bounding box. Blue Island
// (41.657,-87.680) and its adjacency (Beverly/EP/Oak Lawn) fall inside; anything
// outside Chicagoland fails. The Colorado cell (37.85,-107.69) is ~1,500 km out.
const CORRIDOR_BBOX = { latMin: 41.4, latMax: 41.85, lonMin: -88.05, lonMax: -87.45 };

function inCorridor(lat: number, lon: number): boolean {
  return (
    lat >= CORRIDOR_BBOX.latMin &&
    lat <= CORRIDOR_BBOX.latMax &&
    lon >= CORRIDOR_BBOX.lonMin &&
    lon <= CORRIDOR_BBOX.lonMax
  );
}

describe('OSE-995: RIPH identity conforms to the brain', () => {
  it('RIPH_VENUE_NAME is the brain venue "Rock Island Public House"', () => {
    expect(RIPH_VENUE_NAME).toContain(BRAIN_VENUE_NAME);
  });

  it('RIPH_VENUE_NAME does NOT carry the drifted "Ridge-Irish-Prairie Hills" name', () => {
    expect(RIPH_VENUE_NAME).not.toContain(BRAIN_FORBIDDEN_NAME);
  });

  it('RIPH_BRAND_ID reflects Blue Island, not Beverly', () => {
    expect(RIPH_BRAND_ID.toLowerCase()).not.toContain('beverly');
  });
});

describe('OSE-995: RIPH geo is realizable inside its brain corridor (Blue Island)', () => {
  const events = getRiphSeasonEvents();

  it('has season events to check', () => {
    expect(events.length).toBeGreaterThan(0);
  });

  it('every event h3_res7 resolves inside the Blue Island corridor (catches the Colorado cell)', () => {
    for (const e of events) {
      const [lat, lon] = cellToLatLng(e.h3_res7);
      expect(
        inCorridor(lat, lon),
        `${e.id}: h3_res7 ${e.h3_res7} → [${lat.toFixed(3)}, ${lon.toFixed(3)}] is outside the Blue Island corridor`
      ).toBe(true);
    }
  });

  it('every event h3_res9 resolves inside the Blue Island corridor', () => {
    for (const e of events) {
      const [lat, lon] = cellToLatLng(e.h3_res9);
      expect(
        inCorridor(lat, lon),
        `${e.id}: h3_res9 ${e.h3_res9} → [${lat.toFixed(3)}, ${lon.toFixed(3)}] is outside the Blue Island corridor`
      ).toBe(true);
    }
  });

  it('stored lat/lon agrees with the stored H3 cell (internal geo consistency)', () => {
    for (const e of events) {
      const [cellLat, cellLon] = cellToLatLng(e.h3_res7);
      const drift = Math.hypot(e.lat - cellLat, e.lon - cellLon);
      expect(
        drift,
        `${e.id}: stored lat/lon [${e.lat},${e.lon}] disagrees with h3_res7 center [${cellLat.toFixed(3)},${cellLon.toFixed(3)}]`
      ).toBeLessThan(0.5);
    }
  });
});

// The portfolio fixture (getEventFixture / SPONSOR_POOL) is a SEPARATE dataset
// from the season constants above. Stage 1 reconciled the season constants but
// left this one carrying the Colorado H3 cell + 'riph-beverly' brand — and the
// checks above never looked at it, so the drift stayed green. This block closes
// that signal-integrity gap (OSE-995 / OCR-96): the portfolio fixture must ALSO
// resolve inside the Blue Island corridor and carry the Blue Island brand.
describe('OSE-995: portfolio fixture (getEventFixture) also conforms to the brain', () => {
  const fx = getEventFixture();

  it('MOCK_BRAND_ID reflects Blue Island, not Beverly', () => {
    expect(MOCK_BRAND_ID.toLowerCase()).not.toContain('beverly');
    expect(MOCK_BRAND_ID.toLowerCase()).toContain('blue-island');
  });

  it('fixture h3_res7 resolves inside the Blue Island corridor (catches the Colorado cell)', () => {
    const [lat, lon] = cellToLatLng(fx.h3_res7);
    expect(
      inCorridor(lat, lon),
      `getEventFixture h3_res7 ${fx.h3_res7} → [${lat.toFixed(3)}, ${lon.toFixed(3)}] is outside the Blue Island corridor`
    ).toBe(true);
  });

  it('fixture h3_res9 resolves inside the Blue Island corridor', () => {
    const [lat, lon] = cellToLatLng(fx.h3_res9);
    expect(inCorridor(lat, lon)).toBe(true);
  });

  it('stored lat/lon agrees with the stored H3 cell (internal geo consistency)', () => {
    const [cellLat, cellLon] = cellToLatLng(fx.h3_res7);
    expect(Math.hypot(fx.lat - cellLat, fx.lon - cellLon)).toBeLessThan(0.5);
  });

  it('does NOT carry the drifted "Ridge-Irish-Prairie Hills" / Beverly identity', () => {
    expect(fx.title).not.toContain(BRAIN_FORBIDDEN_NAME);
    expect(fx.who_host).not.toContain(BRAIN_FORBIDDEN_NAME);
    expect(fx.corridor_id).not.toContain('beverly');
  });
});
