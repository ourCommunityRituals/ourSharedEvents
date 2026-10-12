/**
 * OSE-818 — the honesty lexicon runs over the SharedReport's payload KEYS.
 *
 * The OSE-801 gate reads schema identifiers; it never read payload keys, which is
 * how `unique_gatherings` and `sponsor_impressions` reached the wire contract and
 * then the page. This builds a real report on a seeded event (scan buckets,
 * sponsor displays, a click-out) and walks every key of it, then checks the
 * declared contract (shared-report.snapshot.json) and the depth sections.
 *
 * It also holds the rename (owner 2026-10-11): `distinct_scanners` is on the
 * report and in every depth, and `unique_gatherings` is in none of them.
 *
 * @born-red OSE-818 | method: built-report key walk vs banned lexicon | date: 2026-10-11
 *   (red on main before the rename: unique_gatherings → "unique")
 */
import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { buildSharedReport } from '../src/lib/shared-report-builder';
import { DEPTH_SECTIONS } from '../src/lib/report-depth';
import {
  EXEMPT_PAYLOAD_KEYS,
  findBannedPayloadKeys,
  type PayloadKeyViolation,
} from '../src/lib/schema-lexicon';
import SNAPSHOT from '../src/api-schema-snapshots/shared-report.snapshot.json';
import { seedSplitSponsor } from './helpers/seed-sponsor';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;
const EVT = 'test-evt-payload-lexicon';

async function applyMigrations(): Promise<void> {
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/duplicate column name|already exists|no such column/.test(msg)) continue;
      throw e;
    }
  }
}

async function seed(): Promise<void> {
  const db = tenv().DB;
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, 'test-brand', 'Payload lexicon', ?, 'active', 'Test Venue', '2026-05-07T19:00:00Z',
               datetime('now'), datetime('now'))`
    )
    .bind(EVT, EVT)
    .run();
  for (const [hour, devices] of [
    ['18', 7],
    ['19', 9],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO scan_aggregates
           (id, event_id, bucket_date, bucket_hour, total_scans, distinct_agent_hashes, computed_at)
         VALUES (?, ?, '2026-05-07', ?, ?, ?, datetime('now'))`
      )
      .bind(`sa-${EVT}-${hour}`, EVT, hour, devices * 2, devices)
      .run();
  }
  await seedSplitSponsor(db, { id: 'sp-payload-lexicon', eventId: EVT, name: 'Corner Cafe' });
  for (let i = 0; i < 6; i++) {
    await db
      .prepare(
        `INSERT INTO sponsor_impressions (id, sponsor_id, event_id, surface, placement, event_type, created_at)
         VALUES (?, 'sp-payload-lexicon', ?, 'display', 'p1', 'impression', datetime('now'))`
      )
      .bind(`si-payload-lexicon-${i}`, EVT)
      .run();
  }
  await db
    .prepare(
      `INSERT INTO shortlinks (code, event_id, kind, clicks, created_at)
       VALUES ('plexi1', ?, 'public', 8, datetime('now'))`
    )
    .bind(EVT)
    .run();
}

const describeViolations = (v: PayloadKeyViolation[]) =>
  v.map((x) => `${x.path} → "${x.term}"`).join('\n  ');

let report: Record<string, unknown>;

beforeAll(async () => {
  await applyMigrations();
  await seed();
  const r = await buildSharedReport(tenv().DB, EVT);
  if (!r.ok) throw new Error(`report did not build: ${r.error}`);
  report = r.report as unknown as Record<string, unknown>;
});

describe('OSE-818 — SharedReport payload keys speak the lexicon', () => {
  test('the built report carries the seeded data (the walk has something to read)', () => {
    expect(report.distinct_scanners).toBe(16);
    expect(Array.isArray(report.sponsor_impressions)).toBe(true);
    expect((report.sponsor_impressions as unknown[]).length).toBeGreaterThan(0);
  });

  test('no key anywhere in a built report carries a banned token', () => {
    const v = findBannedPayloadKeys(report);
    expect(v, `banned payload keys:\n  ${describeViolations(v)}`).toEqual([]);
  });

  test('no field the contract declares carries a banned token', () => {
    const declared: Record<string, true> = {};
    for (const [k, v] of Object.entries(SNAPSHOT)) {
      if (k.endsWith('_fields') && Array.isArray(v)) for (const f of v) declared[f] = true;
    }
    expect(Object.keys(declared).length).toBeGreaterThan(10);
    const v = findBannedPayloadKeys(declared);
    expect(v, `banned contract fields:\n  ${describeViolations(v)}`).toEqual([]);
  });

  test('no depth section name carries a banned token', () => {
    const sections: Record<string, true> = {};
    for (const list of Object.values(DEPTH_SECTIONS)) for (const s of list) sections[s] = true;
    const v = findBannedPayloadKeys(sections);
    expect(v, `banned depth sections:\n  ${describeViolations(v)}`).toEqual([]);
  });

  test('every payload exemption is still on the report or in the contract (no stale exemptions)', () => {
    const seen = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v === null || typeof v !== 'object') return;
      for (const [k, c] of Object.entries(v)) {
        seen.add(k);
        walk(c);
      }
    };
    walk(report);
    for (const [k, v] of Object.entries(SNAPSHOT)) {
      if (k.endsWith('_fields') && Array.isArray(v)) for (const f of v) seen.add(f);
    }
    for (const key of EXEMPT_PAYLOAD_KEYS.keys()) {
      expect(seen.has(key), `exempt key "${key}" is gone — remove it`).toBe(true);
    }
  });
});

describe('OSE-818 — unique_gatherings is distinct_scanners (owner 2026-10-11)', () => {
  test('the report, the contract and every depth carry the new name only', () => {
    expect('unique_gatherings' in report).toBe(false);
    expect(SNAPSHOT.top_level_fields).toContain('distinct_scanners');
    expect(SNAPSHOT.top_level_fields).not.toContain('unique_gatherings');
    expect(SNAPSHOT.version).toBe('2.0.0');
    for (const [depth, list] of Object.entries(DEPTH_SECTIONS)) {
      expect(list, depth).toContain('distinct_scanners');
      expect(list, depth).not.toContain('unique_gatherings');
    }
  });
});

describe('the key walk bites (negative control)', () => {
  test('banned keys at any depth are found, with their path', () => {
    const v = findBannedPayloadKeys({
      ok: 1,
      unique_gatherings: 3,
      rows: [{ uniqueVisitors: 1 }],
      by_kind: { reach: 2 },
    });
    expect(v.map((x) => x.path)).toEqual([
      'unique_gatherings',
      'rows[0].uniqueVisitors',
      'by_kind.reach',
    ]);
  });

  test('values are not keys, and an exempt key is skipped', () => {
    expect(findBannedPayloadKeys({ label: 'unique visits', sponsor_impressions: [] })).toEqual([]);
  });
});
