/**
 * OSE-844 (X-10) — API field-name contract: integration layer.
 *
 * The DB stores `title` / `start_date` / `location`; every surface template
 * (display, poster, public) reads `name` / `startDateISO` / `venue`. Before
 * OSE-844 nothing bridged the two, so a seeded event rendered "Untitled Event"
 * on the TV. The fix maps the three names ONCE in `enrichWithPhase`
 * (handlers/events.ts) — the single seam feeding list, detail and admin-list.
 *
 * This is the INTEGRATION rung of the reconciled pyramid: it seeds a row with
 * the DB column names, drives it through the live worker (SELF.fetch), and
 * asserts the API emits the canonical names — corroborating the L0 structural
 * gate (api-response-schema.invariant.spec.ts) and the FE templates from the
 * opposite direction. Code → contract → API, verified end to end.
 *
 * ADR-016. Decision: PO + backend lead chose Option A (map in the API).
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const BRAND = 'ose844-fieldmap-test';
const SEED = {
  id: 'evt_ose844_fieldmap',
  title: 'Reconciliation Night at Eagles Hall',
  slug: 'ose844-reconciliation-night',
  location: 'Eagles Hall, Blue Island IL',
  start_date: '2026-09-30',
};

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  const stmts: string[] = JSON.parse(tenv.TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await (tenv.DB as D1Database).prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('no such column')
      ) {
        continue;
      }
      throw e;
    }
  }
}

beforeAll(async () => {
  await applyMigrations();
  const tenv = env as unknown as TestEnv;
  const db = tenv.DB as D1Database;
  await db.prepare('DELETE FROM events WHERE brand_id = ?').bind(BRAND).run();
  await db
    .prepare(
      `INSERT INTO events (id, brand_id, title, slug, status, location, start_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, '2026-08-19T00:00:00Z', '2026-08-19T00:00:00Z')`
    )
    .bind(SEED.id, BRAND, SEED.title, SEED.slug, SEED.location, SEED.start_date)
    .run();
});

describe('OSE-844: events API emits canonical field names (name/startDateISO/venue)', () => {
  test('GET /api/v2/events maps title→name, start_date→startDateISO, location→venue', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/events?brand=${BRAND}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: Record<string, unknown>[] };
    expect(body.ok).toBe(true);

    const seeded = body.items.find((e) => e.id === SEED.id);
    expect(seeded, 'seeded active event must appear in the public list').toBeTruthy();
    expect(seeded!.name).toBe(SEED.title);
    expect(seeded!.startDateISO).toBe(SEED.start_date);
    expect(seeded!.venue).toBe(SEED.location);
  });

  test('GET /api/v2/events/:id maps the same three names on the detail payload', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/events/${SEED.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; item: Record<string, unknown> };
    expect(body.ok).toBe(true);
    expect(body.item.name).toBe(SEED.title);
    expect(body.item.startDateISO).toBe(SEED.start_date);
    expect(body.item.venue).toBe(SEED.location);
  });

  test('the DB column names remain in the payload (additive map — #16 floor unbroken)', async () => {
    const res = await SELF.fetch(`https://t.test/api/v2/events/${SEED.id}`);
    const body = (await res.json()) as { ok: boolean; item: Record<string, unknown> };
    // enrichWithPhase spreads the row, so `title`/`start_date`/`location` still
    // ship alongside the mapped names. The snapshot's projected_columns contract
    // (asserted at L0) therefore stays green; nothing is removed, only added.
    expect(body.item.title).toBe(SEED.title);
    expect(body.item.location).toBe(SEED.location);
    expect(body.item.start_date).toBe(SEED.start_date);
  });
});
