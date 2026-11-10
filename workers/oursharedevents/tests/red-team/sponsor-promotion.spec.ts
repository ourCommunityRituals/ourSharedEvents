/**
 * OSE-736 / T8 — sponsor draft → live promotion. Red-team spec.
 *
 * The single crossing of the #25 resolver-invisibility wall must be:
 *   - covenant-gated (no covenant_acknowledged_at → refused)
 *   - brand-matched (draft.brand_id must equal the event's real brand, #9)
 *   - tier-forced (promoted tier is the covenant base, never draft/client)
 *   - idempotent (double-promote mints exactly one sponsors row)
 *   - JSON-subset (sponsor_event_types ⊆ selectable templates of chosen
 *     categories; no foreign template_id; malformed fails closed, no write)
 * and it must actually make the sponsor resolver-visible exactly once.
 *
 * @born-red invariant#25,#9,#8 | method: promotion-wall-crossing | date: 2026-08-12
 */

import { env } from 'cloudflare:test';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  promoteSponsorDraft,
  COVENANT_BASE_TIER,
  type PromotionEnv,
} from '../../src/lib/sponsor-promotion';
import { resolveSponsorsForEvent } from '../../src/lib/sponsor-resolver';
import { sovTierOf } from '../../src/lib/sponsor-allocation';

interface RawEnv {
  DB: D1Database;
  TEST_MIGRATION_STATEMENTS: string;
  TEST_SOURCE_FILES_JSON: string;
}
const e = () => env as unknown as RawEnv;
const penv = () => env as unknown as PromotionEnv;

async function applyMigrations(): Promise<void> {
  const statements: string[] = JSON.parse(e().TEST_MIGRATION_STATEMENTS);
  for (const stmt of statements) {
    try {
      await env.DB.prepare(stmt).run();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('duplicate column name')) continue;
      if (msg.includes('no such column')) continue;
      throw err;
    }
  }
}

async function seedDraft(
  token: string,
  brand: string,
  eventId: string | null,
  opts: { covenant?: boolean; categories?: unknown } = {}
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sponsor_business_draft
       (draft_token, brand_id, event_id, name, category_selections, covenant_acknowledged_at, status,
        free_tier_eligible, eligibility_source)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  )
    .bind(
      token,
      brand,
      eventId,
      `Co ${token}`,
      JSON.stringify(opts.categories ?? [{ category: 'bar_events', mode: 'whole' }]),
      opts.covenant === false ? null : '2026-08-12T00:00:00Z',
      // OSE-744: grant eligibility so the happy path clears the new promotion gate.
      // (community-benefit lane; server-set). opts.ineligible seeds a 402 case.
      opts.ineligible === true ? 0 : 1,
      opts.ineligible === true ? null : 'community_benefit'
    )
    .run();
}

beforeAll(async () => {
  await applyMigrations();
  await env.DB.prepare(
    // OSE-1900: the event chose to have sponsors, so a promoted draft can be resolver-visible.
    `INSERT INTO events (id, brand_id, title, slug, status, settings_json) VALUES ('evt-P','brand-P','P','slug-p','active','{"useSponsors":true}')`
  ).run();
});

describe('OSE-736 — happy path crosses the #25 wall exactly once', () => {
  test('acknowledged, brand-matched draft promotes → live + resolver-visible', async () => {
    await seedDraft('d_ok', 'brand-P', 'evt-P', { covenant: true });
    const res = await promoteSponsorDraft(penv(), 'd_ok');
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    // OSE-799 A2: promotion writes the split model — name on sponsor_business,
    // tier/is_active/event_id on the sponsor_placement it created.
    const sp = await env.DB.prepare(
      `SELECT sp.tier AS tier, sp.is_active AS is_active, sp.event_id AS event_id,
              sp.sponsor_accepted AS sponsor_accepted, sb.name AS name
         FROM sponsor_business sb
         JOIN sponsor_placement sp ON sp.sponsor_business_id = sb.id
        WHERE sb.id = ?`
    )
      .bind(res.sponsor_id)
      .first<{
        tier: string;
        is_active: number;
        event_id: string;
        sponsor_accepted: number;
        name: string;
      }>();
    expect(sp?.is_active).toBe(1);
    expect(sp?.event_id).toBe('evt-P');
    // Promotion IS the sponsor's consent (ADR-019 / CCR-PR567 re-run): a promoted
    // self-signup lands sponsor_accepted=1, so the strict resolver renders it.
    expect(sp?.sponsor_accepted).toBe(1);
    // FIX 1 — tier server-forced to the covenant base (never escalated).
    expect(sp?.tier).toBe(COVENANT_BASE_TIER);
    expect(sovTierOf(sp!.tier)).toBe('base');

    // sponsor_event_types ⊆ selectable bar_events templates (bar_night, music_event).
    expect(res.template_ids.sort()).toEqual(['bar_night', 'music_event']);

    // Draft flipped.
    const draft = await env.DB.prepare(
      'SELECT status, promoted_sponsor_id FROM sponsor_business_draft WHERE draft_token = ?'
    )
      .bind('d_ok')
      .first<{ status: string; promoted_sponsor_id: string }>();
    expect(draft?.status).toBe('promoted');
    expect(draft?.promoted_sponsor_id).toBe(res.sponsor_id);

    // The wall is crossed: the sponsor is now resolver-visible.
    const resolved = await resolveSponsorsForEvent(env.DB, 'evt-P');
    expect(resolved.map((s) => s.id)).toContain(res.sponsor_id);
  });
});

describe('OSE-736 — gates refuse before any write', () => {
  test('missing covenant → 412, no sponsor minted', async () => {
    await seedDraft('d_nocov', 'brand-P', 'evt-P', { covenant: false });
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    const res = await promoteSponsorDraft(penv(), 'd_nocov');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(412);
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
  });

  test('brand mismatch (draft brand ≠ event brand) → 403 (#9)', async () => {
    await seedDraft('d_badbrand', 'brand-OTHER', 'evt-P', { covenant: true });
    const res = await promoteSponsorDraft(penv(), 'd_badbrand');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(403);
  });

  test('malformed category_selections → 400, fail closed, no write', async () => {
    await env.DB.prepare(
      `INSERT INTO sponsor_business_draft (draft_token, brand_id, event_id, name, category_selections, covenant_acknowledged_at, status, free_tier_eligible, eligibility_source)
       VALUES ('d_badjson','brand-P','evt-P','Bad JSON Co','{not valid json','2026-08-12T00:00:00Z','draft', 1, 'community_benefit')`
    ).run();
    const before = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    const res = await promoteSponsorDraft(penv(), 'd_badjson');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.status).toBe(400);
    const after = await env.DB.prepare('SELECT COUNT(*) AS c FROM sponsor_business').first<{
      c: number;
    }>();
    expect(after?.c).toBe(before?.c);
  });
});

describe('OSE-736 — double-promote + JSON-subset', () => {
  test('promoting twice yields exactly ONE sponsors row (409 on the second)', async () => {
    await seedDraft('d_dbl', 'brand-P', 'evt-P', { covenant: true });
    const first = await promoteSponsorDraft(penv(), 'd_dbl');
    expect(first.ok).toBe(true);
    const second = await promoteSponsorDraft(penv(), 'd_dbl');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);

    const cnt = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM sponsor_business WHERE name = 'Co d_dbl'"
    ).first<{ c: number }>();
    expect(cnt?.c).toBe(1);
  });

  test('JSON injection: foreign template_id / unknown category cannot widen the set', async () => {
    // excluded can only REMOVE; an unknown category contributes nothing; a foreign
    // template id in `excluded` is a no-op. Derived set stays ⊆ selectable.
    await seedDraft('d_inj', 'brand-P', 'evt-P', {
      covenant: true,
      categories: [
        {
          category: 'bar_events',
          mode: 'custom',
          excluded: ['music_event', 'totally_foreign_template'],
        },
        { category: 'no_such_category', mode: 'whole' },
      ],
    });
    const res = await promoteSponsorDraft(penv(), 'd_inj');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // bar_events selectable minus music_event = {bar_night}; foreign id ignored; unknown category empty.
    expect(res.template_ids).toEqual(['bar_night']);
    // And the DB rows agree — no foreign template_id was inserted.
    const rows = await env.DB.prepare(
      'SELECT template_id FROM sponsor_event_types WHERE sponsor_id = ?'
    )
      .bind(res.sponsor_id)
      .all<{ template_id: string }>();
    expect((rows.results ?? []).map((r) => r.template_id)).toEqual(['bar_night']);
  });
});

describe('OSE-736 — is_active writer enumeration (truthful, not "sole writer")', () => {
  test('every source that writes sponsor_placement.is_active is a known covenant/admin-gated path', () => {
    const sources: Record<string, string> = JSON.parse(e().TEST_SOURCE_FILES_JSON);
    const writers = Object.entries(sources)
      .filter(([p]) => p.replace(/\\/g, '/').includes('/src/'))
      .filter(
        ([, c]) =>
          // OSE-799 A2: is_active moved to sponsor_placement. A writer is an INSERT
          // of a placement (create/promotion, is_active=1) or an UPDATE that
          // ASSIGNS sponsor_placement.is_active (admin soft-delete).
          //
          // The UPDATE match is scoped to the SET clause (before the first WHERE):
          // a statement that merely FILTERS on `WHERE ... is_active = 1` is a READ,
          // not a write. The earlier `SET[\s\S]*is_active` matched that too, which
          // false-flagged sponsor-home.ts's respond UPDATE — it SETs
          // sponsor_accepted and only references is_active in its WHERE / subquery
          // (PR #567). A real `SET is_active = …` still matches and still fails.
          /INSERT\s+INTO\s+sponsor_placement\b/i.test(c) ||
          /UPDATE\s+sponsor_placement\s+SET\s+(?:(?!\bWHERE\b)[\s\S])*?\bis_active\s*=/i.test(c)
      )
      .map(([p]) => p.replace(/\\/g, '/').replace(/^.*\/src\//, 'src/'))
      .sort();

    // The ONLY writers: the admin sponsor handlers (create + soft-delete, admin-
    // gated + brand-scoped), the promotion lib (covenant + brand gated), and
    // sponsor discovery (reviewed 2026-09-30, PR #700). If a new writer appears,
    // this test fails until it is reviewed and enumerated.
    //
    // sponsor-discovery.ts has two writes, and neither lets a sponsor turn a
    // placement ON by itself:
    //   - createSponsorRequest INSERTs a sponsor-asked placement with
    //     is_active = 0 (a literal, never a bound value) — token-verified, brand
    //     from the signed claim. Behaviourally held by sponsor-discovery.spec.ts
    //     ("stored as the sponsor's yes but switched off"; verified red by
    //     making it insert is_active = 1).
    //   - answerSponsorRequest UPDATEs is_active = 1 only on the organizer's
    //     approval, reached solely through POST
    //     /api/v2/admin/sponsor-requests/:id/respond (requireAdmin at the router,
    //     admin brand scope in the SELECT; outside scope = 404).
    expect(writers).toEqual([
      'src/handlers/sponsors.ts',
      'src/lib/sponsor-discovery.ts',
      'src/lib/sponsor-promotion.ts',
    ]);
  });
});
