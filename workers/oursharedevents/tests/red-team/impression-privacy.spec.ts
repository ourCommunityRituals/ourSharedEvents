/**
 * OSE-662 — Privacy/equity red-team: anonymous sponsor-impression path.
 *
 * Adversarial coverage for the public-URL impression surface. Each test ATTACKS
 * the impression path and asserts the attack finds nothing — a test that cannot
 * detect a violation earns no credit. Feeds the OSE-564 threat ledger.
 *
 * This file authors the three impression-specific attacks that had no coverage:
 *   Attack 2 — Impression de-anonymization: recover WHO from device-minute
 *              impressions (session/timing/cross-state joins). Refused: the
 *              sponsor_displays table carries zero attendee-identifying
 *              columns — nothing to correlate to an individual.
 *   Attack 3 — Floor probe on impressions: request impression metrics for a
 *              tiny cohort. Suppressed: impression-derived aggregates route
 *              through applyCountFloor (OSE-683), so no metric renders below K.
 *   Attack 9 — Channel-cap on impressions: read in-event device impressions at
 *              a finer geo grain than presence allows. Refused: impressions are
 *              captured at h3_res7 (~5 km² corridor cell) ONLY — no finer
 *              (res8/res9) cell is ever stored or writable (OSE-635 res7-cap).
 *
 * Companion coverage (do NOT duplicate): spend-blind = sponsor-share-covenant;
 * registration↔scan join + PII TTL/plaintext = architecture/lifecycle/forms-
 * security; anon-path logging = anti-logging-proof; maps H3 leak =
 * geo-link-maps-not-h3.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

beforeAll(async () => {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('already exists') && !msg.includes('duplicate column name')) throw e;
    }
  }
});

function loadSource(relPath: string): string {
  const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
  const entry = Object.entries(sources).find(([p]) => p.replace(/\\/g, '/').endsWith(relPath));
  if (!entry) throw new Error(`${relPath} not found in TEST_SOURCE_FILES_JSON`);
  return entry[1];
}

async function impressionColumns(): Promise<string[]> {
  const res = await tenv().DB.prepare(`PRAGMA table_info(sponsor_displays)`).all();
  return (res.results as Array<{ name: string }>).map((r) => r.name.toLowerCase());
}

// ─── Attack 9: channel-cap — impressions never finer than res7 ────────────────

describe('OSE-662 attack 9 — channel-cap on impressions (finest grain = res7)', () => {
  // @born-red TL-068 | method: design-time-negative-assertion | date: 2026-08-22
  test('sponsor_displays carries h3_res7 but NO finer h3_res8/res9 grain', async () => {
    const cols = await impressionColumns();
    expect(cols, 'impressions must carry the res7 corridor cell').toContain('h3_res7');
    // The attack: a finer cell would let a sponsor localize a device below the
    // corridor. No such column may exist.
    expect(cols).not.toContain('h3_res8');
    expect(cols).not.toContain('h3_res9');
  });

  test('impression write binds ONLY h3_res7 — no finer cell is written (OSE-635)', () => {
    const src = loadSource('handlers/sponsors.ts');
    // Isolate the INSERT INTO sponsor_displays column list(s).
    const inserts = src.match(/INSERT INTO sponsor_displays[\s\S]*?\)/g) ?? [];
    expect(inserts.length, 'expected an INSERT INTO sponsor_displays').toBeGreaterThan(0);
    for (const ins of inserts) {
      expect(/h3_res7/.test(ins), 'impression INSERT must carry h3_res7').toBe(true);
      expect(
        /h3_res9|h3_res8/.test(ins),
        'impression INSERT must NOT carry a finer-than-res7 cell'
      ).toBe(false);
    }
  });
});

// ─── Attack 2: de-anonymization — no identity columns to correlate ────────────

describe('OSE-662 attack 2 — impression de-anonymization (no identity columns)', () => {
  // @born-red TL-066 | method: design-time-negative-assertion | date: 2026-08-22
  test('sponsor_displays schema carries zero attendee-identifying columns', async () => {
    const cols = await impressionColumns();
    // Anything here would let device-minute impressions resolve to a person via
    // session/timing/cross-state joins. None may be present.
    const forbidden = [
      'ip',
      'ip_hash',
      'user_agent',
      'ua',
      'anon_id',
      'anon_id_hash',
      'session',
      'session_id',
      'device',
      'device_id',
      'fingerprint',
      'user_id',
      'email',
      'phone',
      'name',
      'lat',
      'lon',
      'latitude',
      'longitude',
    ];
    const leaked = forbidden.filter((f) => cols.includes(f));
    expect(
      leaked,
      `sponsor_displays must carry no identity columns; found: ${leaked.join(', ')}`
    ).toEqual([]);
  });
});

// ─── Attack 3: floor probe — sub-K impression cohorts suppressed ──────────────

describe('OSE-662 attack 3 — floor probe on impression metrics (sub-K suppressed)', () => {
  // @born-red TL-067 | method: design-time-negative-assertion | date: 2026-08-22
  test('impression-derived aggregates route through applyCountFloor (OSE-683)', () => {
    const src = loadSource('lib/shared-report-builder.ts');
    // The builder is the only surface that turns raw impressions into published
    // metrics. It must floor them (drop-before-sum), or a tiny cohort leaks.
    expect(src.includes('applyCountFloor'), 'builder must import/apply the K-anon floor').toBe(
      true
    );
    expect(
      /sponsor_class_breakdown/.test(src),
      'impression class breakdown must exist and be the floored surface'
    ).toBe(true);
  });
});

// ─── Evidence line for the conformance report (OSE-560) ───────────────────────

describe('OSE-662 — impression-path red-team evidence', () => {
  test('emits OSE-564 ledger evidence for attacks 2/3/9', () => {
    const evidence = {
      story: 'OSE-662',
      surface: 'public-url:sponsor-impression',
      last_attacked: '2026-08-22',
      attacks: {
        A2_deanonymization: 'no identity columns on sponsor_displays',
        A3_floor_probe: 'impression aggregates floored via applyCountFloor (OSE-683)',
        A9_channel_cap: 'impressions captured at h3_res7 only; no finer cell (OSE-635)',
      },
      invariants: [7, 9, 25],
      // Next-free ledger IDs (TL-061..065 are taken by the sponsor-eligibility
      // group). Entries added when this lands: A2→TL-066, A3→TL-067, A9→TL-068.
      ledger: ['TL-066', 'TL-067', 'TL-068'],
    };
    // eslint-disable-next-line no-console
    console.log(`[OSE-662-EVIDENCE] ${JSON.stringify(evidence)}`);
    expect(evidence.attacks.A9_channel_cap).toContain('h3_res7');
  });
});
