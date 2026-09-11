/**
 * demo-geo-conformance.ts — OSE-997 (signal-integrity / brain-conformance).
 *
 * The SINGLE source of truth for one brain↔code claim:
 *   "The RIPH demo dataset conforms to the brain — venue identity matches, and
 *    its H3 geo is realizable INSIDE its named corridor (Blue Island)."
 *
 * Consumed by BOTH ends of the reconciliation loop so one RIPH drift turns both
 * layers red from a single evaluation (OSE-997 DoD #3 — not just the unit test):
 *   1. tests/riph-brain-conformance.spec.ts   — unit layer (@born-red OSE-995)
 *   2. scripts/generate-conformance-report.ts  — conformance sink (@brain-conformance INV-26)
 *
 * Brain-declared truth is pulled from OCR-docs:
 *   - corridor-definitions.yaml → founding_corridors.blue_island (venue `riph` =
 *     "Rock Island Public House (RIPH)", community Blue Island)
 *   - architectural-invariants.yaml → #26 demo_geo_corridor_realizability
 *
 * The bug this was born against: mock-data.ts once decoded RIPH as
 * "Ridge-Irish-Prairie Hills — Beverly" with an H3 cell resolving to the San Juan
 * Mountains, Colorado (~1,500 km outside the corridor). OSE-995 reconciled the
 * data; OSE-997 makes the claim a standing, machine-readable guard.
 */

import { cellToLatLng } from 'h3-js';
import {
  RIPH_VENUE_NAME,
  RIPH_BRAND_ID,
  MOCK_BRAND_ID,
  getRiphSeasonEvents,
  getEventFixture,
} from './mock-data.js';

/** The architectural-invariant id this evaluator enforces (brain #26). */
export const DEMO_GEO_INVARIANT = 26;

// ── Brain-declared truth (OCR-docs corridor-definitions.yaml, blue_island) ──────
export const BRAIN_VENUE_NAME = 'Rock Island Public House';
export const BRAIN_FORBIDDEN_NAME = 'Ridge-Irish-Prairie Hills';
/**
 * Blue Island / Southwest-Chicago south corridor bounding box. Blue Island
 * (41.657, -87.680) and its adjacency (Beverly / Evergreen Park / Oak Lawn) fall
 * inside; anything outside Chicagoland fails. The Colorado cell (37.85, -107.69)
 * is ~1,500 km out and is the drift this box exists to catch.
 */
export const CORRIDOR_BBOX = { latMin: 41.4, latMax: 41.85, lonMin: -88.05, lonMax: -87.45 };

export interface ConformanceCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DemoGeoConformanceResult {
  invariant: number;
  claim: string;
  ok: boolean;
  checks: ConformanceCheck[];
  failures: string[];
}

function inCorridor(lat: number, lon: number): boolean {
  return (
    lat >= CORRIDOR_BBOX.latMin &&
    lat <= CORRIDOR_BBOX.latMax &&
    lon >= CORRIDOR_BBOX.lonMin &&
    lon <= CORRIDOR_BBOX.lonMax
  );
}

/**
 * Evaluate the demo-geo-corridor-realizability claim against the live mock-data
 * fixtures. Pure and deterministic — no I/O, no Date.now(). Returns a structured
 * verdict: `ok` is the AND of every check; `failures` names each broken one.
 */
export function evaluateDemoGeoConformance(): DemoGeoConformanceResult {
  const checks: ConformanceCheck[] = [];
  const push = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  // ── Identity (season constants) ──────────────────────────────────────────────
  push(
    'venue_name_is_brain_venue',
    RIPH_VENUE_NAME.includes(BRAIN_VENUE_NAME),
    `RIPH_VENUE_NAME="${RIPH_VENUE_NAME}" must contain "${BRAIN_VENUE_NAME}"`
  );
  push(
    'venue_name_not_drifted',
    !RIPH_VENUE_NAME.includes(BRAIN_FORBIDDEN_NAME),
    `RIPH_VENUE_NAME must NOT carry the drifted "${BRAIN_FORBIDDEN_NAME}" name`
  );
  push(
    'brand_id_not_beverly',
    !RIPH_BRAND_ID.toLowerCase().includes('beverly'),
    `RIPH_BRAND_ID="${RIPH_BRAND_ID}" must reflect Blue Island, not Beverly`
  );

  // ── Geo realizability (season events) ────────────────────────────────────────
  const events = getRiphSeasonEvents();
  push('season_events_present', events.length > 0, 'expected at least one RIPH season event to check');
  for (const e of events) {
    const [lat7, lon7] = cellToLatLng(e.h3_res7);
    push(
      `season_${e.id}_res7_in_corridor`,
      inCorridor(lat7, lon7),
      `${e.id}: h3_res7 ${e.h3_res7} → [${lat7.toFixed(3)}, ${lon7.toFixed(3)}] is outside the Blue Island corridor`
    );
    const [lat9, lon9] = cellToLatLng(e.h3_res9);
    push(
      `season_${e.id}_res9_in_corridor`,
      inCorridor(lat9, lon9),
      `${e.id}: h3_res9 ${e.h3_res9} → [${lat9.toFixed(3)}, ${lon9.toFixed(3)}] is outside the Blue Island corridor`
    );
    const drift = Math.hypot(e.lat - lat7, e.lon - lon7);
    push(
      `season_${e.id}_latlon_agrees_h3`,
      drift < 0.5,
      `${e.id}: stored lat/lon [${e.lat}, ${e.lon}] disagrees with h3_res7 center [${lat7.toFixed(3)}, ${lon7.toFixed(3)}]`
    );
  }

  // ── Portfolio fixture (getEventFixture) ──────────────────────────────────────
  const fx = getEventFixture();
  push(
    'fixture_brand_id_blue_island',
    !MOCK_BRAND_ID.toLowerCase().includes('beverly') && MOCK_BRAND_ID.toLowerCase().includes('blue-island'),
    `MOCK_BRAND_ID="${MOCK_BRAND_ID}" must reflect Blue Island, not Beverly`
  );
  if (fx.h3_res7) {
    const [flat7, flon7] = cellToLatLng(fx.h3_res7);
    push(
      'fixture_res7_in_corridor',
      inCorridor(flat7, flon7),
      `getEventFixture h3_res7 ${fx.h3_res7} → [${flat7.toFixed(3)}, ${flon7.toFixed(3)}] is outside the Blue Island corridor`
    );
    if (fx.lat != null && fx.lon != null) {
      push(
        'fixture_latlon_agrees_h3',
        Math.hypot(fx.lat - flat7, fx.lon - flon7) < 0.5,
        `getEventFixture stored lat/lon [${fx.lat}, ${fx.lon}] disagrees with h3_res7 center [${flat7.toFixed(3)}, ${flon7.toFixed(3)}]`
      );
    }
  }
  if (fx.h3_res9) {
    const [flat9, flon9] = cellToLatLng(fx.h3_res9);
    push('fixture_res9_in_corridor', inCorridor(flat9, flon9), `getEventFixture h3_res9 ${fx.h3_res9} is outside the Blue Island corridor`);
  }
  push(
    'fixture_identity_not_drifted',
    !fx.title.includes(BRAIN_FORBIDDEN_NAME) &&
      !(fx.who_host ?? '').includes(BRAIN_FORBIDDEN_NAME) &&
      !(fx.corridor_id ?? '').toLowerCase().includes('beverly'),
    'getEventFixture must not carry the drifted "Ridge-Irish-Prairie Hills" / Beverly identity'
  );

  const failures = checks.filter((c) => !c.ok).map((c) => c.detail);
  return {
    invariant: DEMO_GEO_INVARIANT,
    claim: 'RIPH demo geo resolves inside its named corridor (Blue Island) and its venue identity matches the brain',
    ok: failures.length === 0,
    checks,
    failures,
  };
}
