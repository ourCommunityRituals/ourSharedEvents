/**
 * OSE-1991 (owner 2026-11-12): the poster bundle carries `sponsor_rotation`,
 * the share-weighted turn sequence the digital poster walks: a sponsor's number
 * of turns follows its covenant share (allocateShares: Premium 7 / Anchor 3 /
 * Local 1, the local floor and the caps held), every sponsor on show has at
 * least one turn, and nothing else is in it (ids only, each one of `sponsors`).
 * It is the same sequence the TV side rail plays (sponsor-bundle tvSide).
 *
 * Layer: SELF.fetch against migrated D1. Page half:
 * poster-sponsor-share-turns.spec.ts (node, jsdom).
 *
 * @born-red OSE-1991 | method: run against the parent commit's handler
 * (accb936f: no sponsor_rotation in the bundle): every test here went red | date: 2026-11-12
 */
import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { allocateShares, sovTierOf } from '../src/lib/sponsor-allocation';

interface TestEnv {
  DB: D1Database;
  FORMS_DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_FORMS_MIGRATION_STATEMENTS: string;
}
const tenv = () => env as unknown as TestEnv;

const EVENT_ID = 'pb-share-evt';
const SPONSORS = [
  { id: 'share-prem', tier: 'platinum', name: 'Lakeside Credit Union' },
  { id: 'share-anchor', tier: 'gold', name: 'Sawyer Hardware' },
  { id: 'share-local-1', tier: 'bronze', name: 'Corner Bakery' },
  { id: 'share-local-2', tier: 'primary', name: 'Harbor Books' },
  { id: 'share-local-3', tier: 'bronze', name: 'Dune Coffee' },
];

async function applyMigrations(db: D1Database, json: string): Promise<void> {
  for (const stmt of JSON.parse(json) as string[]) {
    try {
      await db.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name') || msg.includes('already exists')) continue;
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations(tenv().DB, tenv().TEST_MIGRATION_STATEMENTS);
  await applyMigrations(tenv().FORMS_DB, tenv().TEST_FORMS_MIGRATION_STATEMENTS);
  try {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, timezone, starts_at, settings_json)
         VALUES (?, 'pb-share-brand', 'Harbor County Bocce', 'harbor-county-bocce-share', 'active', 'Harbor Hall',
                 '2026-11-21', 'America/Chicago', '2026-11-21T23:00:00.000Z', '{"useSponsors":true}')`
      )
      .bind(EVENT_ID)
      .run();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!msg.includes('UNIQUE constraint failed')) throw e;
  }
  for (const s of SPONSORS) {
    await seedSplitSponsor(tenv().DB, {
      id: s.id,
      eventId: EVENT_ID,
      brandId: 'pb-share-brand',
      name: s.name,
      tier: s.tier,
      isLocal: 0,
    });
  }
});

async function bundle(): Promise<{ sponsors: Array<{ id: string }>; sponsor_rotation: unknown }> {
  const res = await SELF.fetch(`https://t.test/api/v2/events/${EVENT_ID}/poster-bundle`);
  expect(res.status).toBe(200);
  return (await res.json()) as { sponsors: Array<{ id: string }>; sponsor_rotation: unknown };
}

const counts = (ids: string[]) =>
  ids.reduce<Record<string, number>>((m, id) => ((m[id] = (m[id] ?? 0) + 1), m), {});

describe('OSE-1991: the poster bundle carries the share-weighted sponsor turns', () => {
  test('sponsor_rotation is ids only, each one of the sponsors on the poster, every sponsor at least once', async () => {
    const b = await bundle();
    expect(Array.isArray(b.sponsor_rotation)).toBe(true);
    const rotation = b.sponsor_rotation as unknown[];
    for (const id of rotation) expect(typeof id).toBe('string');
    const onPoster = new Set(b.sponsors.map((s) => s.id));
    expect(onPoster.size).toBe(SPONSORS.length);
    for (const id of rotation as string[]) expect(onPoster.has(id), id).toBe(true);
    const c = counts(rotation as string[]);
    for (const id of onPoster) expect(c[id] ?? 0, `${id} has no turn`).toBeGreaterThanOrEqual(1);
  });

  test('turns follow the covenant share: Premium more than Anchor, Anchor more than each Local', async () => {
    const b = await bundle();
    const rotation = b.sponsor_rotation as string[];
    const c = counts(rotation);
    expect(c['share-prem']).toBeGreaterThan(c['share-anchor']);
    for (const id of ['share-local-1', 'share-local-2', 'share-local-3']) {
      expect(c['share-anchor']).toBeGreaterThan(c[id]);
    }
    // Each sponsor's turns track its allocateShares() share (largest remainder,
    // so within one turn of the exact count).
    const shares = allocateShares(
      SPONSORS.map((s) => ({ id: s.id, tier: sovTierOf(s.tier), is_local: false }))
    );
    for (const s of shares) {
      const exact = (s.sharePct / 100) * rotation.length;
      expect(Math.abs((c[s.id] ?? 0) - exact), s.id).toBeLessThanOrEqual(1);
    }
  });

  test('the same sequence the TV side rail plays (sponsor-bundle tvSide)', async () => {
    const b = await bundle();
    const res = await SELF.fetch(
      `https://t.test/api/v2/events/${EVENT_ID}/sponsor-bundle?surface=poster`
    );
    const sb = (await res.json()) as {
      bundle: { surface_sponsors: { tvSide: Array<{ id: string }> } };
    };
    expect(b.sponsor_rotation).toEqual(sb.bundle.surface_sponsors.tvSide.map((s) => s.id));
  });
});
