/**
 * Tenant Isolation — Runtime Cross-Brand Isolation Gate
 *
 * Invariant #9 (tenant_isolation): every public query that returns a list of
 * records MUST scope that list to a single brand. No cross-tenant data leakage
 * through list endpoints.
 *
 * L0 structural tests (tenant-isolation.invariant.spec.ts) assert the
 * WHERE brand_id = ? clause exists in the source code. This spec proves the
 * clause actually works at runtime — a SQL bug such as OR vs AND, or a missing
 * bind, would pass the L0 gate but fail here.
 *
 * Coverage:
 *   - Brand A events are NOT returned when requesting brand B
 *   - Brand B events are NOT returned when requesting brand A
 *   - Unknown brand returns empty list (no leakage of any brand)
 *   - Both brands return their own events correctly (positive case)
 *   - Multiple events per brand are correctly scoped (not just a 1-event fluke)
 *
 * This runs in the cloudflare:test pool (miniflare + D1). Each spec file gets
 * its own isolated D1 instance, so seeding here does not affect other specs.
 */

import { SELF, env } from 'cloudflare:test';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
}

const tenv = () => env as unknown as TestEnv;

// ─── Seed data ────────────────────────────────────────────────────────────────
// Two independent brands, two events each, all status='active' so the
// public list endpoint returns them.

const ALPHA_EVENT_1 = {
  id: 'alpha-evt-1',
  brand_id: 'brand-alpha',
  title: 'Alpha Event One',
  slug: 'alpha-event-one',
  status: 'active',
};

const ALPHA_EVENT_2 = {
  id: 'alpha-evt-2',
  brand_id: 'brand-alpha',
  title: 'Alpha Event Two',
  slug: 'alpha-event-two',
  status: 'active',
};

const BETA_EVENT_1 = {
  id: 'beta-evt-1',
  brand_id: 'brand-beta',
  title: 'Beta Event One',
  slug: 'beta-event-one',
  status: 'active',
};

const BETA_EVENT_2 = {
  id: 'beta-evt-2',
  brand_id: 'brand-beta',
  title: 'Beta Event Two',
  slug: 'beta-event-two',
  status: 'active',
};

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Apply main DB migrations (uses the smart BEGIN/END-aware splitter from vitest.config.mts).
  const stmts: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of stmts) {
    try {
      await tenv().DB.prepare(stmt).run();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (
        msg.includes('duplicate column name') ||
        msg.includes('already exists') ||
        msg.includes('SQL code did not contain a statement')
      )
        continue;
      throw e;
    }
  }

  // Seed both brands. Insert only the NOT NULL columns; everything else defaults.
  const seedEvents = [ALPHA_EVENT_1, ALPHA_EVENT_2, BETA_EVENT_1, BETA_EVENT_2];
  for (const ev of seedEvents) {
    await tenv()
      .DB.prepare(
        `INSERT INTO events (id, brand_id, title, slug, status)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(ev.id, ev.brand_id, ev.title, ev.slug, ev.status)
      .run();
  }
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Invariant #9: Tenant Isolation — runtime cross-brand isolation', () => {
  test('INV9-RT | brand alpha list contains only alpha events', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events?brand=brand-alpha');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: { id: string; brand_id: string }[] };
    expect(body.ok).toBe(true);

    const ids = body.items.map((e) => e.id);
    expect(ids).toContain('alpha-evt-1'); // positive: alpha event 1 is returned
    expect(ids).toContain('alpha-evt-2'); // positive: alpha event 2 is returned
    expect(ids).not.toContain('beta-evt-1'); // isolation: beta event 1 is NOT returned
    expect(ids).not.toContain('beta-evt-2'); // isolation: beta event 2 is NOT returned
  });

  test('INV9-RT | brand beta list contains only beta events', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events?brand=brand-beta');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: { id: string; brand_id: string }[] };
    expect(body.ok).toBe(true);

    const ids = body.items.map((e) => e.id);
    expect(ids).toContain('beta-evt-1'); // positive: beta event 1 is returned
    expect(ids).toContain('beta-evt-2'); // positive: beta event 2 is returned
    expect(ids).not.toContain('alpha-evt-1'); // isolation: alpha event 1 is NOT returned
    expect(ids).not.toContain('alpha-evt-2'); // isolation: alpha event 2 is NOT returned
  });

  test('INV9-RT | unknown brand returns empty list — no cross-brand leakage', async () => {
    const res = await SELF.fetch('https://t.test/api/v2/events?brand=brand-unknown');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; items: unknown[] };
    expect(body.ok).toBe(true);
    // No events from any brand should appear for an unknown brand slug.
    expect(body.items).toHaveLength(0);
  });

  test('INV9-RT | all response items carry the correct brand_id (no leaking row)', async () => {
    // If any item in a brand-scoped list has a different brand_id, the isolation
    // contract is broken even if the IDs matched — this catches a theoretical
    // bug where an event is returned with its brand_id stripped/overwritten.
    const res = await SELF.fetch('https://t.test/api/v2/events?brand=brand-alpha');
    const body = (await res.json()) as { items: { brand_id: string }[] };
    for (const item of body.items) {
      expect(item.brand_id).toBe('brand-alpha'); // invariant #9 — every returned item must match the requested brand
    }
  });
});
