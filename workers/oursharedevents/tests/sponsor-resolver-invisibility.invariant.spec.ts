/**
 * INVARIANT 25 — sponsor_share_covenant: draft resolver-invisibility (RUNTIME).
 *
 * OSE-724 / OSE-725 (epic OSE-723). Brain Invariant #25 requires that a sponsor
 * onboarding DRAFT can never enter the share-of-voice rotation. The design
 * enforces this STRUCTURALLY: drafts live in separate tables
 * (`sponsor_business_draft`, `sponsor_asset_draft`) that the resolver never
 * queries — not via a `status`/`is_active` flag the resolver could later filter
 * on and get wrong.
 *
 * This is a RUNTIME REACHABILITY test, not a string grep (a grep is defeatable
 * and proves nothing about actual query behaviour). We:
 *   1. Seed a real event.
 *   2. Seed a `status='draft'` row in sponsor_business_draft for that event.
 *   3. Seed a real active sponsor for the SAME event (positive control).
 *   4. Run the real resolveSponsorsForEvent() and assert it returns EXACTLY the
 *      real sponsor and NEVER the draft — so the test cannot pass vacuously
 *      because the resolver is broken/empty.
 *
 * Schema guards (defense the resolver relies on):
 *   - No VIEW shaped like `sponsors` exists (a view could re-expose drafts).
 *   - `sponsors` has no `draft`/`status` column the resolver could filter on.
 *
 * String grep is kept ONLY as defense-in-depth, secondary to the runtime proof.
 *
 * @born-red invariant#25 | method: runtime-reachability | date: 2026-08-12
 */

import { env } from 'cloudflare:test';
import { seedSplitSponsor } from './helpers/seed-sponsor';
import { describe, test, expect, beforeAll } from 'vitest';
import { resolveSponsorsForEvent } from '../src/lib/sponsor-resolver';

interface TestEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}

const tenv = () => env as unknown as TestEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(tenv().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw e;
    }
  }
}

const EVENT_ID = 'evt_invis_test';

beforeAll(async () => {
  await applyMigrations();

  // 1. Real event.
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so the live sponsor resolves
    // and the draft's absence is the draft's own.
    `INSERT OR IGNORE INTO events (id, brand_id, title, slug, status, settings_json)
     VALUES (?, 'brand_invis', 'Invisibility Test', 'invisibility-test', 'active', '{"useSponsors":true}')`
  )
    .bind(EVENT_ID)
    .run();

  // 2. Draft row for that event — MUST stay invisible to the resolver.
  await env.DB.prepare(
    `INSERT INTO sponsor_business_draft (draft_token, brand_id, event_id, name, status)
     VALUES ('draft_invis_1', 'brand_invis', ?, 'Draftco (should never render)', 'draft')`
  )
    .bind(EVENT_ID)
    .run();

  // 3. Positive control — a real, active, promoted sponsor for the SAME event.
  //    OSE-799 A2: split model (business + active placement + logo asset).
  await seedSplitSponsor(env.DB, {
    id: 'spn_invis_live',
    eventId: EVENT_ID,
    name: 'Liveco (should render)',
  });

  // 4. Asset-draft row (0054) hanging off the business draft — also invisible.
  await env.DB.prepare(
    `INSERT INTO sponsor_asset_draft (id, draft_token, format, url)
     VALUES ('adraft_invis_1', 'draft_invis_1', 'poster', 'https://example.test/p.png')`
  ).run();
});

describe('Invariant 25: draft resolver-invisibility (runtime reachability)', () => {
  test('resolveSponsorsForEvent returns the live sponsor and NEVER the draft', async () => {
    const resolved = await resolveSponsorsForEvent(env.DB, EVENT_ID);
    const ids = resolved.map((s) => s.id);

    // Positive control: the resolver is actually working (not trivially empty).
    expect(ids).toContain('spn_invis_live');

    // The wall: no draft identity leaks into the rotation by any name.
    expect(ids).not.toContain('draft_invis_1');
    for (const s of resolved) {
      expect(s.name).not.toMatch(/should never render/i);
    }
  });

  test('no VIEW shaped like sponsors exists (a view could re-expose drafts)', async () => {
    const views = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='view'").all<{
      name: string;
    }>();
    const names = (views.results ?? []).map((r) => r.name);
    expect(names).not.toContain('sponsors');
    // Any view whose name contains 'sponsor' is suspicious — none should exist yet.
    expect(names.filter((n) => /sponsor/i.test(n))).toHaveLength(0);
  });

  test('the split sponsor tables have no draft/status column the resolver could filter on', async () => {
    // OSE-799 A2: the retired `sponsors` table split into sponsor_business (identity)
    // + sponsor_placement (per-event visibility). Neither may carry a draft/status
    // discriminator the resolver could accidentally surface a draft through.
    for (const table of ['sponsor_business', 'sponsor_placement']) {
      const cols = await env.DB.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
      const colNames = (cols.results ?? []).map((r) => String(r.name).toLowerCase());
      expect(colNames.length).toBeGreaterThan(0); // table exists (not silently gone)
      expect(colNames).not.toContain('status');
      expect(colNames).not.toContain('draft');
      expect(colNames).not.toContain('is_draft');
      expect(colNames).not.toContain('draft_token');
    }
  });

  test('sponsor_asset_draft carries NO share-weighting column (#25 render-inputs wall)', async () => {
    const cols = await env.DB.prepare('PRAGMA table_info(sponsor_asset_draft)').all<{
      name: string;
    }>();
    const colNames = (cols.results ?? []).map((r) => String(r.name).toLowerCase());
    // The four formats are render inputs, never purchasable slots — allocateShares
    // must have no format dimension to weight by. None of these may ever appear.
    for (const forbidden of ['tier', 'placement', 'placement_formats', 'share', 'weight', 'rank']) {
      expect(colNames, `sponsor_asset_draft must not have a '${forbidden}' column`).not.toContain(
        forbidden
      );
    }
    // Positive control: the table did seed and has its real render-input columns.
    expect(colNames).toContain('format');
    expect(colNames).toContain('focal_x');
  });

  test('defense-in-depth: resolver + allocation source never reference a *_draft table', () => {
    const sources: Record<string, string> = JSON.parse(tenv().TEST_SOURCE_FILES_JSON);
    const suspects = Object.entries(sources).filter(([path]) =>
      /sponsor-resolver\.ts$|sponsor-allocation\.ts$/.test(path.replace(/\\/g, '/'))
    );
    expect(suspects.length).toBeGreaterThanOrEqual(2);
    for (const [path, content] of suspects) {
      expect(content, `${path} must not read a *_draft table`).not.toMatch(/sponsor_\w*_draft/);
    }
  });
});
