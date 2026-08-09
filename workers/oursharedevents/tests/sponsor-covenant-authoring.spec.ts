/**
 * OSE-670 (#25 sponsor_share_covenant) — spend-blind sponsor authoring.
 *
 * The admin sponsor form used to expose four named size-differentiated slot
 * toggles (Poster Top / TV Top / TV Side / Mobile Banner) persisted verbatim as
 * placement_formats — letting an admin hand-assign a bigger/better slot, the
 * exact #25 violation. The fix: placement is UNIFORM and non-purchasable. The
 * SERVER forces the uniform value and ignores any client-supplied slot on both
 * create and update; the form exposes no slot toggles, only a covenant note +
 * read-only geo is_local pill.
 *
 * (a) Behavioral: the server wall — a client CANNOT set a named slot.
 * (b) Source-shape: the admin form no longer offers slot toggles.
 */

import { env, SELF } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import { maybeTag } from '../src/lib/h3-tagging';

const ADMIN = { Authorization: 'Bearer test-admin-key-e2e-2026' };

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

async function applyMigrations(): Promise<void> {
  const tenv = env as unknown as TestEnv;
  for (const stmt of JSON.parse(tenv.TEST_MIGRATION_STATEMENTS) as string[]) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (m.includes('duplicate column name') || m.includes('already exists')) continue;
      throw e;
    }
  }
}

const EVENT = 'ose670-covenant-evt';

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status)
     VALUES (?, 'ose670', 'Covenant Authoring', ?, 'active') ON CONFLICT(id) DO NOTHING`
  )
    .bind(EVENT, EVENT)
    .run();

  // A geocoded event so is_local geo-derivation can be exercised: the event
  // carries an h3_res7 corridor cell; a sponsor at the same coords matches it.
  const geo = maybeTag(GEO_LAT, GEO_LON);
  await env.DB.prepare(
    `INSERT INTO events (id, brand_id, title, slug, status, lat, lon, h3_res9, h3_res7)
     VALUES (?, 'ose670', 'Geo Event', ?, 'active', ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING`
  )
    .bind(GEO_EVENT, GEO_EVENT, GEO_LAT, GEO_LON, geo?.h3_res9 ?? null, geo?.h3_res7 ?? null)
    .run();
});

const GEO_EVENT = 'ose670-geo-evt';
const GEO_LAT = 40.7128;
const GEO_LON = -74.006;

async function createSponsor(payload: Record<string, unknown>): Promise<{ status: number; body: { id?: string; is_local?: boolean } }> {
  const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
    method: 'POST',
    headers: { ...ADMIN, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: res.status, body: (await res.json()) as { id?: string; is_local?: boolean } };
}

async function dbIsLocal(id: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT is_local FROM sponsors WHERE id = ?')
    .bind(id)
    .first<{ is_local: number }>();
  return row?.is_local ?? null;
}

const UNIFORM = { posterTop: true, tvTop: true, tvSide: true, mobileBanner: true };

async function listSponsors(): Promise<Array<{ id: string; placement_formats: string }>> {
  const res = await SELF.fetch(
    `https://t.test/api/v2/admin/sponsors?eventId=${encodeURIComponent(EVENT)}`,
    { headers: ADMIN }
  );
  const body = (await res.json()) as { items?: Array<{ id: string; placement_formats: string }> };
  return body.items ?? [];
}

describe('OSE-670 — server wall: placement is uniform + non-purchasable', () => {
  test('CREATE ignores a client-supplied named slot → stored uniform', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/admin/sponsors', {
      method: 'POST',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      // Adversarial: try to buy ONLY the premium poster-top slot.
      body: JSON.stringify({
        name: 'SlotBuyer',
        event_id: EVENT,
        tier: 'title',
        placement_formats: JSON.stringify({ posterTop: true }),
      }),
    });
    expect(res.status).toBe(201);

    const mine = (await listSponsors()).find((s) => s.id && s.placement_formats);
    const buyer = (await listSponsors()).find((s) => JSON.parse(s.placement_formats));
    expect(buyer).toBeDefined();
    // The narrow slot selection was OVERRIDDEN to the uniform value.
    expect(JSON.parse(buyer!.placement_formats)).toEqual(UNIFORM);
    expect(mine).toBeDefined();
  });

  test('UPDATE cannot write a named slot → placement stays uniform', async () => {
    const created = (await listSponsors())[0];
    expect(created).toBeDefined();
    // Pair the slot-buy attempt with a real field change: the name updates,
    // the named-slot is silently ignored (placement stays uniform).
    const upd = await SELF.fetch(`https://t.test/api/v2/admin/sponsors/${created.id}`, {
      method: 'PUT',
      headers: { ...ADMIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Renamed',
        placement_formats: JSON.stringify({ posterTop: true, tvTop: false }),
      }),
    });
    expect([200, 204]).toContain(upd.status);

    const after = (await listSponsors()).find((s) => s.id === created.id)!;
    expect(JSON.parse(after.placement_formats)).toEqual(UNIFORM);
  });
});

describe('OSE-670 — admin form exposes no slot toggles', () => {
  async function adminHtml(): Promise<string> {
    const res = await SELF.fetch('https://t.test/admin', { headers: ADMIN });
    expect(res.status).toBe(200);
    return res.text();
  }

  test('the four named-slot checkboxes are gone', async () => {
    const html = await adminHtml();
    expect(html).not.toContain('data-testid="placement-poster-top"');
    expect(html).not.toContain('data-testid="placement-tv-top"');
    expect(html).not.toContain('data-testid="placement-tv-side"');
    expect(html).not.toContain('data-testid="placement-mobile-banner"');
  });

  test('a covenant note + read-only geo is_local pill replace them', async () => {
    const html = await adminHtml();
    expect(html).toContain('data-testid="spon-covenant-note"');
    expect(html).toContain('data-testid="spon-is-local-pill"');
    expect(html).toContain('capped, locally-floored share');
  });

  test('the form no longer builds placement_formats from checkboxes', async () => {
    const html = await adminHtml();
    expect(html).not.toContain("posterTop: document.getElementById('spon-placement-poster').checked");
  });
});

describe('OSE-661 — is_local is geo-derived + non-purchasable (#25 precondition)', () => {
  test('a sponsor at the event corridor cell → is_local = 1 (derived, not set)', async () => {
    const { status, body } = await createSponsor({
      name: 'Local Match',
      event_id: GEO_EVENT,
      tier: 'primary',
      lat: GEO_LAT,
      lon: GEO_LON,
    });
    expect(status).toBe(201);
    expect(body.is_local).toBe(true);
    expect(await dbIsLocal(body.id!)).toBe(1);
  });

  test('a sponsor far from the event cell → is_local = 0', async () => {
    const { status, body } = await createSponsor({
      name: 'Far Away',
      event_id: GEO_EVENT,
      tier: 'primary',
      lat: 0,
      lon: 0,
    });
    expect(status).toBe(201);
    expect(body.is_local).toBe(false);
    expect(await dbIsLocal(body.id!)).toBe(0);
  });

  test('a sponsor with NO coords → is_local = 0 (cannot verify locality)', async () => {
    const { status, body } = await createSponsor({
      name: 'No Geo',
      event_id: GEO_EVENT,
      tier: 'primary',
    });
    expect(status).toBe(201);
    expect(body.is_local).toBe(false);
    expect(await dbIsLocal(body.id!)).toBe(0);
  });

  test('is_local is NON-PURCHASABLE: a client-supplied is_local is ignored', async () => {
    // Attempt to buy local status with no matching geo.
    const { status, body } = await createSponsor({
      name: 'Fake Local',
      event_id: GEO_EVENT,
      tier: 'title',
      is_local: 1,
      is_local_suggested: true,
    });
    expect(status).toBe(201);
    // Geo does not match (no coords) → stays 0 regardless of the body.
    expect(body.is_local).toBe(false);
    expect(await dbIsLocal(body.id!)).toBe(0);
  });
});
